// Path: T2Editor/extend/js/t2ai_tool_image_insert.js
// Developer note: Tool 이름·입력 schema·반환 형식은 T2AI 레지스트리와 모델 프롬프트의 호출 계약이므로 함께 수정한다.
//
// T2Editor AI Tool — insert_image
// (이전 이름: insert_generated_image / 파일명: t2ai_tool_image_generate.js.
//  "generate"라는 이름과 달리 이 Tool은 이미지를 생성하지 않는다 — 오직
//  "이미 확보된 이미지 데이터(URL 또는 base64 data URI)를 문서에 이미지
//  블록으로 심는" 역할만 한다는 게 이름과 실제 동작이 어긋나 있어서, 실제
//  기능을 정확히 드러내는 insert_image / t2ai_tool_image_insert.js로 정리함.)
//
// 이미지 "생성" API를 호출하지 않는다. 이 Tool은 오직 "이미 확보된 이미지
// 데이터(URL 또는 base64 data URI)를 이미지 블록으로 문서에 심는" 부분만
// 담당한다 — 이미지 생성 AI를 나중에 연동할 때 필요한 "구조"만 미리 갖춰둔
// 것이다. 어떤 이미지 생성 서비스를 붙이든, 그 결과물(URL 또는 base64)을
// 이 Tool의 image 인자에 그대로 넘기기만 하면 바로 동작한다.
//
// image 플러그인의 createImageBlock()을 그대로 재사용한다(t2llm.js의 IMG:
// 태그와 동일한 내부 경로) — 이 Tool이 하는 건 "누가 만들었는지(생성 AI인지
// 사람인지)" 상관없이 이미지를 블록화하는 것뿐이며, caption 인자를 alt
// 텍스트로 자동 매핑해 "이 이미지가 무엇인지"가 문서에도 남도록 돕는다.
//
// image 플러그인 소스코드는 건드리지 않는다. createImageBlock 이 없는 구버전
// 등에서는 안전하게 실패 메시지를 반환한다.
//
// unsafeForReplace: true — 재구성(rearrange) 요청에는 노출되지 않음
// 이 Tool은 결과를 반환만 하는 다른 Tool들과 달리, run() 실행 그 자체가
// 즉시 에디터 DOM에 이미지 블록을 심는다(부작용이 있는 유일한 Tool). 문서
// "재구성" 요청은 AI의 최종 응답을 T2LLM.apply(DSL, {mode:'replace'})로
// 적용한다 — 즉 문서 전체를 비우고 새로 채운다. 이 Tool이 재구성 도중에
// 실행되면, 방금 심은 이미지가 그 직후의 전체 교체로 통째로 사라지고,
// 이 Tool은 삽입한 이미지의 URL을 돌려주지 않으므로(구조상 "심는" 것 자체가
// 결과였음) AI가 최종 DSL에 IMG: 줄로 그걸 되살릴 방법도 없다 — 즉 유저
// 입장에서는 "분명 넣었다는데 감쪽같이 사라지는" 버그로 보인다.
// unsafeForReplace:true는 이 위험을 아는 당사자(이 파일)가 직접 선언해,
// ai_complex.js의 getClientToolsPayload(mode)가 mode==='rearrange'일 때
// 이 Tool을 아예 광고하지 않도록 스스로 걸러지게 한다(재구성 모드에서는
// 이미지를 IMGQ:/IMG: DSL 태그로 다루는 기존 경로를 그대로 쓰면 된다).
// 글쓰기(generate) 모드는 T2LLM.apply(dsl, {mode:'append'})만 쓰므로 이
// Tool의 즉시 삽입과 충돌하지 않는다 — generate 모드에는 계속 노출된다.

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn(T2Utils.tf('t2ai.console_module_not_loaded', {tool: 'insert_image'}, '[T2AI] t2ai_core.js not loaded yet — skipping insert_image registration.'));
        return;
    }

    async function ensurePlugin(editor, name) {
        if (!editor.getPlugin(name) && typeof editor.loadPluginImmediately === 'function') {
            try { await editor.loadPluginImmediately(name); } catch (e) { console.warn(T2Utils.tf('t2ai.console_plugin_load_failed', {name: name}, '[T2AI] Plugin load failed: ' + name), e); }
        }
        return editor.getPlugin(name);
    }

    function looksLikeUsableImageSrc(src) {
        const s = String(src || '').trim();
        if (!s) return false;
        if (/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(s)) return true;
        if (/^https?:\/\//i.test(s)) return true;
        if (/^\//.test(s)) return true; // 루트 상대 경로
        return false;
    }

    T2AITools.register({
        name: 'insert_image',
        description: 'Immediately inserts an image you already have (an http(s) URL, or base64 data in data:image/...;base64,... form) as an image block into the document currently being edited. This tool does not generate images — it only "places" an image you already have into the document. (e.g. pass through an image found by search_meme/search_external_content, the base64 result of read_image_blocks, or the output of a future image-generation API.) This tool is not offered during document "rearrange" requests — in that case, images must be handled via IMG:/IMGQ: tags in the final result instead.',
        params: {
            image: 'The image to insert — an http(s) URL or a data:image/...;base64,... data URI. Required.',
            caption: 'Optional: a description (caption) for this image. Automatically applied as alt text.',
            width: 'Optional: display width (px)',
            height: 'Optional: display height (px)',
            id: 'Optional: the target editor id when multiple editors are present.',
        },
        unsafeForReplace: true,
        source: 't2ai_tool_image_insert.js',
        ui: {
            label: 'Insert Image',
            icon: 'image',
            description: 'Inserts an image (URL/base64) directly into the document. Does not generate new images.',
            usage: 'e.g. asking to "insert this image into the document" inserts it automatically when the image already exists. Not used during document rearranging.',
        },
        async run(args) {
            const image = String(args.image || '').trim();
            if (!image) return { ok: false, message: 'image is empty (an URL or base64 data URI is required).' };
            if (!looksLikeUsableImageSrc(image)) {
                return { ok: false, message: 'Unsupported image format. Only http(s) URLs or data:image/(png|jpeg|gif|webp|bmp);base64,... are allowed.' };
            }

            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { ok: false, message: 'No active T2Editor instance was found.' };

            const plugin = await ensurePlugin(editor, 'image');
            if (!plugin || typeof plugin.createImageBlock !== 'function') {
                return { ok: false, message: 'The image plugin is not available.' };
            }

            const width = parseInt(args.width, 10) || undefined;
            const height = parseInt(args.height, 10) || undefined;
            const block = plugin.createImageBlock({ url: image, width, height });
            if (!block) {
                return { ok: false, message: 'Failed to create the image block (the image may have failed a security check).' };
            }

            const caption = args.caption != null ? args.caption : args.prompt; // 이전 인자명(prompt)도 당분간 허용
            if (caption) {
                const img = block.querySelector('img');
                if (img) img.alt = String(caption).trim();
            }

            if (typeof editor.insertBlockWithBoundaryLines === 'function') {
                editor.insertBlockWithBoundaryLines(block, editor._lastEditorBookmark || null);
            } else {
                editor.editor.appendChild(block);
                if (typeof editor.normalizeContent === 'function') editor.normalizeContent();
            }
            if (typeof editor.createUndoPoint === 'function') editor.createUndoPoint();
            if (typeof editor.autoSave === 'function') editor.autoSave();

            return {
                ok: true,
                blockIndex: Array.prototype.indexOf.call(editor.editor.children, block),
                image,
                width: width || null,
                height: height || null,
            };
        },
    });
})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
