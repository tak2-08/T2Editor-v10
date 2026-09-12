// Path: T2Editor/plugin/file/hooks.js
// Developer note: file 저장 훅은 반복 실행되어도 같아야 하며, 런타임 UI를 제거하되 복원용 data 속성은 보존한다.
// v10.0.0 — file 플러그인 submit/restore 훅

(function () {
    'use strict';

    // Submit 훅
    T2EditorHooks.onSubmit('file', function (tempDiv) {
        tempDiv.querySelectorAll('.t2-file-block').forEach(function (block) {
            var ctrl = block.querySelector('.t2-media-controls');
            if (ctrl) ctrl.remove();
        });
    });

    // Restore 훅
    T2EditorHooks.onRestore('file', function (tempDiv) {
        var found = [];
        var seen  = new Set();

        function addDirectChild(el) {
            if (!el || el === tempDiv) return;
            var node = el;
            while (node.parentElement && node.parentElement !== tempDiv) {
                node = node.parentElement;
            }
            if (node.parentElement === tempDiv && !seen.has(node)) {
                seen.add(node);
                found.push(node);
            }
        }

        tempDiv.querySelectorAll('.t2-file-block, [data-t2-block="file"]')
               .forEach(function (el) { addDirectChild(el); });
        tempDiv.querySelectorAll('.file-container')
               .forEach(function (el) { addDirectChild(el.closest('div') || el); });
        tempDiv.querySelectorAll('.audio-file-container, .audio-player')
               .forEach(function (el) { addDirectChild(el.closest('div') || el); });
        tempDiv.querySelectorAll('a[download]').forEach(function (a) {
            addDirectChild(a.closest('div, article, section') || a.parentElement);
        });
        tempDiv.querySelectorAll('a[href*="pdf_view.php"]').forEach(function (a) {
            addDirectChild(a.closest('div, article, section') || a.parentElement);
        });

        found.forEach(function (block) {
            if (block.classList.contains('t2-video-block') ||
                block.classList.contains('t2-code-block') ||
                block.classList.contains('t2-table-wrapper') ||
                block.classList.contains('t2-drawing-block')) return;

            var hasFileContent = block.querySelector(
                '.file-container, .audio-player, .audio-file-container, a[download], a[href*="pdf_view.php"], audio'
            );
            if (!hasFileContent) return;

            block.classList.add('t2-media-block', 't2-file-block');
            block.setAttribute('data-t2-block', 'file');
            block.setAttribute('contenteditable', 'false');
            if (!block.style.position) block.style.position = 'relative';

            var ctrl = block.querySelector('.t2-media-controls');
            if (ctrl) ctrl.remove();

            if (block.parentNode && block.parentNode.nodeName === 'P') {
                var p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                if (!p.textContent.trim() && !p.querySelector('img, iframe, video')) p.remove();
            }
        });
    });

})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
