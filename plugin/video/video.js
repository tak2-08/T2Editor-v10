// T2Editor/plugin/video/video.js

class T2VideoPlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertYouTube'];

        // 업로드 설정: window.T2EDITOR_UPLOAD_CONFIG(동기) 우선 사용, 없으면
        // get_upload_config.php로 비동기 보완 로드(video.js/file.js 공용 엔드포인트).
        this._configReady = false;   // _loadConfig() 완료 여부
        this._configPromise = null;  // 진행 중인 로드 Promise (중복 호출 방지)

        this._applyWindowConfig();   // 1단계: window 변수 동기 적용
        this._loadConfig();          // 2단계: 필요 시 비동기 보완 (fire-and-forget)
    }

    // core.js/utils.js 공통 보안 경계 래퍼
    _escapeHtml(value) {
        return (typeof T2Utils !== 'undefined' && T2Utils.escapeHtml)
            ? T2Utils.escapeHtml(String(value ?? ''))
            : String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    }

    _escapeAttr(value) {
        return (typeof T2Utils !== 'undefined' && T2Utils.escapeAttr)
            ? T2Utils.escapeAttr(value)
            : String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#x27;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
    }

    _sanitizeURL(url, context = 'href') {
        if (typeof T2Utils !== 'undefined' && T2Utils.sanitizeURL) {
            return T2Utils.sanitizeURL(String(url || ''), context);
        }

        const value = String(url || '');
        const normalized = value.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript):/.test(normalized)) return '';
        if (context === 'href' && /^data:/.test(normalized)) return '';
        return value;
    }

    // [FIX-RHYMIX-VIDEO-UNAVAILABLE] 라이믹스(Rhymix) 브릿지 업로드 후 서버가
    // 돌려주는 download_url 을 video_player.php/video_view.php 에서 안전하게
    // 재생 가능한 형태로 보정한다.
    //
    // 문제 배경:
    //   라이믹스 파일모듈 설정에서 "멀티미디어 파일 직접 접근 허용"이 꺼져
    //   있거나(관리자 > 파일첨부 모듈 > 다운로드 설정) 다운로드 짧은 URL을
    //   쓰지 않는 설치는, 업로드 응답의 download_url이 실제 파일이 아니라
    //   컨트롤러 액션 URL로 내려온다:
    //     index.php?module=file&act=procFileDownload&file_srl=123&sid=abcdef
    //   이 URL은
    //     1) 사이트 루트 기준 상대경로인데, video_player.php는 하위 폴더
    //        (plugin/video/)에 있어 그대로 쓰면 브라우저가 엉뚱한 위치로
    //        풀어버리고(상대경로 깨짐),
    //     2) URL 경로에 .mp4 같은 확장자가 전혀 없어 video_player.php의
    //        포맷 화이트리스트 검사를 통과하지 못한다("Unsupported video
    //        format." 오류의 직접 원인).
    //   반면 "파일 첨부 → 본문에 추가"는 이 커스텀 플레이어를 거치지 않는
    //   라이믹스 자체 렌더링 경로를 쓰기 때문에 같은 URL이라도 문제없이
    //   재생된다.
    //
    // 해결:
    //   1) 항상 현재 페이지(window.location.href) 기준 절대 URL로 변환한다.
    //   2) URL 경로에서 알려진 비디오 확장자를 찾지 못하면, 업로드 당시의
    //      원본 파일명에서 뽑은 실제 확장자를 t2ext 쿼리파라미터로 실어
    //      보낸다. video_player.php/video_view.php는 경로에서 확장자를
    //      못 찾을 때 이 힌트를 폴백으로 사용하도록 패치되어 있다.
    //
    // @param {string} rawUrl   서버가 반환한 (상대일 수 있는) 비디오 URL
    // @param {string} filename 업로드한 원본 파일명 (확장자 추출용)
    // @returns {string} 절대 URL (+필요 시 t2ext 힌트 포함)
    _resolveRhymixVideoUrl(rawUrl, filename) {
        if (!rawUrl) return rawUrl;

        // Defensive fallback for integrations that call this method without
        // passing through T2Utils.normalizeRhymixUploadResponse(). Decoding an
        // ampersand entity restores query separators used by Rhymix download URLs.
        const normalizedRawUrl = (typeof T2Utils !== 'undefined' && T2Utils._normalizeRhymixUrl)
            ? T2Utils._normalizeRhymixUrl(rawUrl)
            : String(rawUrl).replace(/&(?:amp|#0*38|#x0*26);/gi, '&');

        let absoluteUrl;
        try {
            // Rhymix may return a relative URL such as
            // "index.php?module=file&act=procFileDownload...". Resolving this
            // against the current rewritten board URL can incorrectly produce
            // /board/index.php. request_uri/default_url always points to the
            // Rhymix installation root and matches the native uploader logic.
            const rhymixBase = (typeof window.request_uri === 'string' && window.request_uri)
                || (typeof window.default_url === 'string' && window.default_url)
                || window.location.href;
            absoluteUrl = new URL(normalizedRawUrl, rhymixBase).href;
        } catch (e) {
            // 절대/상대 URL로 파싱 불가한 값(이미 sanitize 단계에서 걸러졌어야
            // 하지만 방어적으로) → 원본 그대로 반환.
            return normalizedRawUrl;
        }

        try {
            const u = new URL(absoluteUrl);
            const knownVideoExts = ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'm4v', 'm3u8'];
            const pathExt = (u.pathname.split('.').pop() || '').toLowerCase();
            if (!knownVideoExts.includes(pathExt) && filename) {
                const realExt = String(filename).split('.').pop().toLowerCase();
                if (realExt && /^[a-z0-9]+$/i.test(realExt)) {
                    u.searchParams.set('t2ext', realExt);
                    return u.toString();
                }
            }
            return absoluteUrl;
        } catch (e) {
            return absoluteUrl;
        }
    }

    _sanitizeYouTubeId(id) {
        const value = String(id || '').trim();
        return /^[a-zA-Z0-9_-]{11}$/.test(value) ? value : '';
    }

    _sanitizeVideoURL(url) {
        const safe = this._sanitizeURL(url, 'href');
        if (!safe) return '';

        const value = String(safe).trim();
        const normalized = value.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^data:/.test(normalized)) return '';
        if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) && !/^https?:/i.test(normalized) && !/^blob:/i.test(normalized)) {
            return '';
        }

        return value;
    }

    _sanitizeVideoInfo(videoInfo) {
        if (!videoInfo || typeof videoInfo !== 'object') return null;

        if (videoInfo.type === 'youtube') {
            const safeId = this._sanitizeYouTubeId(videoInfo.id);
            return safeId ? { type: 'youtube', id: safeId } : null;
        }

        if (videoInfo.type === 'video') {
            const safeUrl = this._sanitizeVideoURL(videoInfo.url);
            return safeUrl ? { type: 'video', url: safeUrl } : null;
        }

        return null;
    }

    _isCustomVideoPlayerEnabled() {
        return window.T2EDITOR_VIDEO_PLAYER_ENABLED !== false;
    }

    _isHlsVideoURL(url) {
        const clean = String(url || '').split('?')[0].split('#')[0].toLowerCase();
        return clean.endsWith('.m3u8');
    }

    _isT2VideoFrameURL(src) {
        return /video_(?:view|player)\.php/i.test(String(src || ''));
    }

    // .t2-video-source 앵커 스타일 관리. position/opacity 대신 font-size:0 등
    // 흔히 허용되는 속성으로 숨겨, 필터에 잘려도 "동영상 보기" 링크는 남게 한다.
    _styleFallbackAnchor(anchor, videoType) {
        anchor.style.cssText =
            'display:inline-block;font-size:0;line-height:0;color:transparent;' +
            'text-decoration:none;max-width:100%;overflow:hidden;';
        anchor.textContent = videoType === 'youtube'
            ? T2Utils.tf('video.fallback_link_youtube', {}, '유튜브 영상 보기')
            : T2Utils.tf('video.fallback_link_video', {}, '동영상 보기');
        return anchor;
    }

    _toBoundedInt(value, fallback, min = 1, max = 10000) {
        const num = Number.parseInt(value, 10);
        if (!Number.isFinite(num)) return fallback;
        return Math.min(max, Math.max(min, num));
    }

    // 비디오의 크기 기준은 에디터 전체가 아니라 사용자가 보는 옅은 테두리의
    // .t2-video-block 내부(content box)다. 블록이 아직 DOM에 붙기 전에는
    // 에디터 content box와 블록 기본 padding/border를 이용해 같은 값을 추정한다.
    _getVideoBlockContentWidth(container = null, fallback = 560) {
        const block = container && typeof container.closest === 'function'
            ? container.closest('.t2-video-block, .t2-media-block')
            : null;

        if (block && block.clientWidth > 0) {
            let width = block.clientWidth;
            try {
                const style = window.getComputedStyle(block);
                width -= (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
            } catch (_) { /* 계산 스타일를 읽을 수 없으면 clientWidth 사용 */ }
            if (width > 0) return this._toBoundedInt(Math.floor(width), fallback, 1, 10000);
        }

        const editor = this.editor && this.editor.editor;
        let editorContentWidth = editor && editor.clientWidth ? editor.clientWidth : fallback;
        if (editor && editor.clientWidth) {
            try {
                const editorStyle = window.getComputedStyle(editor);
                editorContentWidth -= (parseFloat(editorStyle.paddingLeft) || 0)
                    + (parseFloat(editorStyle.paddingRight) || 0);
            } catch (_) { /* fallback 유지 */ }
        }

        // core.css 기본값: wrapper padding 10px × 2 + border 1px × 2.
        const estimatedBlockChrome = 22;
        return this._toBoundedInt(Math.floor(editorContentWidth - estimatedBlockChrome), fallback, 1, 10000);
    }

    _getVideoMaxWidth(container = null, fallback = 560) {
        return Math.max(1, Math.floor(this._getVideoBlockContentWidth(container, fallback) * 0.95));
    }

    _sanitizePluginHTML(html) {
        return (this.editor && typeof this.editor.sanitizePluginHTML === 'function')
            ? this.editor.sanitizePluginHTML(html, 'video')
            : html;
    }

    _setPluginHTML(target, html, debugLabel = 'video') {
        if (this.editor && typeof this.editor.setPluginHTML === 'function') {
            this.editor.setPluginHTML(target, html, { plugin: 'video', debugLabel });
        } else {
            target.innerHTML = this._sanitizePluginHTML(html);
        }
    }

    _setTrustedStaticHTML(target, html) {
        target.innerHTML = this._sanitizePluginHTML(html);
    }

    _normalizeConfig(data = {}) {
        data = data && typeof data === 'object' ? data : {};
        const fallbackExts = ['mp4', 'webm', 'ogg'];
        const exts = data.extensions || {};
        const accept = data.accept || {};

        const allowedVideoTypes = Array.from(new Set(
            (Array.isArray(exts.video) && exts.video.length ? exts.video : fallbackExts)
                .map(ext => String(ext).toLowerCase().replace(/^\./, '').trim())
                .filter(ext => /^[a-z0-9]{1,10}$/.test(ext))
        ));
        const safeVideoExts = allowedVideoTypes.length ? allowedVideoTypes : fallbackExts;

        const videoAccept = String(accept.video || safeVideoExts.map(ext => `.${ext}`).join(','))
            .split(',')
            .map(v => v.trim())
            .filter(v => /^\.[a-z0-9]{1,10}$/i.test(v) || /^video\/[a-z0-9.+-]+$/i.test(v))
            .join(',') || safeVideoExts.map(ext => `.${ext}`).join(',');

        const safeMimeMap = {};
        const rawMimeMap = data.mimeMap && typeof data.mimeMap === 'object' ? data.mimeMap : {};
        safeVideoExts.forEach(ext => {
            const mapped = String(rawMimeMap[ext] || '').toLowerCase();
            safeMimeMap[ext] = /^video\/[a-z0-9.+-]+$/i.test(mapped) ? mapped : (
                ext === 'webm' ? 'video/webm' :
                ext === 'ogg' || ext === 'ogv' ? 'video/ogg' :
                'video/mp4'
            );
        });

        return {
            allowedVideoTypes: safeVideoExts,
            videoAccept,
            videoMimeMap: safeMimeMap,
            maxUploadSizeMB: this._toBoundedInt(data.maxSizeMB, 50, 1, 1024)
        };
    }

    _insertBlockAtSavedRange(savedRange, videoBlock) {
        if (!videoBlock) return false;
        if (typeof this.editor.insertBlockWithBoundaryLines === 'function') {
            return this.editor.insertBlockWithBoundaryLines(videoBlock, savedRange || null);
        }
        this.editor.editor.appendChild(videoBlock);
        this.editor.normalizeContent();
        return true;
    }

    /**
     * window.T2EDITOR_UPLOAD_CONFIG 에서 설정을 읽어 this 에 적용한다.
     * 객체가 없거나 필수 키가 빠진 경우 fallback 값을 설정하고 false 를 반환한다.
     * @returns {boolean} true = 정상 주입됨
     */
    _applyWindowConfig() {
        const cfg = window.T2EDITOR_UPLOAD_CONFIG;
        if (!cfg) {
            const normalized = this._normalizeConfig(null);
            this.allowedVideoTypes = normalized.allowedVideoTypes;
            this.videoAccept = normalized.videoAccept;
            this.videoMimeMap = normalized.videoMimeMap;
            this.maxUploadSizeMB = normalized.maxUploadSizeMB;
            return false;
        }

        const normalized = this._normalizeConfig(cfg);
        this.allowedVideoTypes = normalized.allowedVideoTypes;
        this.videoAccept = normalized.videoAccept;
        this.videoMimeMap = normalized.videoMimeMap;
        this.maxUploadSizeMB = normalized.maxUploadSizeMB;

        this._configReady = true;
        return true;
    }

    /**
     * window 변수가 없을 때 get_upload_config.php 에서 설정을 가져온다.
     * video_config.php · file_config.php 같은 플러그인별 엔드포인트 없이
     * 보안 검증(check_request_origin)이 이미 적용된 공통 엔드포인트를 재사용한다.
     * @returns {Promise<void>}
     */
    _loadConfig() {
        if (this._configReady) return Promise.resolve();
        if (this._configPromise) return this._configPromise;

        this._configPromise = (async () => {
            try {
                console.warn(T2Utils.tf('video.config_not_injected_console', {}, '[T2Video] window.T2EDITOR_UPLOAD_CONFIG not injected.') +
                    '' +
                    '');

                const res = await fetch(
                    `${t2editor_url}/config/get_upload_config.php`,
                    { method: 'GET', credentials: 'same-origin' }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                this._applyServerConfig(await res.json());
                this._configReady = true;
                console.info(T2Utils.tf('video.config_loaded_console', {}, '[T2Video] Configuration loaded from get_upload_config.php.'));

            } catch (err) {
                console.error(T2Utils.tf('video.config_load_failed_console', {}, '[T2Video] Config load failed. Keeping fallback values.'), err);
            }
        })();

        return this._configPromise;
    }

    /**
     * get_upload_config.php 응답(= get_js_config() 구조)을 this 에 적용한다.
     * _applyWindowConfig 와 동일한 키를 사용해 일관성을 보장한다.
     */
    _applyServerConfig(data) {
        const normalized = this._normalizeConfig(data);
        this.allowedVideoTypes = normalized.allowedVideoTypes;
        this.videoAccept = normalized.videoAccept;
        this.videoMimeMap = normalized.videoMimeMap;
        this.maxUploadSizeMB = normalized.maxUploadSizeMB;
    }

    handleCommand(command, button) {
        switch(command) {
            case 'insertYouTube':
                this.insertVideo();
                break;
        }
    }

    onContentSet(html) {
        setTimeout(() => {
            this.initializeVideoBlocks();
        }, 50);
    }

    insertVideo() {
        const selection = window.getSelection();
        let savedRange = null;

        if (selection && selection.rangeCount > 0) {
            savedRange = selection.getRangeAt(0).cloneRange();
        } else if (this.editor && this.editor.editor) {
            savedRange = document.createRange();
            savedRange.selectNodeContents(this.editor.editor);
            savedRange.collapse(false);
        }

        // [UPLOAD-CONFIG] 설정이 아직 로드 중(window 변수 미주입 → API 호출 진행 중)이면
        // 완료를 기다렸다가 모달을 연다. 이미 완료된 경우 즉시 실행.
        this._loadConfig().then(() => this._openInsertVideoModal(savedRange));
    }

    _openInsertVideoModal(savedRange) {
        // this.allowedVideoTypes : upload_config.php 에서 주입된 확장자 배열
        // this.videoAccept       : <input accept> 속성값
        // 표시용 대문자 목록 (예: "MP4, WebM, Ogg, MOV, ...")
        const extDisplayList = this.allowedVideoTypes.map(e => e.toUpperCase()).join(', ');
        // URL 안내 문자열용 소문자 점 포함 목록 (예: ".mp4, .webm, .ogg, ...")
        const extDotList = this.allowedVideoTypes.map(e => '.' + e).join(', ');
        // [SEC-XSS] 위 두 값은 allowedVideoTypes(서버 주입 영숫자)에서만 생성되므로
        // HTML 삽입 시 별도 이스케이프 불필요. 단, escapeHtml 통과로 방어적 처리.
        const safeExtDisplay = this._escapeHtml(extDisplayList);
        const safeExtDotList = this._escapeHtml(extDotList);
        // accept 속성값: setAttribute 로 설정하므로 template literal 에서 제외
        const safeAccept = this._escapeAttr(this.videoAccept);
        // 최대 크기 — 정수이므로 별도 이스케이프 불필요 (Number() 로 타입 보장)
        const maxSizeMB = Number(this.maxUploadSizeMB) || 50;

        const modalContent = `
            <div class="t2-video-editor-modal">
                <h3 data-i18n="video.modal_title">${T2Utils.t('video.modal_title')}</h3>
                <div class="t2-video-tabs">
                    <button class="t2-tab active" data-tab="url" data-i18n="video.tab_video_url">${T2Utils.t('video.tab_video_url')}</button>
                    <button class="t2-tab" data-tab="upload" data-i18n="video.tab_file_upload">${T2Utils.t('video.tab_file_upload')}</button>
                </div>
                <div class="t2-tab-content">
                    <div class="t2-tab-pane active" data-pane="url">
                        <input type="text" placeholder="${T2Utils.t('video.video_url_placeholder')}" class="t2-youtube-url" data-i18n-placeholder="video.video_url_placeholder">
                        <div class="t2-video-type-info" data-i18n="video.video_type_info" data-i18n-vars='${JSON.stringify({exts: safeExtDotList}).replace(/'/g, "&#39;")}'>
                            ${T2Utils.t('video.video_type_info', {exts: safeExtDotList})}
                        </div>
                    </div>
                    <div class="t2-tab-pane" data-pane="upload">
                        <div class="t2-video-upload-area">
                            <span class="material-icons">cloud_upload</span>
                            <div class="t2-video-upload-text" data-i18n="video.click_select_video">${T2Utils.t('video.click_select_video')}</div>
                            <div class="t2-video-upload-hint" data-i18n="video.support_format_hint" data-i18n-vars='${JSON.stringify({exts: safeExtDisplay, max: maxSizeMB}).replace(/'/g, "&#39;")}'>${T2Utils.t('video.support_format_hint', {exts: safeExtDisplay, max: maxSizeMB})}</div>
                            <input type="file" accept="${safeAccept}" />
                        </div>
                        <div class="t2-video-preview-container"></div>
                        <div class="t2-upload-progress" style="display: none;">
                            <div class="t2-progress-bar">
                                <div class="t2-progress-fill"></div>
                            </div>
                            <div class="t2-progress-text" data-i18n="video.video_uploading">${T2Utils.t('video.video_uploading')}</div>
                        </div>
                    </div>
                </div>
                <div class="t2-btn-group">
                    <button class="t2-btn" data-action="cancel" data-i18n="common.cancel">${T2Utils.t('common.cancel')}</button>
                    <button class="t2-btn" data-action="insert" data-i18n="common.insert">${T2Utils.t('common.insert')}</button>
                </div>
            </div>
        `;

        const modal = T2Utils.createModal(modalContent);
        this.setupVideoModalEvents(modal, savedRange);
    }

    setupVideoModalEvents(modal, savedRange) {
        const urlInput = modal.querySelector('.t2-youtube-url');
        const fileInput = modal.querySelector('input[type="file"]');
        const uploadArea = modal.querySelector('.t2-video-upload-area');
        const previewContainer = modal.querySelector('.t2-video-preview-container');
        const progressContainer = modal.querySelector('.t2-upload-progress');
        const progressBar = modal.querySelector('.t2-progress-fill');
        const progressText = modal.querySelector('.t2-progress-text');
        const insertBtn = modal.querySelector('[data-action="insert"]');
        if (insertBtn) insertBtn.disabled = true;

        // [FIX-ASPECT-RATIO] uploadedVideoUrl → uploadedVideoData: { url, width, height }
        // handleVideoFileUpload() 가 객체를 반환하므로 치수를 함께 보관한다.
        let uploadedVideoData = null;
        let activeTab = 'url';

        modal.querySelectorAll('.t2-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                modal.querySelectorAll('.t2-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                const targetPane = tab.dataset.tab;
                activeTab = targetPane;
                
                modal.querySelectorAll('.t2-tab-pane').forEach(pane => {
                    pane.classList.remove('active');
                    if (pane.dataset.pane === targetPane) {
                        pane.classList.add('active');
                    }
                });

                if (activeTab === 'url') {
                    insertBtn.disabled = !urlInput.value.trim();
                } else {
                    insertBtn.disabled = !uploadedVideoData;
                }
            });
        });

        urlInput.addEventListener('input', () => {
            insertBtn.disabled = !urlInput.value.trim();
        });

        fileInput.addEventListener('change', async (e) => {
            if (e.target.files.length > 0) {
                const result = await this.handleVideoFileUpload(
                    e.target.files[0], 
                    previewContainer, 
                    progressContainer, 
                    progressBar, 
                    progressText, 
                    insertBtn
                );
                if (result) {
                    uploadedVideoData = result; // { url, width, height }
                }
            }
        });

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', async (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            
            if (e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (this.validateVideoFile(file)) {
                    fileInput.files = e.dataTransfer.files;
                    const result = await this.handleVideoFileUpload(
                        file, 
                        previewContainer, 
                        progressContainer, 
                        progressBar, 
                        progressText, 
                        insertBtn
                    );
                    if (result) {
                        uploadedVideoData = result; // { url, width, height }
                    }
                }
            }
        });

        // insertVideo: URL 탭은 _detectVideoDimensions()로 해상도 감지 후 삽입(유튜브는 16:9 고정),
        // 업로드 탭은 handleVideoFileUpload()가 감지해둔 치수를 사용. 삽입 중 중복 클릭 방지.
        const insertVideo = async () => {
            let videoInfo  = null;
            let vidWidth   = null;
            let vidHeight  = null;

            if (activeTab === 'url') {
                const url = urlInput.value.trim();
                videoInfo = T2Utils.getVideoType(url);
                
                if (!videoInfo) {
                    T2Utils.showNotification(T2Utils.t('video.invalid_url_msg'), 'error');
                    return;
                }

                // [FIX-ASPECT-RATIO] 직접 비디오 URL이면 해상도 감지 시도
                if (videoInfo.type === 'video' && !this._isHlsVideoURL(videoInfo.url)) {
                    insertBtn.disabled = true;
                    insertBtn.textContent = T2Utils.t('video.btn_analyzing');
                    try {
                        const dims = await this._detectVideoDimensions(videoInfo.url);
                        if (dims) {
                            vidWidth  = dims.width;
                            vidHeight = dims.height;
                        }
                    } catch (_) { /* 감지 실패 → 기본 비율 */ }
                    finally {
                        insertBtn.disabled = false;
                        insertBtn.textContent = T2Utils.t('common.insert');
                    }
                }
                // YouTube: 항상 16:9 기본값 (vidWidth/vidHeight = null → _normalizeDimensions 기본값)

            } else if (activeTab === 'upload' && uploadedVideoData) {
                videoInfo = { type: 'video', url: uploadedVideoData.url };
                vidWidth  = uploadedVideoData.width;
                vidHeight = uploadedVideoData.height;
            } else {
                T2Utils.showNotification(T2Utils.t('video.no_video_selected'), 'error');
                return;
            }

            videoInfo = this._sanitizeVideoInfo(videoInfo);
            if (!videoInfo) {
                T2Utils.showNotification(T2Utils.t('video.security_url_blocked'), 'error');
                return;
            }

            const videoBlock = this.createVideoBlock(videoInfo, vidWidth, vidHeight);
            if (!this._insertBlockAtSavedRange(savedRange, videoBlock)) {
                T2Utils.showNotification(T2Utils.t('video.insert_block_failed'), 'error');
                return;
            }

            this.editor.normalizeContent();
            this.editor.createUndoPoint();
            this.editor.autoSave();
            modal.remove();
        };

        modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();
        modal.querySelector('[data-action="insert"]').onclick = () => insertVideo();
        
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                insertVideo();
            }
        });

        urlInput.focus();
    }

    validateVideoFile(file) {
        if (!file || typeof file.name !== 'string') {
            T2Utils.showNotification(T2Utils.t('video.invalid_file'), 'error');
            return false;
        }

        const fileExt = file.name.toLowerCase().split('.').pop();
        const allowed = Array.isArray(this.allowedVideoTypes) ? this.allowedVideoTypes : [];

        if (!allowed.includes(fileExt)) {
            const extList = allowed.map(e => e.toUpperCase()).join(', ');
            T2Utils.showNotification(T2Utils.t('video.unsupported_format_ext', {exts: extList}), 'error');
            return false;
        }

        // 확장자와 브라우저 MIME이 명백히 충돌하면 클라이언트에서 선제 차단한다.
        // 일부 OS/브라우저는 file.type 이 비어 있을 수 있으므로 빈 값은 서버 검증에 위임한다.
        const fileType = String(file.type || '').toLowerCase();
        const expectedMime = this.videoMimeMap && this.videoMimeMap[fileExt];
        if (fileType && expectedMime && fileType !== expectedMime && !(fileExt === 'mp4' && fileType === 'video/x-m4v')) {
            T2Utils.showNotification(T2Utils.t('video.mime_mismatch'), 'error');
            return false;
        }

        if (file.size > this.maxUploadSizeMB * 1024 * 1024) {
            T2Utils.showNotification(T2Utils.t('video.too_large_max', {max: this.maxUploadSizeMB}), 'error');
            return false;
        }

        return true;
    }

    async handleVideoFileUpload(file, previewContainer, progressContainer, progressBar, progressText, insertBtn) {
        if (!this.validateVideoFile(file)) {
            return null;
        }

        insertBtn.disabled = true;
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = T2Utils.t('video.video_uploading');

        // [FIX-ASPECT-RATIO] 업로드 전에 로컬 File 객체에서 해상도를 감지한다.
        // blob URL 은 same-origin 이므로 CORS 제약 없이 항상 loadedmetadata 가 발생한다.
        // 업로드 완료를 기다리지 않고 병렬 실행해 UX 지연 최소화.
        let detectedWidth  = null;
        let detectedHeight = null;
        const blobUrl = URL.createObjectURL(file);
        try {
            const dims = await this._detectVideoDimensions(blobUrl);
            if (dims) {
                detectedWidth  = dims.width;
                detectedHeight = dims.height;
                console.info(T2Utils.tf('video.console_resolution_detected', {w: detectedWidth, h: detectedHeight}, '[T2Video] Resolution detected: ' + detectedWidth + 'x' + detectedHeight));
            }
        } catch (_) { /* 감지 실패 → 기본 비율 사용 */ }
        finally { URL.revokeObjectURL(blobUrl); }

        try {
            const formData = new FormData();
            formData.append('bf_file', file);
            // [FIX] generateUid()는 UUID·hex 등 다양한 형식을 반환할 수 있다.
            // file_upload.php의 uid 검증을 안정적으로 통과하도록 Date.now()를 사용한다.
            // image.js uploadToServer()와 동일한 방식.
            formData.append('uid', String(Date.now()));
            if (typeof T2Utils !== 'undefined' && T2Utils.appendRhymixUploadFields) T2Utils.appendRhymixUploadFields(formData, this.editor);
            if (typeof T2Utils !== 'undefined' && T2Utils.appendWordPressUploadFields) T2Utils.appendWordPressUploadFields(formData);

            // [FIX-PROGRESS] fetch() 는 업로드 진행률 이벤트를 지원하지 않는다.
            // XMLHttpRequest 로 교체해 progress 바에 실제 전송률을 반영한다.
            //
            // [FIX-RHYMIX-CONST] 반드시 let 이어야 한다 — 아래에서
            // T2Utils.normalizeRhymixUploadResponse() 결과로 재할당한다.
            // 과거 const 로 선언되어 있던 탓에 재할당 시점에
            // "Assignment to constant variable" TypeError 가 발생했고,
            // 이 예외는 바로 아래 catch 블록에서 조용히 삼켜졌다.
            // 그 사이 XHR 자체는 이미 완료되어 Rhymix procFileUpload 로
            // 파일이 정상 업로드(및 upload_target_srl 등록)된 상태였으므로,
            // 사용자 눈에는 "비디오 플러그인에서 업로드했는데 에디터에는
            // 삽입되지 않고 라이믹스 네이티브 첨부파일 목록에만 파일이
            // 걸리는" 것처럼 보였다. image.js/file.js 의 동일 패턴은 모두
            // let 을 사용하고 있어 이 문제가 없었다.
            let data = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();

                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        const pct = Math.round((e.loaded / e.total) * 90); // 90%까지 전송
                        progressBar.style.width = `${pct}%`;
                        progressText.textContent = T2Utils.t('video.video_uploading_pct', {pct: pct});
                    }
                });

                xhr.addEventListener('load', () => {
                    try {
                        const text = xhr.responseText.trim();
                        resolve(JSON.parse(text));
                    } catch (e) {
                        reject(new Error(T2Utils.t('video.server_response_failed')));
                    }
                });

                xhr.addEventListener('error', () => reject(new Error(T2Utils.t('video.network_error'))));
                xhr.addEventListener('abort', () => reject(new Error(T2Utils.t('video.upload_canceled'))));

                const uploadUrl = (typeof T2Utils !== 'undefined' && T2Utils.getRhymixUploadUrl)
                    ? (T2Utils.getRhymixUploadUrl(this.editor) || `${t2editor_url}/plugin/file/file_upload.php`)
                    : `${t2editor_url}/plugin/file/file_upload.php`;
                xhr.open('POST', uploadUrl);
                xhr.withCredentials = true;
                xhr.send(formData);
            });
            
            if (typeof T2Utils !== 'undefined' && T2Utils.normalizeRhymixUploadResponse) data = T2Utils.normalizeRhymixUploadResponse(data, 'file');
            if (typeof T2Utils !== 'undefined' && T2Utils.applyRhymixUploadResult) T2Utils.applyRhymixUploadResult(data, this.editor);
            if (data.success) {
                let uploadedUrl = this._sanitizeVideoURL(data && data.file && data.file.url);
                if (!uploadedUrl) {
                    throw new Error(T2Utils.t('video.url_security_failed'));
                }
                // [FIX-RHYMIX-VIDEO-UNAVAILABLE] 위 _resolveRhymixVideoUrl() 주석 참고.
                uploadedUrl = this._resolveRhymixVideoUrl(uploadedUrl, file.name);

                progressBar.style.width = '100%';
                progressText.textContent = T2Utils.t('video.upload_complete');
                const safeUrl  = this._escapeAttr(uploadedUrl);
                const safeName = this._escapeAttr(file.name);
                // [UPLOAD-CONFIG] 미리보기 <source type>: videoMimeMap 에서 대표 MIME 조회.
                // 맵에 없는 확장자는 'video/mp4' 로 폴백 (브라우저가 재판정함).
                const rawExt   = file.name.split('.').pop().toLowerCase();
                const mimeType = (this.videoMimeMap && this.videoMimeMap[rawExt])
                    ? this.videoMimeMap[rawExt]
                    : 'video/mp4';
                const safeMime = this._escapeAttr(mimeType);
                // [SEC-PLUGIN-API] previewContainer.innerHTML 을 core.js 보안 경계(sanitizePluginHTML)로 라우팅.
                // safeUrl/safeName/safeMime 은 이미 escapeHtml 처리됐으나,
                // video 프로필 기반 2차 검증(src 위험 프로토콜 차단, on* 핸들러 제거)을 추가 적용한다.
                const previewHtml = `
                    <div class="t2-video-preview">
                        <video controls style="width: 100%; max-height: 200px;">
                            <source src="${safeUrl}" type="${safeMime}">
                        </video>
                        <div class="t2-video-info">
                            <span class="t2-video-file-name" title="${safeName}">${safeName}</span>
                            <span class="t2-video-file-size">${T2Utils.formatFileSize(file.size)}</span>
                        </div>
                    </div>
                `;
                this._setPluginHTML(previewContainer, previewHtml, 'video:preview');
                
                insertBtn.disabled = false;
                
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                }, 1000);
                
                T2Utils.showNotification(T2Utils.t('video.video_uploaded'), 'success');

                // [FIX-ASPECT-RATIO] url 단독 반환 → { url, width, height } 객체 반환.
                // setupVideoModalEvents 의 insertVideo 핸들러가 치수를 createVideoBlock 에 전달.
                return { url: uploadedUrl, width: detectedWidth, height: detectedHeight };
            } else {
                throw new Error(data.message || T2Utils.t('video.video_upload_failed'));
            }
        } catch (error) {
            console.error(T2Utils.tf('video.console_upload_error', {}, 'Video upload error:'), error);
            T2Utils.showNotification(T2Utils.t('video.video_upload_error'), 'error');
            insertBtn.disabled = false;
            progressContainer.style.display = 'none';
            return null;
        }
    }

    // 파일 플러그인 등 외부에서 단일 비디오 파일을 업로드할 때 쓰는 공개 API.
    // UI 없이 업로드 후 비디오 블록 DOM(t2-video-block)을 반환, 실패 시 Error throw.
    async uploadVideoFile(file) {
        // 업로드 전 로컬 File 객체에서 해상도 병렬 감지
        let detectedWidth  = null;
        let detectedHeight = null;
        const blobUrl = URL.createObjectURL(file);
        try {
            const dims = await this._detectVideoDimensions(blobUrl);
            if (dims) {
                detectedWidth  = dims.width;
                detectedHeight = dims.height;
            }
        } catch (_) { /* 감지 실패 → 기본 비율 */ }
        finally { URL.revokeObjectURL(blobUrl); }

        const formData = new FormData();
        formData.append('bf_file', file);
        // image.js uploadToServer()와 동일하게 Date.now()를 사용.
        // generateUid()가 생성하는 UUID/hex 문자열은 file_upload.php의
        // uid 검증 패턴을 통과하지 못하는 경우가 있다.
        formData.append('uid', String(Date.now()));
        if (typeof T2Utils !== 'undefined' && T2Utils.appendRhymixUploadFields) T2Utils.appendRhymixUploadFields(formData, this.editor);
        if (typeof T2Utils !== 'undefined' && T2Utils.appendWordPressUploadFields) T2Utils.appendWordPressUploadFields(formData);

        const uploadUrl = (typeof T2Utils !== 'undefined' && T2Utils.getRhymixUploadUrl)
            ? (T2Utils.getRhymixUploadUrl(this.editor) || `${t2editor_url}/plugin/file/file_upload.php`)
            : `${t2editor_url}/plugin/file/file_upload.php`;
        const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
        });

        // PHP 워닝·BOM 대응: text() → trim() → JSON.parse()
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text.trim());
        } catch (e) {
            console.error(T2Utils.tf('video.console_response_parse_failed', {}, '[T2Video] Failed to parse upload response. Server raw:'), text.substring(0, 500));
            throw new Error(T2Utils.t('video.server_response_console'));
        }

        if (typeof T2Utils !== 'undefined' && T2Utils.normalizeRhymixUploadResponse) data = T2Utils.normalizeRhymixUploadResponse(data, 'file');
        if (typeof T2Utils !== 'undefined' && T2Utils.applyRhymixUploadResult) T2Utils.applyRhymixUploadResult(data, this.editor);
        if (!data.success) {
            throw new Error(data.message || T2Utils.t('video.video_upload_failed'));
        }

        let uploadedUrl = this._sanitizeVideoURL(data && data.file && data.file.url);
        if (!uploadedUrl) {
            throw new Error(T2Utils.t('video.url_security_failed'));
        }
        // [FIX-RHYMIX-VIDEO-UNAVAILABLE] 위 _resolveRhymixVideoUrl() 주석 참고.
        // 드래그앤드롭/파일선택으로 비디오 블록을 만드는 이 경로가 바로
        // "비디오 플러그인에서 직접 업로드하면 재생이 안 되는" 증상의 진입점이다.
        uploadedUrl = this._resolveRhymixVideoUrl(uploadedUrl, file.name);

        // 업로드 성공 → 비디오 블록 DOM 요소 생성 후 반환.
        // 삽입 위치 결정은 호출자(파일 플러그인)가 담당한다.
        return this.createVideoBlock(
            { type: 'video', url: uploadedUrl },
            detectedWidth,
            detectedHeight
        );
    }

    // <video>의 loadedmetadata로 실제 해상도를 감지. blob URL은 CORS 없이 로컬 감지,
    // 서버 URL은 CORS 허용 여부에 따라 실패 가능(null 반환 시 호출자가 fallback 처리). 타임아웃 8초.
    // @param {string} url  video src 로 쓸 URL (blob: 또는 http(s):// 모두 가능)
    // @returns {Promise<{width:number,height:number}|null>}
    _detectVideoDimensions(url) {
        const safeUrl = this._sanitizeVideoURL(url);
        if (!safeUrl || this._isHlsVideoURL(safeUrl)) return Promise.resolve(null);

        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted   = true;
            // DOM에 붙이지 않아도 loadedmetadata 는 발생하지만,
            // 일부 브라우저(Safari)에서 hidden 상태 로딩이 불안정한 경우 대비
            video.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
            document.body.appendChild(video);

            let settled = false;

            const resolve_ = (val) => {
                if (settled) return;
                settled = true;
                // blob URL 메모리 해제는 호출자가 담당 (revokeObjectURL)
                video.src = '';
                video.load();
                video.remove();
                resolve(val);
            };

            const timer = setTimeout(() => {
                console.warn(T2Utils.tf('video.console_resolution_timeout', {}, '[T2Video] Resolution detection timeout:'), safeUrl);
                resolve_(null);
            }, 8000);

            video.addEventListener('loadedmetadata', () => {
                clearTimeout(timer);
                const w = video.videoWidth;
                const h = video.videoHeight;
                resolve_((w > 0 && h > 0) ? { width: w, height: h } : null);
            }, { once: true });

            video.addEventListener('error', () => {
                clearTimeout(timer);
                console.warn(T2Utils.tf('video.console_resolution_failed', {}, '[T2Video] Resolution detection failed (error):'), safeUrl);
                resolve_(null);
            }, { once: true });

            video.src = safeUrl;
            video.load();
        });
    }

    // 실제 해상도(rawWidth×rawHeight)를 비디오 블록 내부 너비의 최대 95%에
    // 맞춰 축소한다(비율 유지, 최소높이 80px).
    // 유효하지 않으면 기본 16:9(560×315).
    // @returns {{ width:number, height:number }}
    _normalizeDimensions(rawWidth, rawHeight) {
        const DEFAULT_W = 560;
        const DEFAULT_H = 315;
        const MIN_H     = 80;

        const maxAllowedWidth = this._getVideoMaxWidth(null, DEFAULT_W);

        if (!rawWidth || !rawHeight || rawWidth <= 0 || rawHeight <= 0) {
            const fallbackW = Math.min(DEFAULT_W, maxAllowedWidth);
            return {
                width: fallbackW,
                height: Math.max(Math.round(fallbackW * DEFAULT_H / DEFAULT_W), MIN_H)
            };
        }

        // 원본 해상도가 커도 비디오 블록의 95%를 넘지 않는다.
        const finalW  = Math.min(rawWidth, maxAllowedWidth);
        const ratio   = rawHeight / rawWidth;
        const finalH  = Math.max(Math.round(finalW * ratio), MIN_H);

        return { width: Math.round(finalW), height: finalH };
    }

    // CMS 필터는 iframe의 data-*/style/class는 잘라내도 src는 (없으면 임베드 자체가
    // 안 되므로) 대부분 원형 보존한다. 그래서 크기를 src 쿼리스트링(t2w/t2h)에 심어
    // 다른 속성이 다 잘려도 크기만은 src에서 복구 가능하게 한다.
    _appendSizeToSrc(url, width, height) {
        if (!url) return url;
        const w = parseInt(width, 10);
        const h = parseInt(height, 10);
        if (!w || !h) return url;
        try {
            const u = new URL(url, window.location.origin);
            u.searchParams.set('t2w', String(w));
            u.searchParams.set('t2h', String(h));
            return u.toString();
        } catch (e) {
            // URL 파싱 실패 시 문자열로 수동 부착 (폴백)
            const sep = url.indexOf('?') === -1 ? '?' : '&';
            return url + sep + 't2w=' + w + '&t2h=' + h;
        }
    }

    // src 쿼리스트링에서 t2w/t2h를 복구한다. 없으면 null.
    static parseSizeFromSrc(src) {
        if (!src) return null;
        try {
            const u = new URL(src, window.location.origin);
            const w = parseInt(u.searchParams.get('t2w'), 10);
            const h = parseInt(u.searchParams.get('t2h'), 10);
            if (w && h) return { width: w, height: h };
        } catch (e) { /* noop */ }
        return null;
    }

    getVideoIframeUrl(videoInfo, width = null, height = null) {
        let base;
        if (videoInfo.type === 'youtube') {
            // [SEC-XSS] YouTube video ID 검증: 영숫자·하이픈·언더스코어만 허용.
            // T2Utils.getVideoType() 이 추출한 ID 라도 추가 검증하여
            // URL 인젝션(예: "ID/../../../evil") 을 차단한다.
            const rawId = String(videoInfo.id || '');
            const safeId = this._sanitizeYouTubeId(rawId);
            if (!safeId) {
                console.warn(T2Utils.tf('video.console_invalid_youtube_id', {}, '[T2Video] Invalid YouTube video ID:'), rawId);
                return '';
            }
            base = `https://www.youtube.com/embed/${safeId}`;
        } else {
            const videoPath = this._sanitizeVideoURL(videoInfo.url);
            if (!videoPath) return '';
            const endpoint = this._isCustomVideoPlayerEnabled() ? 'video_player.php' : 'video_view.php';
            base = `${t2editor_url}/plugin/video/${endpoint}?video=${encodeURIComponent(videoPath)}`;
        }
        return (width && height) ? this._appendSizeToSrc(base, width, height) : base;
    }

    // @param {object}      videoInfo        { type, id|url }
    // @param {number|null} [detectedWidth]  실제 비디오 가로 (없으면 기본값)
    // @param {number|null} [detectedHeight] 실제 비디오 세로 (없으면 기본값)
    createVideoBlock(videoInfo, detectedWidth = null, detectedHeight = null) {
        videoInfo = this._sanitizeVideoInfo(videoInfo);
        if (!videoInfo) {
            console.warn(T2Utils.tf('video.console_url_security_blocked', {}, '[T2Video][SEC] Video URL failed security boundary check — skipping block creation.'));
            return null;
        }

        // [FIX-ASPECT-RATIO] 실제 해상도가 전달된 경우 에디터 너비 기준으로 정규화.
        // 전달되지 않으면 16:9 기본값(560×315) 사용.
        const { width: defaultWidth, height: defaultHeight } =
            this._normalizeDimensions(detectedWidth, detectedHeight);

        const wrapper = document.createElement('div');
        wrapper.className = 't2-media-block t2-video-block';
        wrapper.contentEditable = false;
        wrapper.style.position = 'relative';
        // wrapper에 정렬 스타일 직접 새김 — container margin:0 auto만으로는 필터가
        // auto 값을 지웠을 때 정렬이 무너지므로 2·3번째 방어선(style/data-align) 추가.
        wrapper.style.textAlign = 'center';
        wrapper.setAttribute('data-align', 'center');

        const blockId = this.generateBlockId();
        wrapper.setAttribute('data-block-id', blockId);

        // wrapper에도 비디오 메타데이터 중복 기록 — 필터가 container의 data-*를
        // 지워도 wrapper data-*(관찰상 생존율 더 높음)가 복구 근거로 남는다.
        wrapper.setAttribute('data-t2-block', 'video');
        wrapper.setAttribute('data-video-type', videoInfo.type);
        wrapper.setAttribute('data-video-width', String(defaultWidth));
        wrapper.setAttribute('data-video-height', String(defaultHeight));
        // 슬라이더의 100% 기준 크기는 현재 표시 크기와 별도로 영구 보존한다.
        wrapper.setAttribute('data-video-base-width', String(defaultWidth));
        wrapper.setAttribute('data-video-base-height', String(defaultHeight));
        if (videoInfo.type === 'youtube') {
            wrapper.setAttribute('data-video-id', videoInfo.id || '');
        } else {
            wrapper.setAttribute('data-video-url', videoInfo.url || '');
        }
        
        const videoContainer = document.createElement('div');
        videoContainer.style.width = defaultWidth + 'px';
        videoContainer.style.height = defaultHeight + 'px';
        // 실제 비디오는 옅은 테두리의 비디오 블록 내부 너비 중 최대 95%까지만 허용.
        videoContainer.style.maxWidth = '95%';
        videoContainer.style.margin = '0 auto';
        // display:inline-block — text-align:center는 block 자식엔 효과가 없으므로
        // (부모의 text-align을 무시함) inline-block으로 바꿔 margin:auto 손실에도 대비.
        videoContainer.style.display = 'inline-block';
        videoContainer.style.verticalAlign = 'top';
        videoContainer.dataset.width = defaultWidth;
        videoContainer.dataset.height = defaultHeight;
        videoContainer.dataset.originalWidth = defaultWidth;
        videoContainer.dataset.originalHeight = defaultHeight;
        videoContainer.dataset.baseWidth = defaultWidth;
        videoContainer.dataset.baseHeight = defaultHeight;

        // [FIX-PERSIST] container에도 동일 데이터 기록 (iframe 부모 div 로서 CMS 생존율 높음)
        videoContainer.setAttribute('data-t2-block', 'video');
        videoContainer.setAttribute('data-video-type', videoInfo.type);
        if (videoInfo.type === 'youtube') {
            videoContainer.setAttribute('data-video-id', videoInfo.id || '');
        } else {
            videoContainer.setAttribute('data-video-url', videoInfo.url || '');
        }
        
        const videoElement = document.createElement('iframe');
        const iframeUrl = this.getVideoIframeUrl(videoInfo, defaultWidth, defaultHeight);
        if (!iframeUrl) return null;
        videoElement.src = iframeUrl;
        videoElement.frameBorder = "0";
        videoElement.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        videoElement.allowFullscreen = true;
        // [HARD-SIZE 10.4.2] container 의 style(%기준)에 기대지 않는다. iframe 자신의
        // width/height "HTML 속성"과 인라인 px style 에 실제 치수를 직접 새겨,
        // 컨테이너가 CMS 필터로 사라져도 iframe 하나만으로 올바른 크기가 유지되게 한다.
        videoElement.setAttribute('width', String(defaultWidth));
        videoElement.setAttribute('height', String(defaultHeight));
        videoElement.style.width = defaultWidth + 'px';
        videoElement.style.height = defaultHeight + 'px';
        videoElement.style.maxWidth = '100%';
        videoElement.style.display = 'block';
        videoElement.style.borderRadius = '15px';
        videoElement.style.border = 'none';

        // 직접 업로드 비디오(video_view.php)는 sandbox 없이 유지(일부 CMS가 same-origin
        // iframe+sandbox 조합을 비허용으로 걸러내는 것 방지). 외부(YouTube) iframe만 sandbox 적용.
        if (videoInfo.type === 'youtube') {
            T2Editor._applyIframeSandbox(videoElement, videoElement.getAttribute('src') || videoElement.src);
        } else {
            videoElement.removeAttribute('sandbox');
        }
        
        videoElement.dataset.videoType = videoInfo.type;
        
        if (videoInfo.type === 'youtube') {
            videoElement.dataset.videoId = videoInfo.id;
        } else {
            videoElement.dataset.videoUrl = videoInfo.url;
        }
        
        videoContainer.appendChild(videoElement);

        // fallback anchor: 화면엔 숨기되 저장 HTML엔 남겨, iframe/data-*가 모두
        // 제거돼도 href에서 원본 URL을 복구할 수 있게 한다(display:none은 CMS가
        // 함께 제거하는 경우가 있어 미사용).
        const fallbackAnchor = document.createElement('a');
        fallbackAnchor.className = 't2-video-source';
        let fallbackHref = '';
        if (videoInfo.type === 'youtube') {
            const safeId = String(videoInfo.id || '').replace(/[^a-zA-Z0-9\-_]/g, '');
            fallbackHref = safeId ? `https://www.youtube.com/watch?v=${safeId}` : '';
        } else {
            fallbackHref = videoInfo.url || '';
        }
        // [SEC-URL] 직접 비디오 URL 은 사용자 입력에서 유래할 수 있으므로
        // href 컨텍스트(javascript:, vbscript:, data: 모두 차단)로 sanitizeURL 검증.
        fallbackAnchor.href = this._sanitizeURL(fallbackHref, 'href') || '';
        this._styleFallbackAnchor(fallbackAnchor, videoInfo.type);
        videoContainer.appendChild(fallbackAnchor);

        wrapper.appendChild(videoContainer);

        const controls = this.createVideoControls(videoContainer, videoElement, videoInfo, defaultWidth, defaultHeight, blockId);
        wrapper.appendChild(controls);

        const moveControls = this.createMoveControls();
        wrapper.appendChild(moveControls);

        return wrapper;
    }

    createVideoControls(container, videoElement, videoInfo, defaultWidth, defaultHeight, blockId) {
        const controls = document.createElement('div');
        controls.className = 't2-media-controls';
        controls.contentEditable = false;

        defaultWidth = this._toBoundedInt(defaultWidth, 560, 1, 10000);
        defaultHeight = this._toBoundedInt(defaultHeight, 315, 1, 10000);

        // defaultWidth/defaultHeight는 크기 상한이 아니라 종횡비 기준이다.
        // 슬라이더 값은 항상 옅은 테두리의 비디오 블록 내부 너비에 대한 비율이며,
        // 유튜브/직접 업로드 영상 모두 최대 95%를 넘지 않는다.
        const MIN_SIZE_PERCENTAGE = 30;
        const MAX_SIZE_PERCENTAGE = 95;
        const aspectRatio = defaultHeight / defaultWidth;
        const currentWidth = this._toBoundedInt(container.style.width || container.dataset.width, defaultWidth, 1, 10000);
        const blockContentWidth = this._getVideoBlockContentWidth(container, Math.ceil(defaultWidth / 0.95));
        const currentPercentage = Math.max(
            MIN_SIZE_PERCENTAGE,
            Math.min(MAX_SIZE_PERCENTAGE, Math.round((currentWidth / blockContentWidth) * 100))
        );
        const isYoutube = videoInfo.type === 'youtube';

        const createIconButton = (className, iconName, hidden = false) => {
            const btn = document.createElement('button');
            btn.className = `t2-btn ${className}`;
            btn.type = 'button';
            if (hidden) btn.style.display = 'none';

            const icon = document.createElement('span');
            icon.className = 'material-icons';
            icon.textContent = iconName;
            btn.appendChild(icon);

            return btn;
        };

        const deleteBtn = createIconButton('delete-btn', 'delete');
        const editBtn = createIconButton(isYoutube ? 'edit-url-btn-youtube' : 'edit-url-btn', 'edit');

        const rangeInput = document.createElement('input');
        rangeInput.type = 'range';
        rangeInput.min = String(MIN_SIZE_PERCENTAGE);
        rangeInput.max = String(MAX_SIZE_PERCENTAGE);
        rangeInput.value = String(currentPercentage);
        rangeInput.className = 'size-slider';
        rangeInput.style.width = '100px';
        // 구버전의 sliderPercentage는 원본 크기 기준 값일 수 있으므로,
        // 현재 블록 너비 기준으로 다시 계산한 값으로 즉시 교체한다.
        container.dataset.sliderPercentage = String(currentPercentage);

        controls.append(deleteBtn, editBtn, rangeInput);

        deleteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const mediaBlock = controls.closest('.t2-media-block');
            if (mediaBlock) {
                mediaBlock.remove();
                this.editor.createUndoPoint();
                this.editor.autoSave();
            }
        });

        let isSliding = false;
        let slideTimer = null;

        rangeInput.addEventListener('mousedown', () => { isSliding = true; });
        rangeInput.addEventListener('mouseup',   () => { isSliding = false; });
        rangeInput.addEventListener('touchstart',() => { isSliding = true; }, { passive: true });
        rangeInput.addEventListener('touchend',  () => { isSliding = false; });

        const updateIframeSizeQuery = () => {
            if (!videoElement || videoElement.tagName !== 'IFRAME') return;
            const finalW = parseInt(container.style.width, 10) || parseInt(container.dataset.width, 10);
            const finalH = parseInt(container.style.height, 10) || parseInt(container.dataset.height, 10);
            if (finalW && finalH) {
                videoElement.src = this._appendSizeToSrc(videoElement.src, finalW, finalH);
            }
        };

        const scheduleIframeSizeQueryUpdate = () => {
            if (slideTimer) clearTimeout(slideTimer);
            slideTimer = setTimeout(() => {
                updateIframeSizeQuery();
                if (this.editor.getPlugin('collab')) {
                    this.editor.getPlugin('collab')._debounceUpdate();
                }
            }, 300);
        };

        const applyPercentage = (rawPercentage, updateSource = false) => {
            const percentage = this._toBoundedInt(
                rawPercentage,
                MAX_SIZE_PERCENTAGE,
                MIN_SIZE_PERCENTAGE,
                MAX_SIZE_PERCENTAGE
            );
            const availableWidth = this._getVideoBlockContentWidth(container, Math.ceil(defaultWidth / 0.95));
            const newWidth = Math.max(1, Math.round((availableWidth * percentage) / 100));
            const newHeight = Math.max(1, Math.round(newWidth * aspectRatio));

            rangeInput.value = String(percentage);
            container.style.width = `${newWidth}px`;
            container.style.height = `${newHeight}px`;
            container.style.maxWidth = '95%';
            container.dataset.sliderPercentage = String(percentage);
            container.dataset.width = String(newWidth);
            container.dataset.height = String(newHeight);

            if (videoElement) {
                videoElement.setAttribute('width', String(newWidth));
                videoElement.setAttribute('height', String(newHeight));
                videoElement.style.width = `${newWidth}px`;
                videoElement.style.height = `${newHeight}px`;
                videoElement.style.maxWidth = '100%';
            }

            const wrapperEl = container.closest('.t2-media-block');
            if (wrapperEl) {
                wrapperEl.setAttribute('data-video-width', String(newWidth));
                wrapperEl.setAttribute('data-video-height', String(newHeight));
            }

            if (updateSource) scheduleIframeSizeQueryUpdate();
            return { width: newWidth, height: newHeight, percentage };
        };

        // 비디오 블록 자체를 관찰하므로 에디터 폭·반응형 레이아웃 변화에도
        // 같은 비율을 유지하고 언제나 95% 경계를 지킨다.
        const observedBlock = container.closest('.t2-media-block') || this.editor.editor;
        let lastObservedWidth = 0;
        const resizeObserver = new ResizeObserver(() => {
            const newBlockWidth = this._getVideoBlockContentWidth(container, Math.ceil(defaultWidth / 0.95));
            if (!newBlockWidth || newBlockWidth === lastObservedWidth) return;
            lastObservedWidth = newBlockWidth;

            const storedPercentage = parseInt(container.dataset.sliderPercentage, 10);
            const liveWidth = parseInt(container.style.width, 10) || parseInt(container.dataset.width, 10) || currentWidth;
            const percentage = Number.isFinite(storedPercentage)
                ? storedPercentage
                : Math.round((liveWidth / newBlockWidth) * 100);
            applyPercentage(percentage, true);
        });

        resizeObserver.observe(observedBlock);

        rangeInput.addEventListener('input', (e) => {
            applyPercentage(e.target.value, true);
            this.editor.createUndoPoint();
        });

        // MutationObserver로 controls 제거를 감지해 ResizeObserver/slideTimer 정리
        const cleanupObserver = new MutationObserver(() => {
            if (!controls.isConnected) {
                resizeObserver.disconnect();
                if (slideTimer) clearTimeout(slideTimer);
                cleanupObserver.disconnect();
            }
        });
        // childList 와 subtree 모두 감시해야 간접 제거(wrapper.remove() 등)도 감지된다.
        const observeRoot = controls.closest('.t2-media-block')?.parentNode || document.body;
        cleanupObserver.observe(observeRoot, { childList: true, subtree: true });

        // [FIX-SLIDER-SYNC] 슬라이더 값과 container.dataset.sliderPercentage 동기화.
        // setInterval 폴링 대신 데이터 속성 변화를 MutationObserver 로 감시한다.
        const sliderSyncObserver = new MutationObserver(() => {
            const currentPercentage = container.dataset.sliderPercentage;
            if (currentPercentage && parseInt(rangeInput.value, 10) !== parseInt(currentPercentage, 10)) {
                rangeInput.value = currentPercentage;
            }
        });
        sliderSyncObserver.observe(container, { attributes: true, attributeFilter: ['data-slider-percentage'] });

        // cleanupObserver 에서 controls 를 감시할 때 sliderSyncObserver 도 함께 정리한다.
        const origCleanup = cleanupObserver.takeRecords.bind(cleanupObserver);
        const _disconnectAll = () => {
            if (!controls.isConnected) {
                resizeObserver.disconnect();
                sliderSyncObserver.disconnect();
                if (slideTimer) clearTimeout(slideTimer);
                cleanupObserver.disconnect();
            }
        };
        // 기존 MutationObserver 콜백을 교체해 두 Observer 를 함께 정리한다.
        cleanupObserver.disconnect();
        const cleanupObserver2 = new MutationObserver(_disconnectAll);
        cleanupObserver2.observe(observeRoot, { childList: true, subtree: true });

        editBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // [VE] 직접 업로드 비디오 → 풍부한 편집기 / YouTube → URL 수정 모달
            if (isYoutube) {
                this.showVideoUrlEditModal(container, videoElement, videoInfo, blockId);
            } else {
                this._openVideoEditModal(container, videoElement, videoInfo, blockId);
            }
        });

        return controls;
    }

    createMoveControls() {
        const moveWrapper = document.createElement('div');
        moveWrapper.className = 't2-move-controls';
        moveWrapper.contentEditable = false;
        moveWrapper.style.cssText = `
            position: absolute;
            bottom: 8px;
            right: 8px;
            display: inline-flex;
            background: rgba(50, 50, 50, 0.9);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            z-index: 10;
        `;

        const createButton = (direction, iconName) => {
            const btn = document.createElement('button');
            btn.className = 't2-btn t2-move-btn';
            btn.type = 'button';
            btn.dataset.direction = direction;
            btn.style.cssText =
                'padding:6px 12px;border:none;border-radius:0;background:transparent;color:white;transition:all 0.2s;cursor:pointer;';
            if (direction === 'up') {
                btn.style.borderRight = '2px solid rgba(255,255,255,0.3)';
            }

            const icon = document.createElement('span');
            icon.className = 'material-icons';
            icon.style.fontSize = '20px';
            icon.textContent = iconName;
            btn.appendChild(icon);
            return btn;
        };

        const upBtn = createButton('up', 'arrow_upward');
        const downBtn = createButton('down', 'arrow_downward');
        moveWrapper.append(upBtn, downBtn);

        [upBtn, downBtn].forEach(btn => {
            btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.15)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
        });

        upBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.moveBlock('up', moveWrapper);
        });

        downBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.moveBlock('down', moveWrapper);
        });

        return moveWrapper;
    }

    moveBlock(direction, controlElement) {
        const mediaBlock = controlElement.closest('.t2-media-block');
        if (!mediaBlock) return;

        if (typeof this.editor.moveBlockWithBoundaryLines === 'function') {
            if (!this.editor.moveBlockWithBoundaryLines(mediaBlock, direction)) return;
        } else {
            const sibling = direction === 'up' ? mediaBlock.previousElementSibling : mediaBlock.nextElementSibling;
            if (!sibling) return;

            if (direction === 'up') {
                mediaBlock.parentNode.insertBefore(mediaBlock, sibling);
            } else {
                mediaBlock.parentNode.insertBefore(mediaBlock, sibling.nextElementSibling);
            }
            if (typeof this.editor.normalizeContent === 'function') this.editor.normalizeContent();
        }

        this.editor.createUndoPoint();
        this.editor.autoSave();
        
        if (this.editor.getPlugin('collab')) {
            this.editor.getPlugin('collab')._debounceUpdate();
        }
    }

    showVideoUrlEditModal(container, videoElement, currentVideoInfo, blockId) {
        let currentUrl = '';
        if (currentVideoInfo.type === 'youtube') {
            currentUrl = `https://youtube.com/watch?v=${currentVideoInfo.id}`;
        } else {
            currentUrl = currentVideoInfo.url;
        }
        
        // [SEC-XSS] currentUrl을 value 속성 삽입 전 이스케이프
        const safeCurrentUrl = this._escapeAttr(currentUrl);
        // [UPLOAD-CONFIG] 안내 문자열 동적 생성 (insertVideo 모달과 동일 방식)
        const safeExtDotList = this._escapeHtml(this.allowedVideoTypes.map(e => '.' + e).join(', '));
        const modalContent = `
            <div class="t2-video-editor-modal">
                <h3 data-i18n="video.modal_title_edit">${T2Utils.t('video.modal_title_edit')}</h3>
                <input type="text" placeholder="${T2Utils.t('video.video_url_placeholder')}" class="t2-youtube-url" value="${safeCurrentUrl}" data-i18n-placeholder="video.video_url_placeholder">
                <div class="t2-video-type-info" data-i18n="video.video_type_info" data-i18n-vars='${JSON.stringify({exts: safeExtDotList}).replace(/'/g, "&#39;")}'>
                    ${T2Utils.t('video.video_type_info', {exts: safeExtDotList})}
                </div>
                <div class="t2-btn-group">
                    <button class="t2-btn" data-action="cancel" data-i18n="common.cancel">${T2Utils.t('common.cancel')}</button>
                    <button class="t2-btn" data-action="insert" data-i18n="video.btn_update">${T2Utils.t('video.btn_update')}</button>
                </div>
            </div>
        `;

        const modal = T2Utils.createModal(modalContent);
        
        const updateVideo = () => {
            const url = modal.querySelector('.t2-youtube-url').value;
            const parsedInfo = T2Utils.getVideoType(url);
            const videoInfo = this._sanitizeVideoInfo(parsedInfo);

            if (!videoInfo) {
                T2Utils.showNotification(T2Utils.t('video.invalid_url_msg'), 'error');
                return;
            }

            const currentWidth = this._toBoundedInt(container.style.width, 560, 1, 10000);
            const currentHeight = this._toBoundedInt(container.style.height, 315, 1, 10000);
            const currentSliderPercentage = container.dataset.sliderPercentage;

            const nextSrc = this.getVideoIframeUrl(videoInfo, currentWidth, currentHeight);
            if (!nextSrc) {
                T2Utils.showNotification(T2Utils.t('video.security_url_blocked'), 'error');
                return;
            }

            videoElement.src = nextSrc;

            videoElement.dataset.videoType = videoInfo.type;
            const block = container.closest('.t2-video-block') || container.closest('.t2-media-block');
            [block, container].filter(Boolean).forEach(el => {
                el.setAttribute('data-t2-block', 'video');
                el.setAttribute('data-video-type', videoInfo.type);
            });

            if (videoInfo.type === 'youtube') {
                videoElement.dataset.videoId = videoInfo.id;
                delete videoElement.dataset.videoUrl;
                [block, container].filter(Boolean).forEach(el => {
                    el.setAttribute('data-video-id', videoInfo.id);
                    el.removeAttribute('data-video-url');
                });
            } else {
                videoElement.dataset.videoUrl = videoInfo.url;
                delete videoElement.dataset.videoId;
                [block, container].filter(Boolean).forEach(el => {
                    el.setAttribute('data-video-url', videoInfo.url);
                    el.removeAttribute('data-video-id');
                });
            }

            let anchor = container.querySelector('.t2-video-source');
            if (!anchor) {
                anchor = document.createElement('a');
                anchor.className = 't2-video-source';
                container.appendChild(anchor);
            }
            anchor.href = videoInfo.type === 'youtube'
                ? `https://www.youtube.com/watch?v=${videoInfo.id}`
                : this._sanitizeURL(videoInfo.url, 'href');
            // [10.4.1 GRACEFUL-FALLBACK] 재사용 시에도 매번 스타일/텍스트를
            // 다시 새겨, 과거(필터에 잘렸던) 스타일이 그대로 남는 것을 방지.
            this._styleFallbackAnchor(anchor, videoInfo.type);

            // [FIX-G5-IFRAME] 직접 업로드 비디오 iframe은 sandbox 없이 유지한다.
            // YouTube 등 외부 iframe만 sandbox를 재적용한다.
            videoElement.removeAttribute('sandbox');
            if (videoInfo.type === 'youtube') {
                T2Editor._applyIframeSandbox(videoElement, videoElement.getAttribute('src') || '');
            }

            container.style.width = currentWidth + 'px';
            container.style.height = currentHeight + 'px';
            if (currentSliderPercentage) {
                container.dataset.sliderPercentage = currentSliderPercentage;
            }

            modal.remove();
            this.editor.createUndoPoint();
            this.editor.autoSave();

            if (this.editor.getPlugin('collab')) {
                this.editor.getPlugin('collab')._debounceUpdate();
            }
        };

        modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();
        modal.querySelector('[data-action="insert"]').onclick = updateVideo;
        
        modal.querySelector('.t2-youtube-url').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                updateVideo();
            }
        });

        modal.querySelector('.t2-youtube-url').focus();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ── T2 Video Edit Module  (인스타그램 / 틱톡 스타일 동영상 편집기) ────
    // ═══════════════════════════════════════════════════════════════════════

    /** 필터 프리셋 목록 */
    _VE_filterPresets() {
        return [
            { id: 'original', name: T2Utils.t('video.filter_original'),    css: '' },
            { id: 'vivid',    name: T2Utils.t('video.filter_vivid'),       css: 'saturate(1.6) contrast(1.1)' },
            { id: 'warm',     name: T2Utils.t('video.filter_warm'),        css: 'sepia(0.25) saturate(1.3) hue-rotate(-8deg) brightness(1.02)' },
            { id: 'cool',     name: T2Utils.t('video.filter_cool'),        css: 'saturate(0.9) hue-rotate(20deg) brightness(1.04)' },
            { id: 'vintage',  name: T2Utils.t('video.filter_vintage'),     css: 'sepia(0.45) contrast(0.88) brightness(0.96) saturate(0.9)' },
            { id: 'fade',     name: T2Utils.t('video.filter_fade'),        css: 'contrast(0.82) brightness(1.12) saturate(0.75)' },
            { id: 'bw',       name: 'B&W',                                css: 'grayscale(1) contrast(1.08)' },
            { id: 'drama',    name: T2Utils.t('video.filter_drama'),       css: 'contrast(1.35) saturate(1.15) brightness(0.88)' },
            { id: 'golden',   name: T2Utils.t('video.filter_golden'),      css: 'sepia(0.5) saturate(1.4) hue-rotate(-15deg) brightness(1.05)' },
            { id: 'neon',     name: T2Utils.t('video.filter_neon'),        css: 'saturate(2.0) contrast(1.2) brightness(1.1) hue-rotate(10deg)' },
            { id: 'matte',    name: T2Utils.t('video.filter_matte'),       css: 'contrast(0.9) brightness(1.08) saturate(0.85)' },
            { id: 'haze',     name: T2Utils.t('video.filter_haze'),        css: 'contrast(0.8) brightness(1.15) saturate(0.7) blur(0.4px)' },
        ];
    }

    /** 효과 기본값 */
    _VE_defaults() {
        return {
            preset: 'original',
            filterCSS: '',
            brightness: 100,
            contrast:   100,
            saturation: 100,
            blur:       0,
            flipH:      false,
            flipV:      false,
            rotate:     0,
            trimStart:  0,
            trimEnd:    null,
        };
    }

    /** container dataset에서 저장된 효과를 읽는다. */
    _getVideoEffects(container) {
        try {
            const raw = container && container.dataset && container.dataset.t2VideoEffects;
            if (raw) return Object.assign(this._VE_defaults(), JSON.parse(raw));
        } catch(_) {}
        return this._VE_defaults();
    }

    /** 현재 effects 객체에서 CSS filter 문자열을 조합한다. */
    _buildFilterCSS(effects) {
        const { filterCSS = '', brightness = 100, contrast = 100, saturation = 100, blur = 0 } = effects;
        const parts = [];
        if (filterCSS) parts.push(filterCSS);
        if (brightness !== 100) parts.push(`brightness(${(brightness / 100).toFixed(2)})`);
        if (contrast   !== 100) parts.push(`contrast(${(contrast   / 100).toFixed(2)})`);
        if (saturation !== 100) parts.push(`saturate(${(saturation / 100).toFixed(2)})`);
        if (blur        >   0 ) parts.push(`blur(${blur}px)`);
        return parts.join(' ');
    }

    /** 현재 effects 객체에서 CSS transform 문자열을 조합한다. */
    _buildTransformCSS(effects) {
        const { flipH = false, flipV = false, rotate = 0 } = effects;
        const parts = [];
        if (flipH)   parts.push('scaleX(-1)');
        if (flipV)   parts.push('scaleY(-1)');
        if (rotate)  parts.push(`rotate(${rotate}deg)`);
        return parts.join(' ');
    }

    /** DOM 요소(주로 iframe)에 effects를 실제 CSS로 적용한다. */
    _applyVideoEffectsToElement(el, effects) {
        if (!el) return;
        const f = this._buildFilterCSS(effects);
        const t = this._buildTransformCSS(effects);
        el.style.filter    = f || '';
        el.style.transform = t || '';
    }

    /** effects를 container에 저장하고 videoElement에 즉시 적용한다. */
    _saveVideoEffects(container, videoElement, effects) {
        container.dataset.t2VideoEffects = JSON.stringify(effects);
        this._applyVideoEffectsToElement(videoElement, effects);
    }

    // ─────────────────────────────────────────────────────────────────
    // _openVideoEditModal — 업로드된 동영상 전용 풍부한 편집 UI
    // ─────────────────────────────────────────────────────────────────
    _openVideoEditModal(container, videoElement, videoInfo, blockId) {
        const effects  = this._getVideoEffects(container);
        const presets  = this._VE_filterPresets();

        // ── 시간 포맷 헬퍼 ──────────────────────────────────────────
        const fmt = (s) => {
            s = Math.max(0, s || 0);
            const m   = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            return `${m}:${sec.toString().padStart(2, '0')}`;
        };

        // ── 전체 오버레이 ────────────────────────────────────────────
        const overlay = document.createElement('div');
        overlay.className = 't2ve-overlay';

        // ── 헤더 ─────────────────────────────────────────────────────
        const header = document.createElement('div');
        header.className = 't2ve-header';
        header.innerHTML =
            '<button class="t2ve-btn-icon t2ve-btn-close" aria-label="' + T2Utils.t('video.edit_close_aria') + '" data-i18n-aria-label="video.edit_close_aria">' +
                '<span class="material-icons">close</span>' +
            '</button>' +
            '<span class="t2ve-title" data-i18n="video.edit_title">' + T2Utils.t('video.edit_title') + '</span>' +
            '<button class="t2ve-btn-apply" data-i18n="video.edit_done">' + T2Utils.t('video.edit_done') + '</button>';

        // ── 프리뷰 스테이지 ──────────────────────────────────────────
        const previewWrap  = document.createElement('div');
        previewWrap.className = 't2ve-preview-wrap';

        const previewStage = document.createElement('div');
        previewStage.className = 't2ve-preview-stage';

        const previewVideo = document.createElement('video');
        previewVideo.className     = 't2ve-preview-video';
        previewVideo.src           = videoInfo.url;
        previewVideo.muted         = true;
        previewVideo.crossOrigin   = 'anonymous';
        previewVideo.preload       = 'auto';
        previewVideo.playsInline   = true;

        previewStage.appendChild(previewVideo);
        previewWrap.appendChild(previewStage);

        // ── 재생 컨트롤 ──────────────────────────────────────────────
        const playback = document.createElement('div');
        playback.className = 't2ve-playback';
        playback.innerHTML =
            '<button class="t2ve-play-btn" aria-label="' + T2Utils.t('video.edit_play_pause_aria') + '" data-i18n-aria-label="video.edit_play_pause_aria">' +
                '<span class="material-icons">play_arrow</span>' +
            '</button>' +
            '<input type="range" class="t2ve-seek-bar" min="0" max="100" step="0.1" value="0">' +
            '<span class="t2ve-time-display">0:00 / 0:00</span>';

        // ── 트림 섹션 ────────────────────────────────────────────────
        const trimSection = document.createElement('div');
        trimSection.className = 't2ve-trim-section';
        trimSection.innerHTML =
            '<div class="t2ve-trim-label">' +
                '<span class="material-icons" style="font-size:13px;vertical-align:-2px;margin-right:4px;">content_cut</span>' +
                '<span data-i18n="video.edit_section_edit">' + T2Utils.t('video.edit_section_edit') + '</span>' +
            '</div>' +
            '<div class="t2ve-trim-track">' +
                '<div class="t2ve-trim-fill"></div>' +
                '<div class="t2ve-trim-handle t2ve-trim-handle-start"></div>' +
                '<div class="t2ve-trim-handle t2ve-trim-handle-end"></div>' +
                '<div class="t2ve-trim-playhead"></div>' +
            '</div>' +
            '<div class="t2ve-trim-time">' +
                '<span class="t2ve-trim-start-time">0:00</span>' +
                '<span class="t2ve-trim-end-time">0:00</span>' +
            '</div>';

        // ── 탭 바 ────────────────────────────────────────────────────
        const tabs = document.createElement('div');
        tabs.className = 't2ve-tabs';
        tabs.innerHTML =
            '<button class="t2ve-tab active" data-panel="filters">' +
                '<span class="material-icons t2ve-tab-icon">auto_awesome</span>' +
                '<span class="t2ve-tab-label" data-i18n="video.edit_tab_filter">' + T2Utils.t('video.edit_tab_filter') + '</span>' +
            '</button>' +
            '<button class="t2ve-tab" data-panel="adjust">' +
                '<span class="material-icons t2ve-tab-icon">tune</span>' +
                '<span class="t2ve-tab-label" data-i18n="video.edit_tab_adjust">' + T2Utils.t('video.edit_tab_adjust') + '</span>' +
            '</button>' +
            '<button class="t2ve-tab" data-panel="transform">' +
                '<span class="material-icons t2ve-tab-icon">flip</span>' +
                '<span class="t2ve-tab-label" data-i18n="video.edit_tab_transform">' + T2Utils.t('video.edit_tab_transform') + '</span>' +
            '</button>';

        // ── 패널 컨테이너 ────────────────────────────────────────────
        const panelsEl = document.createElement('div');
        panelsEl.className = 't2ve-panels';

        // 필터 패널 ───────────────────────────────────────────────────
        const filtersPanel = document.createElement('div');
        filtersPanel.className    = 't2ve-panel active';
        filtersPanel.dataset.panel = 'filters';

        const filterStrip = document.createElement('div');
        filterStrip.className = 't2ve-filter-strip';

        presets.forEach(preset => {
            const item = document.createElement('div');
            item.className     = 't2ve-filter-item' + (effects.preset === preset.id ? ' active' : '');
            item.dataset.presetId = preset.id;

            const thumb = document.createElement('div');
            thumb.className = 't2ve-filter-thumb';
            // 썸네일: 플레이스홀더 div (비디오 loadedmetadata 후 canvas로 교체)
            const ph = document.createElement('div');
            ph.className = 't2ve-filter-thumb-ph';
            // 미리 filter CSS를 thumb에 적용해 시각적 프리뷰 제공
            if (preset.css) thumb.style.filter = preset.css;
            thumb.appendChild(ph);

            const name = document.createElement('span');
            name.className   = 't2ve-filter-name';
            name.textContent = preset.name;

            item.append(thumb, name);
            filterStrip.appendChild(item);
        });

        filtersPanel.appendChild(filterStrip);

        // 조정 패널 ───────────────────────────────────────────────────
        const adjustPanel = document.createElement('div');
        adjustPanel.className    = 't2ve-panel';
        adjustPanel.dataset.panel = 'adjust';

        const adjustWrap = document.createElement('div');
        adjustWrap.className = 't2ve-adjust-panel';

        const adjustDefs = [
            { id: 'brightness', label: T2Utils.t('video.adjust_brightness'), icon: 'brightness_6', min: 50,  max: 150, step: 1,   unit: '%'  },
            { id: 'contrast',   label: T2Utils.t('video.adjust_contrast'),   icon: 'contrast',      min: 50,  max: 150, step: 1,   unit: '%'  },
            { id: 'saturation', label: T2Utils.t('video.adjust_saturation'), icon: 'palette',        min: 0,   max: 200, step: 1,   unit: '%'  },
            { id: 'blur',       label: T2Utils.t('video.adjust_blur'),       icon: 'blur_on',        min: 0,   max: 10,  step: 0.5, unit: 'px' },
        ];

        adjustDefs.forEach(def => {
            const curVal = effects[def.id] !== undefined ? effects[def.id] : (def.id === 'brightness' || def.id === 'contrast' ? 100 : def.id === 'saturation' ? 100 : 0);
            const pct    = ((curVal - def.min) / (def.max - def.min) * 100).toFixed(1);
            const row    = document.createElement('div');
            row.className = 't2ve-adjust-row';
            row.innerHTML =
                '<span class="t2ve-adjust-icon"><span class="material-icons">' + def.icon + '</span></span>' +
                '<span class="t2ve-adjust-label">' + def.label + '</span>' +
                '<input type="range" class="t2ve-adjust-slider" ' +
                    'data-adjust="' + def.id + '" ' +
                    'min="' + def.min + '" max="' + def.max + '" step="' + def.step + '" ' +
                    'value="' + curVal + '" style="--pct:' + pct + '%">' +
                '<span class="t2ve-adjust-value" data-value-for="' + def.id + '">' + curVal + def.unit + '</span>';
            adjustWrap.appendChild(row);
        });

        adjustPanel.appendChild(adjustWrap);

        // 변형 패널 ───────────────────────────────────────────────────
        const transformPanel = document.createElement('div');
        transformPanel.className    = 't2ve-panel';
        transformPanel.dataset.panel = 'transform';

        const transformWrap = document.createElement('div');
        transformWrap.className = 't2ve-transform-panel';

        const transformDefs = [
            { action: 'flipH',     icon: 'flip',         label: T2Utils.t('video.transform_flipH'), rotate: false },
            { action: 'flipV',     icon: 'flip',         label: T2Utils.t('video.transform_flipV'), rotate: false, iconStyle: 'transform:rotate(90deg)' },
            { action: 'rotateL',   icon: 'rotate_left',  label: T2Utils.t('video.transform_rotateL'), rotate: true  },
            { action: 'rotateR',   icon: 'rotate_right', label: T2Utils.t('video.transform_rotateR'), rotate: true  },
            { action: 'rotate180', icon: 'sync',         label: '180°',                                rotate: true  },
            { action: 'reset',     icon: 'restart_alt',  label: T2Utils.t('video.transform_reset'),    rotate: false },
        ];

        const transformRow1 = document.createElement('div');
        transformRow1.className = 't2ve-transform-row';
        const transformRow2 = document.createElement('div');
        transformRow2.className = 't2ve-transform-row';

        transformDefs.forEach((def, i) => {
            const isActive =
                (def.action === 'flipH'     && effects.flipH) ||
                (def.action === 'flipV'     && effects.flipV) ||
                (def.action === 'rotateL'   && effects.rotate === -90) ||
                (def.action === 'rotateR'   && effects.rotate === 90)  ||
                (def.action === 'rotate180' && effects.rotate === 180);

            const btn = document.createElement('button');
            btn.className       = 't2ve-transform-btn' + (isActive ? ' active' : '');
            btn.dataset.action  = def.action;
            btn.type            = 'button';
            btn.innerHTML =
                '<span class="material-icons"' + (def.iconStyle ? ' style="' + def.iconStyle + '"' : '') + '>' + def.icon + '</span>' +
                def.label;

            (i < 2 ? transformRow1 : transformRow2).appendChild(btn);
        });

        transformWrap.append(transformRow1, transformRow2);
        transformPanel.appendChild(transformWrap);

        panelsEl.append(filtersPanel, adjustPanel, transformPanel);

        // ── 조립 ─────────────────────────────────────────────────────
        overlay.append(header, previewWrap, playback, trimSection, tabs, panelsEl);
        document.body.appendChild(overlay);

        // ── 상태 ─────────────────────────────────────────────────────
        const workingEffects = Object.assign(this._VE_defaults(), effects);
        let videoDuration   = 0;
        let isDraggingS     = false;
        let isDraggingE     = false;
        let isSeekDragging  = false;
        let thumbFilled     = false;

        // ── 요소 참조 ────────────────────────────────────────────────
        const playBtn    = playback.querySelector('.t2ve-play-btn');
        const playIcon   = playBtn.querySelector('.material-icons');
        const seekBar    = playback.querySelector('.t2ve-seek-bar');
        const timeDisp   = playback.querySelector('.t2ve-time-display');
        const trimFill   = trimSection.querySelector('.t2ve-trim-fill');
        const trimHS     = trimSection.querySelector('.t2ve-trim-handle-start');
        const trimHE     = trimSection.querySelector('.t2ve-trim-handle-end');
        const trimPH     = trimSection.querySelector('.t2ve-trim-playhead');
        const trimTimeS  = trimSection.querySelector('.t2ve-trim-start-time');
        const trimTimeE  = trimSection.querySelector('.t2ve-trim-end-time');
        const trackEl    = trimSection.querySelector('.t2ve-trim-track');

        // ── 프리뷰 필터 적용 ─────────────────────────────────────────
        const applyPreview = () => {
            previewVideo.style.filter    = this._buildFilterCSS(workingEffects)    || '';
            previewVideo.style.transform = this._buildTransformCSS(workingEffects) || '';
        };
        applyPreview();

        // ── 트림 UI 업데이트 ─────────────────────────────────────────
        const updateTrimUI = () => {
            if (!videoDuration) return;
            const tS  = workingEffects.trimStart || 0;
            const tE  = workingEffects.trimEnd   ?? videoDuration;
            const pS  = (tS / videoDuration) * 100;
            const pE  = (tE / videoDuration) * 100;
            trimHS.style.left         = pS + '%';
            trimHE.style.left         = pE + '%';
            trimFill.style.left       = pS + '%';
            trimFill.style.width      = (pE - pS) + '%';
            trimTimeS.textContent     = fmt(tS);
            trimTimeE.textContent     = fmt(tE);
        };

        // ── 썸네일 캡처 → 필터 스왓치 채우기 ────────────────────────
        const fillThumbnails = () => {
            if (thumbFilled) return;
            thumbFilled = true;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 80; canvas.height = 80;
                const ctx    = canvas.getContext('2d');
                ctx.drawImage(previewVideo, 0, 0, 80, 80);
                const src = canvas.toDataURL('image/jpeg', 0.7);
                filterStrip.querySelectorAll('.t2ve-filter-thumb-ph').forEach(ph => {
                    const img = document.createElement('img');
                    img.src = src;
                    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:8px;';
                    ph.replaceWith(img);
                });
            } catch(_) { /* CORS 실패 시 그라데이션 플레이스홀더 유지 */ }
        };

        // ── 재생 위치 업데이트 ───────────────────────────────────────
        const updatePlayhead = () => {
            if (!videoDuration || isSeekDragging) return;
            const t   = previewVideo.currentTime;
            const pct = (t / videoDuration) * 100;
            seekBar.value = pct;
            seekBar.style.setProperty('--pct', pct + '%');
            timeDisp.textContent = fmt(t) + ' / ' + fmt(videoDuration);
            trimPH.style.left    = pct + '%';

            // 트림 종료점에서 루프
            const tE = workingEffects.trimEnd ?? videoDuration;
            if (t >= tE) {
                previewVideo.currentTime = workingEffects.trimStart || 0;
                if (!previewVideo.paused) previewVideo.play().catch(() => {});
            }
        };

        // ── 비디오 이벤트 ────────────────────────────────────────────
        previewVideo.addEventListener('loadedmetadata', () => {
            videoDuration = previewVideo.duration || 0;
            if (workingEffects.trimEnd === null) workingEffects.trimEnd = videoDuration;
            timeDisp.textContent = '0:00 / ' + fmt(videoDuration);
            updateTrimUI();
            // 썸네일 캡처용 seek
            previewVideo.currentTime = Math.min(0.5, videoDuration * 0.05);
        });

        previewVideo.addEventListener('seeked', () => {
            fillThumbnails();
        }, { once: true });

        previewVideo.addEventListener('timeupdate', updatePlayhead);
        previewVideo.addEventListener('play',  () => { playIcon.textContent = 'pause'; });
        previewVideo.addEventListener('pause', () => { playIcon.textContent = 'play_arrow'; });
        previewVideo.addEventListener('ended', () => {
            playIcon.textContent = 'play_arrow';
            previewVideo.currentTime = workingEffects.trimStart || 0;
        });

        // ── 재생 버튼 ────────────────────────────────────────────────
        playBtn.addEventListener('click', () => {
            if (previewVideo.paused) {
                const tE = workingEffects.trimEnd ?? videoDuration;
                if (previewVideo.currentTime >= tE || previewVideo.currentTime < (workingEffects.trimStart || 0)) {
                    previewVideo.currentTime = workingEffects.trimStart || 0;
                }
                previewVideo.play().catch(() => {});
            } else {
                previewVideo.pause();
            }
        });

        // ── Seek bar ─────────────────────────────────────────────────
        seekBar.addEventListener('mousedown',  () => { isSeekDragging = true;  });
        seekBar.addEventListener('touchstart', () => { isSeekDragging = true;  }, { passive: true });
        seekBar.addEventListener('mouseup',    () => { isSeekDragging = false; });
        seekBar.addEventListener('touchend',   () => { isSeekDragging = false; });
        seekBar.addEventListener('input', () => {
            if (!videoDuration) return;
            const t = (parseFloat(seekBar.value) / 100) * videoDuration;
            previewVideo.currentTime = t;
            timeDisp.textContent = fmt(t) + ' / ' + fmt(videoDuration);
            seekBar.style.setProperty('--pct', seekBar.value + '%');
        });

        // ── 트림 핸들 드래그 ─────────────────────────────────────────
        const onTrimMove = (e) => {
            if (!isDraggingS && !isDraggingE) return;
            const rect   = trackEl.getBoundingClientRect();
            const cx     = e.touches ? e.touches[0].clientX : e.clientX;
            const pct    = Math.max(0, Math.min(100, ((cx - rect.left) / rect.width) * 100));
            const t      = (pct / 100) * videoDuration;

            if (isDraggingS) {
                workingEffects.trimStart = Math.min(t, (workingEffects.trimEnd ?? videoDuration) - 0.5);
                previewVideo.currentTime = workingEffects.trimStart;
            } else {
                workingEffects.trimEnd = Math.max(t, (workingEffects.trimStart || 0) + 0.5);
                previewVideo.currentTime = workingEffects.trimEnd;
            }
            updateTrimUI();
        };

        const onTrimUp = () => { isDraggingS = false; isDraggingE = false; };

        trimHS.addEventListener('mousedown',  (e) => { e.preventDefault(); isDraggingS = true; });
        trimHS.addEventListener('touchstart', ()  => { isDraggingS = true; }, { passive: true });
        trimHE.addEventListener('mousedown',  (e) => { e.preventDefault(); isDraggingE = true; });
        trimHE.addEventListener('touchstart', ()  => { isDraggingE = true; }, { passive: true });

        window.addEventListener('mousemove',  onTrimMove);
        window.addEventListener('touchmove',  onTrimMove, { passive: true });
        window.addEventListener('mouseup',    onTrimUp);
        window.addEventListener('touchend',   onTrimUp);

        // ── 탭 전환 ──────────────────────────────────────────────────
        tabs.querySelectorAll('.t2ve-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.querySelectorAll('.t2ve-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const pid = tab.dataset.panel;
                panelsEl.querySelectorAll('.t2ve-panel').forEach(p => {
                    p.classList.toggle('active', p.dataset.panel === pid);
                });
            });
        });

        // ── 필터 선택 ────────────────────────────────────────────────
        filterStrip.querySelectorAll('.t2ve-filter-item').forEach(item => {
            item.addEventListener('click', () => {
                filterStrip.querySelectorAll('.t2ve-filter-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const preset = presets.find(p => p.id === item.dataset.presetId);
                if (preset) {
                    workingEffects.preset    = preset.id;
                    workingEffects.filterCSS = preset.css;
                    applyPreview();
                }
            });
        });

        // ── 조정 슬라이더 ────────────────────────────────────────────
        adjustWrap.querySelectorAll('.t2ve-adjust-slider').forEach(slider => {
            const key  = slider.dataset.adjust;
            const min  = parseFloat(slider.min);
            const max  = parseFloat(slider.max);
            const disp = adjustWrap.querySelector('[data-value-for="' + key + '"]');
            const unit = key === 'blur' ? 'px' : '%';

            slider.addEventListener('input', () => {
                const val = parseFloat(slider.value);
                workingEffects[key] = val;
                const pct = ((val - min) / (max - min) * 100).toFixed(1);
                slider.style.setProperty('--pct', pct + '%');
                if (disp) disp.textContent = val + unit;
                applyPreview();
            });
        });

        // ── 변형 버튼 ────────────────────────────────────────────────
        const syncRotateBtns = () => {
            transformWrap.querySelectorAll('[data-action^="rotate"]').forEach(b => b.classList.remove('active'));
            const r = workingEffects.rotate;
            const sel = r === -90 ? 'rotateL' : r === 90 ? 'rotateR' : r === 180 ? 'rotate180' : null;
            if (sel) {
                const b = transformWrap.querySelector('[data-action="' + sel + '"]');
                if (b) b.classList.add('active');
            }
        };

        transformWrap.querySelectorAll('.t2ve-transform-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'flipH') {
                    workingEffects.flipH = !workingEffects.flipH;
                    btn.classList.toggle('active', workingEffects.flipH);
                } else if (action === 'flipV') {
                    workingEffects.flipV = !workingEffects.flipV;
                    btn.classList.toggle('active', workingEffects.flipV);
                } else if (action === 'rotateL') {
                    workingEffects.rotate = ((workingEffects.rotate || 0) - 90 + 360) % 360;
                    if (workingEffects.rotate === 270) workingEffects.rotate = -90;
                    syncRotateBtns();
                } else if (action === 'rotateR') {
                    workingEffects.rotate = ((workingEffects.rotate || 0) + 90) % 360;
                    if (workingEffects.rotate > 180) workingEffects.rotate -= 360;
                    syncRotateBtns();
                } else if (action === 'rotate180') {
                    workingEffects.rotate = workingEffects.rotate === 180 ? 0 : 180;
                    syncRotateBtns();
                } else if (action === 'reset') {
                    // 변형만 초기화
                    workingEffects.flipH   = false;
                    workingEffects.flipV   = false;
                    workingEffects.rotate  = 0;
                    transformWrap.querySelectorAll('.t2ve-transform-btn').forEach(b => b.classList.remove('active'));
                }
                applyPreview();
            });
        });

        // ── 모달 닫기 ────────────────────────────────────────────────
        const cleanup = () => {
            previewVideo.pause();
            previewVideo.src = '';
            window.removeEventListener('mousemove',  onTrimMove);
            window.removeEventListener('touchmove',  onTrimMove);
            window.removeEventListener('mouseup',    onTrimUp);
            window.removeEventListener('touchend',   onTrimUp);
            document.removeEventListener('keydown', onKeyDown);
            overlay.remove();
        };

        const onKeyDown = (e) => { if (e.key === 'Escape') cleanup(); };
        document.addEventListener('keydown', onKeyDown);

        header.querySelector('.t2ve-btn-close').addEventListener('click', cleanup);

        // ── 완료 ─────────────────────────────────────────────────────
        header.querySelector('.t2ve-btn-apply').addEventListener('click', () => {
            this._saveVideoEffects(container, videoElement, workingEffects);

            // 트림 파라미터를 iframe src에 반영 (video_player.php 지원 시)
            const tS = workingEffects.trimStart || 0;
            const tE = workingEffects.trimEnd ?? videoDuration;
            if (videoDuration > 0 && (tS > 0 || tE < videoDuration - 0.5)) {
                try {
                    const currentSrc = videoElement.getAttribute('src') || '';
                    const url = new URL(currentSrc, window.location.href);
                    url.searchParams.set('t_start', Math.floor(tS));
                    url.searchParams.set('t_end',   Math.floor(tE));
                    videoElement.src = url.toString();
                    // container dataset에도 트림 기록
                    container.dataset.t2TrimStart = Math.floor(tS);
                    container.dataset.t2TrimEnd   = Math.floor(tE);
                } catch(_) { /* URL 파싱 실패 무시 */ }
            }

            this.editor.createUndoPoint();
            this.editor.autoSave();
            cleanup();
        });
    }

    // ═══════════════════════════════════════════════════════════════════════

    cleanupEmptyLines(videoBlock) {
        // 빈 줄 개수는 사용자 콘텐츠의 일부다. 플러그인이 임의로 연속 빈 문단을
        // 삭제하지 않고, 코어가 관리하는 블록 직전/직후 입력 경계만 보장한다.
        if (this.editor && typeof this.editor.ensureBlockBoundaryLines === 'function') {
            this.editor.ensureBlockBoundaryLines(videoBlock);
            return;
        }

        // 구형 코어 호환 폴백: 필요한 경계만 추가하고 기존 빈 줄은 보존한다.
        const makeBoundary = () => {
            const p = document.createElement('p');
            p.appendChild(document.createTextNode('\u200B'));
            p.appendChild(document.createElement('br'));
            return p;
        };
        const isEmptyParagraph = (node) => !!(node && node.tagName === 'P' &&
            !(node.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim());

        if (!isEmptyParagraph(videoBlock.previousElementSibling)) {
            videoBlock.parentNode.insertBefore(makeBoundary(), videoBlock);
        }
        if (!isEmptyParagraph(videoBlock.nextElementSibling)) {
            videoBlock.parentNode.insertBefore(makeBoundary(), videoBlock.nextSibling);
        }
    }
    initializeVideoBlocks() {
        
        // 1단계: 단독 iframe/video 태그 처리
        this.editor.editor.querySelectorAll('iframe:not(.t2-media-block iframe)').forEach(frame => {
            let videoInfo = null;

            // [FIX] IDL .src(절대 URL)과 content attribute(원본 상대 URL) 모두 시도
            const resolvedSrc = frame.src || '';
            const rawSrc      = frame.getAttribute('src') || '';

            if (resolvedSrc.includes('youtube.com/embed/') || rawSrc.includes('youtube.com/embed/')) {
                const videoId =
                    resolvedSrc.match(/embed\/([^?]+)/)?.[1] ||
                    rawSrc.match(/embed\/([^?]+)/)?.[1];
                if (videoId) {
                    videoInfo = { type: 'youtube', id: videoId };
                }
            }
            else if (this._isT2VideoFrameURL(resolvedSrc) || this._isT2VideoFrameURL(rawSrc)) {
                // [FIX] [?&]video= 로 첫 파라미터·중간 파라미터 모두 매칭
                const matchResolved = resolvedSrc.match(/[?&]video=([^&]+)/);
                const matchRaw      = rawSrc.match(/[?&]video=([^&]+)/);
                const encoded = (matchResolved || matchRaw)?.[1] || '';
                if (encoded) {
                    try {
                        const url = decodeURIComponent(encoded);
                        videoInfo = { type: 'video', url };
                    } catch (e) {
                        videoInfo = { type: 'video', url: encoded };
                    }
                }
            }
            
            if (videoInfo) {
                const wrapper = this.createVideoBlock(videoInfo);
                if (wrapper) {
                    frame.parentNode.replaceChild(wrapper, frame);
                    this.cleanupEmptyLines(wrapper);
                } else {
                    frame.remove();
                }
            } else {
                // [SEC-IFRAME-ALLOWLIST] 인식되지 않는 iframe:
                // 허용 도메인이면 sandbox 만 적용, 비허용이면 제거.
                const src = frame.getAttribute('src') || '';
                if (!T2Editor._isAllowedIframeSrc(src)) {
                    console.warn(T2Utils.tf('video.console_disallowed_iframe', {}, '[T2Video] Removed disallowed iframe:'), src);
                    frame.remove();
                } else if (this._isT2VideoFrameURL(src)) {
                    // [FIX-G5-IFRAME] T2 직접 업로드 비디오 iframe은 9.1.1 호환 저장 구조 유지.
                    frame.removeAttribute('sandbox');
                } else if (!frame.hasAttribute('sandbox')) {
                    T2Editor._applyIframeSandbox(frame, src);
                }
            }
        });

        this.editor.editor.querySelectorAll('video:not(.t2-media-block video)').forEach(video => {
            const videoInfo = this._sanitizeVideoInfo({ type: 'video', url: video.getAttribute('src') || video.src });
            const wrapper = this.createVideoBlock(videoInfo);
            if (wrapper) {
                video.parentNode.replaceChild(wrapper, video);
                this.cleanupEmptyLines(wrapper);
            } else {
                video.remove();
            }
        });

        // 2단계: 기존 미디어 블록 재초기화
        this.editor.editor.querySelectorAll('.t2-media-block').forEach(block => {
            // 극단적 케이스(container/video 태그까지 필터에 삭제됨) 복원 —
            // wrapper의 data-video-*를 근거로 재구성한다.
            let container = block.querySelector('div:first-child');
            if (!container || container === block) {
                // container가 사라졌으면 wrapper 통째로 createVideoBlock()으로 재생성
                const vTypeS = block.getAttribute('data-video-type') || '';
                const vIdS   = block.getAttribute('data-video-id')   || '';
                const vUrlS  = block.getAttribute('data-video-url')  || '';
                let info = null;
                if (vTypeS === 'youtube' && vIdS) info = { type: 'youtube', id: vIdS };
                else if (vTypeS === 'video'   && vUrlS) info = { type: 'video',   url: vUrlS };
                else {
                    // wrapper 하위에 남은 anchor/영상 링크 검색
                    const anchor = block.querySelector('.t2-video-source[href], a[href]');
                    if (anchor) {
                        const href = anchor.getAttribute('href') || '';
                        const yt = href.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9\-_]+)/);
                        if (yt) info = { type: 'youtube', id: yt[1] };
                        else if (/\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|wmv|flv|m3u8)(\?|#|$)/i.test(href)) {
                            info = { type: 'video', url: href };
                        }
                    }
                }
                if (info) {
                    const rebuilt = this.createVideoBlock(this._sanitizeVideoInfo(info));
                    if (rebuilt) {
                        block.parentNode.replaceChild(rebuilt, block);
                        this.cleanupEmptyLines(rebuilt);
                    }
                }
                return;
            }
            const mediaElement = container?.querySelector('iframe, video');
            
            // URL 복구 우선순위: iframe.dataset → wrapper/container data-* →
            // iframe src 파싱 → .t2-video-source[href]
            const _resolveVideoInfo = (currentIframe) => {
                // ── 우선순위 1: iframe.dataset (가장 신뢰) ──────────────────
                if (currentIframe) {
                    const rawSrc      = currentIframe.getAttribute('src') || '';
                    const resolvedSrc = currentIframe.src || '';

                    const isYoutube =
                        currentIframe.dataset.videoType === 'youtube' ||
                        resolvedSrc.includes('youtube.com') ||
                        rawSrc.includes('youtube.com');

                    if (isYoutube) {
                        const videoId =
                            currentIframe.dataset.videoId ||
                            resolvedSrc.match(/embed\/([^?]+)/)?.[1] ||
                            rawSrc.match(/embed\/([^?]+)/)?.[1];
                        if (videoId) {
                            if (!currentIframe.dataset.videoType) currentIframe.dataset.videoType = 'youtube';
                            if (!currentIframe.dataset.videoId)   currentIframe.dataset.videoId   = videoId;
                            return { type: 'youtube', id: videoId };
                        }
                    }

                    // 직접 비디오: data-video-url 또는 src 파싱
                    let videoUrl = currentIframe.dataset.videoUrl || '';
                    if (!videoUrl) {
                        const matchResolved = resolvedSrc.match(/[?&]video=([^&]+)/);
                        const matchRaw      = rawSrc.match(/[?&]video=([^&]+)/);
                        const encoded = (matchResolved || matchRaw)?.[1] || '';
                        if (encoded) {
                            try { videoUrl = decodeURIComponent(encoded); }
                            catch(e) { videoUrl = encoded; }
                        }
                    }
                    if (videoUrl) {
                        if (!currentIframe.dataset.videoType) currentIframe.dataset.videoType = 'video';
                        if (!currentIframe.dataset.videoUrl)  currentIframe.dataset.videoUrl  = videoUrl;
                        return { type: 'video', url: videoUrl };
                    }
                }

                // ── 우선순위 2: wrapper/container data-* ─────────────────────
                for (const el of [block, container].filter(Boolean)) {
                    const vType = el.getAttribute('data-video-type') || el.dataset.videoType;
                    if (vType === 'youtube') {
                        const id = el.getAttribute('data-video-id') || el.dataset.videoId;
                        if (id) return { type: 'youtube', id };
                    } else if (vType === 'video') {
                        const vUrl = el.getAttribute('data-video-url') || el.dataset.videoUrl;
                        if (vUrl) return { type: 'video', url: vUrl };
                    }
                }

                // ── 우선순위 3: .t2-video-source[href] fallback anchor ────────
                const anchor = container?.querySelector('.t2-video-source[href]') ||
                               block.querySelector('.t2-video-source[href]');
                if (anchor) {
                    const href = anchor.getAttribute('href') || '';
                    if (href) {
                        const info = T2Utils.getVideoType(href);
                        if (info) return info;
                    }
                }

                return null;
            };

            // ── iframe이 없는 경우: fallback URL로 iframe 재생성 ───────────────
            if (!mediaElement && container) {
                const videoInfo = _resolveVideoInfo(null);
                if (videoInfo) {
                    console.log(T2Utils.tf('video.console_no_iframe_fallback', {}, '[T2Video] No iframe — recreating as fallback:'), videoInfo);
                    const newWrapper = this.createVideoBlock(videoInfo);
                    if (newWrapper) {
                        block.parentNode.replaceChild(newWrapper, block);
                        this.cleanupEmptyLines(newWrapper);
                    }
                    return; // forEach 다음 항목으로
                }
                // URL도 없으면 빈 뼈대 방치 방지
                return;
            }

            if (!mediaElement) return;
            
            // video 태그를 iframe으로 변환
            if (mediaElement.tagName === 'VIDEO') {
                // 저장 포맷은 <video><source src></video>. 우선순위: video 자체 속성
                // → data-video-url → <source> 자식.
                const videoUrl =
                    mediaElement.getAttribute('src') ||
                    mediaElement.src ||
                    mediaElement.dataset.videoUrl ||
                    container?.getAttribute('data-video-url') ||
                    block.getAttribute('data-video-url') ||
                    mediaElement.querySelector('source')?.getAttribute('src') ||
                    '';
                const videoInfo = this._sanitizeVideoInfo({ type: 'video', url: videoUrl });
                if (!videoInfo) {
                    mediaElement.remove();
                    return;
                }
                const newIframe = document.createElement('iframe');
                const nextSrc = this.getVideoIframeUrl(videoInfo);
                if (!nextSrc) {
                    mediaElement.remove();
                    return;
                }
                newIframe.src = nextSrc;
                newIframe.frameBorder = "0";
                newIframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
                newIframe.allowFullscreen = true;
                // 임시로 100% — 아래에서 실제 치수 확정 즉시 width/height 속성+px style로 덮어씀
                newIframe.style.width = '100%';
                newIframe.style.height = '100%';
                newIframe.style.borderRadius = '15px';
                newIframe.style.border = 'none';
                newIframe.dataset.videoType = 'video';
                newIframe.dataset.videoUrl = videoInfo.url;

                // video_view.php iframe은 sandbox 없이 유지
                newIframe.removeAttribute('sandbox');
                
                // <video> style이 필터에 잘렸으면 container dataset에서 복원
                const _videoWpx = parseInt(
                    mediaElement.style.width ||
                    (container?.dataset.originalWidth) ||
                    (container?.dataset.width) || '',
                    10
                );
                const _videoHpx = parseInt(
                    mediaElement.style.height ||
                    (container?.dataset.originalHeight) ||
                    (container?.dataset.height) || '',
                    10
                );
                if (_videoWpx && container && !container.style.width)  container.style.width  = _videoWpx + 'px';
                if (_videoHpx && container && !container.style.height) container.style.height = _videoHpx + 'px';

                mediaElement.parentNode.replaceChild(newIframe, mediaElement);
            }
            
            // 기존 iframe인 경우에도 직접 업로드 비디오는 sandbox 제거
            if (mediaElement.tagName === 'IFRAME') {
                const existingSrc = mediaElement.getAttribute('src') || '';
                if (this._isT2VideoFrameURL(existingSrc)) {
                    mediaElement.removeAttribute('sandbox');
                } else if (!mediaElement.hasAttribute('sandbox')) {
                    T2Editor._applyIframeSandbox(mediaElement, existingSrc);
                }
            }
            
            // 블록 설정
            block.contentEditable = false;
            block.style.position = 'relative';
            if (!block.classList.contains('t2-video-block')) {
                block.classList.add('t2-video-block');
            }
            // wrapper 정렬 복원 — data-align 우선, 없으면 center. 이미 명시적
            // inline style이 있으면 덮어쓰지 않는다.
            const _blockStyleAttr = block.getAttribute('style') || '';
            if (!/text-align\s*:/i.test(_blockStyleAttr)) {
                block.style.textAlign = block.getAttribute('data-align') || 'center';
            }
            if (!block.getAttribute('data-align')) {
                block.setAttribute('data-align', 'center');
            }
            
            // blockId 확인
            if (!block.getAttribute('data-block-id')) {
                block.setAttribute('data-block-id', this.generateBlockId());
            }
            
            // 컨테이너 보정 — margin이 부분 손상(auto만 사라짐)됐는지 실제 적용된
            // 스타일 기준으로 검사해 필요 시 재주입.
            const _containerStyleAttr = container.getAttribute('style') || '';
            // 구버전 저장물의 max-width:100%도 수정 화면에서 즉시 95%로 교정한다.
            container.style.maxWidth = '95%';
            // display가 block이면 wrapper의 text-align이 무효화되므로 inline-block으로 보정
            if (window.getComputedStyle(container).display !== 'inline-block') {
                container.style.display = 'inline-block';
                container.style.verticalAlign = 'top';
            }
            {
                const cs = window.getComputedStyle ? window.getComputedStyle(container) : null;
                const marginLeftAuto  = cs ? cs.marginLeft  === 'auto' : /margin-left\s*:\s*auto/i.test(_containerStyleAttr) || /margin\s*:\s*0\s+auto/i.test(_containerStyleAttr);
                const marginRightAuto = cs ? cs.marginRight === 'auto' : /margin-right\s*:\s*auto/i.test(_containerStyleAttr) || /margin\s*:\s*0\s+auto/i.test(_containerStyleAttr);
                if (!(marginLeftAuto && marginRightAuto)) {
                    container.style.margin = '0 auto';
                }
            }
            
            // 현재 표시 치수와 슬라이더 기준 치수를 분리해 복원한다.
            // t2w/t2h 및 data-video-width/height는 현재 표시 크기이고,
            // data-video-base-* / data-base-* / original*은 변경되지 않는 100% 기준 크기다.
            let _currentSize = null;
            if (mediaElement && mediaElement.tagName === 'IFRAME') {
                _currentSize = T2VideoPlugin.parseSizeFromSrc(mediaElement.getAttribute('src') || '');
            }
            if (!_currentSize) {
                const _wAttr = parseInt(block.getAttribute('data-video-width'), 10);
                const _hAttr = parseInt(block.getAttribute('data-video-height'), 10);
                if (_wAttr && _hAttr) _currentSize = { width: _wAttr, height: _hAttr };
            }
            if (!_currentSize) {
                const cw = parseInt(container.style.width, 10) || parseInt(container.dataset.width, 10);
                const ch = parseInt(container.style.height, 10) || parseInt(container.dataset.height, 10);
                if (cw && ch) _currentSize = { width: cw, height: ch };
            }
            if (!_currentSize) _currentSize = { width: 560, height: 315 };

            // 저장 HTML에 과거의 큰 px 크기가 남아 있어도 현재 비디오 블록 내부
            // 너비의 95%를 넘지 않게 즉시 클램핑한다. 높이는 기존 종횡비로 재계산.
            const _currentRatio = _currentSize.width > 0
                ? (_currentSize.height / _currentSize.width)
                : (315 / 560);
            const _maxAllowedWidth = this._getVideoMaxWidth(container, _currentSize.width);
            if (_currentSize.width > _maxAllowedWidth) {
                _currentSize = {
                    width: _maxAllowedWidth,
                    height: Math.max(1, Math.round(_maxAllowedWidth * _currentRatio))
                };
            }

            let _baseWidth = parseInt(block.getAttribute('data-video-base-width'), 10)
                || parseInt(container.dataset.baseWidth, 10)
                || parseInt(container.dataset.originalWidth, 10);
            let _baseHeight = parseInt(block.getAttribute('data-video-base-height'), 10)
                || parseInt(container.dataset.baseHeight, 10)
                || parseInt(container.dataset.originalHeight, 10);

            // 구버전 저장물에는 기준 치수가 없고 original*도 현재 축소값으로 오염되어 있다.
            // 슬라이더 상한은 이제 블록의 95%이므로 기준 치수는 종횡비 보존용으로만 복구한다.
            const hasExplicitBase = !!(block.getAttribute('data-video-base-width') && block.getAttribute('data-video-base-height'))
                || !!(container.dataset.baseWidth && container.dataset.baseHeight);
            if (!hasExplicitBase) {
                _baseWidth = Math.max(_currentSize.width, _maxAllowedWidth);
                _baseHeight = Math.max(1, Math.round(_baseWidth * _currentSize.height / _currentSize.width));
            }
            _baseWidth = this._toBoundedInt(_baseWidth, _currentSize.width, 1, 10000);
            _baseHeight = this._toBoundedInt(_baseHeight, _currentSize.height, 1, 10000);

            container.dataset.width = String(_currentSize.width);
            container.dataset.height = String(_currentSize.height);
            container.dataset.baseWidth = String(_baseWidth);
            container.dataset.baseHeight = String(_baseHeight);
            container.dataset.originalWidth = String(_baseWidth);
            container.dataset.originalHeight = String(_baseHeight);
            block.setAttribute('data-video-width', String(_currentSize.width));
            block.setAttribute('data-video-height', String(_currentSize.height));
            block.setAttribute('data-video-base-width', String(_baseWidth));
            block.setAttribute('data-video-base-height', String(_baseHeight));
            container.style.width = _currentSize.width + 'px';
            container.style.height = _currentSize.height + 'px';
            {
                const wPx = _currentSize.width;
                const hPx = _currentSize.height;
                // container뿐 아니라 실제 미디어 태그 자신에게도 width/height 속성+px style을
                // 직접 새긴다 — 이 태그 하나만 살아남아도 항상 올바른 크기로 표시된다.
                const liveMedia = block.querySelector('iframe, video');
                if (liveMedia && wPx && hPx) {
                    liveMedia.setAttribute('width',  String(wPx));
                    liveMedia.setAttribute('height', String(hPx));
                    liveMedia.style.width  = wPx + 'px';
                    liveMedia.style.height = hPx + 'px';
                }
            }
            
            // P 태그 안에 있으면 꺼내기
            if (block.parentNode.nodeName === 'P') {
                const p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                p.remove();
            }
            
            // ✅ 컨트롤 재생성
            const existingControls = block.querySelector('.t2-media-controls');
            if (existingControls) {
                existingControls.remove();
            }
            
            const currentIframe = container.querySelector('iframe');
            const videoInfo = this._sanitizeVideoInfo(_resolveVideoInfo(currentIframe));

            if (videoInfo) {
                // [FIX-PERSIST] 복구된 URL을 wrapper/container/fallback에 재기록
                // — 다음 저장 후 수정 시 소실 방지
                block.setAttribute('data-t2-block', 'video');
                block.setAttribute('data-video-type', videoInfo.type);
                container.setAttribute('data-t2-block', 'video');
                container.setAttribute('data-video-type', videoInfo.type);

                if (videoInfo.type === 'youtube') {
                    block.setAttribute('data-video-id', videoInfo.id || '');
                    container.setAttribute('data-video-id', videoInfo.id || '');
                    block.removeAttribute('data-video-url');
                    container.removeAttribute('data-video-url');
                } else {
                    block.setAttribute('data-video-url', videoInfo.url || '');
                    container.setAttribute('data-video-url', videoInfo.url || '');
                    block.removeAttribute('data-video-id');
                    container.removeAttribute('data-video-id');
                }

                // fallback anchor 갱신 (없으면 재생성)
                let anchor = container.querySelector('.t2-video-source');
                if (!anchor) {
                    anchor = document.createElement('a');
                    anchor.className = 't2-video-source';
                    container.appendChild(anchor);
                }
                if (videoInfo.type === 'youtube') {
                    const safeId = String(videoInfo.id || '').replace(/[^a-zA-Z0-9\-_]/g, '');
                    anchor.href = safeId ? `https://www.youtube.com/watch?v=${safeId}` : '';
                } else {
                    // [SEC-URL] 복구된 직접 비디오 URL 은 저장 HTML에서 유래할 수 있으므로
                    // href 컨텍스트(javascript:, vbscript:, data: 차단)로 sanitizeURL 검증.
                    anchor.href = this._sanitizeURL(videoInfo.url || '', 'href');
                }
                // [10.4.1 GRACEFUL-FALLBACK] 필터로 스타일이 손상된 채 살아남은
                // 기존 anchor 를 재사용하는 경우에도 매번 스타일/텍스트를 재적용.
                this._styleFallbackAnchor(anchor, videoInfo.type);

                const currentWidth  = parseInt(container.dataset.width)  || 560;
                const currentHeight = parseInt(container.dataset.height) || 315;
                const baseWidth  = parseInt(container.dataset.baseWidth)  || parseInt(container.dataset.originalWidth)  || currentWidth;
                const baseHeight = parseInt(container.dataset.baseHeight) || parseInt(container.dataset.originalHeight) || currentHeight;

                // iframe이 없었다면 여기서 재생성했을 것이므로 currentIframe 재취득
                const activeIframe = container.querySelector('iframe') || currentIframe;
                if (activeIframe && videoInfo.type === 'video') {
                    // [FIX-SRC-SIZE-CARRY] width/height를 함께 넘겨야 t2w/t2h가
                    // 유지된다. 크기 없이 비교하면 이미 t2w/t2h가 붙어있는 정상
                    // src를 "다르다"고 오판해 매번 파라미터 없는 src로 덮어써서
                    // 크기 보존 기능 자체를 무력화시키는 문제가 있었다.
                    const expectedSrc = this.getVideoIframeUrl(videoInfo, currentWidth, currentHeight);
                    if (expectedSrc && activeIframe.getAttribute('src') !== expectedSrc) {
                        activeIframe.src = expectedSrc;
                    }
                    activeIframe.removeAttribute('sandbox');
                }
                
                const controls = this.createVideoControls(
                    container,
                    activeIframe,
                    videoInfo,
                    baseWidth,
                    baseHeight,
                    block.getAttribute('data-block-id')
                );
                block.appendChild(controls);

                // [VE] 저장된 영상 효과(필터·변형) 복원
                const storedEffects = this._getVideoEffects(container);
                this._applyVideoEffectsToElement(activeIframe, storedEffects);
            } else {
                // URL 복구 불가 — 컨트롤 없이 placeholder 상태 유지
                console.warn(T2Utils.tf('video.console_url_recovery_failed', {}, '[T2Video] URL recovery failed, placeholder state:'), block);
            }
            
            // ✅ 이동 버튼 재생성
            const existingMoveControls = block.querySelector('.t2-move-controls');
            if (existingMoveControls) {
                existingMoveControls.remove();
            }
            const moveControls = this.createMoveControls();
            block.appendChild(moveControls);
            
            this.cleanupEmptyLines(block);
        });
    }

    // ── [SEC-XSS] HTML 특수문자 이스케이프 ───────────────────────────────────
    // file.name / data.file.url 등을 innerHTML에 삽입하기 전 반드시 통과시킨다.
    escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }

    generateBlockId() {
        return `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

window.T2VideoPlugin = T2VideoPlugin;