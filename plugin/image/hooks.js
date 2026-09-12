// Path: T2Editor/plugin/image/hooks.js
// Developer note: image 저장 훅은 반복 실행되어도 같아야 하며, 런타임 UI를 제거하되 복원용 data 속성은 보존한다.
// v10.0.0 — image 플러그인 submit 훅
//
// Restore is handled by image.js onContentSet → initializeImageBlocks().
// No onRestore registration needed here.
//
// [v10.0.0-beta2.3.5 - OVERFLOW FIX]
// 과거 코드: if (container.style.width) mediaEl.style.width = container.style.width;
//   → img.style.width 가 자연폭(예: 4000px)으로 강제 설정되어, view 모드(content.css)에서
//     컨테이너(.t2-image-container, max-width:100% 캡 적용)를 삐져나가는 오버플로우 발생.
// 수정: img 는 width:100%; max-width:100% 를 유지하여 항상 컨테이너 내부에 머무름.
//   iframe(video)은 기존 container.style.width 동기화 유지(video는 container 비율에 맞춰야 함).
//   추가로 img.style.maxWidth 를 '100%' 로 명시적 리셋하여 과거 인라인 잔존값 방어(이중 안전).

(function () {
    'use strict';

    // Submit 훅
    T2EditorHooks.onSubmit('image', function (tempDiv) {
        // .t2-media-block 중 video/file/drawing이 아닌 것 = image 블록
        tempDiv.querySelectorAll('.t2-media-block').forEach(function (block) {
            if (block.classList.contains('t2-video-block') ||
                block.classList.contains('t2-file-block') ||
                block.classList.contains('t2-drawing-block')) return;

            var container = block.querySelector('div:first-child');
            var mediaEl   = container ? container.querySelector('iframe, img') : null;
            if (!mediaEl) return;

            if (mediaEl.tagName === 'IMG') {
                // [OVERFLOW-FIX] img는 컨테이너 width 를 그대로 상속받지 않고
                // 항상 100% 로 렌더링되도록 고정. container.style.width 값(자연폭 px)이
                // img 에 전달되면 view 모드에서 오버플로우 발생.
                mediaEl.style.width = '100%';
                mediaEl.style.maxWidth = '100%';
                mediaEl.style.height = 'auto';
            } else if (mediaEl.tagName === 'IFRAME') {
                // video 블록은 기존 동작 유지: container 비율에 맞춰 iframe 크기 동기화
                if (container.style.width) mediaEl.style.width = container.style.width;
                if (container.style.height) mediaEl.style.height = container.style.height;
            }
            var ctrl = block.querySelector('.t2-media-controls');
            if (ctrl) ctrl.remove();
        });
    });

})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
