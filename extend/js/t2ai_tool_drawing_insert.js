// Path: T2Editor/extend/js/t2ai_tool_drawing_insert.js
// Developer note: Tool 이름·입력 schema·반환 형식은 T2AI 레지스트리와 모델 프롬프트의 호출 계약이므로 함께 수정한다.
//
// T2Editor AI Tool — insert_drawing
// draw 플러그인(plugin/draw)을 위한 T2AI Tool. t2llm.js 의 `DRAW:` DSL 태그가
// 이미 SVG → 캔버스 렌더 → draw 플러그인 업로드 파이프라인을 구현해 두었지만,
// 그건 T2LLM.apply(dsl) 을 통한 "문서 생성/재구성" 흐름에서만 쓰인다. 이 Tool은
// insert_image 가 IMG: 태그의 "지금 커서 위치에 바로" 버전인 것과 정확히
// 동일한 관계로, DRAW: 의 "지금 커서 위치에 바로" 버전이다.
//
// insert_image 와의 차이(왜 이 Tool이 따로 필요한가):
//   insert_image 는 image 플러그인의 일반 이미지 블록(t2-media-block)을 만든다.
//   이 Tool은 draw 플러그인의 블록(t2-drawing-block, data-t2-block="drawing")을
//   만든다. 겉보기엔 둘 다 <img>지만, draw 블록만 draw.js의
//   initializeDrawingBlocks()가 인식해 "그림판(펜/지우개)으로 다시 열어 이어
//   그리기"가 가능하다. 즉 "이 이미지는 나중에 사람이 손으로 고칠 수도 있는
//   그림이어야 한다"는 신호를 문서에 남기는 것이 이 Tool의 존재 이유다.
//
// 입력은 둘 중 하나:
//   1) svg   — SVG 마크업. t2llm.js의 compileDrawing()과 동일한 방식으로
//              캔버스에 래스터화(흰 배경 위에 그림)한 뒤 draw 플러그인의 실제
//              업로드 파이프라인(image_upload.php)을 그대로 통과시킨다.
//              LLM이 다이어그램/간단한 그림을 "그려서" 넣고 싶을 때 사용.
//   2) image — 이미 확보된 비트맵(http(s) URL 또는 data:image/...;base64,...).
//              data URI면 draw 파이프라인에 업로드해 draw 블록으로 만들고,
//              이미 호스팅된 URL이면 업로드 없이 그대로 draw 블록에 얹는다.
//
// draw.js / t2llm.js 소스코드는 건드리지 않는다. 두 파일이 이미 공개해 둔
// 메서드(createPlaceholderBlock, insertPlaceholderAtCursor, updateDrawingBlock)
// 와 draw.js가 실제로 쓰는 것과 동일한 업로드 엔드포인트만 재사용한다.
// createPlaceholderBlock/updateDrawingBlock 이 없는 구버전 등에서는 안전하게
// 실패 메시지를 반환한다.
//
// unsafeForReplace: true — 재구성(rearrange) 요청에는 노출되지 않음
// insert_image 와 동일한 이유: run() 자체가 즉시 에디터 DOM에 그림 블록을
// 심는 부작용 Tool이다. 문서 "재구성" 요청은 T2LLM.apply(dsl,{mode:'replace'})
// 로 문서 전체를 비우고 새로 채우므로, 이 Tool이 재구성 도중 실행되면 방금
// 심은 그림이 그 즉시 사라진다. 재구성 흐름에서 그림이 필요하면 최종 DSL의
// ```svg ... ``` (DRAW) 펜스 블록으로 다뤄야 한다 — 그 경로는 이미 존재한다.

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'insert_drawing'}, '[T2AI] t2ai_core.js not loaded yet — skipping insert_drawing registration.'));
        return;
    }

    const DEFAULT_W = 800, DEFAULT_H = 600;

    async function ensurePlugin(editor, name) {
        if (!editor.getPlugin(name) && typeof editor.loadPluginImmediately === 'function') {
            try { await editor.loadPluginImmediately(name); } catch (e) { console.warn(T2Utils.tf('t2ai.console_plugin_load_failed', {name: name}, '[T2AI] Plugin load failed: ' + name), e); }
        }
        return editor.getPlugin(name);
    }

    function isDataUri(src) {
        return /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(String(src || '').trim());
    }

    function looksLikeUsableImageSrc(src) {
        const s = String(src || '').trim();
        if (!s) return false;
        if (isDataUri(s)) return true;
        if (/^https?:\/\//i.test(s)) return true;
        if (/^\//.test(s)) return true; // 루트 상대 경로
        return false;
    }

    // svg 마크업 → 흰 배경 캔버스에 렌더 → PNG blob. t2llm.js compileDrawing()과 동일 로직.
    async function renderSvgToBlob(svgMarkup, w, h) {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create a canvas context.');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);

        const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(svgBlob);
        try {
            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error('Failed to render the SVG — check the markup.'));
                el.src = svgUrl;
            });
            ctx.drawImage(img, 0, 0, w, h);
        } finally {
            URL.revokeObjectURL(svgUrl);
        }

        return await new Promise((resolve, reject) => {
            canvas.toBlob(b => (b && b.size > 0) ? resolve(b) : reject(new Error('An empty image was produced.')), 'image/png', 1.0);
        });
    }

    async function dataUriToBlob(dataUri) {
        const res = await fetch(dataUri);
        return await res.blob();
    }

    // draw.js insertDrawing()이 실제로 쓰는 것과 동일한 업로드 엔드포인트/형식.
    async function uploadDrawing(editor, blob) {
        const file = new File([blob], `drawing_${Date.now()}.png`, { type: blob.type || 'image/png' });
        const formData = new FormData();
        formData.append('bf_file[]', file);
        formData.append('uid', editor.generateUid ? editor.generateUid() : String(Date.now()));

        const uploadUrl = `${window.t2editor_url || ''}/plugin/image/image_upload.php`;
        const response = await fetch(uploadUrl, { method: 'POST', body: formData });
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        const data = await response.json();
        if (!data || !data.success || !data.files || !data.files.length) {
            throw new Error((data && data.message) || 'Upload failed');
        }
        return data.files[0]; // { url, width, height }
    }

    T2AITools.register({
        name: 'insert_drawing',
        description: 'Renders SVG markup as a picture, or immediately inserts an image you already have (URL/base64) into the document currently being edited as a "drawing" (draw block). Unlike insert_image, the result becomes an editable drawing block recognized by the draw plugin, which the user can later reopen with the pen/eraser and keep drawing on. Specify exactly one of svg or image. This tool is not offered during document "rearrange" requests — in that case, drawings must be handled via a ```svg ... ``` fence block in the final result.',
        params: {
            svg: 'SVG markup string (e.g. "<svg ...>...</svg>"). If given, it\'s rendered on a white-background canvas and inserted as a drawing. Cannot be combined with image.',
            image: 'An image you already have — an http(s) URL or a data:image/...;base64,... data URI. Cannot be combined with svg.',
            width: 'Optional: drawing width (px). Default 800.',
            height: 'Optional: drawing height (px). Default 600.',
            caption: 'Optional: a description (caption) for this drawing. Applied as alt text.',
            id: 'Optional: the target editor id when multiple editors are present.',
        },
        unsafeForReplace: true,
        source: 't2ai_tool_drawing_insert.js',
        ui: {
            label: 'Insert Drawing',
            icon: 'brush',
            description: 'Draws a picture from SVG, or inserts an image as an editable drawing block. Can be reopened and edited later.',
            usage: 'e.g. asking to "draw a simple diagram and insert it" inserts it automatically when a drawing is needed. Not used during document rearranging.',
        },
        async run(args) {
            const svg = (args.svg != null) ? String(args.svg).trim() : '';
            const image = (args.image != null) ? String(args.image).trim() : '';

            if (!svg && !image) {
                return { ok: false, message: 'Either svg or image is required.' };
            }
            if (svg && image) {
                return { ok: false, message: 'svg and image cannot both be specified. Pass only one.' };
            }
            if (image && !looksLikeUsableImageSrc(image)) {
                return { ok: false, message: 'Unsupported image format. Only http(s) URLs or data:image/(png|jpeg|gif|webp|bmp);base64,... are allowed.' };
            }

            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { ok: false, message: 'No active T2Editor instance was found.' };

            const plugin = await ensurePlugin(editor, 'draw');
            if (!plugin || typeof plugin.createPlaceholderBlock !== 'function' ||
                typeof plugin.insertPlaceholderAtCursor !== 'function' ||
                typeof plugin.updateDrawingBlock !== 'function') {
                return { ok: false, message: 'The draw plugin is not available.' };
            }

            const width = parseInt(args.width, 10) || DEFAULT_W;
            const height = parseInt(args.height, 10) || DEFAULT_H;

            // 플레이스홀더를 커서 위치에 먼저 삽입(draw.js handleCommand('insertDrawing')와 동일 경로)
            const placeholderBlock = plugin.createPlaceholderBlock();
            plugin.insertPlaceholderAtCursor(placeholderBlock);
            plugin.currentDrawingBlock = placeholderBlock;

            let fileData;
            try {
                if (svg) {
                    const blob = await renderSvgToBlob(svg, width, height);
                    fileData = await uploadDrawing(editor, blob);
                } else if (isDataUri(image)) {
                    const blob = await dataUriToBlob(image);
                    fileData = await uploadDrawing(editor, blob);
                } else {
                    // 이미 호스팅된 URL — 업로드 없이 그대로 사용
                    fileData = { url: image, width, height };
                }
            } catch (e) {
                placeholderBlock.remove();
                plugin.currentDrawingBlock = null;
                return { ok: false, message: `Error while inserting the drawing: ${e && e.message ? e.message : String(e)}` };
            }

            if (!fileData.width) fileData.width = width;
            if (!fileData.height) fileData.height = height;

            plugin.updateDrawingBlock(fileData);

            const caption = args.caption;
            if (caption) {
                const img = placeholderBlock.querySelector('img');
                if (img) img.alt = String(caption).trim();
            }

            plugin.currentDrawingBlock = null;

            return {
                ok: true,
                image: fileData.url,
                width: fileData.width || null,
                height: fileData.height || null,
            };
        },
    });
})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
