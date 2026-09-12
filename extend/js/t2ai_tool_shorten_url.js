// Path: T2Editor/extend/js/t2ai_tool_shorten_url.js
// Developer note: Tool 이름·입력 schema·반환 형식은 T2AI 레지스트리와 모델 프롬프트의 호출 계약이므로 함께 수정한다.
//
// T2Editor AI Tool — shorten_url
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

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'shorten_url'}, '[T2AI] t2ai_core.js not loaded yet — skipping shorten_url registration.'));
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
        description: 'Shortens a long URL via the T2ClipURL (dsclub) API, and optionally returns a QR code image URL too. The result\'s short_url can be inserted directly with T2LLM\'s CLIPURL: tag.',
        params: {
            url: 'The original URL to shorten (http/https only). Required.',
            type: 'Optional: "link" (short URL only) | "qr" (QR code only) | "both" (both, default)',
        },
        source: 't2ai_tool_shorten_url.js',
        ui: {
            label: 'Shorten URL / QR',
            icon: 'link',
            description: 'Shortens a long link, and can also generate a QR code and insert it into the document.',
            usage: 'e.g. asking to "shorten this link" generates a short URL (or QR code) and inserts it.',
        },
        async run(args) {
            const url = String(args.url || '').trim();
            if (!url) return { ok: false, message: 'url is empty.' };
            if (!isValidHttpUrl(url)) return { ok: false, message: 'Not a valid http/https URL.' };

            const type = ['link', 'qr', 'both'].includes(args.type) ? args.type : 'both';

            const formData = new FormData();
            formData.append('api_key', API_KEY);
            formData.append('url', url);
            formData.append('type', type);

            let res;
            try {
                res = await fetch(API_URL, { method: 'POST', body: formData });
            } catch (e) {
                return { ok: false, message: `Network error: ${e.message}` };
            }

            if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };

            let data;
            try { data = await res.json(); } catch (e) {
                return { ok: false, message: 'Failed to parse response — the dsclub API structure may have changed.' };
            }

            if (!data || data.success !== true) {
                return { ok: false, message: (data && data.error) || 'Failed to create a short URL.' };
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

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
