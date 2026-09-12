// Path: T2Editor/plugin/video/video_public_render.js
// =============================================================================
// video 플러그인 — 게시물 "보기" 화면 전용 복원 스크립트 v1.0.0
// -----------------------------------------------------------------------------
// 문제(과거):
//   그누보드5(clean_xss_tags 등)와 라이믹스(HTML 필터)는 게시물을 저장/출력할
//   때 보안을 위해 <iframe>, <script> 태그를 제거(또는 화이트리스트 도메인만
//   허용)한다. video 플러그인이 자체 호스팅 영상까지 <iframe>(video_player.php/
//   video_view.php)으로 감싸 저장하던 예전 버전에서는, 글을 "게시"하면 화면에서
//   영상이 완전히 사라졌다.
//
// [RHYMIX-IFRAME-WHITELIST]
//   라이믹스에서는 t2editor_iframe_whitelist 애드온을 활성화하면 자체
//   video_player.php/video_view.php iframe의 src가 필터에서 보존된다. 이
//   스크립트는 애드온이 비활성화되었거나 과거 게시물이 손상된 경우에만
//   fallback anchor/data-*를 이용해 브라우저 DOM을 복구하는 안전망이다.
// =============================================================================
(function () {
    'use strict';

    if (window.__t2VideoPublicRenderLoaded) return;
    window.__t2VideoPublicRenderLoaded = true;

    var VIDEO_EXT_RE = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|wmv|flv)(\?|#|$)/i;

    function safeYoutubeId(id) {
        return String(id || '').replace(/[^a-zA-Z0-9\-_]/g, '');
    }

    function findDirectChild(root, el) {
        if (!el || el === root) return null;
        var node = el;
        while (node.parentElement && node.parentElement !== root) node = node.parentElement;
        return node.parentElement === root ? node : node; // 최상위 컨테이너를 못 찾아도 el 자체를 반환
    }

    function getBlockContentWidth(block) {
        if (!block || !block.clientWidth) return 0;
        var width = block.clientWidth;
        try {
            var style = window.getComputedStyle(block);
            width -= (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        } catch (e) { /* clientWidth 폴백 */ }
        return Math.max(0, Math.floor(width));
    }

    // 게시물 보기에서도 실제 미디어 래퍼는 바깥 비디오 블록의 최대 95%다.
    // px width만 CSS로 줄이면 height가 그대로 남아 비율이 깨질 수 있으므로,
    // 저장된 width/height를 aspect-ratio로 전환해 반응형 높이까지 함께 보정한다.
    function enforceVideoContainerCap(block, inner) {
        if (!block || !inner || inner === block) return;

        inner.style.maxWidth = '95%';
        inner.style.boxSizing = 'border-box';

        var dw = parseInt(inner.getAttribute('data-width') || inner.dataset.width || inner.style.width || '', 10);
        var dh = parseInt(inner.getAttribute('data-height') || inner.dataset.height || inner.style.height || '', 10);
        var contentWidth = getBlockContentWidth(block);
        var maxWidth = contentWidth > 0 ? Math.max(1, Math.floor(contentWidth * 0.95)) : 0;

        if (dw && dh && maxWidth && dw > maxWidth) {
            dh = Math.max(1, Math.round(dh * maxWidth / dw));
            dw = maxWidth;
        }

        if (dw) inner.style.width = dw + 'px';
        if (dw && dh) {
            inner.style.aspectRatio = dw + ' / ' + dh;
            inner.style.height = 'auto';
        }

        var media = inner.querySelector('iframe, video');
        if (media) {
            media.style.width = '100%';
            media.style.height = '100%';
            media.style.maxWidth = '100%';
            media.style.display = 'block';
            if (dw && dh) {
                media.setAttribute('width', String(dw));
                media.setAttribute('height', String(dh));
            }
        }
    }

    // 이미 정상적으로 살아있는 iframe/video 가 있으면 손대지 않는다(멱등성).
    function alreadyWorking(block) {
        var iframe = block.querySelector('iframe');
        if (iframe && iframe.getAttribute('src')) return true;
        var video = block.querySelector('video');
        if (video && (video.querySelector('source[src]') || video.getAttribute('src'))) return true;
        return false;
    }

    function extractInfo(block) {
        var vType = block.getAttribute('data-video-type') || '';
        var vId   = block.getAttribute('data-video-id')   || '';
        var vUrl  = block.getAttribute('data-video-url')  || '';

        // data-* 속성까지 필터에 걸러졌을 경우를 대비한 2차 폴백:
        // 숨은 앵커(.t2-video-source) 또는 영상 확장자를 가진 일반 링크에서 복구.
        if (!vUrl && !vId) {
            var anchor = block.querySelector('.t2-video-source[href]');
            if (!anchor) {
                var links = block.querySelectorAll('a[href]');
                for (var i = 0; i < links.length; i++) {
                    if (VIDEO_EXT_RE.test(links[i].getAttribute('href') || '')) { anchor = links[i]; break; }
                }
            }
            if (anchor) {
                var href = anchor.getAttribute('href') || '';
                var ytMatch = href.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9\-_]+)/);
                if (ytMatch) { vType = 'youtube'; vId = ytMatch[1]; }
                else if (href) { vType = vType || 'video'; vUrl = href; }
            }
        }
        if (!vType) vType = vId ? 'youtube' : (vUrl ? 'video' : '');
        return { vType: vType, vId: vId, vUrl: vUrl };
    }

    function buildYoutubeIframe(vId) {
        var safeId = safeYoutubeId(vId);
        if (!safeId) return null;
        var iframe = document.createElement('iframe');
        iframe.src = 'https://www.youtube-nocookie.com/embed/' + safeId;
        iframe.setAttribute('title', 'YouTube video player');
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
        iframe.setAttribute('allowfullscreen', '');
        iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
        return iframe;
    }

    function buildVideoTag(vUrl) {
        if (!vUrl) return null;
        var video = document.createElement('video');
        video.setAttribute('controls', 'controls');
        video.style.cssText = 'width:100%;height:100%;display:block;background:#000;';
        var source = document.createElement('source');
        source.setAttribute('src', vUrl);
        video.appendChild(source);
        return video;
    }

    function renderBlock(block) {
        // [LAYOUT-HARDEN 10.4.0] 게시물 보기 화면에서도 wrapper 정렬을 복원.
        // CMS 필터가 wrapper 의 inline style="text-align:center" 를 삭제해도 data-align
        // 속성이 살아있으면 여기서 다시 새긴다. (에디터에서는 video.js가
        // 동일한 일을 함.) 이 복원은 미디어 태그 렌더링 여부와 무관하게
        // 수행되어야 하므로 alreadyWorking() 검사보다 앞에서 수행한다.
        var dataAlign = block.getAttribute('data-align') || '';
        if (dataAlign && !block.style.textAlign) block.style.textAlign = dataAlign;
        // 컨테이너 (치수 div) 의 수평 auto 정렬 복원
        var sizedInner = block.querySelector('div[data-width], div[style*="width"], div[data-video-url], div[data-video-id]');
        if (sizedInner && sizedInner !== block) {
            var innerStyle = sizedInner.getAttribute('style') || '';
            if (!/margin(\s*:|-left\s*:|-right\s*:)/i.test(innerStyle) ||
                !(/margin\s*:\s*0\s+auto/i.test(innerStyle) ||
                  /margin-left\s*:\s*auto/i.test(innerStyle))) {
                sizedInner.style.margin = '0 auto';
            }
            // [LAYOUT-HARDEN 10.4.1] text-align:center 는 block 자식에는 효과가 없다.
            // inline-block 으로 보정해야 wrapper 의 text-align 정렬 방어선이 실제로 동작한다.
            if (!/display\s*:/i.test(innerStyle)) {
                sizedInner.style.display = 'inline-block';
                sizedInner.style.verticalAlign = 'top';
            }
            sizedInner.style.maxWidth = '95%';
            // 치수 복원 — data-width / data-height 이 있는데 inline style 에 없다면 주입
            var dw = parseInt(sizedInner.getAttribute('data-width') || sizedInner.dataset.width || '', 10);
            var dh = parseInt(sizedInner.getAttribute('data-height') || sizedInner.dataset.height || '', 10);
            if (dw && !sizedInner.style.width)  sizedInner.style.width  = dw + 'px';
            if (dh && !sizedInner.style.height) sizedInner.style.height = dh + 'px';
            enforceVideoContainerCap(block, sizedInner);
        }

        // [DUP-FIX] 이중 안전장치: alreadyWorking()이 이미 살아있는 iframe/video를
        // 감지해 스킵하지만, DOMContentLoaded + load(+300ms) 두 번의 run() 호출
        // 사이에서 혹시라도 중복 삽입되는 것을 한 번 더 막기 위해 자체 렌더링
        // 완료 마커를 둔다.
        if (block.dataset.t2VideoRendered === '1') return;
        if (alreadyWorking(block)) {
            // [10.4.1] iframe/video 는 살아남았지만 같은 컨테이너의 fallback anchor
            // 스타일만 별도로 손상된 "혼합 손상" 케이스를 대비해 다시 은닉한다.
            var okAnchor = block.querySelector('.t2-video-source[href]');
            if (okAnchor) {
                okAnchor.style.cssText =
                    'display:inline-block;font-size:0;line-height:0;color:transparent;' +
                    'text-decoration:none;max-width:100%;overflow:hidden;';
            }
            block.dataset.t2VideoRendered = '1';
            return;
        }

        var info = extractInfo(block);
        if (!info.vType) {
            // [10.4.1 LAST-RESORT] data-*/URL 파싱까지 전부 실패한 극단적 케이스.
            // 그래도 .t2-video-source 앵커 자체(href)가 살아있다면, 최소한
            // "클릭하면 원본 영상으로 이동하는 링크"라도 사용자에게 보여준다.
            // (완전한 빈 화면보다 항상 낫다 — file/image 플러그인과 동일한 원칙.)
            var lastResortAnchor = block.querySelector('.t2-video-source[href]');
            if (lastResortAnchor) {
                lastResortAnchor.style.cssText = 'display:inline-block;color:inherit;text-decoration:underline;';
                if (!lastResortAnchor.textContent.trim()) {
                    lastResortAnchor.textContent = '동영상 보기';
                }
                block.dataset.t2VideoRendered = '1';
            }
            return;
        }

        var media = info.vType === 'youtube' && info.vId
            ? buildYoutubeIframe(info.vId)
            : buildVideoTag(info.vUrl);
        if (!media) return;

        // [FIX-LAYOUT] 에디터가 저장하는 실제 구조는
        //   <div class="t2-video-block" ...>            ← 바깥 블록(치수 없음)
        //     <div data-width=".." data-height=".." ..>  ← 실제 크기를 가진 컨테이너
        //       <a class="t2-video-source" ...></a>       ← 필터에서 살아남는 숨은 앵커
        //     </div>
        //   </div>
        // 기존 코드는 media 를 항상 "바깥 블록"의 첫 자식으로 넣었기 때문에,
        // 치수를 가진 안쪽 컨테이너 div가 (필터로 iframe만 빠진 채) 그대로
        // media 뒤에 형제로 남아 게시물 보기 화면에서 영상 아래에 원본
        // width×height 만큼의 빈 여백 박스가 생기는 레이아웃 붕괴가 있었다.
        // → 치수 정보를 가진 안쪽 컨테이너가 있으면 그 "안"에 media 를 넣고,
        //   없을 때만(과거 포맷 등) 바깥 블록에 직접 삽입하는 것으로 폴백한다.
        var sizedContainer = block.querySelector('div[data-width], div[style*="width"]');
        var target = (sizedContainer && sizedContainer !== block) ? sizedContainer : block;

        if (!target.style.position) target.style.position = 'relative';
        if (target === block) {
            // 폴백 경로: 치수 컨테이너가 없어 바깥 블록에 직접 넣는 경우에만
            // 기본 16:9 비율을 잡아 준다(치수 컨테이너가 있으면 이미 자체
            // width/height 를 갖고 있으므로 건드리지 않는다).
            if (!target.style.width && !target.getAttribute('width')) target.style.maxWidth = '95%';
            if (!target.style.aspectRatio && target.clientHeight < 40) target.style.aspectRatio = '16 / 9';
        }

        target.insertBefore(media, target.firstChild);
        if (target !== block) {
            enforceVideoContainerCap(block, target);
        } else {
            // 치수 래퍼가 모두 제거된 레거시 포맷도 바깥 블록의 95%를 넘지 않는다.
            media.style.width = '95%';
            media.style.maxWidth = '95%';
            media.style.margin = '0 auto';
            media.style.aspectRatio = '16 / 9';
            media.style.height = 'auto';
        }
        // [10.4.1] 실제 재생 요소가 성공적으로 붙었으므로, 같은 컨테이너 안의
        // fallback anchor(라벨 텍스트 포함)는 다시 시각적으로 숨긴다 — 그렇지
        // 않으면 정상 재생되는 영상 옆에 "동영상 보기" 텍스트가 중복으로 보인다.
        var justInsertedAnchor = target.querySelector('.t2-video-source[href]');
        if (justInsertedAnchor) {
            justInsertedAnchor.style.cssText =
                'display:inline-block;font-size:0;line-height:0;color:transparent;' +
                'text-decoration:none;max-width:100%;overflow:hidden;';
        }
        block.dataset.t2VideoRendered = '1';
    }

    function scan(root) {
        var seen = new Set();
        var candidates = [];

        function add(el) {
            var top = findDirectChild(root, el);
            if (top && !seen.has(top)) { seen.add(top); candidates.push(top); }
        }

        root.querySelectorAll('.t2-video-block, [data-t2-block="video"]').forEach(add);
        root.querySelectorAll('.t2-video-source[href]').forEach(function (a) {
            add(a.closest('div') || a.parentElement);
        });
        root.querySelectorAll('a[href]').forEach(function (a) {
            if (VIDEO_EXT_RE.test(a.getAttribute('href') || '')) add(a.closest('div') || a.parentElement);
        });

        candidates.forEach(renderBlock);
    }

    function run() {
        var containers = document.querySelectorAll('[data-t2-content], .t2-editor-content, .view-content, article, .bo_v_con, #bo_v_con, .board-content');
        if (containers.length === 0) { scan(document.body); return; }
        containers.forEach(function (c) { scan(c); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }

    // 게시물이 AJAX로 늦게 삽입되는 스킨/테마 대응(가벼운 1회성 재시도).
    window.addEventListener('load', function () { setTimeout(run, 300); });
}());
