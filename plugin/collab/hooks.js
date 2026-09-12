// Path: T2Editor/plugin/collab/hooks.js
// v10.0.1 — collab 플러그인 submit/restore 훅
//
// collab 플러그인의 커서 레이어(.t2-collab-cursor-layer)는
// 에디터 DOM이 아닌 컨테이너 부모에 마운트되므로 tempDiv에 포함되지 않는다.
// Submit 시에는 혹시라도 에디터 콘텐츠에 섞여든 collab 런타임 전용 요소를
// 방어적으로 제거한다.
//
// Restore: collab 상태는 collab.js가 WebSocket 세션을 통해 재동기화하므로
//          별도 DOM 복원 처리 없음.

(function () {
    'use strict';

    // ── Submit 훅 ─────────────────────────────────────────────────────────────
    T2EditorHooks.onSubmit('collab', function (tempDiv) {
        // collab 런타임 전용 요소 방어적 제거
        tempDiv.querySelectorAll([
            '.t2-collab-cursor-layer',
            '.t2-collab-remote-caret',
            '.t2-collab-remote-label',
            '.t2-collab-remote-selection'
        ].join(',')).forEach(function (el) {
            el.remove();
        });
    });

})();
