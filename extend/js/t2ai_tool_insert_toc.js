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
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'insert_table_of_contents'}, '[T2AI] t2ai_core.js not loaded yet — skipping insert_table_of_contents registration.'));
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
        description: 'Scans the heading blocks (H1–H6) in the document currently being edited and immediately inserts a clickable table of contents that jumps to each heading. Assigns an id to headings that don\'t already have one. This tool is not offered during document "rearrange" requests (since the whole document gets replaced).',
        params: {
            levels: 'Optional: heading levels to include, comma-separated (e.g. "1,2,3"). Default "1,2,3".',
            title: 'Optional: heading text shown above the TOC. Default "Table of Contents". Pass an empty string to omit the title line.',
            position: 'Optional: "top" (start of document, default) | "end" (end of document).',
            id: 'Optional: the target editor id when multiple editors are present.',
        },
        unsafeForReplace: true,
        source: 't2ai_tool_insert_toc.js',
        ui: {
            label: 'Insert TOC',
            icon: 'toc',
            description: 'Gathers the headings in the document into a clickable table of contents and inserts it.',
            usage: 'e.g. asking to "add a table of contents to this" finds the headings and inserts a TOC block. Not used during document rearranging.',
        },

        async run(args) {
            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { ok: false, message: 'No active T2Editor instance was found.' };

            const root = editor.editor;
            const wantLevels = parseLevels(args.levels);
            const selector = wantLevels.map(l => `h${l}`).join(',');
            const headings = Array.from(root.querySelectorAll(selector))
                .filter(el => HEADING_TAGS.includes(el.tagName));

            if (!headings.length) {
                return { ok: false, message: `No heading blocks (H${wantLevels.join('/H')}) were found in the document. Please add headings first.` };
            }

            // 제목마다 id 확보(이미 있으면 재사용, 없으면 슬러그+인덱스로 생성해 충돌 방지).
            const usedIds = new Set(Array.from(root.querySelectorAll('[id]')).map(el => el.id));
            const entries = headings.map((el, idx) => {
                const level = parseInt(el.tagName.slice(1), 10);
                const text = (el.textContent || '').trim() || `(untitled ${idx + 1})`;
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

            const titleText = args.title != null ? String(args.title) : 'Table of Contents';
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
