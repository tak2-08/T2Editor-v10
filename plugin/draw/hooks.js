// Path: T2Editor/plugin/draw/hooks.js
// Developer note: draw 저장 훅은 반복 실행되어도 같아야 하며, 런타임 UI를 제거하되 복원용 data 속성은 보존한다.
// v10.0.0 — draw 플러그인 submit/restore 훅

(function () {
    'use strict';

    var PLACEHOLDER_1PX =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Submit 훅
    T2EditorHooks.onSubmit('draw', function (tempDiv) {
        tempDiv.querySelectorAll('.t2-drawing-block').forEach(function (block) {
            var ctrl = block.querySelector('.t2-media-controls');
            if (ctrl) ctrl.remove();

            var container  = block.querySelector('div:first-child');
            var img        = block.querySelector('img');
            var drawingUrl = block.getAttribute('data-drawing-url') ||
                             (container && container.getAttribute('data-drawing-url')) ||
                             (img && img.src && img.src !== PLACEHOLDER_1PX ? img.src : '') || '';

            if (!drawingUrl) return;

            block.setAttribute('data-t2-block',    'drawing');
            block.setAttribute('data-drawing-url', drawingUrl);
            if (container) {
                container.setAttribute('data-t2-block',    'drawing');
                container.setAttribute('data-drawing-url', drawingUrl);
            }

            if (container) {
                var anchor = container.querySelector('.t2-drawing-source');
                if (!anchor) {
                    anchor = document.createElement('a');
                    anchor.className = 't2-drawing-source';
                    anchor.setAttribute('aria-hidden', 'true');
                    anchor.setAttribute('tabindex', '-1');
                    anchor.style.cssText =
                        'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
                    container.appendChild(anchor);
                }
                anchor.href = drawingUrl;
            }
        });
    });

    // Restore 훅
    T2EditorHooks.onRestore('draw', function (tempDiv) {
        tempDiv.querySelectorAll('.t2-drawing-block').forEach(function (drawingBlock) {
            if (!drawingBlock.classList.contains('t2-media-block')) {
                drawingBlock.classList.add('t2-media-block');
            }
            drawingBlock.setAttribute('data-t2-block', 'drawing');

            var container = drawingBlock.querySelector('div:first-child');
            if (container) container.setAttribute('data-t2-block', 'drawing');

            var img = drawingBlock.querySelector('img');
            if (img && img.src && img.src !== PLACEHOLDER_1PX) {
                if (!drawingBlock.getAttribute('data-drawing-url')) {
                    drawingBlock.setAttribute('data-drawing-url', img.src);
                }
                if (container && !container.getAttribute('data-drawing-url')) {
                    container.setAttribute('data-drawing-url', img.src);
                }
            }
        });
    });

})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
