// Path: T2Editor/plugin/code/hooks.js
// Developer note: code 저장 훅은 반복 실행되어도 같아야 하며, 런타임 UI를 제거하되 복원용 data 속성은 보존한다.
// v10.0.0 — code 플러그인 submit/restore 훅

(function () {
    'use strict';

    // Submit 훅
    T2EditorHooks.onSubmit('code', function (tempDiv) {
        tempDiv.querySelectorAll('.t2-code-block code').forEach(function (codeElement) {
            var codeContent = codeElement.textContent;
            codeElement.textContent = '';
            codeElement.appendChild(document.createTextNode(codeContent));
            codeElement.removeAttribute('data-events-setup');
            codeElement.removeAttribute('contenteditable');
        });
        tempDiv.querySelectorAll('.t2-code-block').forEach(function (block) {
            var ctrl = block.querySelector('.t2-media-controls');
            if (ctrl) ctrl.remove();
        });
    });

    // Restore 훅
    T2EditorHooks.onRestore('code', function (tempDiv) {
        var foundBlocks = new Set();

        function addEditorDirectChild(el) {
            if (!el || el === tempDiv) return;
            var node = el;
            while (node.parentElement && node.parentElement !== tempDiv) {
                node = node.parentElement;
            }
            if (node.parentElement === tempDiv) foundBlocks.add(node);
        }

        tempDiv.querySelectorAll('.t2-code-block, [data-block-id^="code_"]')
               .forEach(addEditorDirectChild);

        // <pre><code> 구조로 탐지 (class·data 전부 소실 시)
        tempDiv.querySelectorAll('pre > code').forEach(function (codeEl) {
            var node = codeEl;
            while (node.parentElement && node.parentElement !== tempDiv) {
                node = node.parentElement;
            }
            if (node.parentElement !== tempDiv) return;
            if (node.classList.contains('t2-video-block') ||
                node.classList.contains('t2-file-block') ||
                node.classList.contains('t2-table-wrapper') ||
                node.classList.contains('t2-drawing-block')) return;
            // 이미지·미디어 요소가 없는 것만 코드 블록으로 확정
            if (!node.querySelector('img, iframe, video, audio, .file-container, a[download]')) {
                foundBlocks.add(node);
            }
        });

        foundBlocks.forEach(function (block) {
            if (!block.classList.contains('t2-media-block')) block.classList.add('t2-media-block');
            if (!block.classList.contains('t2-code-block'))  block.classList.add('t2-code-block');
            block.setAttribute('contenteditable', 'false');
            if (!block.style.position) block.style.position = 'relative';

            var ctrl     = block.querySelector('.t2-media-controls');
            var moveCtrl = block.querySelector('.t2-move-controls');
            if (ctrl)     ctrl.remove();
            if (moveCtrl) moveCtrl.remove();

            if (block.parentNode && block.parentNode.nodeName === 'P') {
                var p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                var pText = p.textContent.replace(/\u200B/g, '').trim();
                if (!pText && !p.querySelector('img, iframe, video')) p.remove();
            }

            // <pre> 구조 복원
            var preEl = block.querySelector('pre');
            if (!preEl) {
                var container = block.querySelector('div') || block;
                preEl = document.createElement('pre');
                preEl.setAttribute('contenteditable', 'false');
                var orphanCode = container.querySelector('code');
                if (orphanCode) {
                    preEl.appendChild(orphanCode);
                } else {
                    var newCode = document.createElement('code');
                    newCode.textContent = container.textContent.trim();
                    preEl.appendChild(newCode);
                    container.textContent = '';
                }
                container.appendChild(preEl);
            }
            preEl.setAttribute('contenteditable', 'false');
            preEl.style.overflowX = 'auto';
            preEl.style.maxWidth  = '100%';

            var codeEl = preEl.querySelector('code');
            if (!codeEl) {
                var txt = preEl.textContent;
                preEl.innerHTML = '';
                codeEl = document.createElement('code');
                codeEl.textContent = txt;
                preEl.appendChild(codeEl);
            } else {
                var preText = preEl.textContent;
                if (preEl.childNodes.length > 1 || codeEl.textContent !== preText) {
                    codeEl.textContent = preText;
                    Array.prototype.slice.call(preEl.childNodes).forEach(function (child) {
                        if (child !== codeEl) preEl.removeChild(child);
                    });
                }
                // XSS sanitize: innerHTML과 textContent 불일치 시 textContent로 강제 재설정
                var rawText  = codeEl.textContent;
                var expected = rawText.replace(/&/g,'&amp;').replace(/</g,'&lt;')
                                      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                if (codeEl.innerHTML !== expected) codeEl.textContent = rawText;
            }
            codeEl.removeAttribute('data-events-setup');
        });
    });

})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
