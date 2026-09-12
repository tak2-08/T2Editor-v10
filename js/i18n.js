// Path: T2Editor/js/i18n.js
// Developer settings: add locale files under core/plugin locale directories; missing keys must fall back without blocking plugin load.

// Self-hosted i18n core: browser/PHP locale detection, ICU-compatible formatting, runtime switching
// and non-blocking fallback for plugins without locale support.
// Developer settings: PHP injects T2EDITOR_I18N_*; the FormatJS polyfill is conditionally loaded.

(function (root) {
    'use strict';

    if (root.T2I18N) return; // 중복 로드 방지

    // 1. 상수 및 설정
    var SUPPORTED_LANGS = [];
    var DEFAULT_LANG = '';
    var STORAGE_KEY = 't2editor-lang'; // 사용자 명시적 선택 언어 저장

    // PHP 자동 언어팩 로더에서 주입한 런타임 레지스트리.
    // 신규 언어 추가 시 이 파일을 수정하지 않는다.
    var INJECTED_MESSAGES = {};
    var INJECTED_USER_LANG = null;
    var LANGUAGE_ALIASES = {};
    var LANGUAGE_FALLBACKS = {};
    var LANGUAGE_DIRECTIONS = {};
    var LANGUAGE_REGISTRY = {};
    var LOCALE_URLS = {};
    var LOCALE_ENDPOINT = '';
    var LOCALE_FALLBACK_URL = '';
    var LOCALE_FALLBACK_LOAD = null;
    var LOCALE_LOADS = {};
    var currentLang = null;

    function normalizeLang(lang) {
        if (typeof lang !== 'string') return '';
        lang = lang.trim().toLowerCase().replace(/_/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (!lang || lang.length > 63 || !/^[a-z0-9]{1,8}(?:-[a-z0-9]{1,8})*$/.test(lang)) return '';
        return lang;
    }

    function uniqueLocales(values) {
        var result = [];
        if (!values || typeof values.length !== 'number') return result;
        for (var i = 0; i < values.length; i++) {
            var code = normalizeLang(values[i]);
            if (code && result.indexOf(code) === -1) result.push(code);
        }
        return result;
    }

    function normalizeMap(source, valueIsLocale) {
        var result = {};
        if (!source || typeof source !== 'object') return result;
        Object.keys(source).forEach(function (rawKey) {
            var key = normalizeLang(rawKey);
            if (!key) return;
            var value = source[rawKey];
            result[key] = valueIsLocale ? normalizeLang(value) : value;
        });
        return result;
    }

    function resolveSupportedLang(lang) {
        var candidate = normalizeLang(lang);
        while (candidate) {
            if (SUPPORTED_LANGS.indexOf(candidate) !== -1) return candidate;
            if (LANGUAGE_ALIASES[candidate] && SUPPORTED_LANGS.indexOf(LANGUAGE_ALIASES[candidate]) !== -1) {
                return LANGUAGE_ALIASES[candidate];
            }
            var pos = candidate.lastIndexOf('-');
            if (pos === -1) break;
            candidate = candidate.substring(0, pos);
        }
        return '';
    }

    function getFallbackChain(lang) {
        var chain = [];
        var add = function (candidate) {
            candidate = resolveSupportedLang(candidate);
            if (candidate && chain.indexOf(candidate) === -1) chain.push(candidate);
            return candidate;
        };
        var current = add(lang) || add(DEFAULT_LANG);
        var guard = 0;
        while (current && LANGUAGE_FALLBACKS[current] && guard++ < 16) {
            var next = add(LANGUAGE_FALLBACKS[current]);
            if (!next || next === current) break;
            current = next;
        }

        var normalized = normalizeLang(lang);
        while (normalized.indexOf('-') !== -1) {
            normalized = normalized.substring(0, normalized.lastIndexOf('-'));
            add(normalized);
        }
        add(DEFAULT_LANG);
        return chain;
    }

    function applyDocumentLocale(lang) {
        try {
            if (!root.document || !root.document.documentElement) return;
            var direction = LANGUAGE_DIRECTIONS[lang] === 'rtl' ? 'rtl' : 'ltr';
            // 사이트 전체 레이아웃의 방향을 강제로 바꾸지 않고 에디터 인스턴스에만 적용한다.
            root.document.documentElement.setAttribute('lang', lang);
            if (root.document.querySelectorAll) {
                var containers = root.document.querySelectorAll('.t2-editor-container');
                for (var i = 0; i < containers.length; i++) {
                    containers[i].setAttribute('lang', lang);
                    containers[i].setAttribute('dir', direction);
                }
            }
        } catch (e) {}
    }

    function hydrateFromGlobals(syncLocale) {
        INJECTED_MESSAGES = (root.T2EDITOR_I18N_MESSAGES && typeof root.T2EDITOR_I18N_MESSAGES === 'object')
            ? root.T2EDITOR_I18N_MESSAGES
            : {};

        var supported = uniqueLocales(root.T2EDITOR_I18N_SUPPORTED_LANGS);
        if (!supported.length) supported = uniqueLocales(Object.keys(INJECTED_MESSAGES));
        SUPPORTED_LANGS = supported;

        LANGUAGE_ALIASES = normalizeMap(root.T2EDITOR_I18N_ALIASES, true);
        LANGUAGE_FALLBACKS = normalizeMap(root.T2EDITOR_I18N_FALLBACKS, true);
        LANGUAGE_DIRECTIONS = normalizeMap(root.T2EDITOR_I18N_DIRECTIONS, false);
        LANGUAGE_REGISTRY = (root.T2EDITOR_I18N_REGISTRY && typeof root.T2EDITOR_I18N_REGISTRY === 'object')
            ? root.T2EDITOR_I18N_REGISTRY : {};
        LOCALE_URLS = (root.T2EDITOR_I18N_LOCALE_URLS && typeof root.T2EDITOR_I18N_LOCALE_URLS === 'object')
            ? root.T2EDITOR_I18N_LOCALE_URLS : {};
        LOCALE_ENDPOINT = typeof root.T2EDITOR_I18N_LOCALE_ENDPOINT === 'string' ? root.T2EDITOR_I18N_LOCALE_ENDPOINT : '';
        LOCALE_FALLBACK_URL = typeof root.T2EDITOR_I18N_FALLBACK_URL === 'string' ? root.T2EDITOR_I18N_FALLBACK_URL : '';

        var injectedDefault = resolveSupportedLang(root.T2EDITOR_I18N_DEFAULT_LANG);
        DEFAULT_LANG = injectedDefault || resolveSupportedLang('en') || (SUPPORTED_LANGS[0] || 'en');
        INJECTED_USER_LANG = resolveSupportedLang(root.T2EDITOR_I18N_USER_LANG) || null;

        if (syncLocale) {
            var previousLang = currentLang;
            currentLang = resolveInitialLang();
            _cachedFormatter = null;
            _cachedFormatterKind = null;
            applyDocumentLocale(currentLang);
            if (previousLang && previousLang !== currentLang) notifyLocaleChange(currentLang, previousLang);
        }
    }

    hydrateFromGlobals(false);

    // 2. 브라우저 언어 감지

    /**
     * 브라우저의 navigator.language / navigator.languages 에서
     * 지원 언어 중 일치하는 언어를 찾아 반환
     *
     * @returns {string} 감지된 언어코드 (지원 언어 중 하나, 없으면 영어)
     */
    function detectBrowserLang() {
        if (typeof navigator === 'undefined') return resolveSupportedLang('en') || DEFAULT_LANG;

        // navigator.languages (배열, 우선순위 순) 우선, 없으면 navigator.language
        var langs = navigator.languages ||
                    [navigator.language || navigator.userLanguage || DEFAULT_LANG];

        for (var i = 0; i < langs.length; i++) {
            var l = langs[i];
            if (!l) continue;
            var code = resolveSupportedLang(l);
            if (code) return code;
        }
        return resolveSupportedLang('en') || DEFAULT_LANG;
    }

     /** Resolve locale by explicit user choice, PHP detection, browser language, then English/default. */
    function resolveInitialLang() {
        // 1. localStorage (사용자가 번역 버튼으로 선택한 언어)
        try {
            var stored = resolveSupportedLang(localStorage.getItem(STORAGE_KEY));
            if (stored) return stored;
        } catch (e) {
            // localStorage 접근 불가 (private mode 등) — 무시
        }

        // 2. PHP가 실제로 일치시킨 값 (명시 쿠키/Accept-Language)
        if (INJECTED_USER_LANG) return INJECTED_USER_LANG;

        // 3. 브라우저 navigator.languages를 직접 검사
        var browserLang = detectBrowserLang();
        if (browserLang) return browserLang;

        // 4. 지원 언어가 하나도 일치하지 않으면 영어, 영어 팩이 없을 때만 기본값
        return resolveSupportedLang('en') || DEFAULT_LANG;
    }

    // 3. 메시지 카탈로그 조회

     /** Return the PHP-injected flat catalog for a locale, or an empty object. */
    function getMessages(lang) {
        lang = resolveSupportedLang(lang) || DEFAULT_LANG;
        if (!INJECTED_MESSAGES || typeof INJECTED_MESSAGES !== 'object') hydrateFromGlobals(false);
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

     /** Translate a dot-key with optional ICU variables and locale override; humanize missing keys. */
    function t(key, vars, langOverride) {
        if (typeof key !== 'string' || key === '') return '';

        var lang = resolveSupportedLang(langOverride) || currentLang || DEFAULT_LANG;
        var chain = getFallbackChain(lang);
        var msg;
        var messageLang = lang;
        for (var i = 0; i < chain.length; i++) {
            msg = lookupMessage(getMessages(chain[i]), key);
            if (msg !== undefined) {
                messageLang = chain[i];
                break;
            }
        }

        // 설치된 언어팩의 폴백 체인에도 없으면 키를 사람이 읽을 수 있게 변환
        // (collab/ai_complex 등 대형 플러그인의 누락된 키를 우아하게 처리)
        if (msg === undefined) {
            return humanizeKey(key, vars);
        }

        // 변수 치환 (ICU MessageFormat)
        // msg 가 배열/객체인 경우 (nickname_adjs 등) formatMessage 를 건너뛰고 원본 반환.
        if (vars && typeof vars === 'object' && typeof msg === 'string') {
            msg = formatMessage(msg, vars, messageLang);
        }

        return msg;
    }

     /** Humanize a missing translation key and substitute simple variables. */
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

    // 4. ICU MessageFormat 처리

     // Resolve the formatter lazily so script load order is harmless: polyfill, native implementation, then simple fallback.
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

     /** Minimal {var} substitution fallback without ICU plural/select support. */
    function simpleFormat(pattern, vars) {
        if (!vars || typeof vars !== 'object') return pattern;
        return String(pattern).replace(/\{(\w+)\}/g, function (match, key) {
            return (vars[key] !== undefined && vars[key] !== null) ? String(vars[key]) : match;
        });
    }

    // 5. 언어 전환 이벤트 시스템
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

     /** Register a locale-change callback and return an unsubscribe function. */
    function onLocaleChange(callback) {
        if (typeof callback !== 'function') return function () {};
        localeChangeListeners.push(callback);
        return function () {
            var idx = localeChangeListeners.indexOf(callback);
            if (idx !== -1) localeChangeListeners.splice(idx, 1);
        };
    }

    function hasLocaleMessages(lang) {
        return !!(INJECTED_MESSAGES && typeof INJECTED_MESSAGES === 'object' &&
            INJECTED_MESSAGES[lang] && typeof INJECTED_MESSAGES[lang] === 'object');
    }

    function fetchLocaleJson(url) {
        if (!url || typeof root.fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
        return root.fetch(url, { credentials: 'same-origin', cache: 'force-cache', headers: { 'Accept': 'application/json' } })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            });
    }

    function mergeLocaleCatalogs(all) {
        if (!all || typeof all !== 'object' || Array.isArray(all)) throw new Error('invalid locale fallback');
        Object.keys(all).forEach(function (code) {
            if (all[code] && typeof all[code] === 'object' && !Array.isArray(all[code])) INJECTED_MESSAGES[code] = all[code];
        });
        root.T2EDITOR_I18N_MESSAGES = INJECTED_MESSAGES;
        return all;
    }

    function loadLegacyLocalePayload(lang) {
        if (!LOCALE_FALLBACK_URL) return Promise.reject(new Error('locale fallback unavailable'));
        if (!LOCALE_FALLBACK_LOAD) {
            LOCALE_FALLBACK_LOAD = fetchLocaleJson(LOCALE_FALLBACK_URL).then(mergeLocaleCatalogs);
            LOCALE_FALLBACK_LOAD = LOCALE_FALLBACK_LOAD.then(function (all) {
                LOCALE_FALLBACK_LOAD = null;
                return all;
            }, function (error) {
                LOCALE_FALLBACK_LOAD = null;
                throw error;
            });
        }
        return LOCALE_FALLBACK_LOAD.then(function (all) {
            if (!all[lang] || typeof all[lang] !== 'object' || Array.isArray(all[lang])) throw new Error('invalid locale fallback');
            return all[lang];
        });
    }

    function loadLocale(lang) {
        lang = resolveSupportedLang(lang) || DEFAULT_LANG;
        if (hasLocaleMessages(lang)) return Promise.resolve(INJECTED_MESSAGES[lang]);
        if (LOCALE_LOADS[lang]) return LOCALE_LOADS[lang];

        var staticUrl = typeof LOCALE_URLS[lang] === 'string' ? LOCALE_URLS[lang] : '';
        var dynamicUrl = LOCALE_ENDPOINT ? LOCALE_ENDPOINT + (LOCALE_ENDPOINT.indexOf('?') === -1 ? '?' : '&') + 'lang=' + encodeURIComponent(lang) : '';
        var request = fetchLocaleJson(staticUrl || dynamicUrl);
        if (staticUrl && dynamicUrl) {
            // A server may intentionally deny the projected static directory.
            // Preserve lazy one-language loading before falling back to the
            // larger legacy all-language response.
            request = request.catch(function () { return fetchLocaleJson(dynamicUrl); });
        }
        LOCALE_LOADS[lang] = request.then(function (catalog) {
            if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('invalid locale catalog');
            INJECTED_MESSAGES[lang] = catalog;
            root.T2EDITOR_I18N_MESSAGES = INJECTED_MESSAGES;
            return catalog;
        }).catch(function () {
            return loadLegacyLocalePayload(lang);
        });
        LOCALE_LOADS[lang] = LOCALE_LOADS[lang].then(function (catalog) {
            delete LOCALE_LOADS[lang];
            return catalog;
        }, function (error) {
            delete LOCALE_LOADS[lang];
            throw error;
        });
        return LOCALE_LOADS[lang];
    }

    function commitLocale(newLang, automatic) {
        var oldLang = currentLang;
        if (oldLang === newLang) {
            try { applyTranslations(root.document.body || root.document.documentElement); } catch (e) {}
            return newLang;
        }
        currentLang = newLang;
        _cachedFormatter = null;
        _cachedFormatterKind = null;
        if (!automatic) {
            try { localStorage.setItem(STORAGE_KEY, newLang); } catch (e) {}
        }
        try {
            var expires = new Date();
            expires.setFullYear(expires.getFullYear() + 1);
            root.document.cookie = 't2editor_lang=' + encodeURIComponent(newLang) +
                ';expires=' + expires.toUTCString() + ';path=/;SameSite=Lax';
        } catch (e) {}
        applyDocumentLocale(newLang);
        notifyLocaleChange(newLang, oldLang);
        try { applyTranslations(root.document.body || root.document.documentElement); } catch (e) {}
        return newLang;
    }

    /**
     * 언어 변경 — 모든 리스너에게 알림 + document 이벤트 디스패치
     * @param {string} newLang 새 언어코드
     */
    function setLocale(newLang) {
        var automatic = normalizeLang(newLang) === 'auto';
        if (automatic) {
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
            newLang = detectBrowserLang();
        } else {
            newLang = resolveSupportedLang(newLang) || DEFAULT_LANG;
        }
        if (!hasLocaleMessages(newLang)) {
            loadLocale(newLang).then(function () {
                commitLocale(newLang, automatic);
            }).catch(function (error) {
                if (typeof console !== 'undefined' && console.warn) console.warn('[T2I18N] locale load failed:', error);
                commitLocale(newLang, automatic);
            });
            return newLang;
        }
        return commitLocale(newLang, automatic);
    }

    /**
     * 현재 언어 조회
     * @returns {string} 현재 활성 언어코드
     */
    function getLocale() {
        return currentLang;
    }

    // data-i18n attributes translate text, placeholders, title, aria-label or trusted catalog HTML.
    // This is the extension contract for third-party plugin UI.

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

    // 7. 폴리필 자동 로드 (구형 브라우저 감지)
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

    // 8. T2I18N 객체 초기화
    currentLang = resolveInitialLang();

    // html lang/dir 속성 설정
    applyDocumentLocale(currentLang);
    if (!hasLocaleMessages(currentLang)) {
        loadLocale(currentLang).then(function () {
            try { applyTranslations(root.document.body || root.document.documentElement); } catch (e) {}
        }).catch(function () {});
    }

    var T2I18N = {
        // 핵심 API
        t: t,
        getLocale: getLocale,
        setLocale: setLocale,
        loadLocale: loadLocale,
        onLocaleChange: onLocaleChange,

        // 유틸리티
        detectBrowserLang: detectBrowserLang,
        resolveLocale: resolveSupportedLang,
        getFallbackChain: getFallbackChain,
        applyTranslations: applyTranslations,
        ensurePolyfill: ensurePolyfill,

        // 자동 발견된 언어팩 설정
        supportedLangs: SUPPORTED_LANGS.slice(),
        defaultLang: DEFAULT_LANG,
        languageRegistry: LANGUAGE_REGISTRY,

        // 내부 (디버그용)
        _messages: INJECTED_MESSAGES,
        _formatMessage: formatMessage,
        _simpleFormat: simpleFormat,

        hydrateFromGlobals: function () {
            hydrateFromGlobals(true);
            this.supportedLangs = SUPPORTED_LANGS.slice();
            this.defaultLang = DEFAULT_LANG;
            this.languageRegistry = LANGUAGE_REGISTRY;
            this._messages = INJECTED_MESSAGES;
            applyTranslations(root.document.body || root.document.documentElement);
        },

        version: '10.5.0-lazy-compiled-language-packs'
    };

    // 9. 전역 노출 — 호환성 별칭 포함
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

    // 외부 스크립트 뒤에 전역 설정이 주입되는 레거시 배치도 흡수.
    setTimeout(function () {
        if (root.T2I18N && typeof root.T2I18N.hydrateFromGlobals === 'function') {
            root.T2I18N.hydrateFromGlobals();
        }
    }, 0);

    if (root.document && typeof root.document.addEventListener === 'function') {
        root.document.addEventListener('DOMContentLoaded', function () {
            try {
                applyDocumentLocale(currentLang);
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

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
