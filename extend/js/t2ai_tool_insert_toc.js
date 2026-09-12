// Path: T2Editor/extend/js/t2ai_tool_insert_toc.js
//
// T2Editor AI Tool — insert_table_of_contents
// ============================================================================
// 현재 편집 중인 문서 안의 제목 블록(H1~H6)을 스캔해, 각 제목으로 바로
// 이동하는 목차(클릭 가능한 내부 링크 목록)를 만들어 문서에 삽입한다.
// core.js가 P/DIV/H1~H6/PRE를 블록 태그로 취급하는 것을 그대로 활용하며
// (js/core.js 참고), 별도 플러그인(image/draw 등)에 의존하지 않으므로
// 항상 사용 가능하다.
//
// 텍스트는 전부 textContent로만 다뤄 제목 안에 <, > 같은 문자가 있어도
// 마크업으로 해석되지 않게 한다(innerHTML 문자열 조립을 쓰지 않고 DOM
// 요소를 직접 생성).
//
// ── unsafeForReplace: true — 재구성(rearrange) 요청에는 노출되지 않음 ───────
// insert_image/insert_drawing과 동일한 이유: run()이 즉시 에디터 DOM에
// 목차 블록을 심는 부작용 Tool이라, 문서 전체를 비우고 새로 채우는 재구성
// 흐름 중에 실행되면 방금 심은 목차가 그 직후 통째로 사라진다.
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 insert_table_of_contents 등록을 건너뜁니다.');
        return;
    }

    const HEADING_TAGS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

    function parseLevels(raw) {
        if (!raw) return [1, 2, 3]; // 기본: 너무 깊은 목차가 되지 않도록 H1~H3만
        const nums = String(raw)
            .split(',')
            .map(s => parseInt(s.trim(), 10))
            .filter(n => Number.isInteger(n) && n >= 1 && n <= 6);
        return nums.length ? Array.from(new Set(nums)) : [1, 2, 3];
    }

    function slugBase(text) {
        const s = String(text || '').trim().toLowerCase()
            .replace(/[^\w가-힣\s-]/g, '')
            .replace(/\s+/g, '-')
            .slice(0, 40);
        return s || 'section';
    }

    T2AITools.register({
        name: 'insert_table_of_contents',
        description: '지금 편집 중인 문서 안의 제목 블록(H1~H6)을 스캔해, 각 제목으로 바로 이동하는 클릭 가능한 목차를 만들어 문서에 즉시 삽입한다. 제목에 id가 없으면 자동으로 부여한다. 문서 "재구성" 요청 중에는 이 Tool이 제공되지 않는다(문서 전체가 새로 교체되므로).',
        params: {
            levels: '선택: 목차에 포함할 제목 레벨, 쉼표로 구분(예: "1,2,3"). 기본 "1,2,3".',
            title: '선택: 목차 상단에 표시할 제목 텍스트. 기본 "목차". 빈 문자열이면 제목 줄 생략.',
            position: '선택: "top"(문서 맨 앞, 기본) | "end"(문서 맨 끝).',
            id: '선택: 여러 에디터가 있을 때 대상 에디터 id.',
        },
        unsafeForReplace: true,
        source: 't2ai_tool_insert_toc.js',
        ui: {
            label: '목차 생성',
            icon: 'toc',
            description: '문서 안의 제목들을 모아서 클릭하면 바로 이동하는 목차를 만들어 넣어줘요.',
            usage: '예: "이 글에 목차 좀 넣어줘"처럼 요청하면 제목들을 찾아 목차 블록을 삽입해요. 문서 재구성 중에는 사용되지 않아요.',
        },

        async run(args) {
            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { ok: false, message: '활성 T2Editor 인스턴스를 찾을 수 없습니다.' };

            const root = editor.editor;
            const wantLevels = parseLevels(args.levels);
            const selector = wantLevels.map(l => `h${l}`).join(',');
            const headings = Array.from(root.querySelectorAll(selector))
                .filter(el => HEADING_TAGS.includes(el.tagName));

            if (!headings.length) {
                return { ok: false, message: `문서에서 제목 블록(H${wantLevels.join('/H')})을 찾지 못했습니다. 먼저 제목을 지정해 주세요.` };
            }

            // 제목마다 id 확보(이미 있으면 재사용, 없으면 슬러그+인덱스로 생성해 충돌 방지).
            const usedIds = new Set(Array.from(root.querySelectorAll('[id]')).map(el => el.id));
            const entries = headings.map((el, idx) => {
                const level = parseInt(el.tagName.slice(1), 10);
                const text = (el.textContent || '').trim() || `(제목 없음 ${idx + 1})`;
                let id = el.id;
                if (!id) {
                    let candidate = `toc-${slugBase(text)}`;
                    let n = 1;
                    while (usedIds.has(candidate)) candidate = `toc-${slugBase(text)}-${n++}`;
                    id = candidate;
                    el.id = id;
                    usedIds.add(id);
                }
                return { level, text, id };
            });

            const minLevel = Math.min(...entries.map(e => e.level));

            // ── 목차 블록 DOM 조립 (textContent만 사용, innerHTML 조립 없음) ──
            const container = document.createElement('div');
            container.className = 't2-toc-block';
            container.setAttribute('data-t2-block', 'toc');

            const titleText = args.title != null ? String(args.title) : '목차';
            if (titleText.trim() !== '') {
                const titleEl = document.createElement('p');
                const strong = document.createElement('strong');
                strong.textContent = titleText;
                titleEl.appendChild(strong);
                container.appendChild(titleEl);
            }

            const list = document.createElement('ul');
            list.className = 't2-toc-list';
            entries.forEach(entry => {
                const li = document.createElement('li');
                li.style.marginLeft = `${(entry.level - minLevel) * 16}px`;
                const a = document.createElement('a');
                a.href = `#${entry.id}`;
                a.textContent = entry.text;
                li.appendChild(a);
                list.appendChild(li);
            });
            container.appendChild(list);

            const position = args.position === 'end' ? 'end' : 'top';
            if (position === 'top' && root.firstChild) {
                root.insertBefore(container, root.firstChild);
            } else {
                root.appendChild(container);
            }

            if (typeof editor.normalizeContent === 'function') editor.normalizeContent();
            if (typeof editor.createUndoPoint === 'function') editor.createUndoPoint();
            if (typeof editor.autoSave === 'function') editor.autoSave();

            return {
                ok: true,
                headingCount: entries.length,
                position,
                entries: entries.map(e => ({ level: e.level, text: e.text, id: e.id })),
            };
        },
    });
})();
