// Path: T2Editor/plugin/meme/hooks.js
// Developer note: meme 저장 훅은 반복 실행되어도 같아야 하며, 런타임 UI를 제거하되 복원용 data 속성은 보존한다.
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

    // Submit 훅
    // 밈 삽입 결과는 표준 이미지 블록(.t2-media-block)이므로
    // image/hooks.js의 onSubmit이 처리한다. 여기서는 별도 처리 없음.
    T2EditorHooks.onSubmit('meme', function (tempDiv) {
        // no-op: image/hooks.js에 위임
    });

})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
