/*!
 * T2Editor I18N Polyfill — Self-hosted FormatJS-compatible runtime
 * ─────────────────────────────────────────────────────────────────
 * Version: 10.2.1-beta2.1
 *
 * 이 파일은 구형 브라우저(IE11, 구형 Safari, 구형 Chrome 등)에서
 * Intl.MessageFormat / Intl.PluralRules / Intl.NumberFormat 등의
 * 네이티브 API 가 부재할 때 T2Editor 의 i18n 시스템이 정상 동작하도록
 * 최소한의 호환 런타임을 제공합니다.
 *
 * 원본 FormatJS (@formatjs/intl-messageformat) 의 핵심 기능을
 * T2Editor 사용 사례에 맞춰 경량화하여 자체 구현한 폴리필입니다.
 * CDN 을 사용하지 않고 자체 호스팅하기 위해 작성되었습니다.
 *
 * 지원 ICU MessageFormat 문법 (FormatJS 호환):
 *   1. 단순 변수: "Hello, {name}" → "Hello, World"
 *   2. 복수형 (plural): "{count, plural, =0 {no items} one {one item} other {# items}}"
 *   3. 선택 (select): "{gender, select, male {he} female {she} other {they}}"
 *   4. 숫자 포맷: "{count, number}" → "1,234"
 *   5. 중첩: "{count, plural, one {{name} has one} other {{name} has many}}"
 *
 * 제한사항 (원본 FormatJS 대비):
 *   - date/time 포맷은 네이티브 Intl.DateTimeFormat 이 있어야 동작
 *   - 복잡한 커스텀 포맷은 미지원
 *   - 성능: 원본보다 느릴 수 있으나 단순 케이스에 충분
 *
 * 사용법:
 *   1. 이 파일을 <script>로 로드
 *   2. window.T2I18NPolyfill 가 정의됨
 *   3. js/i18n.js 가 네이티브 Intl 우선, 없으면 폴리필 사용
 */
(function (root) {
    'use strict';

    if (root.T2I18NPolyfill) return; // 중복 로드 방지

    // ────────────────────────────────────────────────────────────────
    // 1. Intl.NumberFormat 폴리필 (구형 브라우저 대응)
    // ────────────────────────────────────────────────────────────────
    var nativeNumberFormat = root.Intl && root.Intl.NumberFormat;

    function T2NumberFormat(locales, options) {
        if (nativeNumberFormat) {
            return new nativeNumberFormat(locales, options);
        }
        // 폴리필: 간단한 3자리 콤마 포맷
        this._locale = (locales && (Array.isArray(locales) ? locales[0] : locales)) || 'en';
        this._options = options || {};
    }
    T2NumberFormat.prototype.format = function (num) {
        if (nativeNumberFormat) {
            return new nativeNumberFormat(this._locale, this._options).format(num);
        }
        // 폴리필 간단 구현
        var n = Number(num);
        if (isNaN(n)) return String(num);
        var parts = String(Math.abs(n)).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (n < 0 ? '-' : '') + parts.join('.');
    };

    // ────────────────────────────────────────────────────────────────
    // 2. Intl.PluralRules 폴리필 (복수형 처리용)
    // ────────────────────────────────────────────────────────────────
    var nativePluralRules = root.Intl && root.Intl.PluralRules;

    /**
     * 언어별 복수형 규칙 (CLDR 기반 최소 구현)
     * - 1형식: ko, ja, zh, th, vi, id (동일 형식)
     * - 2형식: en, de, fr, es, it, nl, pt, sv, da, no, fi (one/other)
     * - 3형식: ru, uk, pl (one/few/many/other) — 부분 지원
     */
    function getPluralCategory(lang, count) {
        var n = Math.abs(Number(count));
        var nInt = Math.floor(n);

        // 1형식 언어 (한국어, 일본어, 중국어 등) — count 무관 always 'other'
        var oneFormLangs = ['ko', 'ja', 'zh', 'th', 'vi', 'id', 'ms', 'tr', 'fa', 'ar'];
        if (oneFormLangs.indexOf(lang) !== -1) {
            return 'other';
        }

        // 3형식 언어 (러시아어, 폴란드어 등) — 부분 지원
        var ruLikeLangs = ['ru', 'uk', 'pl', 'hr', 'sr', 'cs', 'sk'];
        if (ruLikeLangs.indexOf(lang) !== -1) {
            var mod10 = nInt % 10;
            var mod100 = nInt % 100;
            if (mod10 === 1 && mod100 !== 11) return 'one';
            if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'few';
            if (nInt === 0) return 'zero';
            return 'many';
        }

        // 2형식 언어 (영어, 독일어 등) — one/other
        // 기본값 (en 호환)
        if (n === 1) return 'one';
        return 'other';
    }

    function T2PluralRules(locales, options) {
        this._locale = (locales && (Array.isArray(locales) ? locales[0] : locales)) || 'en';
        if (nativePluralRules) {
            this._native = new nativePluralRules(locales, options);
        }
    }
    T2PluralRules.prototype.select = function (count) {
        if (this._native) return this._native.select(count);
        var lang = String(this._locale).toLowerCase().split(/[-_]/)[0];
        return getPluralCategory(lang, count);
    };

    // ────────────────────────────────────────────────────────────────
    // 3. ICU MessageFormat 파서 (FormatJS 호환 최소 구현)
    // ────────────────────────────────────────────────────────────────

    /**
     * ICU MessageFormat 문자열을 파싱하고 번역 결과를 반환
     *
     * 지원 문법:
     *   - {var}                              단순 변수
     *   - {var, number}                      숫자 포맷
     *   - {var, plural, cat {text} ...}      복수형
     *   - {var, select, key {text} ...}      선택
     *   - #                                  복수형 내에서 현재 카운트
     *   - 중첩 변수 {{var}}                  내부 문자열 안에서 변수
     *
     * @param {string} pattern ICU 메시지 패턴
     * @param {object} values 변수값 객체 {name: 'World', count: 5}
     * @param {string} locale 언어코드 (기본 'en')
     * @returns {string} 치환된 메시지
     */
    function formatMessage(pattern, values, locale) {
        if (typeof pattern !== 'string') return String(pattern || '');
        values = values || {};
        locale = locale || 'en';

        // 파싱 커서
        var result = '';
        var i = 0;
        var len = pattern.length;

        // 단순 케이스 최적화: { 또는 # 이 없으면 그대로 반환
        if (pattern.indexOf('{') === -1) return pattern;

        while (i < len) {
            var ch = pattern.charAt(i);

            // 일반 문자 — { 또는 } 만 특수 처리
            if (ch === '{') {
                // 매칭되는 } 찾기 (중첩 고려)
                var depth = 1;
                var j = i + 1;
                var argStart = j;
                while (j < len && depth > 0) {
                    var c = pattern.charAt(j);
                    if (c === '{') depth++;
                    else if (c === '}') depth--;
                    if (depth === 0) break;
                    j++;
                }
                if (j >= len) {
                    // 닫는 } 없음 — 잘못된 패턴, 원본 그대로
                    result += pattern.substring(i);
                    break;
                }

                var argContent = pattern.substring(argStart, j);
                result += formatArgument(argContent, values, locale);
                i = j + 1;
            } else if (ch === '}') {
                // 닫는 } 가 단독으로 나오면 무시 (파싱 오류 복구)
                i++;
            } else if (ch === '#' && (i === 0 || pattern.charAt(i - 1) !== '\\')) {
                // 복수형 컨텍스트 안에서 # 은 현재 count — 허용된 경우에만
                // 단, 단독 사용은 드물어 일반적으로는 그대로 출력
                // (복수형 내부에서는 formatPlural 처리 시 # 치환)
                result += ch;
                i++;
            } else {
                // 일반 문자 추가
                result += ch;
                i++;
            }
        }

        return result;
    }

    /**
     * {argContent} 내부 처리: "name" 또는 "count, plural, ..." 형식
     */
    function formatArgument(argContent, values, locale) {
        // trim 후 쉼표로 분리
        var parts = splitArg(argContent);
        var varName = parts[0].trim();
        var argType = parts.length > 1 ? parts[1].trim() : 'string';
        var value = values[varName];

        // 값이 undefined 면 빈 문자열 (FormatJS 동작)
        if (value === undefined || value === null) {
            // {name} 처럼 단순 변수인 경우 빈 문자열
            if (parts.length === 1) return '';
            // 그 외는 0 으로 처리
            value = 0;
        }

        switch (argType) {
            case 'number':
                return new T2NumberFormat(locale).format(Number(value));
            case 'date':
                if (root.Intl && root.Intl.DateTimeFormat) {
                    try {
                        return new root.Intl.DateTimeFormat(locale).format(new Date(value));
                    } catch (e) {}
                }
                return String(value);
            case 'time':
                if (root.Intl && root.Intl.DateTimeFormat) {
                    try {
                        return new root.Intl.DateTimeFormat(locale, { hour: 'numeric', minute: 'numeric', second: 'numeric' }).format(new Date(value));
                    } catch (e) {}
                }
                return String(value);
            case 'plural':
                return formatPlural(varName, value, parts.slice(2), values, locale);
            case 'select':
                return formatSelect(varName, value, parts.slice(2), values, locale);
            case 'selectordinal':
                // 서수형 — 폴리필에서는 'other' 만 반환 (단순화)
                return formatSelectOrdinal(varName, value, parts.slice(2), values, locale);
            default:
                // 단순 변수
                return String(value);
        }
    }

    /**
     * argContent 를 쉼표로 분리하되 중첩 {} 안의 쉼표는 보존
     */
    function splitArg(content) {
        var parts = [];
        var current = '';
        var depth = 0;
        for (var i = 0; i < content.length; i++) {
            var ch = content.charAt(i);
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            if (ch === ',' && depth === 0) {
                parts.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim() !== '') parts.push(current);
        return parts;
    }

    /**
     * 복수형 처리: "plural, =0 {none} one {one} other {# items}"
     */
    function formatPlural(varName, value, parts, values, locale) {
        var count = Number(value);
        var category = new T2PluralRules(locale).select(count);
        // 명시적 매칭 (=0, =1, =2 ...) 우선, 없으면 category
        var matchPattern = null;

        for (var i = 0; i < parts.length; i++) {
            var part = parts[i].trim();
            // "key {text}" 형식 분리
            var keyMatch = part.match(/^([=\w]+)\s*\{([\s\S]*)\}$/);
            if (keyMatch) {
                var key = keyMatch[1];
                var text = keyMatch[2];
                if (key === '=' + count) {
                    matchPattern = text;
                    break;
                }
                if (key === category && matchPattern === null) {
                    matchPattern = text;
                    // 명시적 매칭이 우선이므로 계속 검색
                }
                if (key === 'other' && matchPattern === null) {
                    matchPattern = text;
                }
            }
        }

        if (matchPattern === null) return String(count);

        // # 치환: 복수형 패턴 안에서 # 은 현재 count
        matchPattern = matchPattern.replace(/#/g, function () {
            return new T2NumberFormat(locale).format(count);
        });

        // 중첩 변수 처리
        return formatMessage(matchPattern, values, locale);
    }

    /**
     * 선택 처리: "select, male {he} female {she} other {they}"
     */
    function formatSelect(varName, value, parts, values, locale) {
        var strValue = String(value);
        var matchPattern = null;
        var otherPattern = null;

        for (var i = 0; i < parts.length; i++) {
            var part = parts[i].trim();
            var keyMatch = part.match(/^(\w+)\s*\{([\s\S]*)\}$/);
            if (keyMatch) {
                var key = keyMatch[1];
                var text = keyMatch[2];
                if (key === strValue) {
                    matchPattern = text;
                    break;
                }
                if (key === 'other') otherPattern = text;
            }
        }

        if (matchPattern === null) matchPattern = otherPattern;
        if (matchPattern === null) return strValue;

        // 중첩 변수 처리
        return formatMessage(matchPattern, values, locale);
    }

    /**
     * 서수형 — 폴리필에서는 'other' 만 사용 (정확한 서수 규칙은 네이티브 Intl.PluralRules 필요)
     */
    function formatSelectOrdinal(varName, value, parts, values, locale) {
        var count = Number(value);
        var matchPattern = null;

        for (var i = 0; i < parts.length; i++) {
            var part = parts[i].trim();
            var keyMatch = part.match(/^([=\w]+)\s*\{([\s\S]*)\}$/);
            if (keyMatch) {
                var key = keyMatch[1];
                var text = keyMatch[2];
                if (key === '=' + count) {
                    matchPattern = text;
                    break;
                }
                if (key === 'other') matchPattern = text;
            }
        }

        if (matchPattern === null) return String(count);
        matchPattern = matchPattern.replace(/#/g, function () {
            return new T2NumberFormat(locale).format(count);
        });
        return formatMessage(matchPattern, values, locale);
    }

    // ────────────────────────────────────────────────────────────────
    // 4. 폴리필 전역 노출
    // ────────────────────────────────────────────────────────────────
    var T2I18NPolyfill = {
        version: '10.2.1-beta2.1',
        formatMessage: formatMessage,
        T2NumberFormat: T2NumberFormat,
        T2PluralRules: T2PluralRules,
        getPluralCategory: getPluralCategory,
        // 네이티브 Intl 보충 — 부재 시 폴리필 제공
        Intl: {
            NumberFormat: nativeNumberFormat || T2NumberFormat,
            PluralRules: nativePluralRules || T2PluralRules,
            DateTimeFormat: (root.Intl && root.Intl.DateTimeFormat) || null,
        },
        hasNativeIntl: !!(nativeNumberFormat && nativePluralRules),
        // 폴리필이 활성화되었는지 여부 (디버그용)
        isPolyfillActive: !(nativeNumberFormat && nativePluralRules)
    };

    root.T2I18NPolyfill = T2I18NPolyfill;

    // 네이티브 Intl 이 없으면 폴리필로 보충
    if (!root.Intl) root.Intl = {};
    if (!root.Intl.NumberFormat) root.Intl.NumberFormat = T2NumberFormat;
    if (!root.Intl.PluralRules) root.Intl.PluralRules = T2PluralRules;

})(typeof window !== 'undefined' ? window : this);
