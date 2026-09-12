// Path: T2Editor/js/legacy_fallback.js
// v10.0.0 — 하위 호환 레거시 fallback 캡슐
//
// [목적] hooks.js 없는 서드파티/구버전 플러그인을 위해 V9.3.0 인라인 코드를
//        조건부로 실행한다. T2EditorHooks.has()로 각 플러그인 등록 여부를
//        확인하여, 이미 hooks.js가 처리하는 플러그인은 건너뛴다.
//
// [캡슐 제거법] 이 파일만 삭제하고 editor.lib.php에서 아래 로드 1줄을 제거:
//   echo _t2e_js_script($editor_url, 'js/legacy_fallback.js', $ver);
// 그러면 모든 레거시 fallback이 즉시 비활성화된다.

'use strict';

var T2LegacyFallback = (function () {

    // ── Restore: 콘텐츠 로드 시 블록 복구 ──────────────────────────────────
    function runRestoreFallback(tempDiv) {
        var H = window.T2EditorHooks;

        // ── table restore ─────────────────────────────────────────────────
        if (!H || !H.has('restore', 'table')) {
            tempDiv.querySelectorAll('.table-responsive').forEach(function (responsiveWrapper) {
                var table = responsiveWrapper.querySelector('table');
                if (!table) return;
                if (!table.classList.contains('t2-table')) table.classList.add('t2-table');
                var isLarge = table.classList.contains('t2-table-large') ||
                              table.rows.length > 10 ||
                              (table.rows[0] && table.rows[0].cells.length > 10);
                if (isLarge && !table.classList.contains('t2-table-large')) {
                    table.classList.add('t2-table-large');
                }
                var tableWrapper = document.createElement('div');
                tableWrapper.className = 't2-table-wrapper';
                tableWrapper.setAttribute('data-t2-block', 'table');
                tableWrapper.contentEditable = false;
                tableWrapper.style.position = 'relative';
                responsiveWrapper.parentNode.insertBefore(tableWrapper, responsiveWrapper);
                if (isLarge) {
                    var scrollWrapper = document.createElement('div');
                    scrollWrapper.className = 't2-table-scroll-wrapper';
                    tableWrapper.appendChild(scrollWrapper);
                    scrollWrapper.appendChild(table);
                } else {
                    tableWrapper.appendChild(table);
                }
                responsiveWrapper.remove();
            });
        }

        // ── drawing restore ───────────────────────────────────────────────
        // draw 블록은 draw.js onContentSet과 강하게 연동되어 있어
        // hooks.js 유무와 관계없이 항상 실행 (V9 동일)
        tempDiv.querySelectorAll('.t2-drawing-block').forEach(function (drawingBlock) {
            if (!drawingBlock.classList.contains('t2-media-block')) {
                drawingBlock.classList.add('t2-media-block');
            }
            drawingBlock.setAttribute('data-t2-block', 'drawing');
            var container = drawingBlock.querySelector('div:first-child');
            if (container) container.setAttribute('data-t2-block', 'drawing');
            var img = drawingBlock.querySelector('img');
            var PLACEHOLDER_1PX =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA' +
                'DUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
            if (img && img.src && img.src !== PLACEHOLDER_1PX) {
                if (!drawingBlock.getAttribute('data-drawing-url')) {
                    drawingBlock.setAttribute('data-drawing-url', img.src);
                }
                if (container && !container.getAttribute('data-drawing-url')) {
                    container.setAttribute('data-drawing-url', img.src);
                }
            }
        });

        // ── video restore ─────────────────────────────────────────────────
        if (!H || !H.has('restore', 'video')) {
            (function restoreVideoBlocks(root) {
                var found = [];
                var seen  = new Set();

                function addDirectChild(el) {
                    if (!el || el === root) return;
                    var node = el;
                    while (node.parentElement && node.parentElement !== root) {
                        node = node.parentElement;
                    }
                    if (node.parentElement === root && !seen.has(node)) {
                        seen.add(node);
                        found.push(node);
                    }
                }

                root.querySelectorAll('.t2-video-block, [data-t2-block="video"]')
                    .forEach(function (el) { addDirectChild(el); });
                root.querySelectorAll('iframe[src*="video_view.php"]')
                    .forEach(function (el) { addDirectChild(el.closest('div') || el.parentElement); });
                root.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"]')
                    .forEach(function (el) { addDirectChild(el.closest('div') || el.parentElement); });
                root.querySelectorAll('.t2-video-source[href]')
                    .forEach(function (el) { addDirectChild(el.closest('div') || el.parentElement); });
                root.querySelectorAll('a[href]').forEach(function (a) {
                    var href = a.getAttribute('href') || '';
                    if (/\.(mp4|webm|ogg|mov|m4v|mkv|avi|wmv|flv)(\?|#|$)/i.test(href)) {
                        addDirectChild(a.closest('div') || a.parentElement);
                    }
                });

                found.forEach(function (block) {
                    if (block.classList.contains('t2-file-block') ||
                        block.classList.contains('t2-code-block') ||
                        block.classList.contains('t2-table-wrapper') ||
                        block.classList.contains('t2-drawing-block')) return;

                    var hasIframe    = !!block.querySelector('iframe');
                    var hasFallback  = !!block.querySelector('.t2-video-source[href]');
                    var hasVideoLink = (function () {
                        var links = block.querySelectorAll('a[href]');
                        for (var i = 0; i < links.length; i++) {
                            if (/\.(mp4|webm|ogg|mov|m4v|mkv|avi|wmv|flv)(\?|#|$)/i.test(links[i].getAttribute('href') || '')) return true;
                        }
                        return false;
                    })();
                    if (!hasIframe && !hasFallback && !hasVideoLink) return;

                    block.classList.add('t2-media-block', 't2-video-block');
                    block.setAttribute('data-t2-block', 'video');
                    block.setAttribute('contenteditable', 'false');
                    if (!block.style.position) block.style.position = 'relative';

                    var ctrl = block.querySelector('.t2-media-controls');
                    if (ctrl) ctrl.remove();
                    var moveCtrl = block.querySelector('.t2-move-controls');
                    if (moveCtrl) moveCtrl.remove();

                    if (block.parentNode && block.parentNode.nodeName === 'P') {
                        var p = block.parentNode;
                        p.parentNode.insertBefore(block, p);
                        var pText = (p.textContent || '').replace(/\u200B/g, '').trim();
                        if (!pText && !p.querySelector('img, iframe, video')) p.remove();
                    }
                });
            })(tempDiv);
        }

        // ── file restore ─────────────────────────────────────────────────
        if (!H || !H.has('restore', 'file')) {
            (function restoreFileBlocks(root) {
                var found = [];
                var seen  = new Set();

                function addDirectChild(el) {
                    if (!el || el === root) return;
                    var node = el;
                    while (node.parentElement && node.parentElement !== root) {
                        node = node.parentElement;
                    }
                    if (node.parentElement === root && !seen.has(node)) {
                        seen.add(node);
                        found.push(node);
                    }
                }

                root.querySelectorAll('.t2-file-block, [data-t2-block="file"]')
                    .forEach(function (el) { addDirectChild(el); });
                root.querySelectorAll('.file-container')
                    .forEach(function (el) { addDirectChild(el.closest('div') || el); });
                root.querySelectorAll('.audio-file-container, .audio-player')
                    .forEach(function (el) { addDirectChild(el.closest('div') || el); });
                root.querySelectorAll('a[download]').forEach(function (a) {
                    addDirectChild(a.closest('div, article, section') || a.parentElement);
                });
                root.querySelectorAll('a[href*="pdf_view.php"]').forEach(function (a) {
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
            })(tempDiv);
        }

        // ── code restore ─────────────────────────────────────────────────
        if (!H || !H.has('restore', 'code')) {
            (function restoreCodeBlocks(root) {
                var foundBlocks = new Set();

                function addEditorDirectChild(el) {
                    if (!el || el === root) return;
                    var node = el;
                    while (node.parentElement && node.parentElement !== root) {
                        node = node.parentElement;
                    }
                    if (node.parentElement === root) foundBlocks.add(node);
                }

                root.querySelectorAll('.t2-code-block, [data-block-id^="code_"]')
                    .forEach(addEditorDirectChild);

                root.querySelectorAll('pre > code').forEach(function (codeEl) {
                    var node = codeEl;
                    while (node.parentElement && node.parentElement !== root) {
                        node = node.parentElement;
                    }
                    if (node.parentElement !== root) return;
                    if (node.classList.contains('t2-video-block') ||
                        node.classList.contains('t2-file-block') ||
                        node.classList.contains('t2-table-wrapper') ||
                        node.classList.contains('t2-drawing-block')) return;
                    if (!node.querySelector('img, iframe, video, audio, .file-container, a[download]')) {
                        foundBlocks.add(node);
                    }
                });

                foundBlocks.forEach(function (block) {
                    if (!block.classList.contains('t2-media-block')) block.classList.add('t2-media-block');
                    if (!block.classList.contains('t2-code-block'))  block.classList.add('t2-code-block');
                    block.setAttribute('contenteditable', 'false');
                    if (!block.style.position) block.style.position = 'relative';

                    var ctrl = block.querySelector('.t2-media-controls');
                    if (ctrl) ctrl.remove();
                    var moveCtrl = block.querySelector('.t2-move-controls');
                    if (moveCtrl) moveCtrl.remove();

                    if (block.parentNode && block.parentNode.nodeName === 'P') {
                        var p = block.parentNode;
                        p.parentNode.insertBefore(block, p);
                        var pText = p.textContent.replace(/\u200B/g, '').trim();
                        if (!pText && !p.querySelector('img, iframe, video')) p.remove();
                    }

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
                        var rawText = codeEl.textContent;
                        var expected = rawText.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                                              .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        if (codeEl.innerHTML !== expected) codeEl.textContent = rawText;
                    }
                    codeEl.removeAttribute('data-events-setup');
                });
            })(tempDiv);
        }
    }

    // ── Submit: 저장 전 DOM 정제 ────────────────────────────────────────────
    function runSubmitFallback(tempDiv) {
        var H = window.T2EditorHooks;

        // ── code submit ──────────────────────────────────────────────────
        if (!H || !H.has('submit', 'code')) {
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
        }

        // ── file + drawing submit ────────────────────────────────────────
        if (!H || !H.has('submit', 'file')) {
            tempDiv.querySelectorAll('.t2-file-block, .t2-drawing-block').forEach(function (block) {
                var ctrl = block.querySelector('.t2-media-controls');
                if (ctrl) ctrl.remove();

                if (block.classList.contains('t2-drawing-block')) {
                    var container  = block.querySelector('div:first-child');
                    var img        = block.querySelector('img');
                    var PLACEHOLDER_1PX =
                        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA' +
                        'DUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
                    var drawingUrl = block.getAttribute('data-drawing-url') ||
                                     (container && container.getAttribute('data-drawing-url')) ||
                                     (img && img.src && img.src !== PLACEHOLDER_1PX ? img.src : '') || '';
                    if (drawingUrl) {
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
                    }
                }
            });
        }

        // ── video submit ─────────────────────────────────────────────────
        if (!H || !H.has('submit', 'video')) {
            var t2IsVideoViewIframe = function (src) {
                return String(src || '').toLowerCase().indexOf('video_view.php') !== -1;
            };
            var t2ToAbsoluteUrl = function (src) {
                if (!src) return src;
                try { return new URL(src, window.location.href).href; } catch (e) { return src; }
            };

            tempDiv.querySelectorAll('.t2-video-block').forEach(function (block) {
                var container = block.querySelector('div:first-child');

                var videoEl = container ? container.querySelector('video') : null;
                if (videoEl) {
                    if (container.style.width)  videoEl.style.width  = container.style.width;
                    if (container.style.height) videoEl.style.height = container.style.height;
                    if (!videoEl.hasAttribute('controls')) videoEl.setAttribute('controls', 'controls');
                    if (!videoEl.style.backgroundColor)   videoEl.style.backgroundColor = '#000';
                }

                var iframeEl = container ? container.querySelector('iframe') : null;
                if (iframeEl) {
                    var rawSrc = iframeEl.getAttribute('src') || '';
                    if (t2IsVideoViewIframe(rawSrc)) {
                        iframeEl.removeAttribute('sandbox');
                        iframeEl.setAttribute('src', t2ToAbsoluteUrl(rawSrc));
                        rawSrc = iframeEl.getAttribute('src') || rawSrc;
                    }
                    if (!iframeEl.dataset.videoUrl && !iframeEl.dataset.videoId) {
                        var m = rawSrc.match(/[?&]video=([^&]+)/);
                        if (m) {
                            try { iframeEl.dataset.videoUrl = decodeURIComponent(m[1]); }
                            catch (e) { iframeEl.dataset.videoUrl = m[1]; }
                        }
                    }
                    if (!iframeEl.dataset.videoType) {
                        iframeEl.dataset.videoType = iframeEl.dataset.videoId ? 'youtube' : 'video';
                    }

                    var vType = iframeEl.dataset.videoType;
                    var vUrl  = iframeEl.dataset.videoUrl  || '';
                    var vId   = iframeEl.dataset.videoId   || '';
                    if (vType) {
                        block.setAttribute('data-t2-block',   'video');
                        block.setAttribute('data-video-type', vType);
                        if (container) {
                            container.setAttribute('data-t2-block',   'video');
                            container.setAttribute('data-video-type', vType);
                        }
                        if (vType === 'youtube' && vId) {
                            block.setAttribute('data-video-id', vId);
                            if (container) container.setAttribute('data-video-id', vId);
                            block.removeAttribute('data-video-url');
                            if (container) container.removeAttribute('data-video-url');
                        } else if (vUrl) {
                            block.setAttribute('data-video-url', vUrl);
                            if (container) container.setAttribute('data-video-url', vUrl);
                            block.removeAttribute('data-video-id');
                            if (container) container.removeAttribute('data-video-id');
                        }
                        if (container) {
                            var anchor = container.querySelector('.t2-video-source');
                            if (!anchor) {
                                anchor = document.createElement('a');
                                anchor.className = 't2-video-source';
                                anchor.setAttribute('aria-hidden', 'true');
                                anchor.setAttribute('tabindex', '-1');
                                anchor.style.cssText =
                                    'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
                                container.appendChild(anchor);
                            }
                            if (vType === 'youtube' && vId) {
                                var safeId = vId.replace(/[^a-zA-Z0-9\-_]/g, '');
                                anchor.href = safeId ? 'https://www.youtube.com/watch?v=' + safeId : '';
                            } else {
                                anchor.href = vUrl || '';
                            }
                        }
                    }
                }
                var controls = block.querySelector('.t2-media-controls');
                if (controls) controls.remove();
                var moveControls = block.querySelector('.t2-move-controls');
                if (moveControls) moveControls.remove();
            });
        }

        // ── image submit ─────────────────────────────────────────────────
        if (!H || !H.has('submit', 'image')) {
            tempDiv.querySelectorAll('.t2-media-block').forEach(function (block) {
                if (block.classList.contains('t2-video-block') ||
                    block.classList.contains('t2-file-block') ||
                    block.classList.contains('t2-drawing-block')) return;
                var container = block.querySelector('div:first-child');
                var mediaEl   = container ? container.querySelector('iframe, img') : null;
                if (mediaEl) {
                    if (container.style.width)  mediaEl.style.width  = container.style.width;
                    if (container.style.height && mediaEl.tagName === 'IFRAME') {
                        mediaEl.style.height = container.style.height;
                    }
                    var ctrl = block.querySelector('.t2-media-controls');
                    if (ctrl) ctrl.remove();
                }
            });
        }

        // ── table submit: controls 제거만 ────────────────────────────────
        // (.table-responsive 변환은 editor.lib.php가 항상 실행)
        if (!H || !H.has('submit', 'table')) {
            tempDiv.querySelectorAll('.t2-table-wrapper').forEach(function (wrapper) {
                var ctrl = wrapper.querySelector('.t2-table-controls, .t2-table-download-btn');
                if (ctrl) ctrl.remove();
            });
            tempDiv.querySelectorAll('.t2-code-block').forEach(function (block) {
                var ctrl = block.querySelector('.t2-media-controls');
                if (ctrl) ctrl.remove();
            });
        }
    }

    return { runRestoreFallback: runRestoreFallback, runSubmitFallback: runSubmitFallback };

})();

window.T2LegacyFallback = T2LegacyFallback;
