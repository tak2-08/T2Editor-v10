// Path: T2Editor/plugin/meme/hooks.js
// v10.0.1 — meme 플러그인 submit/restore 훅
//
// meme 플러그인은 T2ImagePlugin을 상속하여 image 플러그인의
// uploadImageFile() API를 통해 표준 .t2-media-block 이미지 블록을 삽입한다.
// 블록 submit/restore 처리는 image/hooks.js가 담당하므로
// meme 전용 추가 처리는 필요하지 않다.
//
// Restore: image.js onContentSet → initializeImageBlocks()가 담당.

(function () {
    'use strict';

    // ── Submit 훅 ─────────────────────────────────────────────────────────────
    // 밈 삽입 결과는 표준 이미지 블록(.t2-media-block)이므로
    // image/hooks.js의 onSubmit이 처리한다. 여기서는 별도 처리 없음.
    T2EditorHooks.onSubmit('meme', function (tempDiv) {
        // no-op: image/hooks.js에 위임
    });

})();
