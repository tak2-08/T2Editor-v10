// Path: T2Editor/plugin/linkcard/hooks.js
// Developer note: linkcard 저장 훅은 반복 실행되어도 같아야 하며, 런타임 UI를 제거하되 복원용 data 속성은 보존한다.
// linkcard 플러그인 submit/restore 훅 — code/hooks.js, image/hooks.js 와 동일한 관례.

(function () {
    'use strict';

    // Submit 훅
    // 저장 시 런타임 전용 UI(삭제 버튼)는 DB에 남기지 않는다.
    // 로딩 상태로 저장되는 일은 없어야 하지만(fetch 완료를 기다리지 않고
    // 사용자가 바로 저장을 누르는 극단적 케이스 대비) 방어적으로 loading
    // 상태 카드는 일반 링크로 강등해 저장한다 — "영원히 로딩 중"인 채로
    // DB에 박히는 것을 막기 위함.
    //
    // Host HTML sanitizers may rearrange or remove parts of the card
    // <a>/<img>/text structure.
    // linkcard.js가 카드를 만들 때 block(.t2-linkcard-block)에 data-lc-url/
    // -title/-desc/-image/-site 속성을 함께 기록해 두므로(평범한 <div>의
    // data-* 속성은 대부분의 필터에서 살아남는다 — video 플러그인의
    // data-video-url 과 동일한 원리), 실제 내부 마크업이 무너지더라도 이
    // 속성만으로 언제든 카드를 다시 그릴 수 있다. 여기서는 혹시 이 속성이
    // 아직 없는 카드(예: 이 패치 이전에 만들어진 카드)를 대비해 화면에
    // 보이는 값으로부터 한 번 더 채워 넣는다.
    T2EditorHooks.onSubmit('linkcard', function (tempDiv) {
        tempDiv.querySelectorAll('.t2-linkcard-block').forEach(function (block) {
            var ctrl = block.querySelector('.t2-media-controls');
            if (ctrl) ctrl.remove();

            if (block.classList.contains('t2-linkcard-loading')) {
                var link = block.querySelector('.t2-linkcard-link');
                var href = link ? link.getAttribute('href') : '';
                var a = document.createElement('a');
                a.setAttribute('href', href || '#');
                a.setAttribute('target', '_blank');
                a.setAttribute('rel', 'noopener noreferrer nofollow ugc');
                a.textContent = href || '';
                var p = document.createElement('p');
                p.appendChild(a);
                block.parentNode.replaceChild(p, block);
                return;
            }

            if (!block.dataset.lcUrl) {
                var linkEl   = block.querySelector('.t2-linkcard-link');
                var titleEl  = block.querySelector('.t2-linkcard-title');
                var descEl   = block.querySelector('.t2-linkcard-desc');
                var imgEl    = block.querySelector('.t2-linkcard-thumb img');
                var siteEl   = block.querySelector('.t2-linkcard-domain span');
                if (linkEl && linkEl.getAttribute('href')) {
                    block.dataset.lcUrl   = linkEl.getAttribute('href');
                    block.dataset.lcTitle = titleEl ? titleEl.textContent : '';
                    if (descEl && descEl.textContent) block.dataset.lcDesc = descEl.textContent;
                    if (imgEl && imgEl.getAttribute('src')) block.dataset.lcImage = imgEl.getAttribute('src');
                    block.dataset.lcSite = siteEl ? siteEl.textContent : '';
                    // block과 동일한 값을 <a>에도 남긴다 — 바깥 div가 정제기에
                    // 벗겨져도 <a>쪽 data-lc-*로 복구할 수 있도록(아래 onRestore
                    // 참고, linkcard.js _applyCardData와 동일한 관례).
                    linkEl.dataset.lcUrl   = block.dataset.lcUrl;
                    linkEl.dataset.lcTitle = block.dataset.lcTitle;
                    if (block.dataset.lcDesc)  linkEl.dataset.lcDesc  = block.dataset.lcDesc;
                    if (block.dataset.lcImage) linkEl.dataset.lcImage = block.dataset.lcImage;
                    linkEl.dataset.lcSite = block.dataset.lcSite;
                }
            }
        });
    });

    // Restore 훅
    // CMS 정제기가 class/속성 일부를 걷어냈을 수 있는 상황에 대비해
    // .t2-linkcard-block 구조를 다시 확정 짓는다. 썸네일/본문 등 카드
    // "내부" 구조가 아예 무너진 경우의 실제 복구(data-lc-* 속성으로부터
    // 다시 그리기)와 삭제 버튼 재바인딩은 initializeLinkCardBlocks()가
    // 담당(core.js가 undo/redo·processContentSet 이후 자동 호출).
    T2EditorHooks.onRestore('linkcard', function (tempDiv) {
        // CMS compatibility: 정제기가 "의미 없어 보이는" 바깥 <div class="t2-media-block
        // t2-linkcard-block">를 통째로 벗겨내고 안의 <a class="t2-linkcard-link"
        // data-lc-url="...">만 남기는 경우가 있다(반대로 code 플러그인이 대비하는
        // "class/data가 전부 사라지는" 경우와는 다른, "바깥 래퍼만 사라지는" 경우).
        // 이 경우 tempDiv.querySelectorAll('[data-lc-url]')에 <a>가 직접 걸리는데,
        // 아래 루프는 원래 "block(바깥 div)"을 가정하고 동작하므로 <a> 자체에
        // t2-media-block 클래스를 붙이면 구조가 어긋난다(linkcard.css가 기대하는
        // .t2-linkcard-block .t2-linkcard-link 중첩이 깨짐). 그래서 <a>가 걸린
        // 경우엔 먼저 새 래퍼 div로 감싸 "원래 구조"로 되돌려 놓은 뒤, 아래
        // 공통 로직(클래스 확정 등)에 그대로 태운다.
        tempDiv.querySelectorAll('a[data-lc-url]').forEach(function (a) {
            if (a.closest('.t2-linkcard-block')) return; // 이미 정상 래퍼 안에 있음
            var wrapper = document.createElement('div');
            wrapper.dataset.lcUrl = a.dataset.lcUrl;
            if (a.dataset.lcTitle) wrapper.dataset.lcTitle = a.dataset.lcTitle;
            if (a.dataset.lcDesc)  wrapper.dataset.lcDesc  = a.dataset.lcDesc;
            if (a.dataset.lcImage) wrapper.dataset.lcImage = a.dataset.lcImage;
            if (a.dataset.lcSite)  wrapper.dataset.lcSite  = a.dataset.lcSite;
            a.parentNode.insertBefore(wrapper, a);
            wrapper.appendChild(a);
        });

        tempDiv.querySelectorAll('.t2-linkcard-block, [data-block-id^="linkcard_"], [data-lc-url]').forEach(function (block) {
            // 위에서 새로 감싼 wrapper든, 필터를 그대로 통과한 원래 block이든
            // 여기서부터는 동일하게 처리한다. 다만 <a> 자체가 아직도 이 셀렉터에
            // 걸릴 수 있으므로(위 wrapping이 실패한 극단적 케이스 방어) <a>라면
            // 건너뛴다 — initializeLinkCardBlocks()가 다음 처리에서 다시 만난다.
            if (block.tagName === 'A') return;
            if (!block.classList.contains('t2-media-block')) block.classList.add('t2-media-block');
            if (!block.classList.contains('t2-linkcard-block')) block.classList.add('t2-linkcard-block');
            block.setAttribute('contenteditable', 'false');

            // 저장 시 제거했던 컨트롤은 initializeLinkCardBlocks()가 다시 만들어
            // 주므로 여기서는 만들지 않는다(중복 방지) — 구조 확정만 담당.
            var ctrl = block.querySelector('.t2-media-controls');
            if (ctrl) ctrl.remove();

            // <p> 안에 잘못 들어간 경우 최상위로 끌어올림(다른 플러그인과 동일 관례).
            if (block.parentNode && block.parentNode.nodeName === 'P') {
                var p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                var pText = p.textContent.replace(/\u200B/g, '').trim();
                if (!pText && !p.querySelector('img, iframe, video')) p.remove();
            }
        });
    });

})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
