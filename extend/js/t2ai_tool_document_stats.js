// Path: T2Editor/extend/js/t2ai_tool_document_stats.js
//
// T2Editor AI Tool — get_document_stats
// ============================================================================
// 현재 편집 중인 문서의 글자수/단어수/블록 구성/예상 읽기 시간을 계산한다.
// search_document(t2ai_tool_search_local.js)와 마찬가지로 문서를 "읽기만"
// 하고 절대 고치지 않는다 — 외부 API도 쓰지 않아 항상 사용 가능하며, 문서를
// 바꾸지 않으므로 "재구성(rearrange)" 요청 중에도 안전하게 함께 노출해도 된다
// (unsafeForReplace 선언 불필요).
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 get_document_stats 등록을 건너뜁니다.');
        return;
    }

    // search_local.js의 blockTypeOf와 판정 기준을 맞춘다(다만 서로 참조는
    // 하지 않는다 — Tool끼리 서로 몰라야 한다는 규칙이라 로직만 동일하게
    // 각자 갖고 있는다).
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

    // 한글/영문이 섞인 문서에서 둘 다 그럴듯한 "단어 수"를 내려면 공백 기준
    // 분리만으로는 부족하다(한글은 띄어쓰기가 문장 구성상 영어보다 헐거움).
    // 그래서 "공백 기준 토큰 수"와 "공백 제외 글자 수"를 각각 따로 보여주고,
    // 읽기 시간도 "글자 수" 기준(한국어 묵독 평균 분당 500~600자 통용치)으로
    // 추정한다 — 언어를 자동 판별해 분기하는 복잡한 로직 대신, 두 숫자를
    // 그대로 노출해 어떤 언어 문서든 사용자가 스스로 판단할 수 있게 한다.
    const READING_CHARS_PER_MIN = 550;

    T2AITools.register({
        name: 'get_document_stats',
        description: '현재 편집 중인 문서의 글자수(공백 포함/제외), 공백 기준 단어(토큰) 수, 블록 타입별 개수, 예상 읽기 시간을 계산한다. 문서를 읽기만 하며 절대 수정하지 않는다. 외부 API 미사용, 항상 사용 가능.',
        params: {
            id: '선택: 여러 에디터가 있을 때 대상 에디터 id. 생략 시 첫 번째 에디터.',
        },
        source: 't2ai_tool_document_stats.js',
        ui: {
            label: '문서 통계',
            icon: 'analytics',
            description: '지금 문서의 글자수, 단어수, 사진/표 등 블록 구성, 예상 읽는 시간을 알려줘요.',
            usage: '예: "이 글 글자수 몇 자야?", "다 읽는 데 얼마나 걸릴까?"처럼 물으면 계산해줘요.',
        },

        async run(args) {
            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { ok: false, message: '활성 T2Editor 인스턴스를 찾을 수 없습니다.' };

            const root = editor.editor;
            const text = (root.innerText || root.textContent || '').trim();

            const charCount = text.length;
            const charCountNoSpaces = text.replace(/\s+/g, '').length;
            const tokenCount = text.length ? text.split(/\s+/).filter(Boolean).length : 0;

            const blocks = Array.from(root.children);
            const blockTypeCounts = {};
            blocks.forEach((el) => {
                const type = blockTypeOf(el);
                blockTypeCounts[type] = (blockTypeCounts[type] || 0) + 1;
            });

            const estimatedReadingMinutes = charCountNoSpaces > 0
                ? Math.max(1, Math.round(charCountNoSpaces / READING_CHARS_PER_MIN))
                : 0;

            return {
                ok: true,
                charCount,
                charCountNoSpaces,
                tokenCount,
                blockCount: blocks.length,
                blockTypeCounts,
                estimatedReadingMinutes,
                note: '읽기 시간은 공백 제외 글자 수 기준 대략치(분당 약 550자)이며 실제와 다를 수 있습니다.',
            };
        },
    });
})();
