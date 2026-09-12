// Path: T2Editor/plugin/ai_rearrange/hooks.js
// v10.0.1 — ai_rearrange 플러그인 submit/restore 훅
//
// ai_rearrange 플러그인은 선택/호버 대상 에디터 블록에
// .t2-detail-edit-selected, .t2-detail-edit-hovered 클래스를
// 런타임으로 추가한다.
// 저장 전 이 UI 전용 클래스를 제거하여 클린 HTML이 저장되도록 한다.
//
// Restore: 별도 처리 없음.
//          (선택 상태는 편집 세션마다 새로 시작)

(function () {
    'use strict';

    // ── Submit 훅 ─────────────────────────────────────────────────────────────
    T2EditorHooks.onSubmit('ai_rearrange', function (tempDiv) {
        // 런타임 선택/호버 UI 클래스 제거
        tempDiv.querySelectorAll('.t2-detail-edit-selected, .t2-detail-edit-hovered')
               .forEach(function (el) {
                   el.classList.remove('t2-detail-edit-selected', 't2-detail-edit-hovered');
               });
    });

})();
