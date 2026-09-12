// Path: T2Editor/plugin/video/hooks.js
// video 플러그인 submit/restore 훅
//
// 저장 시 iframe/<video>가 CMS 필터(그누보드5/라이믹스 등)에 잘려도 복원 가능하도록
// 세 지점에 데이터를 중복 기록한다: ① iframe(src)/<video><source src> 자체,
// ② wrapper·container의 data-video-* / data-align / 인라인 style, ③ 숨은
// <a class="t2-video-source" href="원본URL"> 폴백. 정렬은 wrapper의 text-align과
// container의 margin:0 auto + display:inline-block 이중 방어.
//
// [HARD-SIZE] iframe/<video> 태그 자신의 width/height "HTML 속성"과 인라인 px
// style에 실제 치수를 직접 하드코딩한다. container의 style이 전부 잘려도 이 태그
// 하나만 살아남으면 항상 올바른 크기로 표시된다.
//
// 에디터 재진입 시에는 video.js의 initializeVideoBlocks() + 이 파일의 onRestore
// 훅이 위 지점들을 순차 확인해 원본 iframe/video/컨트롤을 재구성한다.
(function () {
    'use strict';

    // ── Submit 훅 ─────────────────────────────────────────────────────────────
    T2EditorHooks.onSubmit('video', function (tempDiv) {
        var t2IsSelfHostedFrameSrc = function (src) {
            var s = String(src || '').toLowerCase();
            return s.indexOf('video_view.php') !== -1 || s.indexOf('video_player.php') !== -1;
        };
        var t2ToAbsoluteUrl = function (src) {
            if (!src) return src;
            try { return new URL(src, window.location.href).href; } catch (e) { return src; }
        };
        var t2GetQueryParam = function (src, name) {
            var m = String(src || '').match(new RegExp('[?&]' + name + '=([^&]+)'));
            if (!m) return '';
            try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
        };
        // iframe src에 t2w/t2h 쿼리파라미터로 크기를 병기 — style/data-*가 잘려도
        // src는 iframe 동작에 필수라 대부분 보존되므로 onRestore의 최우선 크기 소스가 된다.
        var t2AppendSizeParams = function (src, w, h) {
            if (!src || !w || !h) return src;
            try {
                var u = new URL(src, window.location.href);
                u.searchParams.set('t2w', String(w));
                u.searchParams.set('t2h', String(h));
                return u.toString();
            } catch (e) {
                var sep = src.indexOf('?') === -1 ? '?' : '&';
                return src + sep + 't2w=' + w + '&t2h=' + h;
            }
        };
        var t2SafeYoutubeId = function (id) {
            return String(id || '').replace(/[^a-zA-Z0-9\-_]/g, '');
        };
        var t2GuessMime = function (url) {
            var m = String(url || '').toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/);
            var ext = m ? m[1] : '';
            switch (ext) {
                case 'mp4': case 'm4v': return 'video/mp4';
                case 'webm':            return 'video/webm';
                case 'ogg': case 'ogv': return 'video/ogg';
                case 'mov':             return 'video/quicktime';
                case 'mkv':             return 'video/x-matroska';
                case 'wmv':             return 'video/x-ms-wmv';
                case 'avi':             return 'video/x-msvideo';
                case 'flv':             return 'video/x-flv';
                case 'm3u8':            return 'application/vnd.apple.mpegurl';
                default:                return 'video/mp4';
            }
        };

        tempDiv.querySelectorAll('.t2-video-block').forEach(function (block) {
            var container = block.querySelector('div');
            if (!container || container === block) container = block; // 필터로 잘린 극단적 경우 block 자체를 사용

            // 이미 <video> 태그인 경우(과거 포맷·붙여넣기 등)
            var videoEl = container.querySelector('video');
            if (videoEl) {
                // [HARD-SIZE] width/height를 속성 + px style 양쪽에 직접 하드코딩
                var vew = parseInt(container.style.width, 10)  || parseInt(container.dataset.width, 10)  || null;
                var veh = parseInt(container.style.height, 10) || parseInt(container.dataset.height, 10) || null;
                if (vew) { videoEl.setAttribute('width',  String(vew)); videoEl.style.width  = vew + 'px'; }
                if (veh) { videoEl.setAttribute('height', String(veh)); videoEl.style.height = veh + 'px'; }
                if (!videoEl.hasAttribute('controls')) videoEl.setAttribute('controls', 'controls');
                if (!videoEl.style.backgroundColor)   videoEl.style.backgroundColor = '#000';
            }

            var iframeEl = container.querySelector('iframe');
            var vType = '', vUrl = '', vId = '';

            if (iframeEl) {
                var rawSrc = iframeEl.getAttribute('src') || '';
                var isYoutubeSrc = /youtube(-nocookie)?\.com/i.test(rawSrc);
                var isSelfHostedFrame = t2IsSelfHostedFrameSrc(rawSrc);

                vType = iframeEl.dataset.videoType || '';
                vUrl  = iframeEl.dataset.videoUrl  || '';
                vId   = iframeEl.dataset.videoId   || '';

                if (!vType) {
                    if (isYoutubeSrc || vId) vType = 'youtube';
                    else if (isSelfHostedFrame || vUrl) vType = 'video';
                }
                if (vType === 'video' && !vUrl && isSelfHostedFrame) {
                    vUrl = t2GetQueryParam(rawSrc, 'video');
                }
                if (vType === 'youtube' && !vId) {
                    var m2 = rawSrc.match(/embed\/([a-zA-Z0-9\-_]+)/);
                    if (m2) vId = m2[1];
                }

                var finalW = parseInt(container.style.width, 10)  || parseInt(container.dataset.width, 10)  || null;
                var finalH = parseInt(container.style.height, 10) || parseInt(container.dataset.height, 10) || null;

                // [HARD-SIZE] "%" + container 크기 조합에 의존하지 않고, iframe 자신의
                // width/height 속성 + 인라인 px style에 최종 픽셀값을 직접 새긴다.
                if (finalW) iframeEl.setAttribute('width',  String(finalW));
                if (finalH) iframeEl.setAttribute('height', String(finalH));

                if (vType === 'video' && vUrl) {
                    // [IFRAME-KEEP] 자체 호스팅 영상도 <video>로 치환하지 않고 same-origin
                    // iframe(video_player.php/video_view.php)을 YouTube와 동일하게 유지한다.
                    iframeEl.removeAttribute('sandbox');
                    iframeEl.setAttribute('src', t2AppendSizeParams(t2ToAbsoluteUrl(rawSrc), finalW, finalH));
                    if (!iframeEl.dataset.videoType) iframeEl.dataset.videoType = 'video';
                    if (!iframeEl.dataset.videoUrl)  iframeEl.dataset.videoUrl  = vUrl;
                    if (finalW) iframeEl.style.width  = finalW + 'px';
                    if (finalH) iframeEl.style.height = finalH + 'px';
                } else if (vType === 'youtube') {
                    iframeEl.removeAttribute('sandbox');
                    iframeEl.setAttribute('src', t2AppendSizeParams(t2ToAbsoluteUrl(rawSrc), finalW, finalH));
                    if (!iframeEl.dataset.videoType) iframeEl.dataset.videoType = 'youtube';
                    if (vId && !iframeEl.dataset.videoId) iframeEl.dataset.videoId = vId;
                    if (finalW) iframeEl.style.width  = finalW + 'px';
                    if (finalH) iframeEl.style.height = finalH + 'px';
                }
                // wrapper(block)의 data-video-width/height에도 병기 (2차 방어선)
                if (finalW && finalH) {
                    block.setAttribute('data-video-width', String(finalW));
                    block.setAttribute('data-video-height', String(finalH));
                }
            } else if (videoEl) {
                vType = 'video';
                vUrl  = videoEl.dataset.videoUrl
                     || (videoEl.querySelector('source') && videoEl.querySelector('source').getAttribute('src'))
                     || videoEl.getAttribute('src')
                     || '';
            }

            if (!vType) return;

            // wrapper 정렬: text-align + data-align 병기
            block.setAttribute('data-t2-block',   'video');
            block.setAttribute('data-video-type', vType);
            block.setAttribute('data-align',      block.getAttribute('data-align') || 'center');
            var blockStyle = block.getAttribute('style') || '';
            if (!/text-align\s*:/i.test(blockStyle)) {
                block.style.textAlign = 'center';
            }

            if (container && container !== block) {
                container.setAttribute('data-t2-block',   'video');
                container.setAttribute('data-video-type', vType);
                var containerStyle = container.getAttribute('style') || '';
                if (!/margin\s*:\s*0\s+auto/i.test(containerStyle) &&
                    !/margin-left\s*:\s*auto/i.test(containerStyle)) {
                    container.style.margin = '0 auto';
                }
                // 실제 비디오는 바깥 비디오 블록 내부 너비의 최대 95%까지만 저장.
                // 과거 max-width:100% 저장물도 제출 시 95%로 교정한다.
                container.style.maxWidth = '95%';
                // text-align은 block 자식에 효과 없음 → inline-block으로 보정
                if (!/display\s*:/i.test(containerStyle)) {
                    container.style.display = 'inline-block';
                    container.style.verticalAlign = 'top';
                }
                if (iframeEl) iframeEl.style.maxWidth = '100%';
                if (videoEl)  videoEl.style.maxWidth  = '100%';
                var cw = parseInt(container.style.width, 10);
                var ch = parseInt(container.style.height, 10);
                if (cw && !container.dataset.width)  container.dataset.width  = String(cw);
                if (ch && !container.dataset.height) container.dataset.height = String(ch);
                if (cw && !container.dataset.originalWidth)  container.dataset.originalWidth  = String(cw);
                if (ch && !container.dataset.originalHeight) container.dataset.originalHeight = String(ch);
            }

            if (vType === 'youtube' && vId) {
                block.setAttribute('data-video-id',  vId);
                block.removeAttribute('data-video-url');
                if (container && container !== block) {
                    container.setAttribute('data-video-id', vId);
                    container.removeAttribute('data-video-url');
                }
            } else if (vUrl) {
                block.setAttribute('data-video-url', vUrl);
                block.removeAttribute('data-video-id');
                if (container && container !== block) {
                    container.setAttribute('data-video-url', vUrl);
                    container.removeAttribute('data-video-id');
                }
            }

            // fallback anchor 유지/보강 — data-*와 iframe/<video>가 함께 잘려도 복원 근거로 남긴다.
            var t2IsSafeHref = function (u) {
                if (!u) return false;
                var s = String(u).trim().toLowerCase();
                if (/^(javascript|vbscript|data|file):/i.test(s)) return false;
                return true;
            };
            var fallbackHref = '';
            if (vType === 'youtube') {
                var safeId = t2SafeYoutubeId(vId);
                fallbackHref = safeId ? 'https://www.youtube.com/watch?v=' + safeId : '';
            } else if (vUrl && t2IsSafeHref(vUrl)) {
                fallbackHref = t2ToAbsoluteUrl(vUrl);
            }
            if (container && fallbackHref) {
                var existingAnchor = container.querySelector('.t2-video-source');
                if (!existingAnchor) {
                    existingAnchor = document.createElement('a');
                    existingAnchor.className = 't2-video-source';
                    container.appendChild(existingAnchor);
                }
                existingAnchor.setAttribute('href', fallbackHref);
                // font-size:0 등 흔히 허용되는 속성으로 숨기고, 고정 라벨 텍스트를 채운다.
                // 이 스타일마저 필터에 잘리면 라벨 텍스트가 그대로 노출되어 최소한 동작하는 링크는 남는다.
                existingAnchor.style.cssText =
                    'display:inline-block;font-size:0;line-height:0;color:transparent;' +
                    'text-decoration:none;max-width:100%;overflow:hidden;';
                existingAnchor.textContent = (vType === 'youtube') ? '유튜브 영상 보기' : '동영상 보기';
            }

            // 에디터 전용 controls 제거
            var ctrl     = block.querySelector('.t2-media-controls');
            var moveCtrl = block.querySelector('.t2-move-controls');
            if (ctrl)     ctrl.remove();
            if (moveCtrl) moveCtrl.remove();
        });
    });

    // ── Restore 훅 ────────────────────────────────────────────────────────────
    // 저장된 HTML → 에디터로 재진입할 때, "video 블록으로 보이는" 후보 div에
    // 필수 클래스/속성/정렬 스타일을 다시 새긴다. 실제 iframe/video 재구성은
    // video.js의 initializeVideoBlocks()가 담당.
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
        tempDiv.querySelectorAll('iframe[src*="video_view.php"], iframe[src*="video_player.php"]')
               .forEach(function (el) { addDirectChild(el.closest('div') || el.parentElement); });
        tempDiv.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"]')
               .forEach(function (el) { addDirectChild(el.closest('div') || el.parentElement); });
        tempDiv.querySelectorAll('.t2-video-source[href]')
               .forEach(function (el) { addDirectChild(el.closest('div') || el.parentElement); });
        tempDiv.querySelectorAll('a[href]').forEach(function (a) {
            var href = a.getAttribute('href') || '';
            if (/\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|wmv|flv|m3u8)(\?|#|$)/i.test(href)) {
                addDirectChild(a.closest('div') || a.parentElement);
            }
        });

        found.forEach(function (block) {
            if (block.classList.contains('t2-file-block') ||
                block.classList.contains('t2-code-block') ||
                block.classList.contains('t2-table-wrapper') ||
                block.classList.contains('t2-drawing-block') ||
                block.classList.contains('t2-linkcard-block')) return;

            var hasIframe    = !!block.querySelector('iframe');
            var hasVideoTag  = !!block.querySelector('video');
            var hasFallback  = !!block.querySelector('.t2-video-source[href]');
            var hasVideoLink = Array.from(block.querySelectorAll('a[href]')).some(function (a) {
                return /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|wmv|flv|m3u8)(\?|#|$)/i.test(a.getAttribute('href') || '');
            });
            var hasDataUrl   = !!(block.getAttribute('data-video-url') || block.getAttribute('data-video-id'));
            if (!hasIframe && !hasVideoTag && !hasFallback && !hasVideoLink && !hasDataUrl) return;

            block.classList.add('t2-media-block', 't2-video-block');
            block.setAttribute('data-t2-block', 'video');
            block.setAttribute('contenteditable', 'false');
            if (!block.style.position) block.style.position = 'relative';
            var alignAttr = block.getAttribute('data-align') || 'center';
            if (!block.style.textAlign) block.style.textAlign = alignAttr;

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
