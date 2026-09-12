// Path: T2Editor/plugin/table/hooks.js
// v10.0.0 — table 플러그인 submit/restore 훅
//
// [중요] .t2-table-wrapper → .table-responsive 변환(DB 저장 포맷)은
// editor.lib.php STEP 3에서 항상 실행된다.
// hooks.js가 등록된 경우에도 이 변환은 editor.lib.php가 담당한다.
// 여기서는 에디터 전용 UI controls 제거만 담당한다.

(function () {
    'use strict';

    // ── Submit 훅 ─────────────────────────────────────────────────────────────
    T2EditorHooks.onSubmit('table', function (tempDiv) {
        tempDiv.querySelectorAll('.t2-table-wrapper').forEach(function (wrapper) {
            var ctrl = wrapper.querySelector('.t2-table-controls, .t2-table-download-btn');
            if (ctrl) ctrl.remove();
        });
    });

    // ── Restore 훅 ────────────────────────────────────────────────────────────
    T2EditorHooks.onRestore('table', function (tempDiv) {
        tempDiv.querySelectorAll('.table-responsive').forEach(function (responsiveWrapper) {
            var table = responsiveWrapper.querySelector('table');
            if (!table) return;

            if (!table.classList.contains('t2-table')) table.classList.add('t2-table');
            var isLarge = table.classList.contains('t2-table-large') ||
                          table.rows.length > 10 ||
                          (table.rows[0] && table.rows[0].cells.length > 10);
            if (isLarge && !table.classList.contains('t2-table-large')) {
                table.classList.add('t2-table-large');
            }

            var tableWrapper = document.createElement('div');
            tableWrapper.className = 't2-table-wrapper';
            tableWrapper.setAttribute('data-t2-block', 'table');
            tableWrapper.contentEditable = false;
            tableWrapper.style.position = 'relative';
            responsiveWrapper.parentNode.insertBefore(tableWrapper, responsiveWrapper);

            if (isLarge) {
                var scrollWrapper = document.createElement('div');
                scrollWrapper.className = 't2-table-scroll-wrapper';
                tableWrapper.appendChild(scrollWrapper);
                scrollWrapper.appendChild(table);
            } else {
                tableWrapper.appendChild(table);
            }
            responsiveWrapper.remove();
        });
    });

})();
