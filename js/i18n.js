// ════════════════════════════════════════════════════════════════════════
// T2Editor I18N Core — T2Editor 10.2.1-beta2+
// ───────────────────────────────────────────────────────────────────────
// 자체 호스팅 다국어(i18n) 시스템 코어 모듈
//
// 주요 기능:
//   1. 브라우저 언어 자동 감지 (navigator.language + PHP 주입값)
//   2. ICU MessageFormat 파싱 (FormatJS 호환)
//   3. T2Editor.t() / T2Utils.t() 번역 API 제공
//   4. 동적 언어 전환 (이벤트 디스패치)
//   5. 서드파티 플러그인 호환성 보장 (i18n 미지원 플러그인도 정상 동작)
//
// 의존성:
//   - vendor/formatjs/t2i18n-polyfill.js (구형 브라우저용, 조건부 로드)
//   - PHP 주입 변수: window.T2EDITOR_I18N_*
//
// 로드 순서 (editor.lib.php):
//   utils.js → i18n.js → hooks.js → core.js → plugins
// ───────────────────────────────────────────────────────────────────────

(function (root) {
    'use strict';

    if (root.T2I18N) return; // 중복 로드 방지

    // ────────────────────────────────────────────────────────────────
    // 1. 상수 및 설정
    // ────────────────────────────────────────────────────────────────
    var DEFAULT_SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh'];
    var SUPPORTED_LANGS = DEFAULT_SUPPORTED_LANGS.slice();
    var DEFAULT_LANG = 'en';
    var STORAGE_KEY = 't2editor-lang'; // 사용자 명시적 선택 언어 저장

    // PHP에서 주입한 메시지 카탈로그 (모든 언어)
    // [FIX-LOAD-ORDER] editor.lib.php 가 늦게 전역을 주입해도 재동기화 가능하도록
    // 스냅샷이 아닌 mutable state로 유지한다.
    var INJECTED_MESSAGES = {};
    var INJECTED_USER_LANG = null;
    var currentLang = null;

    function normalizeLang(lang) {
        if (typeof lang !== 'string') return '';
        return lang.trim().toLowerCase().split(/[-_]/)[0];
    }

    function hydrateFromGlobals(syncLocale) {
        var supported = root.T2EDITOR_I18N_SUPPORTED_LANGS;
        if (supported && typeof supported.length === 'number') {
            SUPPORTED_LANGS = Array.prototype.slice.call(supported).map(normalizeLang).filter(function (lang, idx, arr) {
                return !!lang && arr.indexOf(lang) === idx;
            });
            if (!SUPPORTED_LANGS.length) {
                SUPPORTED_LANGS = DEFAULT_SUPPORTED_LANGS.slice();
            }
        } else {
            SUPPORTED_LANGS = DEFAULT_SUPPORTED_LANGS.slice();
        }

        var injectedDefault = normalizeLang(root.T2EDITOR_I18N_DEFAULT_LANG);
        DEFAULT_LANG = (typeof injectedDefault === 'string' && SUPPORTED_LANGS.indexOf(injectedDefault) !== -1)
            ? injectedDefault
            : 'en';

        INJECTED_MESSAGES = (root.T2EDITOR_I18N_MESSAGES && typeof root.T2EDITOR_I18N_MESSAGES === 'object')
            ? root.T2EDITOR_I18N_MESSAGES
            : {};
        INJECTED_USER_LANG = normalizeLang(root.T2EDITOR_I18N_USER_LANG) || null;

        if (syncLocale) {
            var previousLang = currentLang;
            currentLang = resolveInitialLang();
            _cachedFormatter = null;
            _cachedFormatterKind = null;
            try {
                document.documentElement.setAttribute('lang', currentLang);
            } catch (e) {}
            if (previousLang && previousLang !== currentLang) {
                notifyLocaleChange(currentLang, previousLang);
            }
        }
    }

    hydrateFromGlobals(false);

    // ────────────────────────────────────────────────────────────────
    // 2. 브라우저 언어 감지
    // ────────────────────────────────────────────────────────────────

    /**
     * 브라우저의 navigator.language / navigator.languages 에서
     * 지원 언어 중 일치하는 언어를 찾아 반환
     *
     * @returns {string} 감지된 언어코드 (지원 언어 중 하나, 없으면 DEFAULT_LANG)
     */
    function detectBrowserLang() {
        if (typeof navigator === 'undefined') return DEFAULT_LANG;

        // navigator.languages (배열, 우선순위 순) 우선, 없으면 navigator.language
        var langs = navigator.languages ||
                    [navigator.language || navigator.userLanguage || DEFAULT_LANG];

        for (var i = 0; i < langs.length; i++) {
            var l = langs[i];
            if (!l) continue;
            // 2자리 언어코드 추출 (ko-KR → ko, zh-CN → zh, ja-JP → ja)
            var code = normalizeLang(l);
            if (SUPPORTED_LANGS.indexOf(code) !== -1) {
                return code;
            }
        }
        return DEFAULT_LANG;
    }

    /**
     * 최종 언어 결정 (우선순위):
     *   1. localStorage (사용자 명시적 선택)
     *   2. PHP에서 감지한 언어 (쿠키/Accept-Language)
     *   3. 브라우저 navigator.language
     *   4. DEFAULT_LANG 상수
     *
     * @returns {string} 'ko' | 'en' | 'ja' | 'zh'
     */
    function resolveInitialLang() {
        // 1. localStorage (사용자가 번역 버튼으로 선택한 언어)
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored && SUPPORTED_LANGS.indexOf(stored) !== -1) {
                return stored;
            }
        } catch (e) {
            // localStorage 접근 불가 (private mode 등) — 무시
        }

        // 2. PHP 감지값 (쿠키/Accept-Language 기반)
        if (INJECTED_USER_LANG && SUPPORTED_LANGS.indexOf(INJECTED_USER_LANG) !== -1) {
            return INJECTED_USER_LANG;
        }

        // 3. 브라우저 감지
        var browserLang = detectBrowserLang();
        if (browserLang && SUPPORTED_LANGS.indexOf(browserLang) !== -1) {
            return browserLang;
        }

        // 4. 기본값
        return DEFAULT_LANG;
    }

    // ────────────────────────────────────────────────────────────────
    // 3. 메시지 카탈로그 조회
    // ────────────────────────────────────────────────────────────────

    /**
     * 지정된 언어의 메시지 카탈로그 반환
     * PHP에서 인라인 주입한 값을 우선 사용, 없으면 빈 객체
     *
     * @param {string} lang 언어코드
     * @returns {Object} {key: message} 형태의 평탄화된 카탈로그
     */
    function getMessages(lang) {
        lang = normalizeLang(lang);
        if (SUPPORTED_LANGS.indexOf(lang) === -1) lang = DEFAULT_LANG;
        if (!INJECTED_MESSAGES || typeof INJECTED_MESSAGES !== 'object') {
            hydrateFromGlobals(false);
        }
        return (INJECTED_MESSAGES[lang] || {});
    }

    function lookupMessage(messages, key) {
        if (!messages || typeof messages !== 'object') return undefined;
        if (Object.prototype.hasOwnProperty.call(messages, key)) return messages[key];

        // PHP 평탄화가 비활성화된 임베드/테스트 환경에서도 원본 중첩 JSON을
        // 그대로 사용할 수 있도록 점 표기법을 직접 순회한다.
        var cursor = messages;
        var parts = String(key).split('.');
        for (var i = 0; i < parts.length; i++) {
            if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, parts[i])) {
                return undefined;
            }
            cursor = cursor[parts[i]];
        }
        return cursor;
    }

    /**
     * 메시지 키로 번역 조회 — 점(.) 표기법 지원
     * 예: t('link.modal.title') → INJECTED_MESSAGES['ko']['link.modal.title']
     *
     * @param {string} key 번역 키 (예: 'common.confirm')
     * @param {Object} [vars] 변수값 객체 (ICU MessageFormat 치환용)
     * @param {string} [langOverride] 특정 언어 강제 사용
     * @returns {string} 번역된 메시지 (키가 없으면 키의 마지막 부분을 제목케이스로 변환하여 반환)
     */
    function t(key, vars, langOverride) {
        if (typeof key !== 'string' || key === '') return '';

        var lang = normalizeLang(langOverride) || currentLang || DEFAULT_LANG;
        var messages = getMessages(lang);

        // 점 표기법으로 조회 (PHP에서 이미 평탄화됨)
        // 1차: 그대로 조회 (key = 'link.modal.title')
        var msg = lookupMessage(messages, key);

        // 2차 폴백: 키가 없으면 DEFAULT_LANG 카탈로그에서 조회
        if (msg === undefined && lang !== DEFAULT_LANG) {
            messages = getMessages(DEFAULT_LANG);
            msg = lookupMessage(messages, key);
        }

        // 3차 폴백: 그래도 없으면 키의 마지막 부분을 제목 케이스로 변환
        // (collab/ai_complex 등 대형 플러그인의 누락된 키를 우아하게 처리)
        if (msg === undefined) {
            return humanizeKey(key, vars);
        }

        // 변수 치환 (ICU MessageFormat)
        // [FIX] msg 가 배열/객체인 경우 (nickname_adjs 등) formatMessage 를 건너뛰고 원본 반환.
        if (vars && typeof vars === 'object' && typeof msg === 'string') {
            msg = formatMessage(msg, vars, lang);
        }

        return msg;
    }

    /**
     * 키를 사람이 읽을 수 있는 형태로 변환 (폴백용)
     * 예: 'collab.user_joined' → 'User joined'
     *     'collab.x_people_in' with {count: 5} → '5 people in'
     *
     * @param {string} key 번역 키
     * @param {Object} [vars] 변수값 객체
     * @returns {string} 변환된 문자열
     */
    function humanizeKey(key, vars) {
        // 키의 마지막 부분 추출 (점 다음)
        var lastPart = key;
        var dotIdx = key.lastIndexOf('.');
        if (dotIdx !== -1) {
            lastPart = key.substring(dotIdx + 1);
        }

        // 언더스코어를 공백으로 변환
        var humanized = lastPart.replace(/_/g, ' ');

        // 첫 글자 대문자화
        if (humanized.length > 0) {
            humanized = humanized.charAt(0).toUpperCase() + humanized.slice(1);
        }

        // 변수 치환 (있는 경우)
        if (vars && typeof vars === 'object') {
            humanized = simpleFormat(humanized, vars);
            // x_ 접두사가 있으면 변수를 앞으로 이동 (예: "x people in" with count:5 → "5 people in")
            if (humanized.indexOf('x ') === 0) {
                humanized = (vars.count !== undefined ? String(vars.count) : '0') + humanized.substring(1);
            }
        }

        return humanized;
    }

    // ────────────────────────────────────────────────────────────────
    // 4. ICU MessageFormat 처리
    // ────────────────────────────────────────────────────────────────

    /**
     * FormatJS 호환 ICU MessageFormat 파서 선택 (지연 평가)
     *
     * [중요] 폴리필 로드 순서에 무관하게 동작하도록 지연 평가(lazy evaluation) 사용.
     * i18n.js 가 폴리필보다 먼저 로드되더라도, 실제 t() 호출 시점에는
     * 폴리필이 이미 로드되어 있으므로 정상 작동함.
     *
     * 우선순위:
     *   1. T2I18NPolyfill (vendor/formatjs/t2i18n-polyfill.js)
     *   2. 네이티브 Intl.MessageFormat (향후 표준)
     *   3. simpleFormat (폴백)
     */
    var _cachedFormatter = null;
    var _cachedFormatterKind = null;
    function getFormatter() {
        // 1. 폴리필 우선 (가장 안정적)
        if (root.T2I18NPolyfill && typeof root.T2I18NPolyfill.formatMessage === 'function') {
            if (_cachedFormatterKind !== 'polyfill') {
                _cachedFormatter = function (pattern, vars, lang) {
                    return root.T2I18NPolyfill.formatMessage(pattern, vars, lang);
                };
                _cachedFormatterKind = 'polyfill';
            }
            return _cachedFormatter;
        }

        // 2. 네이티브 Intl.MessageFormat (향후 표준)
        if (root.Intl && typeof root.Intl.MessageFormat === 'function') {
            if (_cachedFormatterKind !== 'intl') {
                _cachedFormatter = function (pattern, vars, lang) {
                    try {
                        var mf = new root.Intl.MessageFormat(pattern, lang);
                        return mf.format(vars);
                    } catch (e) {
                        return simpleFormat(pattern, vars);
                    }
                };
                _cachedFormatterKind = 'intl';
            }
            return _cachedFormatter;
        }

        // 3. 폴백: 단순 {var} 치환
        if (_cachedFormatterKind !== 'simple') {
            _cachedFormatter = function (pattern, vars, lang) {
                return simpleFormat(pattern, vars);
            };
            _cachedFormatterKind = 'simple';
        }
        return _cachedFormatter;
    }

    /**
     * 메시지 포맷 적용 (지연 평가 래퍼)
     */
    function formatMessage(pattern, vars, lang) {
        return getFormatter()(pattern, vars, lang);
    }

    /**
     * 단순 {var} 치환기 — ICU 복수형/선택 미지원
     * 모든 {var} 패턴을 vars 객체의 값으로 치환
     *
     * @param {string} pattern {name} 형식의 변수가 포함된 문자열
     * @param {Object} vars 변수값 객체
     * @returns {string} 치환된 문자열
     */
    function simpleFormat(pattern, vars) {
        if (!vars || typeof vars !== 'object') return pattern;
        return String(pattern).replace(/\{(\w+)\}/g, function (match, key) {
            return (vars[key] !== undefined && vars[key] !== null) ? String(vars[key]) : match;
        });
    }

    // ────────────────────────────────────────────────────────────────
    // 5. 언어 전환 이벤트 시스템
    // ────────────────────────────────────────────────────────────────
    var localeChangeListeners = [];

    function notifyLocaleChange(newLang, oldLang) {
        for (var i = 0; i < localeChangeListeners.length; i++) {
            try {
                localeChangeListeners[i](newLang, oldLang);
            } catch (e) {
                if (typeof console !== 'undefined' && console.error) {
                    console.error('[T2I18N] locale change listener error:', e);
                }
            }
        }

        try {
            if (typeof CustomEvent === 'function') {
                document.dispatchEvent(new CustomEvent('t2editor:locale-change', {
                    detail: { lang: newLang, oldLang: oldLang }
                }));
            }
        } catch (e) {}
    }

    /**
     * 언어 변경 시 호출될 콜백 등록
     * @param {Function} callback function(newLang: string, oldLang: string)
     * @returns {Function} 등록 해제 함수
     */
    function onLocaleChange(callback) {
        if (typeof callback !== 'function') return function () {};
        localeChangeListeners.push(callback);
        return function () {
            var idx = localeChangeListeners.indexOf(callback);
            if (idx !== -1) localeChangeListeners.splice(idx, 1);
        };
    }

    /**
     * 언어 변경 — 모든 리스너에게 알림 + document 이벤트 디스패치
     * @param {string} newLang 새 언어코드
     */
    function setLocale(newLang) {
        newLang = normalizeLang(newLang);
        if (SUPPORTED_LANGS.indexOf(newLang) === -1) {
            newLang = DEFAULT_LANG;
        }
        var oldLang = currentLang;
        if (oldLang === newLang) {
            // 동적으로 추가된 모달/플러그인 UI가 번역되지 않은 경우를 복구한다.
            try { applyTranslations(document.body || document.documentElement); } catch (e) {}
            return newLang;
        }

        currentLang = newLang;

        // localStorage 영속화
        try {
            localStorage.setItem(STORAGE_KEY, newLang);
        } catch (e) {}

        // 쿠키 동기화 (PHP가 다음 페이지 로드 시 감지)
        try {
            var expires = new Date();
            expires.setFullYear(expires.getFullYear() + 1);
            document.cookie = 't2editor_lang=' + newLang +
                ';expires=' + expires.toUTCString() +
                ';path=/;SameSite=Lax';
        } catch (e) {}

        // html lang 속성 갱신
        try {
            document.documentElement.setAttribute('lang', newLang);
        } catch (e) {}

        notifyLocaleChange(newLang, oldLang);

        // body 하위에 붙는 모달/오버레이까지 즉시 재번역
        try {
            applyTranslations(document.body || document.documentElement);
        } catch (e) {}

        return newLang;
    }

    /**
     * 현재 언어 조회
     * @returns {string} 현재 활성 언어코드
     */
    function getLocale() {
        return currentLang;
    }

    // ────────────────────────────────────────────────────────────────
    // 6. DOM 자동 번역 (data-i18n 속성 스캔)
    // ────────────────────────────────────────────────────────────────
    // 서드파티 플러그인이 data-i18n="key" 속성만 추가하면 자동 번역
    // - data-i18n="key"         → textContent 치환
    // - data-i18n-placeholder   → placeholder 속성 치환
    // - data-i18n-title         → title 속성 치환
    // - data-i18n-aria-label    → aria-label 속성 치환
    // - data-i18n-html="key"    → innerHTML 치환

    /**
     * 지정된 루트 요소 하위의 data-i18n 속성들을 현재 언어로 번역
     * @param {Element} [root] 스캔 루트 (기본 document.body)
     */
    function parseI18nVars(node) {
        if (!node || !node.getAttribute) return null;
        var raw = node.getAttribute('data-i18n-vars');
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function collectNodes(scope, selector) {
        var nodes = [];
        if (!scope || !scope.querySelectorAll) return nodes;
        if (scope.nodeType === 1 && scope.matches && scope.matches(selector)) {
            nodes.push(scope);
        }
        var found = scope.querySelectorAll(selector);
        for (var i = 0; i < found.length; i++) nodes.push(found[i]);
        return nodes;
    }

    function isSafeTranslationTarget(node) {
        if (!node || !node.closest) return true;
        if (node.closest('[data-t2-i18n-skip]')) return false;

        // 사용자가 작성하는 본문은 번역 UI 스캐너의 대상이 아니다. 붙여넣은 HTML에
        // data-i18n 속성이 우연히 포함되어도 사용자 텍스트를 덮어쓰지 않는다.
        var editor = node.closest('.t2-editor[contenteditable="true"]');
        if (!editor) return true;

        // 코드 블록처럼 원자 블록 내부에 다시 열린 contenteditable=true 영역은
        // 플러그인 UI가 아니라 사용자 작성 콘텐츠다. 외부 원자 블록보다 가장 가까운
        // 편집 가능 조상을 우선 판단해 data-i18n 문자열이 코드/본문을 덮지 않게 한다.
        var editableIsland = node.closest('[contenteditable="true"]');
        if (editableIsland && editableIsland !== editor) {
            return node.hasAttribute && node.hasAttribute('data-t2-i18n-allow-editable');
        }

        // 플러그인 원자 블록(contenteditable=false) 안의 버튼/상태 텍스트는 번역 허용.
        var atomic = node.closest('[contenteditable="false"]');
        if (atomic && editor.contains(atomic)) return true;

        return node.hasAttribute && node.hasAttribute('data-t2-i18n-allow-editable');
    }

    function applyTranslations(rootEl) {
        var scope = rootEl || document.body;
        if (!scope || !scope.querySelectorAll) return;

        var nodes = collectNodes(scope, '[data-i18n]');
        for (var i = 0; i < nodes.length; i++) {
            if (!isSafeTranslationTarget(nodes[i])) continue;
            var key = nodes[i].getAttribute('data-i18n');
            if (key) nodes[i].textContent = t(key, parseI18nVars(nodes[i]));
        }

        nodes = collectNodes(scope, '[data-i18n-placeholder]');
        for (var i = 0; i < nodes.length; i++) {
            if (!isSafeTranslationTarget(nodes[i])) continue;
            var key = nodes[i].getAttribute('data-i18n-placeholder');
            if (key) nodes[i].setAttribute('placeholder', t(key, parseI18nVars(nodes[i])));
        }

        nodes = collectNodes(scope, '[data-i18n-title]');
        for (var i = 0; i < nodes.length; i++) {
            if (!isSafeTranslationTarget(nodes[i])) continue;
            var key = nodes[i].getAttribute('data-i18n-title');
            if (key) nodes[i].setAttribute('title', t(key, parseI18nVars(nodes[i])));
        }

        nodes = collectNodes(scope, '[data-i18n-aria-label]');
        for (var i = 0; i < nodes.length; i++) {
            if (!isSafeTranslationTarget(nodes[i])) continue;
            var key = nodes[i].getAttribute('data-i18n-aria-label');
            if (key) nodes[i].setAttribute('aria-label', t(key, parseI18nVars(nodes[i])));
        }

        nodes = collectNodes(scope, '[data-i18n-html]');
        for (var i = 0; i < nodes.length; i++) {
            if (!isSafeTranslationTarget(nodes[i])) continue;
            var key = nodes[i].getAttribute('data-i18n-html');
            if (key) nodes[i].innerHTML = t(key, parseI18nVars(nodes[i]));
        }
    }

    // ────────────────────────────────────────────────────────────────
    // 7. 폴리필 자동 로드 (구형 브라우저 감지)
    // ────────────────────────────────────────────────────────────────
    /**
     * 구형 브라우저 감지 시 폴리필 스크립트 동적 로드
     * editor.lib.php 에서 이미 로드했다면 이 함수는 no-op
     */
    function ensurePolyfill() {
        // 이미 폴리필이 있으면 패스
        if (root.T2I18NPolyfill) return Promise.resolve();

        // 모던 브라우저: 네이티브 Intl.PluralRules 가 있으면 폴리필 불필요
        // 단, ICU MessageFormat 파싱은 항상 필요하므로 폴리필 사용
        var polyfillUrl = root.T2EDITOR_I18N_POLYFILL_URL ||
                          (root.T2EDITOR_URL || '') + '/vendor/formatjs/t2i18n-polyfill.js';

        return new Promise(function (resolve) {
            var script = document.createElement('script');
            script.src = polyfillUrl;
            script.async = true;
            script.onload = function () {
                _cachedFormatter = null;
                _cachedFormatterKind = null;
                resolve();
            };
            script.onerror = function () {
                // 폴리필 로드 실패 — simpleFormat 으로 폴백 (치명적 아님)
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[T2I18N] polyfill load failed, using simple format fallback');
                }
                resolve();
            };
            (document.head || document.documentElement).appendChild(script);
        });
    }

    // ────────────────────────────────────────────────────────────────
    // 8. T2I18N 객체 초기화
    // ────────────────────────────────────────────────────────────────
    currentLang = resolveInitialLang();

    // html lang 속성 설정
    try {
        document.documentElement.setAttribute('lang', currentLang);
    } catch (e) {}

    var T2I18N = {
        // 핵심 API
        t: t,
        getLocale: getLocale,
        setLocale: setLocale,
        onLocaleChange: onLocaleChange,

        // 유틸리티
        detectBrowserLang: detectBrowserLang,
        applyTranslations: applyTranslations,
        ensurePolyfill: ensurePolyfill,

        // 설정 (읽기 전용)
        supportedLangs: SUPPORTED_LANGS.slice(),
        defaultLang: DEFAULT_LANG,

        // 내부 (디버그용)
        _messages: INJECTED_MESSAGES,
        _formatMessage: formatMessage,
        _simpleFormat: simpleFormat,

        hydrateFromGlobals: function () {
            hydrateFromGlobals(true);
            this.supportedLangs = SUPPORTED_LANGS.slice();
            this.defaultLang = DEFAULT_LANG;
            this._messages = INJECTED_MESSAGES;
            applyTranslations(document.body || document.documentElement);
        },

        version: '10.2.1-beta2.2'
    };

    // ────────────────────────────────────────────────────────────────
    // 9. 전역 노출 — 호환성 별칭 포함
    // ────────────────────────────────────────────────────────────────
    root.T2I18N = T2I18N;

    // T2Editor.t() 별칭 — T2Editor 클래스가 정의된 후 T2Editor.t = T2I18N.t
    // (core.js 로드 후 자동 설정됨)
    // 플러그인이 T2Editor.t('key') 또는 T2Utils.t('key') 또는 T2I18N.t('key') 사용 가능

    // T2Utils 가 이미 정의되어 있으면 t() 추가
    if (root.T2Utils) {
        root.T2Utils.t = t;
        root.T2Utils.getLocale = getLocale;
        root.T2Utils.setLocale = setLocale;
        root.T2Utils.onLocaleChange = onLocaleChange;
    }

    // [FIX-LOAD-ORDER] 외부 스크립트 뒤에 전역 설정이 주입되는 레거시 배치도 흡수.
    setTimeout(function () {
        if (root.T2I18N && typeof root.T2I18N.hydrateFromGlobals === 'function') {
            root.T2I18N.hydrateFromGlobals();
        }
    }, 0);

    if (document && typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', function () {
            try {
                applyTranslations(document.body || document.documentElement);
            } catch (e) {}

            // 플러그인 지연 로딩으로 추가되는 모달/메뉴도 자동 번역한다. 한 프레임에
            // 한 번만 배치 처리하고, 사용자 본문은 isSafeTranslationTarget에서 제외한다.
            if (typeof MutationObserver === 'function' && document.body) {
                var pendingRoots = [];
                var scheduled = false;
                var flush = function () {
                    scheduled = false;
                    var roots = pendingRoots.slice();
                    pendingRoots.length = 0;
                    for (var i = 0; i < roots.length; i++) {
                        try { applyTranslations(roots[i]); } catch (e) {}
                    }
                };
                var observer = new MutationObserver(function (mutations) {
                    for (var i = 0; i < mutations.length; i++) {
                        for (var j = 0; j < mutations[i].addedNodes.length; j++) {
                            var added = mutations[i].addedNodes[j];
                            if (added && added.nodeType === 1) pendingRoots.push(added);
                        }
                    }
                    if (pendingRoots.length && !scheduled) {
                        scheduled = true;
                        (root.requestAnimationFrame || root.setTimeout)(flush, 0);
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                T2I18N._observer = observer;
            }
        });
    }

})(typeof window !== 'undefined' ? window : this);
