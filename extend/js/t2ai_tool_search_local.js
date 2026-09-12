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
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 search_document 등록을 건너뜁니다.');
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
        description: '현재 편집 중인 문서 안에서 이미 작성된 텍스트/블록을 검색한다 (외부 API 미사용, 항상 사용 가능). query 또는 blockType 중 최소 하나는 지정해야 한다.',
        params: {
            query: '선택: 검색어. 생략 시 blockType으로만 필터링(예: 이미지 블록 전체 나열).',
            blockType: '선택: text|image|video|file|code|table|drawing 중 하나로 결과를 좁힘. 생략 시 전체.',
            limit: '선택: 최대 반환 개수 (기본 20)',
            id: '선택: 여러 에디터가 있을 때 대상 에디터 id. 생략 시 첫 번째 에디터.',
        },
        source: 't2ai_tool_search_local.js',
        ui: {
            label: '문서 내 검색',
            icon: 'find_in_page',
            description: '지금 편집 중인 문서 안에서 이미 쓰여 있는 글이나 블록을 찾아요. 외부 서버를 쓰지 않아 항상 사용 가능해요.',
            usage: '예: "아까 내가 쓴 사과 관련 문단 어디 있지?"처럼 물으면 문서 안을 뒤져서 위치를 찾아줘요.',
        },
        async run(args) {
            const query = String(args.query || '').trim();
            const wantType = args.blockType ? String(args.blockType).trim() : null;
            if (!query && !wantType) {
                return { matches: [], total: 0, message: 'query 또는 blockType 중 최소 하나를 지정하세요.' };
            }

            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { matches: [], total: 0, message: '활성 T2Editor 인스턴스를 찾을 수 없습니다.' };

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
                    matches.push({ blockIndex: idx, blockType: type, snippet: text.slice(0, 60) || '(텍스트 없음)' });
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
