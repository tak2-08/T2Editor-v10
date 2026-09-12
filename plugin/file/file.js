// Path: T2Editor/plugin/file/file.js
// Developer note: 플러그인 ID "file"과 command/button ID는 등록 설정·button.json·locale 키와 함께 변경한다.

class T2FilePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['attachFile'];
        this._savedEditorRange = null;

        // Upload config uses injected values first and the shared endpoint second; safe fallbacks keep the modal usable.
        this._configReady = false;  // _loadConfig() 완료 여부
        this._configPromise = null; // 진행 중인 로드 Promise (중복 호출 방지)

        this._applyWindowConfig();  // 1단계: window 변수 동기 적용
        this._loadConfig();         // 2단계: 필요 시 비동기 보완 (fire-and-forget)

        // Reinitialize existing file blocks after delayed plugin loading because an earlier plugin may consume contentSetQueue.
        setTimeout(() => {
            if (this.editor.editor && this.editor.editor.innerHTML.trim()) {
                this.initializeFileBlocks();
            }
        }, 50);
    }

     /** Apply injected upload configuration; return false when unavailable. */
    _applyWindowConfig() {
        const cfg = window.T2EDITOR_UPLOAD_CONFIG;
        if (!cfg) return false;

        const exts   = cfg.extensions || {};
        const accept = cfg.accept     || {};

        this.docExtensions   = Array.isArray(exts.document) && exts.document.length ? exts.document.slice() : ['pdf','txt','doc','docx','xls','xlsx','ppt','pptx','hwp','odt','ods','odp','rtf'];
        this.videoExtensions = Array.isArray(exts.video)    && exts.video.length    ? exts.video.slice()    : ['mp4','webm','ogg','mov','avi','mkv','wmv','flv','m4v'];
        this.audioExtensions = Array.isArray(exts.audio)    && exts.audio.length    ? exts.audio.slice()    : ['mp3','m4a','wav','flac','aac','wma'];
        this.imageExtensions = Array.isArray(exts.image)    && exts.image.length    ? exts.image.slice()    : ['jpg','jpeg','png','gif','webp','bmp'];
        this.otherExtensions = Array.isArray(exts.other)    && exts.other.length    ? exts.other.slice()    : ['zip','rar','7z','tar','gz','bz2','mp3','m4a','wav','flac','aac','wma','json','xml','csv'];
        this.fileAccept      = typeof accept.file === 'string' && accept.file       ? accept.file           : '.pdf,.txt,.doc,.docx,.mp4,.webm,.ogg,.mov,.avi,.mkv,.zip,.rar,.7z,.mp3,.m4a,.wav,.flac,.json,.xml,.csv';
        this.maxUploadSizeMB = typeof cfg.maxSizeMB === 'number' && cfg.maxSizeMB > 0 ? cfg.maxSizeMB      : 50;

        this._configReady = true;
        return true;
    }

     /** Load the shared origin-checked upload configuration endpoint as a fallback. */
    _loadConfig() {
        if (this._configReady) return Promise.resolve();
        if (this._configPromise) return this._configPromise;

        this._configPromise = (async () => {
            try {
                console.warn(T2Utils.tf('file.config_not_injected_console', {}, '[T2File] window.T2EDITOR_UPLOAD_CONFIG not injected.') +
                    '' +
                    '');

                const res = await fetch(
                    `${t2editor_url}/config/get_upload_config.php`,
                    { method: 'GET', credentials: 'same-origin' }
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                this._applyServerConfig(await res.json());
                this._configReady = true;
                console.info(T2Utils.tf('file.config_loaded_console', {}, '[T2File] Configuration loaded from get_upload_config.php.'));

            } catch (err) {
                console.error(T2Utils.tf('file.config_load_failed_console', {}, '[T2File] Config load failed. Keeping fallback values.'), err);
            }
        })();

        return this._configPromise;
    }

    /**
     * get_upload_config.php 응답(= get_js_config() 구조)을 this 에 적용한다.
     * _applyWindowConfig 와 동일한 키를 사용해 일관성을 보장한다.
     */
    _applyServerConfig(data) {
        const exts   = data.extensions || {};
        const accept = data.accept     || {};

        if (Array.isArray(exts.document) && exts.document.length) this.docExtensions   = exts.document;
        if (Array.isArray(exts.video)    && exts.video.length)    this.videoExtensions  = exts.video;
        if (Array.isArray(exts.audio)    && exts.audio.length)    this.audioExtensions  = exts.audio;
        if (Array.isArray(exts.image)    && exts.image.length)    this.imageExtensions  = exts.image;
        if (Array.isArray(exts.other)    && exts.other.length)    this.otherExtensions  = exts.other;
        if (typeof accept.file === 'string' && accept.file)       this.fileAccept       = accept.file;
        if (typeof data.maxSizeMB === 'number' && data.maxSizeMB > 0) this.maxUploadSizeMB = data.maxSizeMB;
    }

    // collab.recordChange 안전 호출 헬퍼
    // this.editor.collab 객체가 존재하더라도 recordChange 가 함수가 아닌 경우
    // "is not a function" TypeError 가 발생한다 (collab 플러그인 로딩 타이밍,
    // 버전 불일치 등). typeof 로 먼저 확인하고, 없으면 createUndoPoint() 로 폴백.
    _recordChange() {
        if (this.editor.collab && typeof this.editor.collab.recordChange === 'function') {
            this.editor.collab.recordChange();
        } else {
            this.editor.createUndoPoint();
        }
    }

    handleCommand(command, button) {
        switch(command) {
            case 'attachFile':
                this._saveEditorRange();
                this.showFileUploadModal();
                break;
        }
    }

    _saveEditorRange() {
        if (this.editor && typeof this.editor.captureSelectionBookmark === 'function') {
            this._savedEditorRange = this.editor.captureSelectionBookmark() || this.editor._lastEditorBookmark || null;
            return this._savedEditorRange;
        }
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return null;
        const range = selection.getRangeAt(0);
        if (range.startContainer === this.editor.editor || this.editor.editor.contains(range.startContainer)) {
            this._savedEditorRange = range.cloneRange();
        }
        return this._savedEditorRange;
    }

    onContentSet(html) {
        setTimeout(() => {
            this.initializeFileBlocks();
        }, 100);
    }

    showFileUploadModal() {
        // 설정이 아직 로드 중(window 변수 미주입 → API 호출 진행 중)이면
        // 완료를 기다렸다가 모달을 연다. 이미 완료된 경우 즉시 실행.
        this._loadConfig().then(() => this._openFileUploadModal());
    }

    _openFileUploadModal() {
        const modalContent = `
            <div class="t2-file-editor-modal">
                <h3 data-i18n="file.modal_title">${T2Utils.t('file.modal_title')}</h3>
                <div class="t2-file-upload-area">
                    <span class="material-icons">attach_file</span>
                    <div class="t2-file-upload-text" data-i18n="file.click_select">${T2Utils.t('file.click_select')}</div>
                    <div class="t2-file-upload-hint" data-i18n="file.support_hint" data-i18n-vars='${JSON.stringify({max: this.maxUploadSizeMB}).replace(/'/g, "&#39;")}'>${T2Utils.t('file.support_hint', {max: this.maxUploadSizeMB})}</div>
                    <input type="file" accept="${this.escapeHtml(this.fileAccept)}" />
                </div>
                <div class="t2-file-preview-grid"></div>
                <div class="t2-upload-progress" style="display: none;">
                    <div class="t2-progress-bar">
                        <div class="t2-progress-fill"></div>
                    </div>
                    <div class="t2-progress-text" data-i18n="file.uploading">${T2Utils.t('file.uploading')}</div>
                </div>
                <div class="t2-btn-group">
                    <button class="t2-btn" data-action="cancel" data-i18n="common.cancel">${T2Utils.t('common.cancel')}</button>
                    <button class="t2-btn" data-action="upload" disabled data-i18n="file.btn_insert">${T2Utils.t('file.btn_insert')}</button>
                </div>
            </div>
        `;

        const modal = T2Utils.createModal(modalContent);
        this.setupFileModalEvents(modal);
    }

    getAcceptString() {
        // fileAccept 는 editor_lib.php 주입(window.T2EDITOR_UPLOAD_CONFIG) 또는
        // get_upload_config.php fallback 으로 항상 초기화되어 있으므로 별도 null 체크 불필요.
        return this.fileAccept;
    }

    validateFile(file) {
        const fileExt = file.name.toLowerCase().split('.').pop();

        if (this.imageExtensions.includes(fileExt)) {
            T2Utils.showNotification(T2Utils.t('file.use_image_button'), 'warning');
            return false;
        }

        const allAllowedExtensions = [
            ...this.docExtensions,
            ...this.videoExtensions,
            ...this.otherExtensions
        ];

        if (!allAllowedExtensions.includes(fileExt)) {
            T2Utils.showNotification(T2Utils.t('file.upload.unsupported_type'), 'error');
            return false;
        }

        const maxSize = this.maxUploadSizeMB * 1024 * 1024;
        if (file.size > maxSize) {
            T2Utils.showNotification(T2Utils.t('file.upload.too_large', {max: this.maxUploadSizeMB}), 'error');
            return false;
        }

        return true;
    }

    // HTML 특수문자 이스케이프
    // file.name / original_name 을 innerHTML에 삽입하기 전 반드시 통과시킨다.
    escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }

    detectFileType(filename) {
        const fileExt = filename.toLowerCase().split('.').pop();

        if (this.docExtensions.includes(fileExt))   return 'document';
        if (this.videoExtensions.includes(fileExt)) return 'video';
        if (this.imageExtensions.includes(fileExt)) return 'image';
        if (this.otherExtensions.includes(fileExt)) return 'other';

        return 'unknown';
    }

    // 코어 드래그앤드롭용 공개 API
    // 코어는 커서·오버레이만 관리하고, 허용 확장자 검증·업로드·블록 생성은
    // 이 파일 플러그인 API 하나를 통해 실행한다.
    _dropMessage(key, vars = {}, fallback = '') {
        if (typeof T2I18N !== 'undefined' && T2I18N.t) {
            const value = T2I18N.t(`editor.${key}`, vars);
            if (value && value !== `editor.${key}`) return value;
        }
        let value = fallback;
        Object.keys(vars).forEach((name) => {
            value = String(value).replace(new RegExp(`\\{${name}\\}`, 'g'), String(vars[name]));
        });
        return value;
    }

    getDropAllowedExtensions() {
        return Array.from(new Set([
            ...(this.imageExtensions || []),
            ...(this.videoExtensions || []),
            ...(this.docExtensions || []),
            ...(this.audioExtensions || []),
            ...(this.otherExtensions || [])
        ].map((ext) => String(ext || '').toLowerCase()).filter(Boolean)));
    }

    validateDroppedFile(file, notify = true) {
        const name = file && typeof file.name === 'string' ? file.name : '';
        const ext = name.toLowerCase().split('.').pop();
        if (!name || !this.getDropAllowedExtensions().includes(ext)) {
            if (notify) T2Utils.showNotification(
                this._dropMessage('drop_unsupported', { name: name || '-' }, `Unsupported file type: ${name || '-'}`),
                'error'
            );
            return false;
        }
        const maxBytes = this.maxUploadSizeMB * 1024 * 1024;
        if (!file || file.size > maxBytes) {
            if (notify) T2Utils.showNotification(
                this._dropMessage('drop_too_large', { name, max: this.maxUploadSizeMB }, `File exceeds ${this.maxUploadSizeMB} MB: ${name}`),
                'error'
            );
            return false;
        }
        return true;
    }

    _restoreEditorRange(range) {
        if (!range) return false;
        if (this.editor && typeof this.editor.restoreSelectionBookmark === 'function') {
            const restored = this.editor.restoreSelectionBookmark(range, { focus: true, preventScroll: true });
            if (restored) this._savedEditorRange = this.editor.captureSelectionBookmark() || range;
            return restored;
        }
        try {
            const start = range.startContainer;
            if (start !== this.editor.editor && !this.editor.editor.contains(start)) return false;
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            this._savedEditorRange = range.cloneRange();
            return true;
        } catch (_) {
            this._savedEditorRange = null;
            return false;
        }
    }

    _currentEditorRange() {
        if (this.editor && typeof this.editor.captureSelectionBookmark === 'function') {
            return this.editor.captureSelectionBookmark();
        }
        const selection = window.getSelection();
        if (!selection || selection.rangeCount < 1) return null;
        const range = selection.getRangeAt(0);
        if (range.startContainer !== this.editor.editor && !this.editor.editor.contains(range.startContainer)) return null;
        try { return range.cloneRange(); } catch (_) { return null; }
    }

    async _uploadGenericFile(file) {
        const formData = new FormData();
        formData.append('bf_file', file);
        formData.append('uid', String(Date.now()));
        if (typeof T2Utils !== 'undefined' && T2Utils.appendHostUploadFields) T2Utils.appendHostUploadFields(formData, this.editor);

        const uploadUrl = (typeof T2Utils !== 'undefined' && T2Utils.getHostUploadUrl)
            ? (T2Utils.getHostUploadUrl(this.editor) || `${t2editor_url}/plugin/file/file_upload.php`)
            : `${t2editor_url}/plugin/file/file_upload.php`;
        const response = await fetch(uploadUrl, { method: 'POST', body: formData, credentials: 'same-origin' });
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text.trim());
        } catch (_) {
            console.error('[T2File] Dropped-file upload response parse failed:', text.substring(0, 500));
            throw new Error(T2Utils.t('file.server_response_error'));
        }
        if (typeof T2Utils !== 'undefined' && T2Utils.normalizeHostUploadResponse) data = T2Utils.normalizeHostUploadResponse(data, 'file', this.editor);
        if (typeof T2Utils !== 'undefined' && T2Utils.applyHostUploadResult) T2Utils.applyHostUploadResult(data, this.editor);
        if (!response.ok || !data.success || !data.file) {
            throw new Error(data.message || T2Utils.t('file.upload_failed_msg'));
        }
        return data.file;
    }

    async uploadDroppedFiles(files, insertionRange = null) {
        await this._loadConfig();
        const queue = Array.from(files || []);
        let cursorRange = insertionRange;
        let success = 0;
        let failed = 0;
        const errors = [];

        for (const file of queue) {
            if (!this.validateDroppedFile(file, true)) {
                failed++;
                errors.push({ name: file?.name || '', message: 'validation_failed' });
                continue;
            }

            // 첫 파일은 코어가 보존한 마지막 커서 위치를, 다음 파일부터는 직전
            // 블록 삽입 후 코어가 만든 하단 경계 문단의 현재 Selection을 사용한다.
            if (!this._restoreEditorRange(cursorRange)) {
                const fallback = this.editor && typeof this.editor._getActiveEditorRange === 'function'
                    ? this.editor._getActiveEditorRange(this.editor._lastEditorBookmark, { fallback: 'end' })
                    : null;
                if (fallback) this._restoreEditorRange(fallback);
            }

            const fileType = this.detectFileType(file.name);
            try {
                if (fileType === 'image') {
                    try { await this.editor.loadPluginImmediately('image'); } catch (_) { /* direct fallback */ }
                    // image 플러그인은 비동기 NSFW 검사 진입 시 현재 Selection을 다시
                    // 저장하므로, 위에서 복구한 코어 Range를 그대로 전달할 수 있다.
                    await this.handleImageUpload(file);
                } else if (fileType === 'video') {
                    try { await this.editor.loadPluginImmediately('video'); } catch (_) { /* file block fallback */ }
                    await this.handleVideoUpload(file);
                } else {
                    const fileInfo = await this._uploadGenericFile(file);
                    this.insertFileBlock(fileInfo);
                }
                success++;
                cursorRange = this._currentEditorRange();
            } catch (error) {
                failed++;
                errors.push({ name: file.name, message: error?.message || String(error) });
                console.error('[T2File] Dropped-file upload failed:', file.name, error);
                T2Utils.showNotification(`${file.name}: ${error?.message || T2Utils.t('file.upload_error')}`, 'error');
                cursorRange = this._currentEditorRange() || cursorRange;
            }
        }

        return { success, failed, errors };
    }

    setupFileModalEvents(modal) {
        const previewGrid = modal.querySelector('.t2-file-preview-grid');
        const fileInput = modal.querySelector('input[type="file"]');
        const uploadBtn = modal.querySelector('[data-action="upload"]');
        const uploadArea = modal.querySelector('.t2-file-upload-area');
        const progressBar = modal.querySelector('.t2-progress-fill');
        const progressContainer = modal.querySelector('.t2-upload-progress');
        const progressText = modal.querySelector('.t2-progress-text');

        let selectedFile = null;

        const handleFile = (file) => {
            if (!this.validateFile(file)) {
                return;
            }

            const fileExt = file.name.toLowerCase().split('.').pop();
            const fileType = this.detectFileType(file.name);

            previewGrid.innerHTML = '';

            const previewItem = document.createElement('div');
            previewItem.className = 't2-file-preview-item';

            if (fileType === 'image') {
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewItem.innerHTML = `
                        <div class="t2-file-preview-image" style="position: relative; width: 100%; height: 100%; overflow: hidden;">
                            <img src="${e.target.result}" style="width: 100%; height: 100%; object-fit: cover;">
                            <div class="t2-file-preview-image-label" style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.7); color: white; padding: 4px 8px; font-size: 12px;">
                                <span class="material-icons" style="font-size: 14px; vertical-align: middle;">image</span>
                                <span data-i18n="file.image_file_label">${T2Utils.t('file.image_file_label')}</span>
                            </div>
                        </div>
                        <div class="t2-file-preview-name">${this.escapeHtml(file.name)}</div>
                        <button type="button" class="t2-file-preview-remove">
                            <span class="material-icons">close</span>
                        </button>
                    `;

                    const removeBtn = previewItem.querySelector('.t2-file-preview-remove');
                    removeBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectedFile = null;
                        previewItem.remove();
                        uploadBtn.disabled = true;
                        fileInput.value = '';
                    };
                };
                reader.readAsDataURL(file);
            } else if (fileType === 'video') {
                previewItem.innerHTML = `
                    <div class="t2-file-preview-icon" style="background-color: #8B5CF6; position: relative;">
                        <span class="material-icons" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px;">play_circle</span>
                    </div>
                    <div class="t2-file-preview-name">${this.escapeHtml(file.name)}</div>
                    <button type="button" class="t2-file-preview-remove">
                        <span class="material-icons">close</span>
                    </button>
                `;
            } else {
                const iconColor = this.getFileIconColor(fileExt);
                previewItem.innerHTML = `
                    <div class="t2-file-preview-icon" style="background-color: ${iconColor}"></div>
                    <div class="t2-file-preview-name">${this.escapeHtml(file.name)}</div>
                    <button type="button" class="t2-file-preview-remove">
                        <span class="material-icons">close</span>
                    </button>
                `;
            }

            if (fileType !== 'image') {
                const removeBtn = previewItem.querySelector('.t2-file-preview-remove');
                removeBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectedFile = null;
                    previewItem.remove();
                    uploadBtn.disabled = true;
                    fileInput.value = '';
                };
            }

            selectedFile = file;
            previewGrid.appendChild(previewItem);
            uploadBtn.disabled = false;
        };

        fileInput.onchange = (e) => {
            if (e.target.files.length > 0) {
                handleFile(e.target.files[0]);
            }
        };

        T2Utils.setupDragAndDrop(uploadArea, (files) => {
            if (files.length > 0) {
                handleFile(files[0]);
            }
        });

        modal.querySelector('[data-action="cancel"]').onclick = () => modal.remove();

        modal.querySelector('[data-action="upload"]').onclick = async () => {
            if (!selectedFile) return;

            const fileType = this.detectFileType(selectedFile.name);

            uploadBtn.disabled = true;
            progressContainer.style.display = 'block';
            progressBar.style.width = '0%';
            progressText.textContent = this.getUploadProgressText(fileType);

            // 업로드 실패 시 UI 복원 헬퍼
            const onUploadError = (msg) => {
                T2Utils.showNotification(msg || T2Utils.t('file.upload_error'), 'error');
                uploadBtn.disabled = false;
                progressContainer.style.display = 'none';
            };

            if (fileType === 'image') {
                try {
                    await this.handleImageUpload(selectedFile);
                    progressBar.style.width = '100%';
                    progressText.textContent = T2Utils.t('file.upload_complete');
                    modal.remove();
                } catch (error) {
                    console.error('Image upload error:', error);
                    onUploadError(error.message);
                }
                return;
            }

            if (fileType === 'video') {
                try {
                    await this.handleVideoUpload(selectedFile);
                    progressBar.style.width = '100%';
                    progressText.textContent = T2Utils.t('file.upload_complete');
                    modal.remove();
                } catch (error) {
                    console.error('Video upload error:', error);
                    onUploadError(error.message);
                }
                return;
            }

            // 문서/기타 파일 업로드
            // 네트워크 요청 및 JSON 파싱
            // response.json() 대신 text() → trim() → JSON.parse() 를 사용해
            // PHP 워닝·BOM 등 JSON 앞 불필요한 출력으로 인한 파싱 실패를 방지한다.
            let data;
            try {
                const formData = new FormData();
                formData.append('bf_file', selectedFile);
                // generateUid() 대신 Date.now() 사용.
                // generateUid()가 반환하는 UUID/hex 형식이 file_upload.php uid 검증을
                // 통과하지 못하는 경우가 있다. image.js uploadToServer()와 동일한 방식.
                formData.append('uid', String(Date.now()));
                if (typeof T2Utils !== 'undefined' && T2Utils.appendHostUploadFields) T2Utils.appendHostUploadFields(formData, this.editor);

                const uploadUrl = (typeof T2Utils !== 'undefined' && T2Utils.getHostUploadUrl)
                    ? (T2Utils.getHostUploadUrl(this.editor) || `${t2editor_url}/plugin/file/file_upload.php`)
                    : `${t2editor_url}/plugin/file/file_upload.php`;
                const response = await fetch(uploadUrl, {
                    method: 'POST',
                    body: formData
                });

                const text = await response.text();
                data = JSON.parse(text.trim());
                if (typeof T2Utils !== 'undefined' && T2Utils.normalizeHostUploadResponse) data = T2Utils.normalizeHostUploadResponse(data, 'file', this.editor);
                if (typeof T2Utils !== 'undefined' && T2Utils.applyHostUploadResult) T2Utils.applyHostUploadResult(data, this.editor);
            } catch (networkOrParseError) {
                console.error('File upload network/parse error:', networkOrParseError);
                onUploadError(T2Utils.t('file.server_response_error'));
                return;
            }

            // 서버 응답 확인 — 실패 시 서버 메시지를 그대로 사용자에게 표시
            if (!data.success) {
                console.error('File upload rejected by server:', data.message);
                onUploadError(data.message || T2Utils.t('file.upload_failed_msg'));
                return;
            }

            // 업로드 성공 — 모달을 먼저 닫고 파일 블록 삽입
            // insertFileBlock(→ insertElementAtCursor)의 selection 오류가
            // 업로드 성공 알림을 막지 않도록 블록 삽입은 별도 try-catch로 보호한다.
            progressBar.style.width = '100%';
            progressText.textContent = T2Utils.t('file.upload_complete');
            modal.remove();

            try {
                this.insertFileBlock(data.file);
            } catch (insertError) {
                console.error('File block insertion error (non-critical):', insertError);
            }

            this._recordChange();
        };
    }

    getFileIconColor(fileExt) {
        const colors = {
            'zip': '#E8B56F', 'rar': '#E8B56F', '7z': '#E8B56F', 'tar': '#E8B56F', 'gz': '#E8B56F', 'bz2': '#E8B56F',
            'pdf': '#F44336',
            'txt': '#585858', 'rtf': '#585858',
            'doc': '#2196F3', 'docx': '#2196F3',
            'xls': '#4CAF50', 'xlsx': '#4CAF50', 'ods': '#4CAF50',
            'ppt': '#FF9800', 'pptx': '#FF9800', 'odp': '#FF9800',
            'hwp': '#1976D2', 'odt': '#1976D2',
            'mp3': '#9C27B0', 'm4a': '#9C27B0', 'wav': '#9C27B0', 'flac': '#9C27B0', 'aac': '#9C27B0', 'wma': '#9C27B0',
            'mp4': '#8B5CF6', 'webm': '#8B5CF6', 'ogg': '#8B5CF6', 'mov': '#8B5CF6', 'avi': '#8B5CF6', 'mkv': '#8B5CF6', 'wmv': '#8B5CF6', 'flv': '#8B5CF6', 'm4v': '#8B5CF6',
            'json': '#FFC107', 'xml': '#FFC107', 'csv': '#4CAF50'
        };
        return colors[fileExt.toLowerCase()] || '#E8B56F';
    }

    getUploadProgressText(fileType) {
        switch(fileType) {
            case 'image': return T2Utils.t('file.image_uploading');
            case 'video': return T2Utils.t('file.video_uploading');
            case 'document': return T2Utils.t('file.document_uploading');
            case 'other': return T2Utils.t('file.uploading');
            default: return T2Utils.t('file.uploading');
        }
    }

    async handleImageUpload(file) {
        const imagePlugin = this.editor.getPlugin('image');

        if (imagePlugin) {
            // Delegate image files to uploadImageFile() so NSFW, preview and queue behavior stays identical to the image plugin.
            await imagePlugin.uploadImageFile(file);
        } else {
            // 이미지 플러그인 미로드 시 직접 업로드 폴백
            const formData = new FormData();
            formData.append('bf_file[]', file);
            // generateUid() 대신 Date.now() 사용.
            // image.js uploadToServer()와 동일 — UUID 형식이 PHP 검증을 통과 못하는 문제 방지.
            formData.append('uid', String(Date.now()));
            if (typeof T2Utils !== 'undefined' && T2Utils.appendHostUploadFields) T2Utils.appendHostUploadFields(formData, this.editor);

            const imageUploadUrl = (typeof T2Utils !== 'undefined' && T2Utils.getHostUploadUrl)
                ? (T2Utils.getHostUploadUrl(this.editor) || `${t2editor_url}/plugin/image/image_upload.php`)
                : `${t2editor_url}/plugin/image/image_upload.php`;
            const response = await fetch(imageUploadUrl, {
                method: 'POST',
                body: formData
            });

            let data = JSON.parse((await response.text()).trim());
            if (typeof T2Utils !== 'undefined' && T2Utils.normalizeHostUploadResponse) data = T2Utils.normalizeHostUploadResponse(data, 'image', this.editor);
            if (typeof T2Utils !== 'undefined' && T2Utils.applyHostUploadResult) T2Utils.applyHostUploadResult(data, this.editor);

            if (data.success && data.files && data.files.length > 0) {
                this.insertImageBlock(data.files[0]);
                T2Utils.showNotification(T2Utils.t('file.image_uploaded'), 'success');
            } else {
                throw new Error(data.message || T2Utils.t('file.image_upload_failed'));
            }
        }
    }

    // 공통 fetch 헬퍼: text() → trim() → JSON.parse()
    // response.json()은 PHP 워닝·BOM 등 JSON 앞 여분의 출력에 취약하다.
    async _fetchJSON(url, formData) {
        const response = await fetch(url, { method: 'POST', body: formData });
        return JSON.parse((await response.text()).trim());
    }

    async handleVideoUpload(file) {
        const videoPlugin = this.editor.getPlugin('video');

        if (videoPlugin && typeof videoPlugin.uploadVideoFile === 'function') {
            // 비디오 플러그인에 완전 위임
            // uploadVideoFile()이 서버 업로드 → createVideoBlock()까지 담당.
            // 반환된 HTMLElement를 파일 플러그인의 커서 삽입 로직으로 에디터에 배치한다.
            // 이렇게 하면 비디오 블록 생성 방식이 비디오 플러그인 모달과 100% 동일하다.
            const videoBlock = await videoPlugin.uploadVideoFile(file);
            this.insertElementAtCursor(videoBlock);
            T2Utils.showNotification(T2Utils.t('file.video_uploaded'), 'success');
            this._recordChange();
            return;
        }

        // 비디오 플러그인 미로드 시 직접 업로드 폴백
        // generateUid() 대신 Date.now() 사용 — uid 검증 오류 방지.
        // file_upload.php의 uid 검증이 image_upload.php와 동일하게 수정되었더라도
        // Date.now()가 가장 안전한 방어적 선택이다.
        const formData = new FormData();
        formData.append('bf_file', file);
        formData.append('uid', String(Date.now()));
        if (typeof T2Utils !== 'undefined' && T2Utils.appendHostUploadFields) T2Utils.appendHostUploadFields(formData, this.editor);

        const fileUploadUrl = (typeof T2Utils !== 'undefined' && T2Utils.getHostUploadUrl)
            ? (T2Utils.getHostUploadUrl(this.editor) || `${t2editor_url}/plugin/file/file_upload.php`)
            : `${t2editor_url}/plugin/file/file_upload.php`;
        let data = await this._fetchJSON(fileUploadUrl, formData);

        if (typeof T2Utils !== 'undefined' && T2Utils.normalizeHostUploadResponse) data = T2Utils.normalizeHostUploadResponse(data, 'file', this.editor);
        if (typeof T2Utils !== 'undefined' && T2Utils.applyHostUploadResult) T2Utils.applyHostUploadResult(data, this.editor);
        if (!data.success) {
            throw new Error(data.message || T2Utils.t('file.video_upload_failed'));
        }

        // 비디오 플러그인 없음 → 일반 파일 블록으로 에디터에 삽입
        this.insertFileBlock(data.file);
        T2Utils.showNotification(T2Utils.t('file.file_uploaded'), 'success');
        this._recordChange();
    }

    insertElementAtCursor(element) {
        let range = this._savedEditorRange;
        if (!range && this.editor && typeof this.editor.captureSelectionBookmark === 'function') {
            range = this.editor.captureSelectionBookmark() || this.editor._lastEditorBookmark;
        }
        if (!range) {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const candidate = selection.getRangeAt(0);
                if (candidate.startContainer === this.editor.editor || this.editor.editor.contains(candidate.startContainer)) {
                    range = candidate.cloneRange();
                }
            }
        }

        if (typeof this.editor.insertBlockWithBoundaryLines === 'function') {
            this.editor.insertBlockWithBoundaryLines(element, range);
        } else {
            this.editor.editor.appendChild(element);
            this.editor.normalizeContent();
        }
        this._savedEditorRange = null;

        this._recordChange();
    }

    cleanupEmptyLines(fileBlock) {
        // 빈 줄 개수는 사용자 콘텐츠의 일부다. 플러그인이 임의로 연속 빈 문단을
        // 삭제하지 않고, 코어가 관리하는 블록 직전/직후 입력 경계만 보장한다.
        if (this.editor && typeof this.editor.ensureBlockBoundaryLines === 'function') {
            this.editor.ensureBlockBoundaryLines(fileBlock);
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

        if (!isEmptyParagraph(fileBlock.previousElementSibling)) {
            fileBlock.parentNode.insertBefore(makeBoundary(), fileBlock);
        }
        if (!isEmptyParagraph(fileBlock.nextElementSibling)) {
            fileBlock.parentNode.insertBefore(makeBoundary(), fileBlock.nextSibling);
        }
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

        moveWrapper.innerHTML = `
            <button class="t2-btn t2-move-btn" type="button" data-direction="up"
                style="padding: 6px 12px; border: none; border-radius: 0; border-right: 2px solid rgba(255,255,255,0.3); background: transparent; color: white; transition: all 0.2s; cursor: pointer;">
                <span class="material-icons" style="font-size: 20px;">arrow_upward</span>
            </button>
            <button class="t2-btn t2-move-btn" type="button" data-direction="down"
                style="padding: 6px 12px; border: none; border-radius: 0; background: transparent; color: white; transition: all 0.2s; cursor: pointer;">
                <span class="material-icons" style="font-size: 20px;">arrow_downward</span>
            </button>
        `;

        const upBtn = moveWrapper.querySelector('[data-direction="up"]');
        const downBtn = moveWrapper.querySelector('[data-direction="down"]');

        [upBtn, downBtn].forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = 'rgba(255,255,255,0.15)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = 'transparent';
            });
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

    insertImageBlock(imageInfo) {
        const mediaBlock = document.createElement('div');
        mediaBlock.className = 't2-media-block';

        const container = document.createElement('div');
        container.style.width = imageInfo.width + 'px';
        container.style.maxWidth = '100%';
        container.style.margin = '0 auto';

        const img = document.createElement('img');
        // Security: core.js / utils.js 보안 경계 준수:
        // img.src 에 직접 할당하기 전 T2Utils.sanitizeURL(url, 'src') 로 검증.
        // 서버 응답 URL 이라도 javascript:, vbscript: 프로토콜을 차단한다.
        // (data: URI 는 'src' 컨텍스트에서 정상 사용 케이스이므로 허용)
        img.src = T2Utils.sanitizeURL(imageInfo.url, 'src') || '';
        img.style.width = '100%';
        img.dataset.width = imageInfo.width;
        img.dataset.height = imageInfo.height;

        container.appendChild(img);
        mediaBlock.appendChild(container);

        const controls = this.createImageControls(container, img);
        mediaBlock.appendChild(controls);

        this.insertElementAtCursor(mediaBlock);
    }

    createImageControls(container, img) {
        const controls = document.createElement('div');
        controls.className = 't2-media-controls';
        controls.contentEditable = false;

        const width = parseInt(img.dataset.width) || parseInt(container.style.width) || 320;
        const height = parseInt(img.dataset.height) || parseInt(container.style.height) || 180;

        const editorWidth = this.editor.editor.clientWidth;
        const maxWidthPercentage = Math.min(100, Math.floor((editorWidth / width) * 100));
        const currentWidth = parseInt(container.style.width);
        const percentage = Math.round((currentWidth / width) * 100);

        controls.innerHTML = `
            <button class="t2-btn delete-btn">
                <span class="material-icons">delete</span>
            </button>
            <input type="range" min="30" max="${maxWidthPercentage}" value="${percentage}" class="size-slider" style="width: 100px;">
        `;

        const sizeSlider = controls.querySelector('.size-slider');
        if (sizeSlider) {
            const resizeObserver = new ResizeObserver(() => {
                const newEditorWidth = this.editor.editor.clientWidth;
                const newMaxPercentage = Math.min(100, Math.floor((newEditorWidth / width) * 100));
                sizeSlider.max = newMaxPercentage;

                if (parseInt(sizeSlider.value) > newMaxPercentage) {
                    sizeSlider.value = newMaxPercentage;
                    const newWidth = Math.round((width * newMaxPercentage) / 100);
                    container.style.width = `${newWidth}px`;
                    container.style.maxWidth = '100%';
                    img.style.width = '100%';
                }
            });

            resizeObserver.observe(this.editor.editor);

            sizeSlider.addEventListener('input', (e) => {
                const percentage = parseInt(e.target.value);
                const newWidth = Math.round((width * percentage) / 100);

                container.style.width = `${newWidth}px`;
                container.style.maxWidth = '100%';
                img.style.width = '100%';

                img.dataset.currentWidth = newWidth;
            });
        }

        const deleteBtn = controls.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const mediaBlock = controls.closest('.t2-media-block');
                if (mediaBlock) {
                    mediaBlock.remove();

                    this._recordChange();
                }
            });
        }

        return controls;
    }

    insertFileBlock(fileInfo) {
        const fileBlock = document.createElement('div');
        fileBlock.className = 't2-media-block t2-file-block';
        fileBlock.contentEditable = false;
        fileBlock.style.position = 'relative';
        // CMS 새니타이저가 class 속성을 제거하더라도 data 속성으로 복구 가능하도록 마킹
        fileBlock.dataset.t2Block = 'file';

        const date = new Date().toISOString().split('T')[0].replace(/-/g, '.');
        const fileSize = T2Utils.formatFileSize(fileInfo.size);
        const fileExt = fileInfo.original_name.toLowerCase().split('.').pop();
        const isAudioFile = this.audioExtensions.includes(fileExt);
        const isPdfFile = fileExt === 'pdf';

        let fileUrl = fileInfo.url;
        if (isPdfFile) {
            const matches = fileUrl.match(/data\/editor\/t2editor_(\d+)\/(.+\.pdf)$/i);
            if (matches) {
                const [, date, filename] = matches;
                fileUrl = t2editor_url + `/plugin/file/pdf_view.php?pdf=${date}/${filename}`;
            }
        }

        // Security: file markup must pass setPluginHTML(file profile); escapeHtml is only for visible text.
        // URL protocols, audio/download capabilities and data-* fields are enforced by the profile.
        let fileBlockHTML;
        if (isAudioFile) {
            const safeAudioUrl = this.escapeHtml(fileInfo.url);
            fileBlockHTML = `
                <div class="audio-player">
                    <audio src="${safeAudioUrl}" preload="metadata"></audio>
                </div>
                <a href="${safeAudioUrl}" download style="text-decoration: none; color: inherit;">
                    <div class="audio-file-container">
                        <div class="audio-file-icon"></div>
                        <div class="audio-file-info">
                            <div class="audio-file-name">${this.escapeHtml(fileInfo.original_name)}</div>
                            <div class="audio-file-details">
                                <span>DATE: ${date}</span>
                                <span>Size: ${fileSize}</span>
                                <span class="audio-duration">--:--</span>
                            </div>
                        </div>
                    </div>
                </a>
            `;
        } else {
            fileBlockHTML = `
                <a href="${this.escapeHtml(fileUrl)}" ${!isPdfFile ? 'download' : ''} style="text-decoration: none; color: inherit;">
                    <div class="file-container">
                        <div class="file-icon" style="background-color: ${this.getFileIconColor(fileExt)};"></div>
                        <div class="file-info">
                            <div class="file-name">${this.escapeHtml(fileInfo.original_name)}</div>
                            <div class="file-details">
                                <span>DATE: ${date}&nbsp;</span>
                                <span>Size: ${fileSize}</span>
                            </div>
                        </div>
                    </div>
                </a>
            `;
        }

        this.editor.setPluginHTML(fileBlock, fileBlockHTML, { plugin: 'file' });

        if (isAudioFile) {
            // [NOTE] audio 이벤트 리스너는 setPluginHTML() 이후에 재연결한다.
            // sanitizePluginHTML은 on* HTML 속성만 제거하므로
            // addEventListener 방식의 JS 이벤트 바인딩은 영향 없음.
            const audio = fileBlock.querySelector('audio');
            const durationSpan = fileBlock.querySelector('.audio-duration');

            if (audio && durationSpan) {
                audio.addEventListener('loadedmetadata', () => {
                    const minutes = Math.floor(audio.duration / 60);
                    const seconds = Math.floor(audio.duration % 60);
                    durationSpan.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                });
                audio.addEventListener('error', () => {
                    durationSpan.textContent = '--:--';
                });
            }
        }

        const controls = document.createElement('div');
        controls.className = 't2-media-controls';
        controls.contentEditable = false;
        controls.innerHTML = `
            <button class="t2-btn delete-btn">
                <span class="material-icons">delete</span>
            </button>
        `;

        const deleteBtn = controls.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fileBlock.remove();

            this._recordChange();
        });

        fileBlock.appendChild(controls);

        // 이미지 블록과 동일하게 하단 알약형 이동 바 추가
        const moveControls = this.createMoveControls();
        fileBlock.appendChild(moveControls);

        this.insertElementAtCursor(fileBlock);
    }

    initializeFileBlocks() {
        // Restore blocks by canonical class/data marker, then container/audio/download/PDF structure as fallbacks.
        // Promote matches to direct editor children and deduplicate them before binding controls.

        const editorEl = this.editor.editor;
        const foundBlocks = new Set();

        const addEditorDirectChild = (el) => {
            if (!el || el === editorEl) return;
            let node = el;
            while (node.parentElement && node.parentElement !== editorEl) {
                node = node.parentElement;
            }
            if (node.parentElement === editorEl) foundBlocks.add(node);
        };

        // 전략 1·2: class / data 속성
        editorEl.querySelectorAll('.t2-file-block, [data-t2-block="file"]')
            .forEach(addEditorDirectChild);

        // 전략 3: 내부 .file-container 클래스
        editorEl.querySelectorAll('.file-container')
            .forEach(el => addEditorDirectChild(el.closest('div') || el));

        // 전략 4: 오디오 블록 내부 클래스
        editorEl.querySelectorAll('.audio-file-container, .audio-player')
            .forEach(el => addEditorDirectChild(el.closest('div') || el));

        // 전략 5: <a download> 를 포함한 블록 (class 전체 손실 시)
        editorEl.querySelectorAll('a[download]').forEach(a => {
            // <p> 또는 <a> 자체가 직계일 수 있으므로 closest block-level ancestor 탐색
            const ancestor = a.closest('div, article, section') || a.parentElement;
            addEditorDirectChild(ancestor);
        });

        // 전략 6: PDF 뷰어 링크 포함 블록
        editorEl.querySelectorAll('a[href*="pdf_view.php"]').forEach(a => {
            const ancestor = a.closest('div, article, section') || a.parentElement;
            addEditorDirectChild(ancestor);
        });

        // 이미 다른 플러그인 블록으로 처리된 요소 제외
        const validBlocks = Array.from(foundBlocks).filter(block => {
            // 이미지·비디오 전용 media-block이 file 내용을 담을 수는 없음
            if (block.classList.contains('t2-video-block')) return false;
            if (block.classList.contains('t2-code-block')) return false;
            if (block.classList.contains('t2-table-wrapper')) return false;
            // <img> 또는 <iframe>만 있고 file-container 없으면 이미지/비디오 블록
            const hasFileContent = block.querySelector(
                '.file-container, .audio-player, .audio-file-container, a[download], a[href*="pdf_view.php"], audio'
            );
            return !!hasFileContent;
        });

        validBlocks.forEach(block => {
            // 1. 필수 속성·클래스 복원
            block.classList.add('t2-media-block', 't2-file-block');
            block.dataset.t2Block = 'file';
            block.contentEditable = false;
            if (!block.style.position) block.style.position = 'relative';

            // 2. <p> 래핑 탈출
            if (block.parentNode && block.parentNode.nodeName === 'P') {
                const p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                if (!p.textContent.trim() && !p.querySelector('img, iframe, video')) {
                    p.remove();
                }
            }

            // 3. 기존 컨트롤 제거 후 재생성
            // HTML 구조는 남아있지만 JS 이벤트 리스너가 없는 '죽은' 버튼 방지
            const existingControls = block.querySelector('.t2-media-controls');
            if (existingControls) existingControls.remove();

            // 4. 오디오 이벤트 리스너 재연결
            const audio = block.querySelector('audio');
            const durationSpan = block.querySelector('.audio-duration');
            if (audio && durationSpan) {
                const updateDuration = () => {
                    if (audio.duration && isFinite(audio.duration)) {
                        const m = Math.floor(audio.duration / 60);
                        const s = Math.floor(audio.duration % 60);
                        durationSpan.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                    }
                };
                audio.addEventListener('loadedmetadata', updateDuration);
                audio.addEventListener('error', () => { durationSpan.textContent = '--:--'; });
                if (audio.readyState >= 1) updateDuration();
            }

            // 5. 새 컨트롤 생성
            const controls = document.createElement('div');
            controls.className = 't2-media-controls';
            controls.contentEditable = false;
            controls.innerHTML = `
                <button class="t2-btn delete-btn">
                    <span class="material-icons">delete</span>
                </button>
            `;
            controls.querySelector('.delete-btn').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                block.remove();
                this._recordChange();
            });

            block.appendChild(controls);

            // 이미지 블록과 동일하게 하단 알약형 이동 바 복원
            const existingMoveControls = block.querySelector('.t2-move-controls');
            if (existingMoveControls) existingMoveControls.remove();
            const moveControls = this.createMoveControls();
            block.appendChild(moveControls);

            this.cleanupEmptyLines(block);
        });
    }
}

window.T2FilePlugin = T2FilePlugin;

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
