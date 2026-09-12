// Path: T2Editor/extend/js/t2ai_tool_search_local.js
//
// T2Editor AI Tool — search_document
// ============================================================================
// 현재 편집 중인 문서(사람 또는 AI가 이미 작성한 블록/텍스트) 안에서
// 텍스트를 검색한다. 외부 API를 전혀 쓰지 않으므로 항상 사용 가능하다.
//
// 이 파일 하나만 지워도 다른 어떤 Tool·T2LLM·플러그인에도 영향이 없다.
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'search_document'}, '[T2AI] t2ai_core.js not loaded yet — skipping search_document registration.'));
        return;
    }

    function blockTypeOf(el) {
        if (!el.classList) return 'text';
        if (el.classList.contains('t2-image-block')) return 'image';
        if (el.classList.contains('t2-video-block')) return 'video';
        if (el.classList.contains('t2-file-block')) return 'file';
        if (el.classList.contains('t2-code-block')) return 'code';
        if (el.dataset && el.dataset.t2Block === 'drawing') return 'drawing';
        if (el.querySelector && el.querySelector('table')) return 'table';
        return 'text';
    }

    function snippetAround(text, index, term, radius = 30) {
        const start = Math.max(0, index - radius);
        const end = Math.min(text.length, index + term.length + radius);
        let s = text.slice(start, end);
        if (start > 0) s = '…' + s;
        if (end < text.length) s = s + '…';
        return s;
    }

    T2AITools.register({
        name: 'search_document',
        description: 'Searches text/blocks already present in the document currently being edited (no external API, always available). At least one of query or blockType must be given.',
        params: {
            query: 'Optional: search term. If omitted, filters by blockType only (e.g. list all image blocks).',
            blockType: 'Optional: narrow results to one of text|image|video|file|code|table|drawing. Omit for all types.',
            limit: 'Optional: max number of results (default 20)',
            id: 'Optional: the target editor id when multiple editors are present. Defaults to the first editor if omitted.',
        },
        source: 't2ai_tool_search_local.js',
        ui: {
            label: 'Search Document',
            icon: 'find_in_page',
            description: 'Finds text or blocks already written in the document you\'re currently editing. Uses no external server, so it\'s always available.',
            usage: 'e.g. asking "where\'s the paragraph I wrote about apples earlier?" searches the document and finds it.',
        },
        async run(args) {
            const query = String(args.query || '').trim();
            const wantType = args.blockType ? String(args.blockType).trim() : null;
            if (!query && !wantType) {
                return { matches: [], total: 0, message: 'Specify at least one of query or blockType.' };
            }

            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { matches: [], total: 0, message: 'No active T2Editor instance was found.' };

            const limit = Math.max(1, Math.min(200, parseInt(args.limit, 10) || 20));
            const q = query.toLowerCase();

            const matches = [];
            const blocks = Array.from(editor.editor.children);

            blocks.forEach((el, idx) => {
                const type = blockTypeOf(el);
                if (wantType && type !== wantType) return;

                const text = (el.innerText || el.textContent || '').trim();

                if (!q) {
                    // 타입 필터만 적용 — 텍스트 매치 불필요
                    matches.push({ blockIndex: idx, blockType: type, snippet: text.slice(0, 60) || '(no text)' });
                    return;
                }

                const lower = text.toLowerCase();
                const pos = lower.indexOf(q);
                if (pos === -1) return; // query 지정 시 텍스트 매치는 필수

                matches.push({ blockIndex: idx, blockType: type, snippet: snippetAround(text, pos, q) });
            });

            return {
                total: matches.length,
                matches: matches.slice(0, limit),
                truncated: matches.length > limit,
            };
        },
    });
})();
