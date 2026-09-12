// Path: T2Editor/extend/js/t2ai_tool_image_vision.js
// Developer note: Tool 이름·입력 schema·반환 형식은 T2AI 레지스트리와 모델 프롬프트의 호출 계약이므로 함께 수정한다.
//
// T2Editor AI Tool — read_image_blocks
// VLLM(비전 지원 LLM)이 문서에 이미 삽입된 이미지 블록을 "볼" 수 있도록,
// 이미지 블록의 URL·크기·설명과, 필요하면 base64 data URL까지 반환한다.
//
// image 플러그인의 소스코드는 건드리지 않는다 — 렌더링된 DOM(t2-image-block)만
// 읽는다. 실제로 이미지를 "이해"하는 것은 이 Tool을 호출하는 바깥의 비전 LLM이며,
// 이 파일은 그 LLM이 이미지에 접근할 수 있는 형태로 데이터를 정리해 건네줄 뿐이다.
//
// base64 모드는 대상 이미지 서버가 CORS를 허용해야 동작한다(허용하지 않으면
// 명확한 에러로 알려준다) — 이 파일이 어떻게 해도 우회할 수 없는 브라우저 보안
// 제약이므로, 그 경우 url 모드(기본값)를 그대로 비전 LLM에 넘기는 편이 낫다.

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'read_image_blocks'}, '[T2AI] t2ai_core.js not loaded yet — skipping read_image_blocks registration.'));
        return;
    }

    async function toBase64DataUrl(url) {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);
        const blob = await res.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to base64-encode the image'));
            reader.readAsDataURL(blob);
        });
    }

    function collectImageBlocks(editor) {
        const blocks = Array.from(editor.editor.children);
        const out = [];
        blocks.forEach((el, idx) => {
            if (!el.classList || !el.classList.contains('t2-image-block')) return;
            const img = el.querySelector('img');
            if (!img) return;
            out.push({
                blockIndex: idx,
                url: img.getAttribute('src') || '',
                alt: img.getAttribute('alt') || '',
                width: img.naturalWidth || null,
                height: img.naturalHeight || null,
            });
        });
        return out;
    }

    T2AITools.register({
        name: 'read_image_blocks',
        description: 'Returns image blocks in the document in a form a VLLM (vision-capable LLM) can see. By default returns just the image URLs (most vision LLM APIs accept a URL directly); with format:"base64", also encodes the pixel data as a data URL (requires the target server to allow CORS).',
        params: {
            blockIndex: 'Optional: fetch only a single block index (can reuse the blockIndex from search_document\'s result). If omitted, returns every image block in the document.',
            format: 'Optional: "url" (default, URL only) | "base64" (includes a data-URL encoding — expensive, so use only when needed)',
            id: 'Optional: the target editor id when multiple editors are present.',
        },
        source: 't2ai_tool_image_vision.js',
        ui: {
            label: 'Image Recognition (Vision)',
            icon: 'visibility',
            description: 'Reads images already in the document so the AI can see them. Requires the AI to support vision.',
            usage: 'e.g. asking "describe the photos in this document" automatically reads them in and uses them in the answer.',
        },
        async run(args) {
            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { images: [], message: 'No active T2Editor instance was found.' };

            let images = collectImageBlocks(editor);

            if (args.blockIndex !== undefined && args.blockIndex !== null && args.blockIndex !== '') {
                const wantIdx = parseInt(args.blockIndex, 10);
                images = images.filter(im => im.blockIndex === wantIdx);
                if (!images.length) return { images: [], message: `No image block found at blockIndex ${wantIdx}.` };
            }

            if (args.format === 'base64') {
                for (const im of images) {
                    try {
                        im.dataUrl = await toBase64DataUrl(im.url);
                    } catch (e) {
                        im.dataUrl = null;
                        im.encodeError = e.message;
                    }
                }
            }

            return { images, total: images.length };
        },
    });
})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
