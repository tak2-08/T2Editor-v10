// Path: T2Editor/plugin/clipurl/hooks.js
// Developer note: clipurl 저장 훅은 반복 실행되어도 같아야 하며, 런타임 UI를 제거하되 복원용 data 속성은 보존한다.
// v10.0.1 — clipurl 플러그인 submit/restore 훅
//
// clipurl 플러그인은 에디터에 표준 <a> 링크를 삽입한다.
// 링크의 data-link-events-setup 마커 제거는 link/hooks.js가 담당하므로
// clipurl 전용 추가 처리는 필요하지 않다.
//
// Restore: 별도 처리 없음.

(function () {
    'use strict';

    // Submit 훅
    // 삽입된 <a> 링크의 런타임 마커 정제는 link/hooks.js에 위임.
    T2EditorHooks.onSubmit('clipurl', function (tempDiv) {
        // no-op: link/hooks.js에 위임
    });

})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
