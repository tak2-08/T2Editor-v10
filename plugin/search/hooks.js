// Path: T2Editor/plugin/search/hooks.js
// Developer note: search 저장 훅은 반복 실행되어도 같아야 하며, 런타임 UI를 제거하되 복원용 data 속성은 보존한다.
// v10.0.1 — search 플러그인 submit/restore 훅
//
// search 플러그인은 에디터 내 검색어를 .t2-search-highlight 스팬으로 감싼다.
// 이 스팬은 런타임 UI 전용이므로 저장 전 제거해야 한다.
// 텍스트 내용은 보존(스팬만 벗겨냄).
//
// Restore: 하이라이트는 런타임에만 존재하므로 별도 복원 처리 없음.

(function () {
    'use strict';

    // Submit 훅
    T2EditorHooks.onSubmit('search', function (tempDiv) {
        tempDiv.querySelectorAll('.t2-search-highlight').forEach(function (span) {
            var parent = span.parentNode;
            if (!parent) return;
            // 스팬 내부 노드를 부모로 끌어올린 뒤 스팬 제거
            while (span.firstChild) {
                parent.insertBefore(span.firstChild, span);
            }
            parent.removeChild(span);
        });
    });

})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
