// Path: T2Editor/plugin/clipurl/clipurl.js

class T2ClipurlPlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['createClipUrl'];
        this.apiKey = 'T2ClipUrl2025';
        this.apiEndpoint = 'https://dsclub.kr/api/link/';
        this.lastCursorPosition = null;
        this.lastSelectionWasPlainTextUrl = false;
        this.currentButton = null;
        this.panelRoot = null;
        this.closeOnEscape = this.handleEscapeKey.bind(this);
        this.loadStyles();
    }

    loadStyles() {
        // CSS 파일에서 스타일을 관리하므로, 중복 style 주입만 방지용으로 유지.
        if (document.querySelector('style[data-t2-clipurl-styles]')) return;
        const style = document.createElement('style');
        style.setAttribute('data-t2-clipurl-styles', 'true');
        style.textContent = '';
        document.head.appendChild(style);
    }

    handleCommand(command, button) {
        if (command !== 'createClipUrl') return;
        this.saveCursorPosition();
        this.currentButton = button || null;

        // 선택 영역(또는 커서 위치)에 링크가 있으면 href를 기본값으로 주입
        const detectedUrl = this.getSelectedLinkUrl();
        this.showUrlInputPanel(detectedUrl);
    }

    // 커서/선택 영역 안에 <a> 링크 또는 URL 형식의 일반 텍스트가 있으면 해당 URL 반환
    // link.js의 findExistingLink 패턴 참고
    getSelectedLinkUrl() {
        this.lastSelectionWasPlainTextUrl = false;

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return '';

        const range = selection.getRangeAt(0);

        const findLinkParent = (node) => {
            while (node && node !== this.editor.editor) {
                if (node.nodeName === 'A') return node;
                node = node.parentNode;
            }
            return null;
        };

        const startLink = findLinkParent(range.startContainer);
        const endLink   = findLinkParent(range.endContainer);

        // 시작·끝이 동일한 <a> 안에 있으면 바로 반환
        if (startLink && startLink === endLink) {
            return startLink.href || '';
        }

        // collapsed 커서일 때: 부모 중 <a>가 있으면 반환
        if (range.collapsed && startLink) {
            return startLink.href || '';
        }

        // 범위 선택일 때: commonAncestor 안에서 range에 포함된 <a> 탐색
        const ancestor = range.commonAncestorContainer;
        const root = ancestor.nodeType === Node.ELEMENT_NODE
            ? ancestor
            : ancestor.parentElement;

        if (root) {
            const links = Array.from(root.querySelectorAll('a'));
            const intersecting = links.filter(a => range.intersectsNode(a));

            // 정확히 하나의 링크만 걸쳐 있을 때만 자동 입력 (모호한 경우는 빈 값)
            if (intersecting.length === 1) {
                return intersecting[0].href || '';
            }
        }

        // <a> 링크가 없으면 선택된 텍스트가 URL 형식인지 확인
        const selectedText = range.toString().trim();
        if (selectedText && this.validateUrl(selectedText)) {
            this.lastSelectionWasPlainTextUrl = true;
            return selectedText;
        }

        return '';
    }

    saveCursorPosition() {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            this.lastCursorPosition = selection.getRangeAt(0).cloneRange();
        }
    }

    handleEscapeKey(e) {
        if (e.key === 'Escape') {
            this.closePanel();
        }
    }

    ensureContainerPosition() {
        const style = window.getComputedStyle(this.editor.container);
        if (style.position === 'static') {
            this.editor.container.style.position = 'relative';
        }
    }

    closePanel() {
        if (!this.panelRoot) return;
        document.removeEventListener('keydown', this.closeOnEscape);
        this.panelRoot.remove();
        this.panelRoot = null;
    }

    createShell() {
        this.closePanel();
        this.ensureContainerPosition();

        const shell = document.createElement('div');
        shell.className = 't2-clipurl-shell';
        shell.style.setProperty('--t2-clipurl-toolbar-height', `${this.editor.toolbar.offsetHeight}px`);
        shell.innerHTML = `
            <div class="t2-clipurl-backdrop" data-action="backdrop"></div>
            <div class="t2-clipurl-panel" role="dialog" aria-modal="true" aria-label="T2ClipURL"></div>
        `;

        shell.addEventListener('click', (e) => {
            if (e.target && e.target.getAttribute('data-action') === 'backdrop') {
                this.closePanel();
            }
        });

        this.editor.container.appendChild(shell);
        this.panelRoot = shell;
        document.addEventListener('keydown', this.closeOnEscape);

        return shell.querySelector('.t2-clipurl-panel');
    }

    setPanelView(options) {
        const panel = this.createShell();
        const {
            title = 'T2ClipURL',
            subtitle = T2Utils.t('clipurl.subtitle_default'),
            body = '',
            footer = '',
            panelClass = ''
        } = options || {};

        panel.className = `t2-clipurl-panel ${panelClass}`.trim();
        panel.innerHTML = `
            <div class="t2-clipurl-panel-inner">
                <div class="t2-clipurl-header">
                    <div class="t2-clipurl-brand">
                        <div class="t2-clipurl-brand-icon"><span class="material-icons">qr_code_2</span></div>
                        <div class="t2-clipurl-brand-copy">
                            <h3>${this.escapeHtml(title)}</h3>
                            <p>${this.escapeHtml(subtitle)}</p>
                        </div>
                    </div>
                    <button type="button" class="t2-clipurl-close" data-action="close" data-i18n-aria-label="common.close" aria-label="${T2Utils.t('common.close')}">
                        <span class="material-icons">close</span>
                    </button>
                </div>
                <div class="t2-clipurl-body">${body}</div>
                ${footer ? `<div class="t2-clipurl-footer">${footer}</div>` : ''}
            </div>
        `;

        const closeBtn = panel.querySelector('[data-action="close"]');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closePanel());
        }

        return panel;
    }

    createInfoText(text) {
        return `
            <div class="t2-clipurl-help">
                <span class="material-icons">info</span>
                <span>${this.escapeHtml(text)}</span>
            </div>
        `;
    }

    showUrlInputPanel(defaultUrl = '') {
        const body = `
            <div class="t2-clipurl-field-wrap">
                <label class="t2-clipurl-field" for="t2-clipurl-input">
                    <span class="material-icons t2-clipurl-field-icon">language</span>
                    <input
                        id="t2-clipurl-input"
                        type="url"
                        class="t2-clipurl-input"
                        value="${this.escapeAttribute(defaultUrl)}"
                        placeholder="https://example.com"
                        autocomplete="off"
                        inputmode="url"
                    >
                </label>
            </div>
            ${this.createInfoText(T2Utils.t('clipurl.info_url_scheme'))}
            <div class="t2-clipurl-action-grid">
                <button type="button" class="t2-clipurl-choice t2-clipurl-choice-primary" data-action="short">
                    <span class="material-icons">short_text</span>
                    <span class="t2-clipurl-choice-copy">
                        <strong data-i18n="clipurl.choice_short">${T2Utils.t('clipurl.choice_short')}</strong>
                        <small data-i18n="clipurl.choice_short_desc">${T2Utils.t('clipurl.choice_short_desc')}</small>
                    </span>
                </button>
                <button type="button" class="t2-clipurl-choice" data-action="qr">
                    <span class="material-icons">qr_code_2</span>
                    <span class="t2-clipurl-choice-copy">
                        <strong data-i18n="clipurl.choice_qr">${T2Utils.t('clipurl.choice_qr')}</strong>
                        <small data-i18n="clipurl.choice_qr_desc">${T2Utils.t('clipurl.choice_qr_desc')}</small>
                    </span>
                </button>
            </div>
        `;

        const panel = this.setPanelView({ body });
        const input = panel.querySelector('.t2-clipurl-input');
        const shortBtn = panel.querySelector('[data-action="short"]');
        const qrBtn = panel.querySelector('[data-action="qr"]');

        const setPending = (pending) => {
            [shortBtn, qrBtn].forEach((btn) => {
                if (!btn) return;
                btn.disabled = pending;
                btn.classList.toggle('is-loading', pending);
            });
        };

        const run = async (type) => {
            const url = input.value.trim();
            if (!this.validateUrl(url)) {
                T2Utils.showNotification(T2Utils.t('clipurl.invalid_url'), 'error');
                input.focus();
                input.select();
                return;
            }

            setPending(true);
            try {
                const data = await this.callAPI(url, type);
                if (type === 'link') {
                    this.showShortLinkResult(url, data);
                } else {
                    this.showQRCodeResult(url, data);
                }
            } catch (error) {
                T2Utils.showNotification(type === 'link' ? T2Utils.t('clipurl.short_failed') : T2Utils.t('clipurl.qr_failed'), 'error');
                setPending(false);
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                run('link');
            }
        });

        shortBtn.addEventListener('click', () => run('link'));
        qrBtn.addEventListener('click', () => run('qr'));

        setTimeout(() => input.focus(), 0);
    }

    showShortLinkResult(originalUrl, data) {
        const shortUrl = this.escapeHtml(data.short_url || '');
        const safeOriginalUrl = this.escapeHtml(originalUrl || '');

        const body = `
            <div class="t2-clipurl-stack">
                <div class="t2-clipurl-summary-card">
                    <div class="t2-clipurl-label-row">
                        <span class="t2-clipurl-label" data-i18n="clipurl.url_label">${T2Utils.t('clipurl.url_label')}</span>
                    </div>
                    <div class="t2-clipurl-source-url">${safeOriginalUrl}</div>
                </div>

                <div class="t2-clipurl-result-card">
                    <div class="t2-clipurl-label-row">
                        <span class="t2-clipurl-label"><span class="material-icons">link</span><span data-i18n="clipurl.shortened_label">${T2Utils.t('clipurl.shortened_label')}</span></span>
                    </div>
                    <div class="t2-clipurl-output-box">${shortUrl}</div>
                </div>
            </div>
        `;

        const footer = `
            <div class="t2-clipurl-footer-row">
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-secondary" data-action="edit">
                    <span class="material-icons">edit</span><span data-i18n="clipurl.btn_rewrite">${T2Utils.t('clipurl.btn_rewrite')}</span>
                </button>
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-secondary" data-action="regen">
                    <span class="material-icons">sync</span><span data-i18n="clipurl.btn_qr_too">${T2Utils.t('clipurl.btn_qr_too')}</span>
                </button>
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-secondary" data-action="copy">
                    <span class="material-icons">content_copy</span><span data-i18n="clipurl.btn_copy">${T2Utils.t('clipurl.btn_copy')}</span>
                </button>
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-primary" data-action="insert">
                    <span class="material-icons">add</span><span data-i18n="clipurl.btn_add_link">${T2Utils.t('clipurl.btn_add_link')}</span>
                </button>
            </div>
        `;

        const panel = this.setPanelView({
            subtitle: T2Utils.t('clipurl.subtitle_short_ready'),
            body,
            footer
        });

        panel.querySelector('[data-action="edit"]').addEventListener('click', () => {
            this.showUrlInputPanel(originalUrl);
        });

        panel.querySelector('[data-action="regen"]').addEventListener('click', async () => {
            try {
                const bothData = await this.callAPI(originalUrl, 'both');
                this.showBothResult(originalUrl, bothData);
            } catch (error) {
                T2Utils.showNotification(T2Utils.t('clipurl.regen_failed'), 'error');
            }
        });

        panel.querySelector('[data-action="copy"]').addEventListener('click', async () => {
            const copied = await this.copyToClipboard(data.short_url || '');
            T2Utils.showNotification(copied ? T2Utils.t('clipurl.copied') : T2Utils.t('clipurl.copy_failed'), copied ? 'success' : 'error');
        });

        panel.querySelector('[data-action="insert"]').addEventListener('click', () => {
            this.insertLink(data.short_url || '');
            this.closePanel();
            T2Utils.showNotification(T2Utils.t('clipurl.added'), 'success');
        });
    }

    showQRCodeResult(originalUrl, data) {
        const qrUrl = this.escapeAttribute(data.qr_code_url || '');
        const safeOriginalUrl = this.escapeHtml(originalUrl || '');

        const body = `
            <div class="t2-clipurl-stack">
                <div class="t2-clipurl-summary-card">
                    <div class="t2-clipurl-label-row">
                        <span class="t2-clipurl-label" data-i18n="clipurl.url_label">${T2Utils.t('clipurl.url_label')}</span>
                    </div>
                    <div class="t2-clipurl-source-url">${safeOriginalUrl}</div>
                </div>

                <div class="t2-clipurl-result-card t2-clipurl-result-card-centered">
                    <div class="t2-clipurl-label-row">
                        <span class="t2-clipurl-label"><span class="material-icons">qr_code_2</span><span data-i18n="clipurl.qr_label">${T2Utils.t('clipurl.qr_label')}</span></span>
                    </div>
                    <img src="${qrUrl}" alt="QR Code" class="t2-clipurl-qr-image" crossorigin="anonymous">
                </div>
            </div>
        `;

        const footer = `
            <div class="t2-clipurl-footer-row">
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-secondary" data-action="edit">
                    <span class="material-icons">edit</span><span data-i18n="clipurl.btn_rewrite">${T2Utils.t('clipurl.btn_rewrite')}</span>
                </button>
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-secondary" data-action="regen">
                    <span class="material-icons">sync</span><span data-i18n="clipurl.btn_link_too">${T2Utils.t('clipurl.btn_link_too')}</span>
                </button>
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-secondary" data-action="download">
                    <span class="material-icons">download</span><span data-i18n="common.download">${T2Utils.t('common.download')}</span>
                </button>
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-primary" data-action="insert">
                    <span class="material-icons">image</span><span data-i18n="clipurl.btn_add_qr">${T2Utils.t('clipurl.btn_add_qr')}</span>
                </button>
            </div>
        `;

        const panel = this.setPanelView({
            subtitle: T2Utils.t('clipurl.subtitle_qr_ready'),
            body,
            footer,
            panelClass: 't2-clipurl-panel-compact-result'
        });

        panel.querySelector('[data-action="edit"]').addEventListener('click', () => {
            this.showUrlInputPanel(originalUrl);
        });

        panel.querySelector('[data-action="regen"]').addEventListener('click', async () => {
            try {
                const bothData = await this.callAPI(originalUrl, 'both');
                this.showBothResult(originalUrl, bothData);
            } catch (error) {
                T2Utils.showNotification(T2Utils.t('clipurl.regen_failed'), 'error');
            }
        });

        panel.querySelector('[data-action="download"]').addEventListener('click', () => {
            this.downloadQRCode(data.qr_code_url || '', 'qrcode.png');
        });

        panel.querySelector('[data-action="insert"]').addEventListener('click', () => {
            this.insertQRImage(data.qr_code_url || '');
            this.closePanel();
            T2Utils.showNotification(T2Utils.t('clipurl.added'), 'success');
        });
    }

    showBothResult(originalUrl, data) {
        const shortUrl = this.escapeHtml(data.short_url || '');
        const qrUrl = this.escapeAttribute(data.qr_code_url || '');
        const safeOriginalUrl = this.escapeHtml(originalUrl || '');

        const body = `
            <div class="t2-clipurl-stack">
                <div class="t2-clipurl-summary-card">
                    <div class="t2-clipurl-label-row">
                        <span class="t2-clipurl-label" data-i18n="clipurl.url_label">${T2Utils.t('clipurl.url_label')}</span>
                    </div>
                    <div class="t2-clipurl-source-url">${safeOriginalUrl}</div>
                </div>

                <div class="t2-clipurl-both-layout">
                    <div class="t2-clipurl-result-card t2-clipurl-result-card-centered">
                        <div class="t2-clipurl-label-row">
                            <span class="t2-clipurl-label"><span class="material-icons">qr_code_2</span><span data-i18n="clipurl.qr_label">${T2Utils.t('clipurl.qr_label')}</span></span>
                        </div>
                        <img src="${qrUrl}" alt="QR Code" class="t2-clipurl-qr-image" crossorigin="anonymous">
                        <button type="button" class="t2-clipurl-inline-btn" data-action="download">
                            <span class="material-icons">download</span><span data-i18n="common.download">${T2Utils.t('common.download')}</span>
                        </button>
                    </div>

                    <div class="t2-clipurl-result-card">
                        <div class="t2-clipurl-label-row">
                            <span class="t2-clipurl-label"><span class="material-icons">link</span><span data-i18n="clipurl.shortened_label">${T2Utils.t('clipurl.shortened_label')}</span></span>
                        </div>
                        <div class="t2-clipurl-output-box">${shortUrl}</div>
                        <button type="button" class="t2-clipurl-inline-btn" data-action="copy">
                            <span class="material-icons">content_copy</span><span data-i18n="clipurl.btn_copy">${T2Utils.t('clipurl.btn_copy')}</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        const footer = `
            <div class="t2-clipurl-footer-row">
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-secondary" data-action="edit">
                    <span class="material-icons">edit</span><span data-i18n="clipurl.btn_rewrite">${T2Utils.t('clipurl.btn_rewrite')}</span>
                </button>
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-primary" data-action="insert-link">
                    <span class="material-icons">add</span><span data-i18n="clipurl.btn_add_link">${T2Utils.t('clipurl.btn_add_link')}</span>
                </button>
                <button type="button" class="t2-clipurl-btn t2-clipurl-btn-primary" data-action="insert-qr">
                    <span class="material-icons">image</span><span data-i18n="clipurl.btn_add_qr">${T2Utils.t('clipurl.btn_add_qr')}</span>
                </button>
            </div>
        `;

        const panel = this.setPanelView({
            subtitle: T2Utils.t('clipurl.subtitle_both_ready'),
            body,
            footer,
            panelClass: 't2-clipurl-panel-wide'
        });

        panel.querySelector('[data-action="edit"]').addEventListener('click', () => {
            this.showUrlInputPanel(originalUrl);
        });

        panel.querySelector('[data-action="download"]').addEventListener('click', () => {
            this.downloadQRCode(data.qr_code_url || '', 'qrcode.png');
        });

        panel.querySelector('[data-action="copy"]').addEventListener('click', async () => {
            const copied = await this.copyToClipboard(data.short_url || '');
            T2Utils.showNotification(copied ? T2Utils.t('clipurl.copied') : T2Utils.t('clipurl.copy_failed'), copied ? 'success' : 'error');
        });

        panel.querySelector('[data-action="insert-link"]').addEventListener('click', () => {
            this.insertLink(data.short_url || '');
            this.closePanel();
            T2Utils.showNotification(T2Utils.t('clipurl.short_added'), 'success');
        });

        panel.querySelector('[data-action="insert-qr"]').addEventListener('click', () => {
            this.insertQRImage(data.qr_code_url || '');
            this.closePanel();
            T2Utils.showNotification(T2Utils.t('clipurl.qr_added'), 'success');
        });
    }

    validateUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (e) {
            return false;
        }
    }

    async callAPI(url, type) {
        const formData = new FormData();
        formData.append('api_key', this.apiKey);
        formData.append('url', url);
        formData.append('type', type);

        const response = await fetch(this.apiEndpoint, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!data || !data.success) {
            throw new Error((data && data.error) || T2Utils.t('clipurl.api_error'));
        }

        return data;
    }

    async copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (e) {}

        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', 'readonly');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(textarea);
            return copied;
        } catch (e) {
            return false;
        }
    }

    downloadQRCode(url, filename) {
        if (!url) {
            T2Utils.showNotification(T2Utils.t('clipurl.download_failed'), 'error');
            return;
        }

        fetch(url)
            .then((response) => response.blob())
            .then((blob) => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
                T2Utils.showNotification(T2Utils.t('clipurl.downloaded'), 'success');
            })
            .catch(() => T2Utils.showNotification(T2Utils.t('clipurl.download_failed'), 'error'));
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttribute(value) {
        return this.escapeHtml(value).replace(/`/g, '&#96;');
    }

    insertLink(url) {
        const link = document.createElement('a');
        link.href = url;
        link.textContent = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        // 원본 선택이 URL 형식의 일반 텍스트였으면 해당 자리를 그대로 대체
        if (this.lastSelectionWasPlainTextUrl && this.lastCursorPosition) {
            try {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(this.lastCursorPosition);

                const range = selection.getRangeAt(0);
                range.deleteContents();
                range.insertNode(link);

                const newRange = document.createRange();
                newRange.setStartAfter(link);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);

                this.editor.normalizeContent();
                this.editor.createUndoPoint();
                this.editor.autoSave();
                return;
            } catch (e) {}
        }

        // 일반 커서 위치에 추가
        let targetBlock = null;

        if (this.lastCursorPosition) {
            try {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(this.lastCursorPosition);
                targetBlock = this.editor.getClosestBlock(this.lastCursorPosition.startContainer);
            } catch (e) {}
        }

        if (!targetBlock || targetBlock === this.editor.editor) {
            const blocks = this.editor.editor.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6');
            targetBlock = blocks[blocks.length - 1];

            if (!targetBlock) {
                targetBlock = document.createElement('p');
                this.editor.editor.appendChild(targetBlock);
            }
        }

        if (targetBlock.textContent.trim() === '' || targetBlock.innerHTML === '<br>') {
            targetBlock.innerHTML = '';
            targetBlock.appendChild(link);
        } else {
            targetBlock.appendChild(document.createTextNode(' '));
            targetBlock.appendChild(link);
        }

        const range = document.createRange();
        const selection = window.getSelection();
        range.setStartAfter(link);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);

        this.editor.normalizeContent();
        this.editor.createUndoPoint();
        this.editor.autoSave();
    }

    insertQRImage(qrUrl) {
        const imagePlugin = this.editor.getPlugin('image');
        if (!imagePlugin) {
            T2Utils.showNotification(T2Utils.t('clipurl.image_plugin_missing'), 'error');
            return;
        }

        let targetBlock = null;

        if (this.lastCursorPosition) {
            try {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(this.lastCursorPosition);
                targetBlock = this.editor.getClosestBlock(this.lastCursorPosition.startContainer);
            } catch (e) {}
        }

        if (!targetBlock || targetBlock === this.editor.editor) {
            const blocks = this.editor.editor.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6');
            targetBlock = blocks[blocks.length - 1];

            if (!targetBlock) {
                targetBlock = document.createElement('p');
                targetBlock.innerHTML = '<br>';
                this.editor.editor.appendChild(targetBlock);
            }
        }

        const imageData = {
            url: qrUrl,
            width: 300,
            height: 300,
            blockId: imagePlugin.generateBlockId(),
            isUploading: false
        };

        const mediaBlock = imagePlugin.createImageBlock(imageData);
        const topBreak = document.createElement('p');
        topBreak.innerHTML = this.editor.isIOS || this.editor.isSafari ? '<br>' : '\u200B<br>';

        targetBlock.parentNode.insertBefore(topBreak, targetBlock.nextSibling);
        topBreak.parentNode.insertBefore(mediaBlock, topBreak.nextSibling);

        const bottomBreak = document.createElement('p');
        bottomBreak.textContent = '\u200B';
        mediaBlock.parentNode.insertBefore(bottomBreak, mediaBlock.nextSibling);

        imagePlugin.cleanupEmptyLines(mediaBlock);

        const range = document.createRange();
        const selection = window.getSelection();
        range.setStartAfter(bottomBreak);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);

        this.editor.normalizeContent();
        this.editor.createUndoPoint();
        this.editor.autoSave();
    }
}

window.T2ClipurlPlugin = T2ClipurlPlugin;