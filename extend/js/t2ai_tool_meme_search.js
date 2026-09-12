// Path: T2Editor/extend/js/t2ai_tool_meme_search.js
// Developer note: Tool 이름·입력 schema·반환 형식은 T2AI 레지스트리와 모델 프롬프트의 호출 계약이므로 함께 수정한다.
//
// T2Editor AI Tool — search_meme
// T2Meme 플러그인이 쓰는 dsclub 밈 검색 API를 그대로 호출한다.
// meme 플러그인의 소스코드에는 의존하지 않는다 — 같은 공개 API 엔드포인트만
// 재사용한다. dsclub API 구조가 바뀌거나 서비스가 중단되면 이 파일 하나만
// 삭제하면 된다.
//
// 검색 결과의 각 항목은 url 필드를 담고 있으며, 이 url을 T2LLM의 IMG: 또는
// MEME: DSL 태그에 그대로 넘기면 문서에 삽입할 수 있다(별도 변환 불필요).

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'search_meme'}, '[T2AI] t2ai_core.js not loaded yet — skipping search_meme registration.'));
        return;
    }

    const DIRECT_API_URL = 'https://dsclub.kr/api/meme/index.php';
    const editorBase = String(window.t2editor_url || window.T2EDITOR_URL || '').replace(/\/+$/, '');
    const PROXY_API_URL = editorBase ? `${editorBase}/plugin/meme/meme_api_proxy.php` : '';

    async function fetchMeme(queryString) {
        if (PROXY_API_URL) {
            try {
                const proxyResponse = await fetch(`${PROXY_API_URL}?${queryString}`, {
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' },
                });
                if (proxyResponse.ok || (proxyResponse.status !== 404 && proxyResponse.status !== 405)) {
                    return proxyResponse;
                }
            } catch (error) {
                console.warn('[T2AI] T2Meme proxy unavailable, trying direct API:', error);
            }
        }
        return fetch(`${DIRECT_API_URL}?${queryString}`, {
            headers: { Accept: 'application/json' },
            referrerPolicy: 'no-referrer',
        });
    }

    T2AITools.register({
        name: 'search_meme',
        description: 'Searches meme images via the T2Meme (dsclub) API. The result urls can be used directly in T2LLM\'s MEME:/IMG: tags.',
        params: {
            query: 'Search term (required)',
            page: 'Optional: page number, starting from 1 (default 1)',
            limit: 'Optional: results per page (default 20, max 50)',
        },
        source: 't2ai_tool_meme_search.js',
        ui: {
            label: 'Meme Search',
            icon: 'mood',
            description: 'Finds a meme image that fits the situation and inserts it into the document.',
            usage: 'e.g. asking for "an awkward reaction meme" triggers an automatic search and insert. When off, meme requests won\'t trigger a search.',
        },
        async run(args) {
            const query = String(args.query || '').trim();
            if (!query) return { results: [], message: 'query is empty.' };

            const page = Math.max(1, parseInt(args.page, 10) || 1);
            const limit = Math.max(1, Math.min(50, parseInt(args.limit, 10) || 20));

            const qs = new URLSearchParams({ q: query, page: String(page), limit: String(limit) });

            let res;
            try {
                res = await fetchMeme(qs.toString());
            } catch (e) {
                return { results: [], message: `Network error: ${e.message}` };
            }

            if (!res.ok) return { results: [], message: `HTTP ${res.status}` };

            let json;
            try { json = await res.json(); } catch (e) {
                return { results: [], message: 'Failed to parse response — the dsclub API structure may have changed.' };
            }

            if (!json || json.success !== true || !Array.isArray(json.data)) {
                return { results: [], message: (json && json.message) || 'The search result format was unexpected.' };
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

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
