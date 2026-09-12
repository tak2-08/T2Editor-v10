// Path: T2Editor/extend/js/t2ai_tool_search_external.js
//
// T2Editor AI Tool — search_external_content
// ============================================================================
// T2Search 플러그인이 쓰는 dsclub 외부 검색 API를 그대로 호출한다.
// search 플러그인의 소스코드에는 전혀 의존하지 않는다 — 같은 공개 API
// 엔드포인트만 재사용한다. dsclub API 구조가 바뀌거나 서비스가 중단되면
// 이 파일 하나만 삭제하면 된다(다른 어떤 것도 영향받지 않는다).
//
// 사용자가 T2Search 설정에서 외부 검색을 꺼둔 상태(localStorage
// 't2-search-enabled' === 'false')라면 이 Tool도 그 의사를 존중해 호출하지 않는다.
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'search_external_content'}, '[T2AI] t2ai_core.js not loaded yet — skipping search_external_content registration.'));
        return;
    }

    const DIRECT_API_URL = 'https://dsclub.kr/api/search/index.php';
    const API_KEY = 'dsclubSEARCH2025';
    const editorBase = String(window.t2editor_url || window.T2EDITOR_URL || '').replace(/\/+$/, '');
    const PROXY_API_URL = editorBase ? `${editorBase}/plugin/search/search_proxy.php?action=search` : '';

    async function fetchSearch(body) {
        if (PROXY_API_URL) {
            try {
                const proxyResponse = await fetch(PROXY_API_URL, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                });
                if (proxyResponse.ok || (proxyResponse.status !== 404 && proxyResponse.status !== 405)) {
                    return proxyResponse;
                }
            } catch (error) {
                console.warn('[T2AI] T2Search proxy unavailable, trying direct API:', error);
            }
        }
        return fetch(DIRECT_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY,
                'X-T2Editor': 'true',
            },
            body,
            referrerPolicy: 'no-referrer',
        });
    }

    function isUserOptedOut() {
        try {
            const v = window.localStorage.getItem('t2-search-enabled');
            return v === 'false';
        } catch (_) {
            return false; // localStorage 접근 불가 환경에서는 기본 허용(플러그인과 동일 정책)
        }
    }

    T2AITools.register({
        name: 'search_external_content',
        description: 'Tag-based search of publicly available content via the T2Search (dsclub) API. Does not run if the user has T2Search turned off.',
        params: {
            tags: 'Search tag(s). A single string, or multiple tags separated by commas/spaces. Required.',
            limit: 'Optional: max number of results (default 15, max 50)',
            offset: 'Optional: pagination offset (default 0)',
        },
        source: 't2ai_tool_search_external.js',
        ui: {
            label: 'T2Search',
            icon: 'travel_explore',
            description: 'When up-to-date information or fact-checking seems necessary, searches T2Search before answering and uses it as supporting evidence.',
            usage: 'e.g. asking about "the specs of the newly announced iPhone" triggers a search automatically. When off, the AI answers from its own knowledge only, without searching.',
        },
        async run(args) {
            if (isUserOptedOut()) {
                return { results: [], total: 0, message: 'The user has disabled T2Search external search.' };
            }

            const raw = String(args.tags || '').trim();
            if (!raw) return { results: [], total: 0, message: 'tags is empty.' };

            const tags = raw.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean);
            if (!tags.length) return { results: [], total: 0, message: 'No valid tags found.' };

            const limit = Math.max(1, Math.min(50, parseInt(args.limit, 10) || 15));
            const offset = Math.max(0, parseInt(args.offset, 10) || 0);

            let res;
            try {
                res = await fetchSearch(JSON.stringify({ tags, limit, offset }));
            } catch (e) {
                return { results: [], total: 0, message: `Network error: ${e.message}` };
            }

            if (!res.ok) {
                return { results: [], total: 0, message: `HTTP ${res.status}` };
            }

            let json;
            try { json = await res.json(); } catch (e) {
                return { results: [], total: 0, message: 'Failed to parse response — the dsclub API structure may have changed.' };
            }

            if (!json || json.success !== true || !Array.isArray(json.results)) {
                return { results: [], total: 0, message: (json && json.error) || 'The search result format was unexpected.' };
            }

            return {
                results: json.results,
                total: json.total || json.results.length,
                offset,
            };
        },
    });
})();
