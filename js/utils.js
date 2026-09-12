//Path: T2Editor/js/utils.js

window.T2Utils = {

    // ════════════════════════════════════════════════════════════════════════
    // [I18N] 번역 API — T2Editor 10.2.1-beta2+
    // ───────────────────────────────────────────────────────────────────────
    // T2I18N 이 로드되어 있으면 위임, 없으면 키 그대로 반환 (서드파티 호환성)
    // T2I18N.t(key, vars) 와 동일 — T2Utils.t() 는 별칭
    //
    // [동작 설명]
    // - T2I18N 로드 시: T2I18N.t() 위임
    //   · 키가 있으면 번역된 메시지 반환
    //   · 키가 없으면 humanizeKey() 가 키를 사람이 읽을 수 있는 형태로 변환
    //     (예: 'collab.user_joined' → 'User joined')
    // - T2I18N 미로드 시: 키 그대로 반환 (서드파티 플러그인 호환성 보장)
    // ───────────────────────────────────────────────────────────────────────
    /**
     * 번역 키로 메시지 조회
     * @param {string} key 번역 키 (예: 'common.confirm')
     * @param {Object} [vars] 변수값 객체 (ICU MessageFormat 치환용)
     * @returns {string} 번역된 메시지 (T2I18N 미로드 시 키 그대로 반환)
     */
    t: function(key, vars) {
        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.t) {
            return window.T2I18N.t(key, vars);
        }
        // T2I18N 미로드 시 폴백 — 키 그대로 반환 (서드파티 플러그인 호환성 보장)
        return key;
    },

    /**
     * 번역 조회 + 폴백 지원 (T2Editor 10.2.1-beta2+)
     *
     * T2I18N 이 로드되어 있고 키가 발견되면 번역된 값을 반환.
     * 그렇지 않으면 fallback 문자열을 반환.
     *
     * @param {string} key 번역 키
     * @param {Object} [vars] ICU 변수
     * @param {string} [fallback] 폴백 문자열 (기본: 빈 문자열)
     * @returns {string} 번역된 메시지 또는 폴백
     */
    tf: function(key, vars, fallback) {
        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.t) {
            // [FIX] humanizeKey 변환을 직접 수행하여 정확히 비교.
            // i18n.js 의 humanizeKey 는 키의 마지막 부분(점 다음)을 추출하고,
            // 언더스코어를 공백으로 변환한 뒤 첫 글자를 대문자화함.
            // 키가 발견되지 않으면 humanizeKey 결과가 반환되므로, 이를 감지하여 폴백 사용.
            var msg = window.T2I18N.t(key, vars);

            // 배열/객체 fallback 지원: msg 가 배열/객체가 아닌데 fallback 이 배열/객체이면 폴백 사용
            // (i18n.js 의 t() 는 객체/배열 값을 그대로 반환하지 못하고 humanizeKey 가 동작함)
            if (Array.isArray(fallback) || (typeof fallback === 'object' && fallback !== null)) {
                // msg 가 문자열이면 → i18n 이 배열을 처리하지 못한 것 → 폴백 사용
                if (typeof msg === 'string') {
                    return fallback;
                }
                return msg;
            }

            // 1. 키 자체가 반환된 경우 → 누락
            if (msg === key) {
                return (typeof fallback === 'string') ? fallback : key;
            }

            // 2. humanizeKey 결과와 비교 — 누락 감지
            var lastPart = key;
            var dotIdx = key.lastIndexOf('.');
            if (dotIdx !== -1) {
                lastPart = key.substring(dotIdx + 1);
            }
            var humanized = lastPart.replace(/_/g, ' ');
            if (humanized.length > 0) {
                humanized = humanized.charAt(0).toUpperCase() + humanized.slice(1);
            }
            // 변수 치환된 humanizeKey 와 비교 (vars.count 등이 있는 경우)
            if (typeof vars === 'object' && vars !== null) {
                humanized = humanized.replace(/\{(\w+)\}/g, function(match, varKey) {
                    return (vars[varKey] !== undefined && vars[varKey] !== null) ? String(vars[varKey]) : match;
                });
                // x_ 접두사 처리 (humanizeKey 의 special case)
                if (humanized.indexOf('x ') === 0 && vars.count !== undefined) {
                    humanized = String(vars.count) + humanized.substring(1);
                }
            }
            if (msg === humanized) {
                // humanizeKey 결과 → 키가 누락됨 → 폴백 사용
                return (typeof fallback === 'string') ? fallback : msg;
            }

            // 3. 정상 번역 값
            return msg;
        }
        return (typeof fallback !== 'undefined') ? fallback : key;
    },

    /**
     * 현재 언어 조회 (T2I18N 위임)
     * @returns {string} 'ko' | 'en' | 'ja' | 'zh' | 'en' (폴백)
     */
    getLocale: function() {
        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.getLocale) {
            return window.T2I18N.getLocale();
        }
        return 'en'; // 폴백
    },

    /**
     * 언어 변경 (T2I18N 위임)
     * @param {string} lang 언어코드
     */
    setLocale: function(lang) {
        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.setLocale) {
            window.T2I18N.setLocale(lang);
        }
    },

    /**
     * 언어 변경 리스너 등록 (T2I18N 위임)
     * @param {Function} callback function(newLang, oldLang)
     * @returns {Function} 등록 해제 함수
     */
    onLocaleChange: function(callback) {
        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.onLocaleChange) {
            return window.T2I18N.onLocaleChange(callback);
        }
        return function() {}; // no-op
    },

    // 모달 생성 및 관리
    createModal: function(content, className = '') {
        // [SEC-XSS] className을 template literal에 삽입하기 전 알파벳·숫자·하이픈·언더스코어·공백만 허용.
        // 검증 없이 외부 값을 className에 넣으면 예상치 못한 클래스 주입이 가능.
        const safeClassName = className.replace(/[^a-zA-Z0-9_\- ]/g, '');
        const modal = document.createElement('div');
        modal.className = `t2-modal-overlay ${safeClassName}`;
        modal.innerHTML = content;
        
        // ESC 키로 모달 닫기
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        // 모달 외부 클릭으로 닫기
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        });
        
        document.body.appendChild(modal);

        // [I18N] body 직속 모달도 즉시 현재 언어로 동기화
        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.applyTranslations) {
            window.T2I18N.applyTranslations(modal);
        }
        return modal;
    },

    formatFileSize: function(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    getFileColor: function(type) {
        const colors = {
            'zip': '#E8B56F',
            'pdf': '#F44336',
            'txt': '#585858',
            'mp3': '#9C27B0',
            'm4a': '#2196F3'
        };
        return colors[type.toLowerCase()] || '#E8B56F';
    },

    sanitizeFileName: function(fileName) {
        return fileName.replace(/[\\/:*?"<>|]/g, '_');
    },

    setupDragAndDrop: function(element, onFiles) {
        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            element.classList.add('drag-over');
        });

        element.addEventListener('dragleave', (e) => {
            e.preventDefault();
            element.classList.remove('drag-over');
        });

        element.addEventListener('drop', (e) => {
            e.preventDefault();
            element.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                onFiles(Array.from(e.dataTransfer.files));
            }
        });
    },

    request: async function(url, options = {}) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                ...options
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('Request failed:', error);
            throw error;
        }
    },

    validateImage: function(file) {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        return allowedTypes.includes(file.type);
    },

    validateFile: function(file, allowedExtensions) {
        const fileExt = file.name.toLowerCase().split('.').pop();
        return allowedExtensions.includes(fileExt);
    },

    validateUrl: function(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    },

    // YouTube URL에서 비디오 ID 추출 (URL parser 기반)
    // [FIX] getVideoType()과 동일한 파싱 로직 재사용.
    getYouTubeVideoId: function(url) {
        const info = this.getVideoType(url);
        return (info && info.type === 'youtube') ? info.id : null;
    },

    // 비디오 타입 감지 (URL parser 기반)
    //
    // [FIX] 정규식 단순 패턴 매칭 → URL 객체 파싱으로 교체.
    // 지원 YouTube 형식:
    //   · youtube.com/watch?v=ID   · youtu.be/ID
    //   · youtube.com/embed/ID     · youtube.com/shorts/ID
    //   · youtube.com/live/ID      · youtube-nocookie.com/embed/ID
    //   · //www.youtube.com/...    (프로토콜 상대 URL 자동 보정)
    //   · www.youtube.com/...      (프로토콜 없는 URL 자동 보정)
    // 지원 직접 비디오:
    //   · window.T2EDITOR_UPLOAD_CONFIG.extensions.video 에 정의된 확장자
    //     (없으면 fallback: mp4/webm/ogg/mov/m4v/mkv/avi/wmv/flv)
    //   · URL path 기준 확장자 검사 → 쿼리스트링이 붙어 있어도 통과
    //   · HLS(.m3u8)는 링크 삽입만 지원하며 업로드 허용 목록과 별도로 감지
    //   · 상대 경로도 지원
    getVideoType: function(url) {
        if (!url || typeof url !== 'string') return null;

        // ── 1단계: URL 정규화 ────────────────────────────────────────────────
        let raw = url.trim();
        // 프로토콜 상대 URL (//...) 보정
        if (raw.startsWith('//')) {
            raw = 'https:' + raw;
        }
        // 프로토콜 없는 절대 도메인 (www.youtube.com/...) 보정
        else if (/^(?:www\.|m\.|youtube\.|youtu\.)/i.test(raw)) {
            raw = 'https://' + raw;
        }

        // ── 2단계: YouTube 패턴 판별 ─────────────────────────────────────────
        // [SEC-XSS] video ID는 영숫자·하이픈·언더스코어 11자로 엄격 검증.
        // getVideoIframeUrl()이 동일한 패턴으로 2차 검증하므로 여기서는
        // 파싱 오류 없이 추출하는 것에 집중한다.
        const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
        try {
            const u = new URL(raw);
            const host = u.hostname.toLowerCase().replace(/^m\./, '').replace(/^www\./, '');

            // youtu.be/ID
            if (host === 'youtu.be') {
                const id = u.pathname.replace(/^\//, '').split('/')[0].split('?')[0];
                if (YT_ID_RE.test(id)) return { type: 'youtube', id };
            }

            // youtube.com 및 youtube-nocookie.com 변형 처리
            if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
                // /embed/ID
                const embedMatch = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
                if (embedMatch) return { type: 'youtube', id: embedMatch[1] };

                // /shorts/ID
                const shortsMatch = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
                if (shortsMatch) return { type: 'youtube', id: shortsMatch[1] };

                // /live/ID
                const liveMatch = u.pathname.match(/\/live\/([a-zA-Z0-9_-]{11})/);
                if (liveMatch) return { type: 'youtube', id: liveMatch[1] };

                // /watch?v=ID  또는  /watch?…&v=ID
                const vParam = u.searchParams.get('v');
                if (vParam && YT_ID_RE.test(vParam)) return { type: 'youtube', id: vParam };

                // /v/ID (레거시)
                const vMatch = u.pathname.match(/\/v\/([a-zA-Z0-9_-]{11})/);
                if (vMatch) return { type: 'youtube', id: vMatch[1] };
            }
        } catch(_) {
            // URL 파싱 실패 → 직접 비디오 경로로 계속 진행
        }

        // ── 3단계: 직접 비디오 파일 판별 ─────────────────────────────────────
        // [UPLOAD-CONFIG] window.T2EDITOR_UPLOAD_CONFIG 에서 허용 확장자 가져오기.
        // 주입 실패 시 하드코딩 fallback 사용.
        const cfg = window.T2EDITOR_UPLOAD_CONFIG;
        const allowedExts = (cfg && Array.isArray(cfg.extensions && cfg.extensions.video) && cfg.extensions.video.length)
            ? cfg.extensions.video.map(e => String(e).toLowerCase())
            : ['mp4', 'webm', 'ogg', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv'];

        // URL path 기준 확장자 검사 (쿼리스트링·프래그먼트 무시)
        let pathPart;
        try {
            pathPart = new URL(raw).pathname;
        } catch(_) {
            // 상대 경로 등 파싱 불가 → 원본에서 쿼리/프래그먼트 제거
            pathPart = raw.split('?')[0].split('#')[0];
        }
        const ext = pathPart.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
        const isHlsManifest = ext === 'm3u8';
        if (isHlsManifest || (ext && allowedExts.includes(ext))) {
            // 정규화된 URL 반환 (프로토콜 보정이 적용된 raw 사용)
            return { type: 'video', url: raw };
        }

        return null;
    },

    validateHexColor: function(hex) {
        return /^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$/.test(hex);
    },

    expandHexColor: function(hex) {
        if (hex.length === 3) {
            return hex.split('').map(char => char + char).join('');
        }
        return hex;
    },

    isElementInViewport: function(el) {
        const rect = el.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    },

    debounce: function(func, wait, immediate) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                timeout = null;
                if (!immediate) func(...args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func(...args);
        };
    },

    throttle: function(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    deepClone: function(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this.deepClone(item));
        if (typeof obj === 'object') {
            const clonedObj = {};
            for (let key in obj) {
                if (obj.hasOwnProperty(key)) {
                    clonedObj[key] = this.deepClone(obj[key]);
                }
            }
            return clonedObj;
        }
    },

    generateRandomString: function(length = 10) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    },

    escapeHtml: function(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // ── [SEC-PLUGIN-UTILS] 플러그인 보안 헬퍼 ───────────────────────────────
    //
    // 플러그인이 user-controlled 값을 HTML 에 삽입하기 전 반드시 통과시켜야 하는
    // 최소 검증 함수들. core.js 의 sanitizePluginHTML() / setPluginHTML() 에서
    // 내부적으로 사용하며, 플러그인도 직접 호출할 수 있다.
    //
    // 사용 예:
    //   `<span>${T2Utils.escapeHtml(file.name)}</span>`
    //   `<a href="${T2Utils.sanitizeURL(url, 'href')}">`
    //   `<iframe src="${T2Utils.sanitizeURL(src, 'iframe-src')}">`
    // ─────────────────────────────────────────────────────────────────────────

    // URL 새니타이징 — 컨텍스트별 위험 프로토콜 차단
    //
    // context:
    //   'href'       → javascript:, vbscript:, data: 모두 차단
    //                  (data:text/html 클릭 시 스크립트 실행 가능)
    //   'src'        → javascript:, vbscript: 차단
    //                  (data: URI 는 img/audio 정상 사용 케이스 → 허용)
    //   'iframe-src' → src 규칙 + T2Editor 허용 도메인 allowlist 검증
    //
    // 반환: 안전한 URL 문자열, 위험하면 ''
    sanitizeURL: function(url, context) {
        if (!url || typeof url !== 'string') return '';
        context = context || 'href';

        // 공백·제어문자·zero-width 제거 후 소문자 비교 (인코딩 우회 방지)
        const normalized = url.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();

        // javascript:, vbscript: — 모든 컨텍스트에서 차단
        if (/^(javascript|vbscript):/.test(normalized)) return '';

        // href 컨텍스트: data: 도 차단
        if (context === 'href' && /^data:/.test(normalized)) return '';

        // iframe-src: T2Editor allowlist 검증
        // T2Editor 가 아직 정의되지 않은 경우 안전하게 차단
        if (context === 'iframe-src') {
            if (typeof T2Editor === 'undefined' || !T2Editor._isAllowedIframeSrc(url)) return '';
        }

        return url;
    },

    // HTML 속성 값 이스케이프 (속성 컨텍스트 특화)
    //
    // escapeHtml() 과의 차이:
    //   escapeHtml()  → textContent 기반, innerHTML 컨텍스트 (태그 내부 텍스트)
    //   escapeAttr()  → 단/쌍따옴표 포함 5자 모두 처리, 속성값 컨텍스트
    //
    // 사용 예:
    //   `<div class="${T2Utils.escapeAttr(userClass)}">`
    //   `<input value="${T2Utils.escapeAttr(userInput)}">`
    escapeAttr: function(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },

    unescapeHtml: function(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    },

    parseCSSUnit: function(value) {
        const match = value.match(/^(\d+(?:\.\d+)?)(px|em|rem|%|vh|vw)?$/);
        if (match) {
            return {
                value: parseFloat(match[1]),
                unit: match[2] || 'px'
            };
        }
        return null;
    },

    preloadImage: function(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    },

    downloadCanvasAsImage: function(canvas, filename, format = 'image/png', quality = 0.8) {
        const url = canvas.toDataURL(format, quality);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    downloadTextFile: function(content, filename, type = 'text/plain') {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },

    matchMedia: function(query) {
        return window.matchMedia(query).matches;
    },

    isTouchDevice: function() {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    },

    isMobile: function() {
        return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    },

    getComputedStyle: function(element, property) {
        return window.getComputedStyle(element).getPropertyValue(property);
    },

    toggleClass: function(element, className, force) {
        if (force !== undefined) {
            element.classList.toggle(className, force);
        } else {
            element.classList.toggle(className);
        }
    },

    waitForAnimation: function(element, animationName) {
        return new Promise(resolve => {
            const handler = (e) => {
                if (e.animationName === animationName) {
                    element.removeEventListener('animationend', handler);
                    resolve();
                }
            };
            element.addEventListener('animationend', handler);
        });
    },

    waitForTransition: function(element, property) {
        return new Promise(resolve => {
            const handler = (e) => {
                if (!property || e.propertyName === property) {
                    element.removeEventListener('transitionend', handler);
                    resolve();
                }
            };
            element.addEventListener('transitionend', handler);
        });
    },

    safeJsonParse: function(str, fallback = null) {
        try {
            return JSON.parse(str);
        } catch {
            return fallback;
        }
    },

    storage: {
        get: function(key, fallback = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : fallback;
            } catch {
                return fallback;
            }
        },
        
        set: function(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch {
                return false;
            }
        },
        
        remove: function(key) {
            try {
                localStorage.removeItem(key);
                return true;
            } catch {
                return false;
            }
        }
    },

    handleError: function(error, context = '') {
        console.error(`T2Editor Error ${context}:`, error);
        
        // 사용자에게 표시할 에러 메시지
        const userMessage = this.getUserFriendlyError(error);
        
        // 에러 알림 표시 (필요시)
        if (userMessage) {
            this.showNotification(userMessage, 'error');
        }
    },

    getUserFriendlyError: function(error) {
        // [I18N] 에러 메시지 다국어 처리 (T2Utils.t 위임)
        // T2I18N 이 로드되어 있고 error.* 키가 정의되어 있으면 번역된 메시지 반환
        // T2I18N 미로드 시 한국어 폴백 (서드파티 호환성)
        const errorMap = {
            'NetworkError': 'error.network',
            'TypeError': 'error.unexpected',
            'ReferenceError': 'error.feature_unavailable',
            'SyntaxError': 'error.data_format'
        };
        const errorType = error.constructor.name;
        const key = errorMap[errorType] || 'error.generic';

        // T2I18N 이 로드되어 있으면 t() 위임 (humanizeKey 폴백 포함)
        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.t) {
            return window.T2I18N.t(key);
        }
        // T2I18N 미로드 시 한국어 폴백
        const koFallback = {
            'error.network': '네트워크 연결을 확인해주세요.',
            'error.unexpected': '예기치 않은 오류가 발생했습니다.',
            'error.feature_unavailable': '일부 기능을 사용할 수 없습니다.',
            'error.data_format': '데이터 형식에 오류가 있습니다.',
            'error.generic': '오류가 발생했습니다. 다시 시도해주세요.'
        };
        return koFallback[key] || '오류가 발생했습니다. 다시 시도해주세요.';
    },

    showNotification: function(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `t2-notification t2-notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            color: white;
            font-size: 14px;
            z-index: 10000;
            transform: translateX(100%);
            transition: transform 0.3s ease;
        `;
        
        // 타입별 배경색
        const colors = {
            info: '#2196F3',
            success: '#4CAF50',
            warning: '#FF9800',
            error: '#F44336'
        };
        notification.style.backgroundColor = colors[type] || colors.info;
        
        document.body.appendChild(notification);
        
        // 애니메이션으로 표시
        requestAnimationFrame(() => {
            notification.style.transform = 'translateX(0)';
        });
        
        // 자동 제거
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, duration);
    },

    // ════════════════════════════════════════════════════════════════════
    // [RHYMIX] 업로드 브릿지 필드 주입
    // ───────────────────────────────────────────────────────────────────
    // editor.lib.php 가 Rhymix 어댑터를 통해 렌더링되면 window.T2EDITOR_RHYMIX_*
    // 전역이 존재한다. plugin/image/image.js, plugin/file/file.js, plugin/draw/draw.js,
    // plugin/video/video.js 는 image_upload.php·file_upload.php 로 업로드를
    // 보내기 직전에 이 함수를 한 줄 호출하기만 하면 된다.
    //
    // 이 전역이 없으면(=독립형/그누보드5 실행) 아무 것도 하지 않고 그대로
    // 반환한다 — 기존 동작에 영향 없음.
    //
    // 실제 Rhymix 전용 분기 로직(요청을 Rhymix 파일 모듈로 위임하고 응답을
    // 변환하는 부분)은 전부 image_upload.php / file_upload.php 안에 있다
    // (config/upload_config.php 의 t2editor_rhymix_proxy_upload 참고).
    //
    // @param {FormData} formData
    // @returns {boolean} Rhymix 필드를 추가했으면 true
    // ════════════════════════════════════════════════════════════════════
    _getRhymixConfig(editor) {
        const container = editor && editor.container
            ? editor.container.closest('.rx_t2editor')
            : null;
        if (container) {
            try {
                const config = JSON.parse(container.getAttribute('data-editor-config') || '{}');
                config.__container = container;
                return config;
            } catch (e) {
                console.error('[T2Editor/Rhymix] Invalid per-instance upload config.', e);
            }
        }
        // Backward compatibility for older single-editor adapters.
        return {
            editorSequence: window.T2EDITOR_RHYMIX_EDITOR_SEQUENCE || '',
            uploadTargetSrl: window.T2EDITOR_RHYMIX_UPLOAD_TARGET_SRL || '',
            moduleSrl: window.T2EDITOR_RHYMIX_MODULE_SRL || '',
            mid: window.T2EDITOR_RHYMIX_MID || '',
            csrfToken: window.T2EDITOR_RHYMIX_CSRF_TOKEN || ''
        };
    },

    appendRhymixUploadFields(formData, editor) {
        const config = this._getRhymixConfig(editor);
        const seq = config.editorSequence;
        if (!seq) return false;

        // Rhymix's native uploader accepts Filedata and act=procFileUpload.
        // Reuse the same File object without sending it twice under bf_file.
        const file = formData.get('Filedata') || formData.get('bf_file') || formData.get('bf_file[]');
        if (file) {
            formData.delete('bf_file');
            formData.delete('bf_file[]');
            if (!formData.has('Filedata')) formData.append('Filedata', file);
        }
        formData.set('act', 'procFileUpload');
        formData.set('editor_sequence', seq);
        if (config.uploadTargetSrl) formData.set('uploadTargetSrl', config.uploadTargetSrl);
        if (config.moduleSrl)       formData.set('module_srl', config.moduleSrl);
        if (config.mid)             formData.set('mid', config.mid);
        if (config.csrfToken)       formData.set('_rx_csrf_token', config.csrfToken);
        return true;
    },

    getRhymixUploadUrl(editor) {
        const config = this._getRhymixConfig(editor);
        if (!config.editorSequence) return '';
        // This is the same endpoint used by Rhymix's bundled CKEditor uploader.
        return window.request_uri || window.location.pathname || '/';
    },

    // Rhymix's FileModel::getDownloadUrl() returns an HTML-attribute-safe URL
    // such as "index.php?module=file&amp;act=procFileDownload&amp;...".
    // The native attachment inserter places this value in HTML, where the browser
    // automatically decodes &amp;. T2Editor consumes the JSON response as a URL
    // string instead, so it must decode ampersand entities explicitly first.
    // Decode ampersands only; the normal plugin URL sanitizer still runs after
    // this normalization and remains the security boundary.
    _normalizeRhymixUrl(value) {
        return String(value || '').replace(/&(?:amp|#0*38|#x0*26);/gi, '&');
    },

    normalizeRhymixUploadResponse(data, kind) {
        if (!data || typeof data.error === 'undefined') return data;
        const success = Number(data.error) === 0;
        const info = {
            file_srl: Number(data.file_srl || 0),
            upload_target_srl: Number(data.upload_target_srl || 0),
            source_filename: String(data.source_filename || ''),
            uploaded_filename: String(data.uploaded_filename || ''),
            download_url: this._normalizeRhymixUrl(data.download_url),
            mime_type: String(data.mime_type || ''),
            direct_download: String(data.direct_download || ''),
            error: Number(data.error || 0)
        };
        if (kind === 'image') {
            return {
                success: success,
                message: data.message || '',
                files: success ? [{
                    url: info.download_url,
                    width: Number(data.width || 0),
                    height: Number(data.height || 0)
                }] : [],
                failures: [],
                rhymix: info
            };
        }
        return {
            success: success,
            message: data.message || '',
            file: success ? {
                url: info.download_url,
                original_name: info.source_filename || 'file',
                size: Number(data.file_size || 0),
                type: (info.source_filename.split('.').pop() || '').toLowerCase()
            } : null,
            rhymix: info
        };
    },

    applyRhymixUploadResult(data, editor) {
        const info = data && data.rhymix;
        if (!info || !info.upload_target_srl) return false;
        const config = this._getRhymixConfig(editor);
        config.uploadTargetSrl = String(info.upload_target_srl);

        if (config.__container) {
            const container = config.__container;
            delete config.__container;
            container.setAttribute('data-editor-config', JSON.stringify(config));
            const form = container.closest('form');
            if (form && config.primaryKeyName) {
                const primary = form.elements && form.elements.namedItem(config.primaryKeyName);
                if (primary && typeof primary.value !== 'undefined' && !primary.value) {
                    primary.value = String(info.upload_target_srl);
                }
            }
        }
        window.T2EDITOR_RHYMIX_UPLOAD_TARGET_SRL = String(info.upload_target_srl);
        if (config.editorSequence && window.jQuery) {
            const nativeUploader = window.jQuery('#xefu-container-' + config.editorSequence);
            if (nativeUploader.length) nativeUploader.data('uploadTargetSrl', String(info.upload_target_srl));
        }
        if (config.editorSequence && typeof window.reloadUploader === 'function') {
            window.reloadUploader(config.editorSequence);
        }
        return true;
    },

    // ════════════════════════════════════════════════════════════════════
    // [WORDPRESS] 업로드 브릿지 필드 주입
    // ───────────────────────────────────────────────────────────────────
    // t2editor/wordpress/t2editor-bridge.php 가 활성화되어 있으면
    // window.T2EDITOR_WP_NONCE 가 존재한다. appendRhymixUploadFields 와
    // 동일한 방식으로, 없으면 아무 것도 하지 않는 no-op.
    //
    // 실제 워드프레스 위임 로직(media_handle_upload() 직접 호출, 응답
    // 변환)은 전부 image_upload.php / file_upload.php 안에 있다
    // (config/upload_config.php 의 t2editor_wp_handle_upload 참고).
    // ════════════════════════════════════════════════════════════════════
    appendWordPressUploadFields(formData) {
        const nonce = window.T2EDITOR_WP_NONCE;
        if (!nonce) return false;

        formData.append('_wpnonce', nonce);
        formData.append('action', 'upload-attachment'); // 워드프레스 코어 관례상 참고용 (T2 엔드포인트 자체 라우팅에는 미사용)
        if (window.T2EDITOR_WP_POST_ID) formData.append('post_id', window.T2EDITOR_WP_POST_ID);
        return true;
    }
};