// Path: T2Editor/plugin/link/hooks.js
// Developer note: link 저장 훅은 반복 실행되어도 같아야 하며, 런타임 UI를 제거하되 복원용 data 속성은 보존한다.
// v10.0.1 — link 플러그인 submit/restore 훅
//
// link 플러그인은 <a> 요소에 data-link-events-setup 속성을
// 런타임 이벤트 등록 마커로 사용한다.
// 저장 전 이 마커를 제거하여 클린 HTML이 DB에 저장되도록 한다.
//
// Restore: link.js onContentSet → initializeLinks()가 담당.
//          별도 DOM 복원 처리 없음.

(function () {
    'use strict';

    // Submit 훅
    T2EditorHooks.onSubmit('link', function (tempDiv) {
        // 런타임 이벤트 등록 마커 제거
        tempDiv.querySelectorAll('a[data-link-events-setup]').forEach(function (a) {
            a.removeAttribute('data-link-events-setup');
        });
    });

})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
