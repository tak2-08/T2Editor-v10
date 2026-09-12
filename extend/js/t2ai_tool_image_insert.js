// Path: T2Editor/extend/js/t2ai_tool_image_insert.js
//
// T2Editor AI Tool — insert_image
// ============================================================================
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
// ── unsafeForReplace: true — 재구성(rearrange) 요청에는 노출되지 않음 ───────
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
// ============================================================================

(function () {
    'use strict';

    if (!window.T2AITools) {
        console.warn('[T2AI] t2ai_core.js 가 아직 로드되지 않아 insert_image 등록을 건너뜁니다.');
        return;
    }

    async function ensurePlugin(editor, name) {
        if (!editor.getPlugin(name) && typeof editor.loadPluginImmediately === 'function') {
            try { await editor.loadPluginImmediately(name); } catch (e) { console.warn(`[T2AI] 플러그인 로드 실패: ${name}`, e); }
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
        description: '이미 확보되어 있는 이미지(http(s) URL 또는 data:image/...;base64,... 형식의 base64 데이터)를 지금 편집 중인 문서에 이미지 블록으로 즉시 삽입한다. 이 Tool은 이미지를 생성하지 않는다 — 어딘가에서 이미 가지고 있는 이미지를 "문서 안에 넣는" 역할만 한다. (예: search_meme/search_external_content가 찾아준 이미지, read_image_blocks의 base64 결과, 향후 연동될 이미지 생성 API의 결과물 등을 그대로 넘기면 된다.) 문서 "재구성" 요청 중에는 이 Tool이 제공되지 않는다 — 그 경우 이미지는 최종 결과의 IMG:/IMGQ: 태그로 다뤄야 한다.',
        params: {
            image: '삽입할 이미지 — http(s) URL 또는 data:image/...;base64,... 형식의 data URI. 필수.',
            caption: '선택: 이 이미지에 대한 설명(캡션). alt 텍스트로 자동 반영됨.',
            width: '선택: 표시 너비(px)',
            height: '선택: 표시 높이(px)',
            id: '선택: 여러 에디터가 있을 때 대상 에디터 id.',
        },
        unsafeForReplace: true,
        source: 't2ai_tool_image_insert.js',
        ui: {
            label: '이미지 삽입',
            icon: 'image',
            description: '이미지(URL/base64)를 지금 문서에 바로 넣어요. 이미지를 새로 만들어주지는 않아요.',
            usage: '예: "이 이미지를 문서에 넣어줘"처럼 넣을 이미지가 이미 있을 때 자동으로 삽입해요. 문서 재구성 중에는 사용되지 않아요.',
        },
        async run(args) {
            const image = String(args.image || '').trim();
            if (!image) return { ok: false, message: 'image 가 비어 있습니다 (URL 또는 base64 data URI 필요).' };
            if (!looksLikeUsableImageSrc(image)) {
                return { ok: false, message: '지원하지 않는 이미지 형식입니다. http(s) URL 또는 data:image/(png|jpeg|gif|webp|bmp);base64,... 형식만 허용됩니다.' };
            }

            const editor = T2AITools.resolveEditor(args.id);
            if (!editor) return { ok: false, message: '활성 T2Editor 인스턴스를 찾을 수 없습니다.' };

            const plugin = await ensurePlugin(editor, 'image');
            if (!plugin || typeof plugin.createImageBlock !== 'function') {
                return { ok: false, message: 'image 플러그인을 사용할 수 없습니다.' };
            }

            const width = parseInt(args.width, 10) || undefined;
            const height = parseInt(args.height, 10) || undefined;
            const block = plugin.createImageBlock({ url: image, width, height });
            if (!block) {
                return { ok: false, message: '이미지 블록 생성에 실패했습니다 (보안 검증을 통과하지 못한 이미지일 수 있습니다).' };
            }

            const caption = args.caption != null ? args.caption : args.prompt; // 이전 인자명(prompt)도 당분간 허용
            if (caption) {
                const img = block.querySelector('img');
                if (img) img.alt = String(caption).trim();
            }

            editor.editor.appendChild(block);
            if (typeof editor.normalizeContent === 'function') editor.normalizeContent();
            if (typeof editor.createUndoPoint === 'function') editor.createUndoPoint();
            if (typeof editor.autoSave === 'function') editor.autoSave();

            return {
                ok: true,
                blockIndex: editor.editor.children.length - 1,
                image,
                width: width || null,
                height: height || null,
            };
        },
    });
})();
