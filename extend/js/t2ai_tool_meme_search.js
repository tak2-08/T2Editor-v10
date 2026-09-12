// Path: T2Editor/extend/js/t2ai_tool_meme_search.js
//
// T2Editor AI Tool — search_meme
// ============================================================================
// T2Meme 플러그인이 쓰는 dsclub 밈 검색 API를 그대로 호출한다.
// meme 플러그인의 소스코드에는 의존하지 않는다 — 같은 공개 API 엔드포인트만
// 재사용한다. dsclub API 구조가 바뀌거나 서비스가 중단되면 이 파일 하나만
// 삭제하면 된다.
//
// 검색 결과의 각 항목은 url 필드를 담고 있으며, 이 url을 T2LLM의 IMG: 또는
// MEME: DSL 태그에 그대로 넘기면 문서에 삽입할 수 있다(별도 변환 불필요).
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 search_meme 등록을 건너뜁니다.');
        return;
    }

    const API_URL = 'https://dsclub.kr/api/meme/index.php';

    T2AITools.register({
        name: 'search_meme',
        description: 'T2Meme(dsclub) API로 밈 이미지를 검색한다. 결과의 url을 T2LLM의 MEME:/IMG: 태그에 그대로 사용할 수 있다.',
        params: {
            query: '검색어 (필수)',
            page: '선택: 페이지 번호, 1부터 시작 (기본 1)',
            limit: '선택: 페이지당 개수 (기본 20, 최대 50)',
        },
        source: 't2ai_tool_meme_search.js',
        ui: {
            label: '밈 짤 검색',
            icon: 'mood',
            description: '상황에 어울리는 밈(짤) 이미지를 찾아 문서에 삽입해요.',
            usage: '예: "당황한 짤 하나 넣어줘"처럼 요청하면 자동으로 찾아 넣어요. 끄면 밈을 요청해도 검색하지 않아요.',
        },
        async run(args) {
            const query = String(args.query || '').trim();
            if (!query) return { results: [], message: 'query 가 비어 있습니다.' };

            const page = Math.max(1, parseInt(args.page, 10) || 1);
            const limit = Math.max(1, Math.min(50, parseInt(args.limit, 10) || 20));

            const qs = new URLSearchParams({ q: query, page: String(page), limit: String(limit) });

            let res;
            try {
                res = await fetch(`${API_URL}?${qs}`, {
                    headers: { Accept: 'application/json' },
                    referrerPolicy: 'no-referrer',
                });
            } catch (e) {
                return { results: [], message: `네트워크 오류: ${e.message}` };
            }

            if (!res.ok) return { results: [], message: `HTTP ${res.status}` };

            let json;
            try { json = await res.json(); } catch (e) {
                return { results: [], message: '응답 파싱 실패 — dsclub API 구조가 변경되었을 수 있습니다.' };
            }

            if (!json || json.success !== true || !Array.isArray(json.data)) {
                return { results: [], message: (json && json.message) || '검색 결과 형식이 예상과 다릅니다.' };
            }

            const results = json.data.map(m => ({
                url: m.url,
                tags: Array.isArray(m.tags) ? m.tags : [],
                poster: m.poster || null,
            }));

            return { results, page, hasMore: results.length >= limit };
        },
    });
})();
