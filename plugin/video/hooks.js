// Path: T2Editor/plugin/video/hooks.js
// v10.0.0 — video 플러그인 submit/restore 훅

(function () {
    'use strict';

    // ── Submit 훅 ─────────────────────────────────────────────────────────────
    T2EditorHooks.onSubmit('video', function (tempDiv) {
        var t2IsVideoViewIframe = function (src) {
            return String(src || '').toLowerCase().indexOf('video_view.php') !== -1;
        };
        var t2ToAbsoluteUrl = function (src) {
            if (!src) return src;
            try { return new URL(src, window.location.href).href; } catch (e) { return src; }
        };

        tempDiv.querySelectorAll('.t2-video-block').forEach(function (block) {
            var container = block.querySelector('div:first-child');

            // <video> 태그 처리
            var videoEl = container ? container.querySelector('video') : null;
            if (videoEl) {
                if (container.style.width)  videoEl.style.width  = container.style.width;
                if (container.style.height) videoEl.style.height = container.style.height;
                if (!videoEl.hasAttribute('controls')) videoEl.setAttribute('controls', 'controls');
                if (!videoEl.style.backgroundColor)   videoEl.style.backgroundColor = '#000';
            }

            var iframeEl = container ? container.querySelector('iframe') : null;
            if (!iframeEl) return;

            var rawSrc = iframeEl.getAttribute('src') || '';

            // sandbox 제거 + 절대 URL (video_view.php 직접 업로드)
            if (t2IsVideoViewIframe(rawSrc)) {
                iframeEl.removeAttribute('sandbox');
                iframeEl.setAttribute('src', t2ToAbsoluteUrl(rawSrc));
                rawSrc = iframeEl.getAttribute('src') || rawSrc;
            }

            // data-video-url 누락 시 src에서 복원
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
            if (!vType) return;

            // wrapper / container data-* 재기록
            block.setAttribute('data-t2-block',   'video');
            block.setAttribute('data-video-type', vType);
            if (container) {
                container.setAttribute('data-t2-block',   'video');
                container.setAttribute('data-video-type', vType);
            }
            if (vType === 'youtube' && vId) {
                block.setAttribute('data-video-id',  vId);
                block.removeAttribute('data-video-url');
                if (container) {
                    container.setAttribute('data-video-id', vId);
                    container.removeAttribute('data-video-url');
                }
            } else if (vUrl) {
                block.setAttribute('data-video-url', vUrl);
                block.removeAttribute('data-video-id');
                if (container) {
                    container.setAttribute('data-video-url', vUrl);
                    container.removeAttribute('data-video-id');
                }
            }

            // fallback anchor 갱신
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

            // 에디터 전용 controls 제거
            var ctrl     = block.querySelector('.t2-media-controls');
            var moveCtrl = block.querySelector('.t2-move-controls');
            if (ctrl)     ctrl.remove();
            if (moveCtrl) moveCtrl.remove();
        });
    });

    // ── Restore 훅 ────────────────────────────────────────────────────────────
    T2EditorHooks.onRestore('video', function (tempDiv) {
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

        tempDiv.querySelectorAll('.t2-video-block, [data-t2-block="video"]')
               .forEach(function (el) { addDirectChild(el); });
        tempDiv.querySelectorAll('iframe[src*="video_view.php"]')
               .forEach(function (el) { addDirectChild(el.closest('div') || el.parentElement); });
        tempDiv.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"]')
               .forEach(function (el) { addDirectChild(el.closest('div') || el.parentElement); });
        tempDiv.querySelectorAll('.t2-video-source[href]')
               .forEach(function (el) { addDirectChild(el.closest('div') || el.parentElement); });
        tempDiv.querySelectorAll('a[href]').forEach(function (a) {
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
            var hasVideoLink = Array.from(block.querySelectorAll('a[href]')).some(function (a) {
                return /\.(mp4|webm|ogg|mov|m4v|mkv|avi|wmv|flv)(\?|#|$)/i.test(a.getAttribute('href') || '');
            });
            if (!hasIframe && !hasFallback && !hasVideoLink) return;

            block.classList.add('t2-media-block', 't2-video-block');
            block.setAttribute('data-t2-block', 'video');
            block.setAttribute('contenteditable', 'false');
            if (!block.style.position) block.style.position = 'relative';

            var ctrl     = block.querySelector('.t2-media-controls');
            var moveCtrl = block.querySelector('.t2-move-controls');
            if (ctrl)     ctrl.remove();
            if (moveCtrl) moveCtrl.remove();

            if (block.parentNode && block.parentNode.nodeName === 'P') {
                var p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                var pText = (p.textContent || '').replace(/\u200B/g, '').trim();
                if (!pText && !p.querySelector('img, iframe, video')) p.remove();
            }
        });
    });

})();
