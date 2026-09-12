// Path: T2Editor/plugin/export/hooks.js
// Developer note: export 저장 훅은 반복 실행되어도 같아야 하며, 런타임 UI를 제거하되 복원용 data 속성은 보존한다.
// v10.0.1 — export 플러그인 submit/restore 훅
//
// export 플러그인은 에디터 DOM을 읽기만 하고 수정하지 않는다.
// 다운로드용 HTML 생성은 export.js 내부에서 독립적으로 처리되며
// 에디터 DOM 및 저장 콘텐츠에 영향을 주지 않는다.
//
// Restore: 별도 처리 없음.

(function () {
    'use strict';

    // Submit 훅
    // export 플러그인은 에디터 DOM을 변경하지 않으므로 별도 정제 불필요.
    T2EditorHooks.onSubmit('export', function (tempDiv) {
        // no-op: export는 에디터 DOM을 읽기 전용으로 사용
    });

})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
