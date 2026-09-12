// Path: T2Editor/extend/js/t2llm.js
//
// T2LLM — T2Editor를 위한 경량 LLM 오케스트레이션 레이어 (lite-MCP)
// ============================================================================
// 목적: LLM이 T2Editor를 "사람 작가처럼" 조작할 수 있도록, 모든 글쓰기 서식과
// (collab 제외) 모든 플러그인의 콘텐츠 생성 기능을 하나의 압축 DSL과 소수의
// 함수 호출로 규격화한다. 실제 LLM API를 호출하는 연결부는 포함하지 않는다 —
// 이 파일은 이미 어딘가에서 실행 중인 LLM(에이전트)이 브라우저 콘솔·자동화
// 도구·다른 확장 등을 통해 T2Editor를 "조작하는 손"으로 사용할 표준 인터페이스만
// 제공한다.
//
// 왜 DSL인가: 매 서식 변경마다 "커서를 A로 옮기고 B를 선택한 뒤 bold 실행" 같은
// selection 기반 명령을 여러 턴에 걸쳐 시키면 토큰을 급격히 소모하고 실패에도
// 취약하다. 대신 LLM이 이미 잘 아는 마크다운과 거의 동일한 압축 문법으로 문서
// 전체(또는 이어붙일 부분)를 한 번에 기술하면, 이 스크립트가 그 자리에서
// DOM으로 컴파일한다 — 실제 텍스트 선택이나 실행취소 스택 조작이 전혀 없다.
//
// 공개 API (window.T2LLM):
//   T2LLM.spec()                         → 사람도, LLM도 읽을 수 있는 DSL 설명 문자열
//   T2LLM.list()                         → 페이지 내 에디터 인스턴스 id 배열
//   await T2LLM.apply(dsl, opts)         → DSL을 컴파일해 문서에 적용
//   T2LLM.read(opts)                     → 현재 문서를 DSL로 역직렬화해 반환
//
//   opts = { id?: string, mode?: 'replace'|'append' }
//     id   생략 시 페이지의 첫 번째 에디터를 사용
//     mode 생략 시 'append' (기존 내용 뒤에 이어씀)
//
// 상태를 전혀 저장하지 않는다 — 매 호출이 그 순간의 DOM만 다룬다.
// ============================================================================

(function () {
    'use strict';

    // compileBlock() 이 "이 블록은 해당 플러그인이 이미 자체적으로 문서에 삽입했으므로
    // apply() 루프가 재삽입을 시도하지 말라"를 상위 루프에 알리는 시그널.
    // null 과 다른 객체로 두어 "삽입이 실패해서 null" 과 "이미 삽입되었기 때문에
    // null 취급"을 구별한다. 모듈 외부로는 노출하지 않는다.
    const T2LLM_SELF_INSERTED = Object.freeze({ __t2llm: 'self_inserted' });

    // ── 0. 에디터 인스턴스 레지스트리 ─────────────────────────────────────────
    // editor.lib.php 는 인스턴스를 window[textareaId + '_editor'] 에 노출한다
    // (id 는 사이트마다 다르므로 하드코딩 불가 — 매 호출 시 스캔).
    function findEditors() {
        const found = [];
        for (const key in window) {
            if (!key.endsWith('_editor')) continue;
            let val;
            try { val = window[key]; } catch (_) { continue; }
            if (val && typeof val === 'object' && val.editor && typeof val.getPlugin === 'function') {
                found.push({ id: key.slice(0, -'_editor'.length), instance: val });
            }
        }
        return found;
    }

    function resolveEditor(id) {
        const list = findEditors();
        if (!list.length) throw new Error(T2Utils.tf('t2llm.err_no_active_editor', {}, 'T2LLM: No active T2Editor instance found on the page.'));
        if (!id) return list[0].instance;
        const hit = list.find(e => e.id === id);
        if (!hit) throw new Error(T2Utils.tf('t2llm.err_editor_not_found', {id: id, list: list.map(function(e){return e.id;}).join(', ')}, 'T2LLM: No editor found for id "' + id + '". (available: ' + list.map(function(e){return e.id;}).join(', ') + ')'));
        return hit.instance;
    }

    // ── 1. 인라인 마크업 (P/H1-H6 텍스트 내부) ────────────────────────────────
    // **bold**  *italic*  ~~strike~~  ++underline++  `code`  [text](url)
    // {c:#hex}text{/c}   {s:px}text{/s}
    // 마크다운과 거의 동일 — LLM이 이미 아는 문법을 최대한 재사용해 학습 비용을 없앤다.
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function sanitizeHref(url) {
        const raw = String(url || '').trim();
        if (!raw) return '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return '';
        return raw;
    }

    function compileInline(text) {
        // 토큰 순서: code(먼저 격리, 내부는 재해석 안 함) → link → bold → italic → strike → underline → color → size
        // 각 단계는 이미 처리된 구간을 <!--T2LLM:n--> 플레이스홀더로 빼서 겹쳐 매칭되는 것을 막는다.
        const vault = [];
        function stash(html) {
            vault.push(html);
            return `\u0000${vault.length - 1}\u0000`;
        }

        let s = escapeHtml(text);

        // inline code — 내부는 그대로(재해석 금지)
        s = s.replace(/`([^`]+)`/g, (_, code) => stash(`<code>${code}</code>`));

        // link [text](url) — url 안에 괄호 한 겹까지 허용(예: 위키형 URL)
        s = s.replace(/\[([^\]]+)\]\(([^()\s]*(?:\([^()]*\)[^()\s]*)*)\)/g, (_, t, url) => {
            const safe = sanitizeHref(url);
            if (!safe) return t;
            return stash(`<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${t}</a>`);
        });

        // color {c:#rrggbb}text{/c}
        s = s.replace(/\{c:(#[0-9A-Fa-f]{6})\}([\s\S]*?)\{\/c\}/g, (_, hex, t) =>
            stash(`<span style="color:${hex}">${t}</span>`));

        // size {s:px}text{/s}
        s = s.replace(/\{s:(\d{1,3})\}([\s\S]*?)\{\/s\}/g, (_, px, t) => {
            const n = Math.max(8, Math.min(96, parseInt(px, 10) || 16));
            return stash(`<span style="font-size:${n}px">${t}</span>`);
        });

        // bold **text**
        s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => stash(`<b>${t}</b>`));
        // italic *text*
        s = s.replace(/\*([^*]+)\*/g, (_, t) => stash(`<i>${t}</i>`));
        // strike ~~text~~
        s = s.replace(/~~([^~]+)~~/g, (_, t) => stash(`<s>${t}</s>`));
        // underline ++text++
        s = s.replace(/\+\+([^+]+)\+\+/g, (_, t) => stash(`<u>${t}</u>`));

        // vault 복원 (역순 아님 — 플레이스홀더가 겹치지 않으므로 단순 치환으로 충분)
        s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => vault[Number(i)]);

        return s;
    }

    // DOM → 인라인 마크업 역변환 (read 용, 대략적 근사 — 완전한 왕복을 보장하진 않음)
    function decompileInline(node) {
        let out = '';
        node.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                out += child.textContent;
                return;
            }
            if (child.nodeType !== Node.ELEMENT_NODE) return;
            const tag = child.tagName.toLowerCase();
            const inner = decompileInline(child);
            switch (tag) {
                case 'b': case 'strong': out += `**${inner}**`; break;
                case 'i': case 'em': out += `*${inner}*`; break;
                case 's': case 'strike': case 'del': out += `~~${inner}~~`; break;
                case 'u': out += `++${inner}++`; break;
                case 'code': out += `\`${inner}\``; break;
                case 'a': {
                    const href = child.getAttribute('href') || '';
                    out += `[${inner}](${href})`;
                    break;
                }
                case 'span': {
                    const color = child.style && child.style.color;
                    const size = child.style && child.style.fontSize;
                    if (color) { out += `{c:${rgbToHex(color)}}${inner}{/c}`; }
                    else if (size) { out += `{s:${parseInt(size, 10) || 16}}${inner}{/s}`; }
                    else { out += inner; }
                    break;
                }
                case 'br': out += '\n'; break;
                default: out += inner;
            }
        });
        return out;
    }

    function rgbToHex(c) {
        const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return /^#/.test(c) ? c : '#000000';
        const h = n => Number(n).toString(16).padStart(2, '0');
        return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
    }

    // ── 2. DSL 파서 ──────────────────────────────────────────────────────────
    // 한 줄 = 한 블록. `TAG: args` 형식. CODE/DRAW 는 마크다운처럼 ``` 펜스로 감싸
    // 여러 줄 원문을 그대로 담는다.
    function parseDSL(text) {
        const lines = String(text).replace(/\r\n/g, '\n').split('\n');
        const blocks = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            if (!trimmed) { i++; continue; }

            // 펜스 블록: ```lang ... ``` (CODE), ```svg ... ``` (DRAW)
            const fenceMatch = trimmed.match(/^```(\w*)$/);
            if (fenceMatch) {
                const lang = fenceMatch[1] || '';
                const body = [];
                i++;
                while (i < lines.length && lines[i].trim() !== '```') {
                    body.push(lines[i]);
                    i++;
                }
                i++; // closing fence
                if (lang.toLowerCase() === 'svg') {
                    blocks.push({ tag: 'DRAW', arg: body.join('\n') });
                } else {
                    blocks.push({ tag: 'CODE', arg: lang, body: body.join('\n') });
                }
                continue;
            }

            const m = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.*)$/);
            if (m) {
                blocks.push({ tag: m[1], arg: m[2] });
            } else {
                // 태그 없는 줄은 그냥 문단으로 취급 (LLM이 형식을 깜빡해도 콘텐츠 유실 없게)
                blocks.push({ tag: 'P', arg: trimmed });
            }
            i++;
        }
        return blocks;
    }

    // ── 3. 블록 컴파일러: DSL 블록 → 실제 DOM 노드 ────────────────────────────
    // 각 케이스는 해당 플러그인의 "순수 생성" 메서드만 재사용한다(모달·이벤트 없음).
    async function compileBlock(block, editor) {
        const { tag, arg, body } = block;

        switch (tag) {
            case 'P': {
                const p = document.createElement('p');
                p.innerHTML = compileInline(arg) || '<br>';
                return p;
            }
            case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
                const h = document.createElement(tag.toLowerCase());
                h.innerHTML = compileInline(arg);
                return h;
            }
            case 'HR': {
                const p = document.createElement('p');
                p.innerHTML = '\u200B';
                return p; // T2Editor 코어는 <hr> 전용 블록이 없어 시각적 구분은 문단 간격으로 대체
            }
            case 'LINK': {
                const [url, ...rest] = String(arg).split('|');
                const text = rest.join('|').trim() || url;
                const safe = sanitizeHref(url);
                if (!safe) return null;
                const p = document.createElement('p');
                const a = document.createElement('a');
                a.href = safe; a.target = '_blank'; a.rel = 'noopener noreferrer';
                a.textContent = text;
                p.appendChild(a);
                return p;
            }
            case 'CLIPURL': {
                const plugin = await ensurePlugin(editor, 'clipurl');
                if (!plugin || typeof plugin.insertLink !== 'function') return null;
                // clipurl 플러그인은 자체적으로 커서 위치에 삽입한다.
                //   [FIX] apply() 흐름과의 정합을 위해 커서를 문서 끝(직전 삽입 지점)에
                //   먼저 위치시켜, 자체 삽입도 결국 append 순서를 지키게 한다.
                //   (apply() 루프가 매 삽입 뒤에 커서를 이동시켜 두므로 이 함수는
                //   그 시점의 커서 위치를 신뢰하기만 하면 된다.)
                plugin.insertLink(sanitizeHref(arg));
                return T2LLM_SELF_INSERTED; // 이미 삽입 완료 — 상위 루프에서 추가 삽입 불필요
            }
            case 'IMG': {
                const [url, w, h, alt] = String(arg).split('|');
                const plugin = await ensurePlugin(editor, 'image');
                if (!plugin || typeof plugin.createImageBlock !== 'function') return null;
                const block2 = plugin.createImageBlock({
                    url: url && url.trim(),
                    width: parseInt(w, 10) || undefined,
                    height: parseInt(h, 10) || undefined,
                });
                if (block2 && alt) {
                    const img = block2.querySelector('img');
                    if (img) img.alt = alt.trim();
                }
                return block2;
            }
            case 'VIDEO': {
                const plugin = await ensurePlugin(editor, 'video');
                if (!plugin || typeof plugin.createVideoBlock !== 'function') return null;
                const info = window.T2Utils && T2Utils.getVideoType ? T2Utils.getVideoType(String(arg).trim()) : null;
                if (!info) return null;
                return plugin.createVideoBlock(info);
            }
            case 'FILE': {
                const [url, filename, size] = String(arg).split('|');
                const plugin = await ensurePlugin(editor, 'file');
                if (!plugin || typeof plugin.insertFileBlock !== 'function') return null;
                // insertFileBlock 은 함수 이름과 달리 블록을 반환하지 않고 커서 위치에
                // 직접 삽입까지 수행한다(이벤트 부착 완료 상태). apply() 루프가
                // 커서를 이미 문서 끝(직전 삽입 지점)에 두므로 여기서는 그대로 호출만
                // 하면 자연스러운 append 순서로 붙는다. self-inserted 시그널을 돌려
                // 상위 루프가 재삽입을 시도하지 않도록 한다.
                plugin.insertFileBlock({
                    url: url && url.trim(),
                    original_name: (filename || 'file').trim(),
                    size: parseInt(size, 10) || 0,
                });
                return T2LLM_SELF_INSERTED;
            }
            case 'MEME': {
                const plugin = await ensurePlugin(editor, 'meme');
                if (!plugin || typeof plugin._insertBlock !== 'function') return null;
                await plugin._insertBlock({ url: String(arg).trim() });
                return T2LLM_SELF_INSERTED; // meme 플러그인이 image 파이프라인을 통해 자체 삽입 완료
            }
            case 'TABLE': {
                const [cols, rows, width, border] = String(arg).split('|');
                const plugin = await ensurePlugin(editor, 'table');
                if (!plugin || typeof plugin.createTable !== 'function') return null;
                const table = plugin.createTable(
                    parseInt(cols, 10) || 3,
                    parseInt(rows, 10) || 3,
                    width ? width.trim() : '100%',
                    border ? border.trim() : 'solid'
                );
                return typeof plugin.createTableWrapper === 'function'
                    ? plugin.createTableWrapper(table)
                    : table;
            }
            case 'CODE': {
                const plugin = await ensurePlugin(editor, 'code');
                if (!plugin || typeof plugin.createCodeBlock !== 'function') return null;
                const block2 = plugin.createCodeBlock();
                const codeEl = block2.querySelector('code');
                if (codeEl) {
                    codeEl.textContent = body || '';
                    codeEl.classList.remove('code-placeholder');
                    if (arg) codeEl.setAttribute('data-lang', arg.trim());
                }
                return block2;
            }
            case 'DRAW': {
                return await compileDrawing(editor, body || arg || '');
            }
            default:
                console.warn(`[T2LLM] Unknown tag "${tag}" — treating as paragraph.`);
                const p = document.createElement('p');
                p.innerHTML = compileInline(arg || '');
                return p;
        }
    }

    async function ensurePlugin(editor, name) {
        if (!editor.getPlugin(name) && typeof editor.loadPluginImmediately === 'function') {
            try { await editor.loadPluginImmediately(name); } catch (e) { console.warn(`[T2LLM] 플러그인 로드 실패: ${name}`, e); }
        }
        return editor.getPlugin(name);
    }

    // DRAW: LLM이 준 SVG 마크업을 캔버스에 렌더 → draw 플러그인의 실제 업로드
    // 파이프라인(image_upload.php)을 그대로 통해 저장 → 완성된 t2-drawing-block을
    // 반환한다. 이렇게 해야 사람이 나중에 그림판으로 다시 열어 이어 그릴 수 있다
    // (단순 <img> 삽입과 달리 draw 플러그인의 데이터 구조를 그대로 따름).
    async function compileDrawing(editor, svgMarkup) {
        const plugin = await ensurePlugin(editor, 'draw');
        if (!plugin || typeof plugin.createPlaceholderBlock !== 'function') return null;

        const W = 800, H = 600;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.warn('[T2LLM] 캔버스 컨텍스트를 생성할 수 없어 드로잉을 건너뜁니다.');
            return null;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);

        try {
            const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml' });
            const svgUrl = URL.createObjectURL(svgBlob);
            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = reject;
                el.src = svgUrl;
            });
            ctx.drawImage(img, 0, 0, W, H);
            URL.revokeObjectURL(svgUrl);
        } catch (e) {
            console.warn('[T2LLM] SVG 렌더링 실패, 빈 캔버스로 진행합니다.', e);
        }

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('empty blob')), 'image/png', 1.0);
        });

        const placeholder = plugin.createPlaceholderBlock();

        try {
            const file = new File([blob], `t2llm_drawing_${Date.now()}.png`, { type: 'image/png' });
            const formData = new FormData();
            formData.append('bf_file[]', file);
            formData.append('uid', editor.generateUid ? editor.generateUid() : String(Date.now()));

            const uploadUrl = `${window.t2editor_url || ''}/plugin/image/image_upload.php`;
            const res = await fetch(uploadUrl, { method: 'POST', body: formData });
            const data = await res.json();

            if (data && data.success && data.files && data.files[0]) {
                plugin.currentDrawingBlock = placeholder;
                if (typeof plugin.updateDrawingBlock === 'function') {
                    plugin.updateDrawingBlock(data.files[0]);
                }
            }
        } catch (e) {
            console.warn('[T2LLM] 드로잉 업로드 실패, 플레이스홀더만 삽입합니다.', e);
        }

        return placeholder;
    }

    // ── 4. 문서 삽입 ─────────────────────────────────────────────────────────
    //
    // 여기가 사람이 UI로 삽입한 블록과 LLM이 삽입한 블록의 "동등성"을 보장하는 지점.
    // (v10.2.0-beta8.0.x 버그 픽스) 이전 구현은 단순히 `editor.appendChild(node)` 로만
    // 붙였기 때문에:
    //   · 이미지 블록  → 앞뒤 boundary 문단 미확보 → 사용자가 블록 사이에 커서를 놓지
    //                    못하고, 리사이즈 슬라이더/삭제 버튼/이동 버튼 클릭이 편집
    //                    흐름에 방해받는 문제
    //   · 비디오 블록  → 위/아래 이동·삭제 버튼 클릭이 정상 반응하지 않는 문제
    //   · 파일 블록    → 위/아래 이동·삭제 버튼 클릭이 정상 반응하지 않는 문제
    //   · 테이블 블록  → 셀 추가/삭제·행 추가/삭제·테이블 삭제 버튼이 아예 죽어
    //                    있고, 셀 편집·리사이즈도 안 되는 심각한 문제
    //     (원인: t2llm.js 가 createTable/createTableWrapper 만 부르고, table.js 의
    //     setupTableControlEvents/setupTableCellEditing/setupTableResizing 을 호출
    //     하지 않았음. 이 3종은 사용자 정식 삽입 경로인 insertTableWithLineBreaks 안
    //     에서만 호출되었기 때문에 AI 경유 삽입 시 컨트롤이 죽은 채로 남았다.)
    //
    // 해결책은 구조적으로:
    //   (1) 각 블록 타입에 대해 "사람이 UI로 삽입할 때와 동일한 후처리"를 코어의
    //       공개 메서드만 이용해 대신 호출해 준다. 새 API 를 만들지 않고, 이미
    //       존재하는 setup 함수들을 그대로 재사용한다 — 그래야 UI 경로와의 동작
    //       동등성이 자동으로 유지된다.
    //   (2) 미디어 블록은 삽입 즉시 editor.ensureBlockBoundaryLines(node) 로 앞뒤
    //       ZWSP 문단을 확보한다. apply() 마지막에서 어차피 normalizeContent() 를
    //       호출하지만, 그 사이에 이어 붙는 다음 블록의 커서 위치 계산이 이미
    //       흔들려 있으므로 "블록 단위 즉시 정렬" 이 정답이다.
    //   (3) 삽입이 끝난 뒤 커서를 마지막 블록 바로 뒤 boundary 문단으로 이동시켜
    //       두어, 다음 self-insert 형 블록(FILE/MEME/CLIPURL — 커서 위치에
    //       스스로 붙는 타입)도 자연스러운 append 순서를 갖게 한다.
    // 이 세 가지가 함께 갖춰졌을 때만, AI 가 넣은 이미지/비디오/파일/테이블도
    // 사람이 넣은 것과 완전히 똑같이 크기 조정·이동·삭제·셀 편집이 가능해진다.
    function appendBlockToEditor(editor, node) {
        if (!node || node === T2LLM_SELF_INSERTED) {
            // FILE/MEME/CLIPURL 등 자체 삽입 블록 — 이미 각 플러그인이 자기
            // 정식 삽입 경로로 넣었으므로 여기서 추가 처리 불필요.
            // (커서 위치는 apply() 루프가 매 삽입 뒤에 문서 끝으로 재고정한다.)
            return;
        }
        editor.editor.appendChild(node);
        // 방금 붙인 블록에 대한 "사람이 넣은 것과 동등한 상태" 후처리.
        finalizeInsertedNode(editor, node);
    }

    // 방금 문서에 붙인 노드에 대해, 그 블록 타입이 요구하는 후처리를 코어/플러그인의
    // 공개 메서드만 이용해 대신 걸어준다. 여기서 하는 일은 "사용자가 UI로 삽입했다면
    // 어차피 실행됐을 초기화" 뿐이다 — 즉 T2LLM 은 UI 삽입 파이프라인의 후반부를
    // 다시 걷는 것이지, 새로운 렌더링 규칙을 만들지 않는다.
    function finalizeInsertedNode(editor, node) {
        if (!node || node.nodeType !== 1 /* ELEMENT_NODE */) return;

        // (a) 테이블 wrapper — createTableWrapper 는 컨트롤 DOM 만 만들고 이벤트는
        //     붙이지 않는다. UI 경로의 insertTableWithLineBreaks 는 이 뒤에
        //     반드시 setupTableControlEvents / setupTableCellEditing /
        //     setupTableResizing 을 호출한다. AI 경로도 동일하게 걸어준다.
        //     (이걸 걸어주지 않으면 열 추가/삭제·행 추가/삭제·테이블 삭제 버튼과
        //     셀 편집·컬럼 리사이즈가 전부 죽는다.)
        if (node.classList && node.classList.contains('t2-table-wrapper')) {
            const tablePlugin = editor.getPlugin && editor.getPlugin('table');
            const table = node.querySelector('.t2-table') || node.querySelector('table');
            if (tablePlugin && table) {
                const controls = node.querySelector('.t2-table-controls');
                try {
                    if (controls && typeof tablePlugin.setupTableControlEvents === 'function') {
                        tablePlugin.setupTableControlEvents(controls, table);
                    }
                    if (typeof tablePlugin.setupTableCellEditing === 'function') {
                        tablePlugin.setupTableCellEditing(table);
                    }
                    if (typeof tablePlugin.setupTableResizing === 'function') {
                        tablePlugin.setupTableResizing(table);
                    }
                } catch (e) {
                    console.warn('[T2LLM] 테이블 컨트롤 활성화 중 오류(무시하고 계속):', e);
                }
            }
        }

        // (b) boundary 문단 확보 — 미디어 블록은 앞뒤에 편집 가능한 ZWSP 문단이
        //     있어야 사용자가 블록 사이/앞/뒤에 커서를 두고 편집을 이어갈 수 있다.
        //     또한 인접한 contentEditable=false 미디어 블록끼리 붙어 있으면
        //     브라우저 selection 이 그 사이로 들어가지 못해, 컨트롤 버튼 클릭
        //     자체가 방해받는 경우가 있다. 코어의 ensureBlockBoundaryLines 가
        //     이 문제를 정확히 해결한다.
        if (typeof editor.ensureBlockBoundaryLines === 'function') {
            try { editor.ensureBlockBoundaryLines(node); } catch (_) { /* noop */ }
        }

        // (c) 커서를 방금 붙인 블록 바로 뒤로 옮겨, 다음 turn 에 실행되는
        //     self-insert 형 블록(FILE/MEME/CLIPURL) 이 커서 위치에 자기 자신을
        //     붙일 때 자연스럽게 append 순서를 지키게 한다. 사용자에게 시각적
        //     스크롤이 튀는 부작용을 피하려고 selection 만 옮기고 scrollIntoView
        //     는 호출하지 않는다.
        try {
            const sel = window.getSelection();
            if (sel) {
                const after = node.nextElementSibling || node;
                const r = document.createRange();
                if (after && after !== node && after.firstChild) {
                    r.setStart(after, 0);
                } else {
                    r.setStartAfter(node);
                }
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
            }
        } catch (_) { /* selection 이 없는 헤드리스 상황에서는 조용히 무시 */ }
    }

    // 문서 끝(마지막 자식 뒤)으로 커서를 이동시킨다. FILE/MEME/CLIPURL 등
    // "커서 위치에 자기 자신을 붙이는" 플러그인들이 append 순서를 지키도록,
    // apply() 시작 시점과 self-insert 직후에 이 유틸을 호출한다.
    // (사용자가 편집 중 커서를 문서 중간에 두고 AI 를 호출한 경우, replace 모드로
    // 문서가 통째로 지워진 뒤에도 이전 selection 범위 참조가 남아 있어
    // 플러그인의 삽입 지점이 예측 불가한 위치가 될 수 있다. 이 함수가 그
    // selection 을 매 삽입 사이마다 확실히 "문서 끝" 으로 재고정한다.)
    function collapseSelectionToEnd(editor) {
        try {
            const sel = window.getSelection();
            if (!sel) return;
            const editorEl = editor.editor;
            const r = document.createRange();
            if (editorEl.lastChild) {
                r.setStartAfter(editorEl.lastChild);
            } else {
                r.setStart(editorEl, 0);
            }
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
        } catch (_) { /* noop */ }
    }

    // ── 5. 공개 API ──────────────────────────────────────────────────────────
    async function apply(dsl, opts) {
        opts = opts || {};
        const editor = resolveEditor(opts.id);
        const blocks = parseDSL(dsl);

        if (opts.mode !== 'append') {
            editor.editor.innerHTML = '';
        }

        // 첫 블록을 처리하기 전에 커서를 문서 끝으로 세팅한다.
        // 특히 self-insert 형 블록(FILE/MEME/CLIPURL)이 문서 첫 블록으로
        // 오는 경우, 남아 있던 오래된 selection 이 에디터 밖 요소를 가리키고
        // 있으면 플러그인이 삽입 자체를 포기하는 사고가 발생할 수 있다.
        collapseSelectionToEnd(editor);

        for (const block of blocks) {
            try {
                const node = await compileBlock(block, editor);
                appendBlockToEditor(editor, node);
                // self-insert 형(FILE/MEME/CLIPURL) 블록은 appendBlockToEditor 가
                // finalizeInsertedNode 에서 selection 을 손대지 않고 지나가므로,
                // 이 지점에서 커서를 다시 문서 끝으로 고정해 다음 블록이
                // 예상한 위치에 붙도록 한다.
                if (node === T2LLM_SELF_INSERTED) {
                    collapseSelectionToEnd(editor);
                }
            } catch (e) {
                console.error(`[T2LLM] 블록 처리 실패 (${block.tag}):`, e);
            }
        }

        if (typeof editor.normalizeContent === 'function') editor.normalizeContent();
        if (typeof editor.createUndoPoint === 'function') editor.createUndoPoint();
        if (typeof editor.autoSave === 'function') editor.autoSave();

        return { ok: true, blocksApplied: blocks.length };
    }

    // 현재 문서를 DSL로 근사 역직렬화. 완벽한 왕복(round-trip)을 보장하진 않지만
    // LLM이 "지금 문서가 대략 어떤 구조인지" 저비용으로 파악하기엔 충분하다.
    function read(opts) {
        opts = opts || {};
        const editor = resolveEditor(opts.id);
        const out = [];

        editor.editor.childNodes.forEach(node => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const tag = node.tagName.toLowerCase();

            if (node.dataset && node.dataset.t2Block) {
                switch (node.dataset.t2Block) {
                    case 'drawing': {
                        const c = node.querySelector('[data-drawing-url]');
                        out.push(`IMG: ${c ? c.getAttribute('data-drawing-url') : ''} (drawing block — DRAW로 재생성 불가, 이미지로만 확인 가능)`);
                        return;
                    }
                }
            }
            if (node.classList && node.classList.contains('t2-image-block')) {
                const img = node.querySelector('img');
                if (img) out.push(`IMG: ${img.src}|${img.naturalWidth || ''}|${img.naturalHeight || ''}|${img.alt || ''}`);
                return;
            }
            if (node.classList && node.classList.contains('t2-video-block')) {
                const src = node.querySelector('[data-video-url]');
                out.push(`VIDEO: ${src ? src.getAttribute('data-video-url') : '(unknown)'}`);
                return;
            }
            if (node.classList && node.classList.contains('t2-file-block')) {
                const a = node.querySelector('a[href]');
                out.push(`FILE: ${a ? a.getAttribute('href') : ''}`);
                return;
            }
            if (node.classList && node.classList.contains('t2-code-block')) {
                const codeEl = node.querySelector('code');
                const lang = codeEl ? codeEl.getAttribute('data-lang') || '' : '';
                out.push('```' + lang);
                out.push(codeEl ? codeEl.textContent : '');
                out.push('```');
                return;
            }
            if (tag === 'table' || (tag === 'div' && node.querySelector('table'))) {
                const table = tag === 'table' ? node : node.querySelector('table');
                const trs = table.querySelectorAll('tr');
                const rows = trs.length;
                const cols = rows ? trs[0].children.length : 0;
                out.push(`TABLE: ${cols}|${rows}|${table.style.width || '100%'}|solid`);
                return;
            }
            if (/^h[1-6]$/.test(tag)) {
                out.push(`${tag.toUpperCase()}: ${decompileInline(node)}`);
                return;
            }
            if (tag === 'p' || tag === 'div') {
                const text = decompileInline(node).trim();
                if (text) out.push(`P: ${text}`);
                return;
            }
        });

        return out.join('\n');
    }

    function list() {
        return findEditors().map(e => e.id);
    }

    function spec() {
        return `T2LLM DSL v1 — one block per line. "TAG: content" format.

[Text Blocks]
P: Paragraph text. **bold** *italic* ~~strikethrough~~ ++underline++ \`code\` [link](https://a.com) {c:#ff0000}red text{/c} {s:24}large text{/s}
H1: / H2: / H3: / H4: / H5: / H6: heading text (same inline markup supported)

[Insert Blocks — direct plugin calls]
IMG: imageUrl|width|height|alttext      (width/height/alttext optional)
VIDEO: videoUrl                         (YouTube or direct video file URL)
LINK: URL|displaytext                   (standalone link paragraph)
CLIPURL: URL                            (clipurl plugin — clip-style link)
FILE: URL|filename|bytesize
MEME: imageUrl                          (inserted via meme plugin)
TABLE: cols|rows|width(e.g. 100%)|border(solid/dashed/none)
\`\`\`language
code content (multi-line) — CODE block needs only this fence, no separate tag line required
\`\`\`
DRAW: single-line SVG markup  OR
\`\`\`svg
<svg>...</svg>
\`\`\`
  (uses the draw plugin's actual save pipeline — humans can continue drawing later)

[Usage]
await T2LLM.apply(dsl, {mode:'append'|'replace', id?})   apply to document (mode defaults to append)
T2LLM.read({id?})                                        approximate current document as DSL
T2LLM.list()                                              list editor IDs on the page
T2LLM.spec()                                              return this description

[Excluded]
collab — real-time collaboration sessions require human participants, so not a programmatic target.
ai_complex — (v10.2.0: ai + ai_rearrange merged) this plugin is the opposite: it "calls T2LLM
  internally" — writing results are inserted via T2LLM.apply(), and rearrange reads the document
  as DSL via T2LLM.read(), asks the LLM to rewrite it, then replaces via T2LLM.apply() again.
  So it is not included in the T2LLM DSL tag list (to avoid circular self-calls).
search — search UI, not content insertion, so out of T2LLM scope.`;
    }

    window.T2LLM = { version: '1.0', apply, read, list, spec };
})();
