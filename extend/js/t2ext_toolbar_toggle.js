// Path: T2Editor/extend/js/t2ext_toolbar_toggle.js
// Developer note: extend 자동 로딩 순서와 전역 이름 충돌을 고려하고, 코어 공개 API만 호출한다.
// 기여 및 저작권자: DIGIWB(https://rhymix.org/member/member_info?member_srl=1911515) - Rhymix //DSc(dsclub.kr) - Tak2 일부 에러 수정
// [FEATURE] 툴바 열기/닫기 토글 버튼
//
// 배경
// Rhymix 에디터 설정의 "도구상자 숨김" 옵션이 켜져 있으면 js/rhymix.js 가
// 초기화 시점에 `.t2-toolbar` 에 display:none 을 걸어 툴바가 잠깐 보였다가
// 사라진다. 옵션을 끄면 항상 보이지만, "필요할 때만 열고 닫는" 중간 상태가
// 없다 — 이 확장은 상태바(하단 푸터)에 토글 버튼을 추가해 그것을 제공한다.
//
// 동작
// · 상태바 우측(다크모드 버튼 왼쪽)에 기존 디자인 패턴(.t2-dark-mode-btn,
//   25px 원형 버튼)을 그대로 재사용한 토글 버튼 추가 → 라이트/다크 테마
//   스타일을 자동으로 상속받는다.
// · 초기 상태: 사용자가 이전에 토글한 기억이 있으면 그 값, 없으면
//   관리자 설정(hideToolbar)을 따른다.
// · 사용자 선택은 localStorage 에 저장하되, "관리자 기본값이 숨김인
//   에디터"(예: 댓글)와 "보임인 에디터"(예: 본문)의 선택을 별도 키로
//   기억한다 — 댓글 에디터에서 연 툴바가 본문 에디터 설정을 오염시키지
//   않도록.
// · js/rhymix.js 의 초기화가 이 스크립트보다 늦게 실행되어 툴바를 다시
//   숨겨버리는 레이스를 MutationObserver 로 감지해 사용자 설정을 재적용
//   (초기 10초간만 감시 후 해제).
//
// 설치: 이 파일을 extend/js/ 에 두기만 하면 자동 로드된다 (코어 무수정).

(function () {
    'use strict';

    var SETUP_FLAG = '__t2ToolbarToggle';
    var OBSERVE_WINDOW_MS = 10000;

    function t(key, fallback) {
        if (typeof T2Utils !== 'undefined' && typeof T2Utils.tf === 'function') {
            return T2Utils.tf(key, {}, fallback);
        }
        return fallback;
    }

    function readConfig(container) {
        // data-editor-config 는 .t2-editor-container 자신이 아니라
        // 바깥의 Rhymix 래퍼(div.rx_t2editor, editor.html 참고)에 붙어 있다.
        // 컨테이너에서 읽으면 항상 {} 가 되어 hideToolbar 를 false 로 오판
        // → "숨김" 설정인데도 툴바가 기본 펼침이 되는 버그가 있었다.
        // closest() 로 속성을 실제로 가진 조상을 찾고, (독립 설치 등으로)
        // 래퍼가 없으면 컨테이너 자신을 그대로 사용한다.
        var source = container.closest('[data-editor-config]') || container;
        try {
            return JSON.parse(source.getAttribute('data-editor-config') || '{}');
        } catch (_) {
            return {};
        }
    }

    // 관리자 기본값(숨김/보임)별로 사용자 선택을 분리 저장
    function storageKey(adminHidden) {
        return adminHidden ? 't2editor-toolbar-user-pref-hidden' : 't2editor-toolbar-user-pref-shown';
    }

    function loadPref(adminHidden) {
        try {
            var v = localStorage.getItem(storageKey(adminHidden));
            if (v === 'show') return true;
            if (v === 'hide') return false;
        } catch (_) { /* localStorage 불가 환경 */ }
        return null;
    }

    function savePref(adminHidden, visible) {
        try {
            localStorage.setItem(storageKey(adminHidden), visible ? 'show' : 'hide');
        } catch (_) { /* noop */ }
    }

    function setupContainer(container) {
        if (container[SETUP_FLAG]) return;
        var toolbar = container.querySelector('.t2-toolbar');
        if (!toolbar) return;
        container[SETUP_FLAG] = true;

        var config = readConfig(container);
        var adminHidden = !!config.hideToolbar;

        // 초기 상태: 사용자 기억 > 관리자 기본값
        var pref = loadPref(adminHidden);
        var visible = (pref !== null) ? pref : !adminHidden;

        // 내부 쓰기 가드 — 우리 스스로의 가시성 변경을 관찰자가 무시하도록
        var internalWrite = false;

        function apply(v) {
            visible = v;
            internalWrite = true;
            // display:flex 같은 인라인 값을 복원하면 코어의 균형 그리드 레이아웃을
            // 덮어쓸 수 있다. hidden 속성만 토글하고, Rhymix가 남긴 display:none은
            // 펼칠 때 제거해 CSS가 원래 display(grid/flex)를 결정하게 한다.
            toolbar.hidden = !v;
            toolbar.classList.toggle('t2-toolbar-collapsed', !v);
            if (v && toolbar.style.display === 'none') {
                toolbar.style.removeProperty('display');
            }
            // MutationObserver 콜백은 마이크로태스크 이후 실행되므로 플래그를
            // 태스크 큐에서 해제한다.
            setTimeout(function () { internalWrite = false; }, 0);
            updateButton();

            if (v) {
                // display:none 상태에서 폭 0으로 계산된 1열 그리드가 남지 않도록
                // 실제 폭이 복구된 다음 코어 툴바에 강제 재배치를 요청한다.
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () {
                        toolbar.dispatchEvent(new CustomEvent('t2:toolbar-visibility', {
                            bubbles: false,
                            detail: { visible: true }
                        }));
                    });
                });
            }
        }

        // 토글 버튼 생성
        var btn = document.createElement('button');
        btn.type = 'button';
        // .t2-dark-mode-btn 재사용 → 라이트/다크 스타일 자동 상속
        btn.className = 't2-dark-mode-btn t2-toolbar-toggle-btn';
        var icon = document.createElement('span');
        icon.className = 'material-icons';
        btn.appendChild(icon);

        function updateButton() {
            icon.textContent = visible ? 'expand_less' : 'expand_more';
            var label = visible
                ? t('toolbar.hide_toolbar', '툴바 숨기기')
                : t('toolbar.show_toolbar', '툴바 표시');
            btn.setAttribute('aria-label', label);
            btn.title = label;
            btn.setAttribute('aria-expanded', visible ? 'true' : 'false');
        }

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            apply(!visible);
            savePref(adminHidden, visible);
        });

        // 상태바 우측 그룹(.t2-dark-mode-toggle)의 다크모드 버튼 앞에 삽입.
        // 상태바가 없는 비정상 케이스에는 컨테이너 상단에 폴백 배치.
        var rightGroup = container.querySelector('.t2-editor-status .t2-dark-mode-toggle');
        if (rightGroup) {
            var darkBtn = rightGroup.querySelector('.t2-dark-mode-btn:not(.t2-toolbar-toggle-btn)');
            rightGroup.insertBefore(btn, darkBtn || null);
        } else {
            btn.style.cssText += ';position:absolute;top:4px;right:4px;z-index:101;';
            container.appendChild(btn);
        }

        // 초기 상태 적용 + rhymix.js 초기화 레이스 방어
        apply(visible);

        var observer = new MutationObserver(function () {
            if (internalWrite) return;
            var nowHidden = toolbar.hidden || toolbar.style.display === 'none';
            if (nowHidden === visible) {
                // 외부(rhymix.js 등)가 사용자 설정과 다른 상태로 바꿈 → 재적용
                apply(visible);
            }
        });
        observer.observe(toolbar, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
        setTimeout(function () { observer.disconnect(); }, OBSERVE_WINDOW_MS);
    }

    function init() {
        document.querySelectorAll('.t2-editor-container').forEach(setupContainer);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // 늦게(동적으로) 생성되는 에디터 대비 재스캔
    setTimeout(init, 1000);
    setTimeout(init, 3000);
})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
