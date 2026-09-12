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
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 search_external_content 등록을 건너뜁니다.');
        return;
    }

    const API_URL = 'https://dsclub.kr/api/search/index.php';
    const API_KEY = 'dsclubSEARCH2025';

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
        description: 'T2Search(dsclub) API로 외부에 공개된 콘텐츠를 태그 기반으로 검색한다. 사용자가 T2Search를 꺼둔 경우 실행되지 않는다.',
        params: {
            tags: '검색 태그(들). 문자열 하나 또는 쉼표/공백 구분 다중 태그. 필수.',
            limit: '선택: 최대 반환 개수 (기본 15, 최대 50)',
            offset: '선택: 페이지네이션 오프셋 (기본 0)',
        },
        source: 't2ai_tool_search_external.js',
        ui: {
            label: 'T2Search 검색',
            icon: 'travel_explore',
            description: '최신 정보나 사실 확인이 필요해 보이면, 답변 전에 T2Search에서 검색해 근거로 반영해요.',
            usage: '예: "최근 발표된 아이폰 스펙 알려줘"처럼 최신·사실 확인성 지시를 쓰면 자동으로 검색해 반영해요. 끄면 검색 없이 AI가 알고 있는 지식만으로 답해요.',
        },
        async run(args) {
            if (isUserOptedOut()) {
                return { results: [], total: 0, message: '사용자가 T2Search 외부 검색을 비활성화했습니다.' };
            }

            const raw = String(args.tags || '').trim();
            if (!raw) return { results: [], total: 0, message: 'tags 가 비어 있습니다.' };

            const tags = raw.split(/[,，\s]+/).map(t => t.trim()).filter(Boolean);
            if (!tags.length) return { results: [], total: 0, message: '유효한 태그가 없습니다.' };

            const limit = Math.max(1, Math.min(50, parseInt(args.limit, 10) || 15));
            const offset = Math.max(0, parseInt(args.offset, 10) || 0);

            let res;
            try {
                res = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': API_KEY,
                        'X-T2Editor': 'true',
                    },
                    body: JSON.stringify({ tags, limit, offset }),
                });
            } catch (e) {
                return { results: [], total: 0, message: `네트워크 오류: ${e.message}` };
            }

            if (!res.ok) {
                return { results: [], total: 0, message: `HTTP ${res.status}` };
            }

            let json;
            try { json = await res.json(); } catch (e) {
                return { results: [], total: 0, message: '응답 파싱 실패 — dsclub API 구조가 변경되었을 수 있습니다.' };
            }

            if (!json || json.success !== true || !Array.isArray(json.results)) {
                return { results: [], total: 0, message: (json && json.error) || '검색 결과 형식이 예상과 다릅니다.' };
            }

            return {
                results: json.results,
                total: json.total || json.results.length,
                offset,
            };
        },
    });
})();
