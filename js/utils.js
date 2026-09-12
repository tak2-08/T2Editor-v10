// Path: T2Editor/js/utils.js
// Developer note: 공개 메서드·이벤트·command 이름은 플러그인 호환 API이므로 변경 시 별칭을 남긴다.

window.T2Utils = {

    // I18N helpers delegate to T2I18N when available and preserve key/fallback behavior for third-party plugins.
     /** Translate a key with ICU variables; return the key when T2I18N is unavailable. */
    t: function(key, vars) {
        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.t) {
            return window.T2I18N.t(key, vars);
        }
        // T2I18N 미로드 시 폴백 — 키 그대로 반환 (서드파티 플러그인 호환성 보장)
        return key;
    },

     /** Translate when the key exists; otherwise return the caller-provided fallback. */
    tf: function(key, vars, fallback) {
        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.t) {
            // humanizeKey 변환을 직접 수행하여 정확히 비교.
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

     /** Register a locale-change callback and return its unsubscribe function. */
    onLocaleChange: function(callback) {
        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.onLocaleChange) {
            return window.T2I18N.onLocaleChange(callback);
        }
        return function() {}; // no-op
    },

    // 모달 생성 및 관리
    createModal: function(content, className = '') {
        const safeClassName = String(className).replace(/[^a-zA-Z0-9_\- ]/g, '');
        const modal = document.createElement('div');
        modal.className = `t2-modal-overlay ${safeClassName}`;
        modal.setAttribute('role', 'presentation');
        modal.innerHTML = content;

        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const dialog = modal.firstElementChild || modal;
        if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('tabindex', '-1');

        if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
            const heading = dialog.querySelector('h1, h2, h3, [data-modal-title]');
            if (heading) {
                if (!heading.id) heading.id = `t2-modal-title-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                dialog.setAttribute('aria-labelledby', heading.id);
            }
        }

        let closed = false;
        const focusableSelector = [
            'button:not([disabled])',
            '[href]',
            'input:not([disabled]):not([type="hidden"])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(',');

        const isTopmost = () => {
            const modals = document.querySelectorAll('.t2-modal-overlay');
            return modals.length > 0 && modals[modals.length - 1] === modal;
        };

        const cleanup = () => {
            document.removeEventListener('keydown', keyHandler, true);
        };

        const nativeRemove = modal.remove.bind(modal);
        const close = () => {
            if (closed) return;
            closed = true;
            cleanup();
            nativeRemove();
            if (previousFocus && document.contains(previousFocus)) {
                try { previousFocus.focus({ preventScroll: true }); }
                catch (error) { previousFocus.focus(); }
            }
        };
        modal.remove = close;
        modal.t2Close = close;

        const keyHandler = (event) => {
            if (!isTopmost()) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = Array.from(dialog.querySelectorAll(focusableSelector))
                .filter(element => element.offsetParent !== null && element.getAttribute('aria-hidden') !== 'true');
            if (!focusable.length) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', keyHandler, true);

        modal.addEventListener('click', (event) => {
            if (event.target === modal && isTopmost()) close();
        });

        document.body.appendChild(modal);

        if (typeof window.T2I18N !== 'undefined' && window.T2I18N.applyTranslations) {
            window.T2I18N.applyTranslations(modal);
        }

        requestAnimationFrame(() => {
            if (closed || !document.contains(modal)) return;
            const initial = dialog.querySelector('[autofocus], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href]');
            (initial || dialog).focus();
        });
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
    // getVideoType()과 동일한 파싱 로직 재사용.
    getYouTubeVideoId: function(url) {
        const info = this.getVideoType(url);
        return (info && info.type === 'youtube') ? info.id : null;
    },

    // Detect supported YouTube forms and direct-video/HLS URLs with URL parsing rather than query-fragile regexes.
    // Direct extensions come from T2EDITOR_UPLOAD_CONFIG with a compatibility fallback.
    getVideoType: function(url) {
        if (!url || typeof url !== 'string') return null;

        // 1단계: URL 정규화
        let raw = url.trim();
        // 프로토콜 상대 URL (//...) 보정
        if (raw.startsWith('//')) {
            raw = 'https:' + raw;
        }
        // 프로토콜 없는 절대 도메인 (www.youtube.com/...) 보정
        else if (/^(?:www\.|m\.|youtube\.|youtu\.)/i.test(raw)) {
            raw = 'https://' + raw;
        }

        // 2단계: YouTube 패턴 판별
        // Security: video ID는 영숫자·하이픈·언더스코어 11자로 엄격 검증.
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

        // 3단계: 직접 비디오 파일 판별
        // window.T2EDITOR_UPLOAD_CONFIG 에서 허용 확장자 가져오기.
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

    // Security helpers for user-controlled plugin text, attributes and URLs.
    // Use escapeHtml for text, escapeAttr for attributes and sanitizeURL for navigation/media contexts.

    // sanitizeURL blocks script protocols everywhere, data: in href, and non-allowlisted iframe origins.
    // src keeps safe data media cases. An unsafe value returns an empty string.
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

    // escapeAttr handles quote-sensitive attribute context; escapeHtml is for element text only.
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
        // I18N: 에러 메시지 다국어 처리 (T2Utils.t 위임)
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

    // Host integrations register browser capabilities in integration/cms/browser.js.
    _hostAdapters() {
        return window.T2EditorHostAdapters || null;
    },

    appendHostUploadFields(formData, editor) {
        const adapters = this._hostAdapters();
        if (!adapters || typeof adapters.callFirst !== 'function') return false;
        return !!adapters.callFirst('appendUploadFields', [formData, editor], false);
    },

    getHostUploadUrl(editor) {
        const adapters = this._hostAdapters();
        if (!adapters || typeof adapters.callFirst !== 'function') return '';
        return adapters.callFirst('uploadUrl', [editor], '');
    },

    normalizeHostUrl(value, editor) {
        const adapters = this._hostAdapters();
        if (!adapters || typeof adapters.callAll !== 'function') return String(value || '');
        return adapters.callAll('normalizeUrl', [value, editor], String(value || ''));
    },

    normalizeHostUploadResponse(data, kind, editor) {
        const adapters = this._hostAdapters();
        if (!adapters || typeof adapters.callFirst !== 'function') return data;
        return adapters.callFirst('normalizeUploadResponse', [data, kind, editor], data);
    },

    applyHostUploadResult(data, editor) {
        const adapters = this._hostAdapters();
        if (!adapters || typeof adapters.callFirst !== 'function') return false;
        return !!adapters.callFirst('applyUploadResult', [data, editor], false);
    }
};

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
