// Path: T2Editor/extend/js/t2admin_runtime.js
//
// 매 페이지 로드마다 admin/runtime_config.php 를 통해 <공용 데이터>/t2editor_db/t2admin-private/admin_settings.php 의
// 아이콘·반응형 툴바 설정을 그 자리에서 읽어와 적용한다.
// extend/php/t2admin_settings_loader.php 가 설정 파일을 매 요청마다 직접 읽는 것과
// 동일한 패턴 — 관리자 저장 시 이 파일이나 다른 파일을 새로 굽지 않는다.
//
// window.T2EDITOR_URL 은 이 스크립트보다 늦게 정의되므로 사용할 수 없다.
// 대신 document.currentScript 로 이 스크립트 자신의 경로를 읽어 엔드포인트를 구성한다.

(function () {
    'use strict';

    var scriptEl = document.currentScript;
    if (!scriptEl || !scriptEl.src) return;

    // ".../extend/js/t2admin_runtime.js(?v=...)" → ".../admin/runtime_config.php"
    var endpoint = scriptEl.src.replace(/\/extend\/js\/[^\/?]+(\?.*)?$/, '/admin/runtime_config.php');
    if (endpoint === scriptEl.src) return; // 패턴 불일치 시 안전하게 중단

    var cfg = null;
    try {
        // 툴바 그룹은 toolbar.js 초기화 이전에 window.T2_TOOLBAR_GROUPS 로 반드시
        // 준비되어 있어야 하므로, 작은 same-origin JSON 에 한해 동기 XHR 사용.
        var xhr = new XMLHttpRequest();
        xhr.open('GET', endpoint, false);
        xhr.send(null);
        if (xhr.status === 200) {
            cfg = JSON.parse(xhr.responseText);
        }
    } catch (e) {
        return; // 실패 시 조용히 기본값 유지
    }
    if (!cfg) return;

    if (cfg.toolbar_groups) {
        window.T2_TOOLBAR_GROUPS = cfg.toolbar_groups;
    }

    if (cfg.icons && Object.keys(cfg.icons).length) {
        var applyIcons = function () {
            document.querySelectorAll('.t2-btn[data-command]').forEach(function (btn) {
                var cmd = btn.getAttribute('data-command');
                var ov = cfg.icons[cmd];
                if (!ov || !ov.name) return;
                var icon = btn.querySelector('.material-icons, .material-icons-outlined');
                if (!icon) {
                    icon = document.createElement('span');
                    btn.appendChild(icon);
                }
                icon.className = ov.type === 'material-icons-outlined' ? 'material-icons-outlined' : 'material-icons';
                icon.textContent = ov.name;
                if (ov.style) {
                    icon.setAttribute('style', ov.style);
                }
            });
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', applyIcons);
        } else {
            applyIcons();
        }
    }
})();
