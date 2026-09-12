// Path: T2Editor/plugin/ai/hooks.js
// v10.0.1 — ai 플러그인 submit/restore 훅
//
// ai 플러그인은 에디터에 직접 블록을 삽입하지 않고
// code / image / table / link 플러그인의 공개 API를 통해 삽입한다.
// AI 모달(.t2-ai-modal-overlay)은 document.body에 마운트되므로
// tempDiv에 포함되지 않는다.
// 삽입된 각 블록의 submit/restore는 해당 플러그인의 hooks.js가 담당한다.
//
// Restore: 별도 처리 없음.

(function () {
    'use strict';

    // ── Submit 훅 ─────────────────────────────────────────────────────────────
    // 삽입된 콘텐츠는 code/image/table/link hooks가 각자 처리.
    T2EditorHooks.onSubmit('ai', function (tempDiv) {
        // no-op: 각 블록은 해당 플러그인 hooks에 위임
    });

})();
