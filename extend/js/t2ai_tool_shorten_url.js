// Path: T2Editor/extend/js/t2ai_tool_shorten_url.js
//
// T2Editor AI Tool — shorten_url
// ============================================================================
// T2ClipURL 플러그인이 쓰는 dsclub 링크 단축 API를 그대로 호출한다.
// clipurl 플러그인의 소스코드에는 의존하지 않는다 — 같은 공개 API
// 엔드포인트만 재사용한다. dsclub API 구조가 바뀌거나 서비스가 중단되면
// 이 파일 하나만 삭제하면 된다(T2LLM의 CLIPURL: 태그는 clipurl 플러그인의
// insertLink()를 직접 호출하는 별개 경로이므로 이 파일 삭제와 무관하게 계속 동작).
//
// 이 Tool은 "단축 URL을 만들어서 반환"만 한다. 문서에 실제로 삽입할지는
// 호출자(LLM)가 결정해 T2LLM의 `CLIPURL: {short_url}` 태그로 넣으면 된다 —
// 조회(search_* 계열)와 동일하게 "결과 반환 → 삽입 여부는 LLM 판단" 구조를
// 그대로 따른다.
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 shorten_url 등록을 건너뜁니다.');
        return;
    }

    const API_URL = 'https://dsclub.kr/api/link/';
    const API_KEY = 'T2ClipUrl2025';

    function isValidHttpUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (_) {
            return false;
        }
    }

    T2AITools.register({
        name: 'shorten_url',
        description: 'T2ClipURL(dsclub) API로 긴 URL을 단축하고, 필요하면 QR코드 이미지 URL도 함께 받는다. 결과의 short_url을 T2LLM의 CLIPURL: 태그에 그대로 넣어 문서에 삽입할 수 있다.',
        params: {
            url: '단축할 원본 URL (http/https만 허용). 필수.',
            type: '선택: "link"(단축URL만) | "qr"(QR코드만) | "both"(둘 다, 기본값)',
        },
        source: 't2ai_tool_shorten_url.js',
        ui: {
            label: 'URL 단축/QR',
            icon: 'link',
            description: '긴 링크를 짧게 줄이고, 필요하면 QR코드도 함께 만들어 문서에 넣어요.',
            usage: '예: "이 링크 짧게 줄여서 넣어줘"처럼 요청하면 단축 URL(또는 QR)을 만들어 삽입해요.',
        },
        async run(args) {
            const url = String(args.url || '').trim();
            if (!url) return { ok: false, message: 'url 이 비어 있습니다.' };
            if (!isValidHttpUrl(url)) return { ok: false, message: '올바른 http/https URL이 아닙니다.' };

            const type = ['link', 'qr', 'both'].includes(args.type) ? args.type : 'both';

            const formData = new FormData();
            formData.append('api_key', API_KEY);
            formData.append('url', url);
            formData.append('type', type);

            let res;
            try {
                res = await fetch(API_URL, { method: 'POST', body: formData });
            } catch (e) {
                return { ok: false, message: `네트워크 오류: ${e.message}` };
            }

            if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };

            let data;
            try { data = await res.json(); } catch (e) {
                return { ok: false, message: '응답 파싱 실패 — dsclub API 구조가 변경되었을 수 있습니다.' };
            }

            if (!data || data.success !== true) {
                return { ok: false, message: (data && data.error) || '단축 URL 생성에 실패했습니다.' };
            }

            return {
                ok: true,
                originalUrl: url,
                shortUrl: data.short_url || null,
                qrCodeUrl: data.qr_code_url || null,
            };
        },
    });
})();
