// Path: T2Editor/plugin/link/link.js
// Developer note: 플러그인 ID "link"과 command/button ID는 등록 설정·button.json·locale 키와 함께 변경한다.

class T2LinkPlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['createLink'];

        setTimeout(() => {
            this.initializeLinks();
        }, 100);

        this.editorClickHandler = (e) => {
            if (e.target.tagName === 'A' && this.editor.editor.contains(e.target)) {
                this.handleLinkClick(e, e.target);
            }
        };
        this.editor.editor.addEventListener('click', this.editorClickHandler);
    }

    escapeAttribute(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    openLinkSafely(url, target) {
        const safeTarget = target || '_blank';
        const opened = window.open(url, safeTarget, safeTarget === '_blank' ? 'noopener,noreferrer' : undefined);
        if (opened && safeTarget === '_blank') opened.opener = null;
    }

    handleCommand(command, button) {
        switch(command) {
            case 'createLink':
                this.showLinkModal();
                break;
        }
    }

    onContentSet(html) {
        setTimeout(() => {
            this.initializeLinks();
        }, 50);
    }

    showLinkModal() {
        const selection = window.getSelection();

        if (!selection || !selection.rangeCount || selection.getRangeAt(0).collapsed) {
            T2Utils.showNotification(T2Utils.t('link.select_text_first'), 'warning');
            return;
        }

        const range = selection.getRangeAt(0);
        if (!this.editor.editor.contains(range.commonAncestorContainer)) {
            T2Utils.showNotification(T2Utils.t('link.select_text_first'), 'warning');
            return;
        }

        // 모달 포커스 이동과 비동기 입력 후에도 동일한 선택을 복원할 수 있도록
        // raw Range 대신 코어의 인스턴스 전용 북마크를 이 작업에 고정한다.
        const selectionBookmark = this.editor.saveSelection();
        let existingLink = this.findExistingLink(range);

        const modalContent = `
            <div class="t2-link-editor-modal">
                <h3 data-i18n="${existingLink ? 'link.modal_title_edit' : 'link.modal_title'}">${existingLink ? T2Utils.t('link.modal_title_edit') : T2Utils.t('link.modal_title')}</h3>
                <div class="t2-link-input-container">
                    <input type="text" class="t2-link-url-input"
                           placeholder="https://"
                           value="${this.escapeAttribute(existingLink ? existingLink.href : '')}">
                    <div class="t2-link-options">
                        <label>
                           <input type="checkbox" class="t2-link-new-tab" ${existingLink ? (existingLink.target === '_blank' ? 'checked' : '') : 'checked'}>
                           <span data-i18n="link.target_label">${T2Utils.t('link.target_label')}</span>
                        </label>
                    </div>
                </div>
                <div class="t2-btn-group">
                    ${existingLink ? '<button class="t2-btn" data-action="remove" data-i18n="link.btn_remove">' + T2Utils.t('link.btn_remove') + '</button>' : ''}
                    <button class="t2-btn" data-action="cancel" data-i18n="common.cancel">${T2Utils.t('common.cancel')}</button>
                    <button class="t2-btn" data-action="insert">${existingLink ? T2Utils.t('link.btn_update') : T2Utils.t('common.insert')}</button>
                </div>
            </div>
        `;

        const modal = T2Utils.createModal(modalContent);
        this.setupLinkModalEvents(modal, existingLink, selectionBookmark);
    }

    setupLinkModalEvents(modal, existingLink, selectionBookmark) {
        const urlInput = modal.querySelector('.t2-link-url-input');
        const newTabCheckbox = modal.querySelector('.t2-link-new-tab');

        const handleLink = () => {
            const url = urlInput.value.trim();
            const newTab = newTabCheckbox.checked;

            if (!url) {
                T2Utils.showNotification(T2Utils.t('link.invalid_url'), 'warning');
                return;
            }

            let finalUrl = url;
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) {
                finalUrl = `mailto:${url}`;
            } else if (/^\+?[0-9()\-\s]{7,}$/.test(url)) {
                finalUrl = `tel:${url.replace(/\s+/g, '')}`;
            } else if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
                finalUrl = 'https://' + url;
            }

            if (!T2Utils.validateUrl(finalUrl)) {
                T2Utils.showNotification(T2Utils.t('link.invalid_url'), 'error');
                return;
            }

            const restored = selectionBookmark && typeof this.editor.restoreSelectionBookmark === 'function'
                ? this.editor.restoreSelectionBookmark(selectionBookmark, { focus: true, preventScroll: true })
                : this.editor.restoreSelection();

            try {
                const selection = window.getSelection();
                if (!restored || !selection || !selection.rangeCount) {
                    T2Utils.showNotification(T2Utils.t('link.no_selection'), 'error');
                    return;
                }

                const range = selection.getRangeAt(0);
                let activeLink = existingLink && existingLink.isConnected ? existingLink : this.findExistingLink(range);

                if (activeLink) {
                    activeLink.href = finalUrl;
                    activeLink.target = newTab ? '_blank' : '';
                    activeLink.rel = newTab ? 'noopener noreferrer' : '';
                } else {
                    if (!range.toString()) {
                        T2Utils.showNotification(T2Utils.t('link.no_text_selected'), 'warning');
                        return;
                    }
                    this.insertLinkAtRange(range, finalUrl, newTab);
                }

                modal.remove();
                this.editor.normalizeContent();
                this.editor.createUndoPoint();
                this.editor.autoSave();

                setTimeout(() => {
                    this.initializeLinks();
                }, 50);
            } catch (error) {
                console.error('Link creation error:', error);
                T2Utils.showNotification(T2Utils.t('link.apply_error'), 'error');
            }
        };

        modal.querySelector('[data-action="insert"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleLink();
        };

        modal.querySelector('[data-action="cancel"]').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            modal.remove();
        };

        if (existingLink) {
            modal.querySelector('[data-action="remove"]').onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.removeLinkFromSelection(existingLink);
                modal.remove();
            };
        }

        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleLink();
            }
        });

        setTimeout(() => {
            urlInput.focus();
            urlInput.select();
        }, 100);
    }

    unwrapLinksInFragment(fragment) {
        if (!fragment || typeof fragment.querySelectorAll !== 'function') return;
        Array.from(fragment.querySelectorAll('a')).forEach((link) => {
            const parent = link.parentNode;
            if (!parent) return;
            while (link.firstChild) parent.insertBefore(link.firstChild, link);
            link.remove();
        });
    }

    fragmentContainsBlockContent(fragment) {
        if (!fragment || typeof fragment.querySelector !== 'function') return false;
        return !!fragment.querySelector('p,div,h1,h2,h3,h4,h5,h6,blockquote,pre,ul,ol,li,table,thead,tbody,tfoot,tr,td,th,figure,section,article,hr');
    }

    wrapFragmentTextNodes(fragment, url, newTab) {
        const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                if (!node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (parent && parent.closest('script,style,button,[contenteditable="false"]')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        let current;
        while ((current = walker.nextNode())) nodes.push(current);
        nodes.forEach((textNode) => {
            if (!textNode.parentNode) return;
            const link = this.createLinkElement(url, '', newTab);
            textNode.parentNode.insertBefore(link, textNode);
            link.appendChild(textNode);
        });
    }

    wrapRangeTextNodes(range, url, newTab) {
        const selected = [];
        const walker = document.createTreeWalker(this.editor.editor, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                if (!node.nodeValue || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
                const editableOwner = node.parentElement && node.parentElement.closest('[contenteditable]');
                if (editableOwner && editableOwner !== this.editor.editor && editableOwner.contentEditable === 'false') {
                    return NodeFilter.FILTER_REJECT;
                }
                try {
                    return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                } catch (error) {
                    return NodeFilter.FILTER_REJECT;
                }
            }
        });

        let node;
        while ((node = walker.nextNode())) {
            let start = 0;
            let end = node.nodeValue.length;
            if (range.startContainer === node) start = range.startOffset;
            if (range.endContainer === node) end = range.endOffset;
            if (end > start) selected.push({ node, start, end });
        }
        if (!selected.length) return null;

        const caretTextOffset = typeof this.editor._textOffsetFromPoint === 'function'
            ? this.editor._textOffsetFromPoint(this.editor.editor, range.endContainer, range.endOffset)
            : null;
        let lastLink = null;
        selected.reverse().forEach((part) => {
            let selectedNode = part.node;
            if (part.end < selectedNode.nodeValue.length) selectedNode.splitText(part.end);
            if (part.start > 0) selectedNode = selectedNode.splitText(part.start);

            const existing = selectedNode.parentElement && selectedNode.parentElement.closest('a');
            if (existing && this.editor.editor.contains(existing)) {
                existing.href = url;
                existing.target = newTab ? '_blank' : '';
                existing.rel = newTab ? 'noopener noreferrer' : '';
                lastLink = lastLink || existing;
                return;
            }

            const link = this.createLinkElement(url, '', newTab);
            selectedNode.parentNode.insertBefore(link, selectedNode);
            link.appendChild(selectedNode);
            lastLink = lastLink || link;
        });

        const selection = window.getSelection();
        let caret = null;
        if (Number.isFinite(caretTextOffset) && typeof this.editor._collapsedRangeAtTextOffset === 'function') {
            caret = this.editor._collapsedRangeAtTextOffset(this.editor.editor, caretTextOffset);
        }
        if (!caret && lastLink && lastLink.parentNode) {
            caret = document.createRange();
            caret.setStartAfter(lastLink);
            caret.collapse(true);
        }
        if (caret && selection) {
            selection.removeAllRanges();
            selection.addRange(caret);
        }
        return lastLink;
    }

    insertLinkAtRange(range, url, newTab) {
        const selection = window.getSelection();
        const common = range.commonAncestorContainer;
        if (common === this.editor.editor || (common.nodeType === Node.ELEMENT_NODE && common === this.editor.editor)) {
            return this.wrapRangeTextNodes(range, url, newTab);
        }

        const fragment = range.extractContents();
        this.unwrapLinksInFragment(fragment);

        let insertedNodes;
        if (this.fragmentContainsBlockContent(fragment)) {
            this.wrapFragmentTextNodes(fragment, url, newTab);
            insertedNodes = Array.from(fragment.childNodes);
        } else {
            const link = this.createLinkElement(url, '', newTab);
            link.appendChild(fragment);
            insertedNodes = [link];
            const wrapper = document.createDocumentFragment();
            wrapper.appendChild(link);
            range.insertNode(wrapper);
            const caret = document.createRange();
            caret.setStartAfter(link);
            caret.collapse(true);
            selection.removeAllRanges();
            selection.addRange(caret);
            return link;
        }

        const lastNode = insertedNodes[insertedNodes.length - 1] || null;
        range.insertNode(fragment);
        if (lastNode && lastNode.parentNode) {
            const caret = document.createRange();
            caret.setStartAfter(lastNode);
            caret.collapse(true);
            selection.removeAllRanges();
            selection.addRange(caret);
        }
        return lastNode;
    }

    findExistingLink(range) {
        const startNode = range.startContainer;
        const endNode = range.endContainer;

        const findLinkParent = (node) => {
            while (node && node !== this.editor.editor) {
                if (node.nodeName === 'A') {
                    return node;
                }
                node = node.parentNode;
            }
            return null;
        };

        const startLink = findLinkParent(startNode);
        const endLink = findLinkParent(endNode);

        if (startLink && startLink === endLink) {
            return startLink;
        }

        const selectedText = range.toString();
        const allLinks = [];
        const commonAncestor = range.commonAncestorContainer;

        if (commonAncestor.nodeType === Node.ELEMENT_NODE) {
            const treeWalker = document.createTreeWalker(
                commonAncestor,
                NodeFilter.SHOW_ELEMENT,
                {
                    acceptNode: (node) => {
                        return node.nodeName === 'A' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                    }
                }
            );

            let currentNode;
            while (currentNode = treeWalker.nextNode()) {
                if (range.intersectsNode(currentNode)) {
                    if (currentNode.textContent === selectedText) {
                        return currentNode;
                    }
                    allLinks.push(currentNode);
                }
            }
        }

        if (allLinks.length === 1 && allLinks[0].textContent === selectedText) {
            return allLinks[0];
        }

        return null;
    }

    createLinkElement(url, text, newTab = false) {
        const link = document.createElement('a');
        link.href = url;
        link.textContent = text;

        if (newTab) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }

        link.style.color = '#4A90E2';
        link.style.textDecoration = 'none';

        this.setupLinkEvents(link);

        return link;
    }

    removeLinkFromSelection(existingLink) {
        this.editor.restoreSelection();

        try {
            this.unwrapLinkElement(existingLink, true);
            this.editor.normalizeContent();
            this.editor.createUndoPoint();
            this.editor.autoSave();
        } catch (error) {
            console.error('Link removal error:', error);
            T2Utils.showNotification(T2Utils.t('link.remove_error'), 'error');
        }
    }

    showLinkPreview(link) {
        const existingPreview = this.editor.container.querySelector('.t2-link-preview');
        if (existingPreview) {
            existingPreview.remove();
        }

        const preview = document.createElement('div');
        preview.className = 't2-link-preview';
        preview.innerHTML = `
            <div class="t2-link-preview-content">
                <div class="t2-link-preview-url">${this.truncateUrl(link.href, 50)}</div>
                <div class="t2-link-preview-actions">
                    <button class="t2-btn t2-link-edit" data-action="edit">편집</button>
                    <button class="t2-btn t2-link-remove" data-action="remove">제거</button>
                    <button class="t2-btn t2-link-visit" data-action="visit">방문</button>
                </div>
            </div>
        `;

        const linkRect = link.getBoundingClientRect();
        const editorRect = this.editor.editor.getBoundingClientRect();

        preview.style.position = 'absolute';
        preview.style.top = (linkRect.bottom - editorRect.top + 5) + 'px';
        preview.style.left = (linkRect.left - editorRect.left) + 'px';
        preview.style.zIndex = '1000';

        preview.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const action = e.target.closest('[data-action]')?.dataset.action;

            switch(action) {
                case 'edit':
                    this.editLink(link);
                    break;
                case 'remove':
                    this.removeLink(link);
                    break;
                case 'visit':
                    this.openLinkSafely(link.href, link.target || '_blank');
                    break;
            }

            preview.remove();
        });

        this.editor.container.style.position = 'relative';
        this.editor.container.appendChild(preview);

        const closeHandler = (e) => {
            if (!preview.contains(e.target) && e.target !== link) {
                preview.remove();
                document.removeEventListener('mousedown', closeHandler);
            }
        };

        setTimeout(() => {
            document.addEventListener('mousedown', closeHandler);
        }, 100);
    }

    editLink(link) {
        const range = document.createRange();
        range.selectNodeContents(link);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        this.showLinkModal();
    }

    unwrapLinkElement(link, placeCaret = false) {
        const parent = link && link.parentNode;
        if (!parent) return null;
        const moved = [];
        while (link.firstChild) {
            const child = link.firstChild;
            moved.push(child);
            parent.insertBefore(child, link);
        }
        link.remove();
        parent.normalize();

        const lastNode = moved[moved.length - 1] || null;
        if (placeCaret && lastNode && lastNode.parentNode) {
            const range = document.createRange();
            range.setStartAfter(lastNode);
            range.collapse(true);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
        return lastNode;
    }

    removeLink(link) {
        this.unwrapLinkElement(link, true);
        this.editor.normalizeContent();
        this.editor.createUndoPoint();
        this.editor.autoSave();
    }

    initializeLinks() {
        const links = this.editor.editor.querySelectorAll('a');
        links.forEach(link => {
            if (!link.dataset.linkEventsSetup) {
                this.setupLinkEvents(link);
            }
        });
    }

    setupLinkEvents(link) {
        const clickHandler = (e) => {
            this.handleLinkClick(e, link);
        };

        link.removeEventListener('click', clickHandler);
        link.addEventListener('click', clickHandler);

        link.addEventListener('mouseenter', () => {
            link.style.textDecoration = 'underline';
        });

        link.addEventListener('mouseleave', () => {
            link.style.textDecoration = 'none';
        });

        link.dataset.linkEventsSetup = 'true';
    }

    handleLinkClick(e, link) {
        if (this.editor.editor.contentEditable === 'true' || this.editor.editor.isContentEditable) {
            e.preventDefault();
            e.stopPropagation();

            if (e.ctrlKey || e.metaKey) {
                this.openLinkSafely(link.href, link.target || '_blank');
            } else {
                // 이미지 링크인지 확인
                if (this.isImageUrl(link.href)) {
                    // 이미지 플러그인의 미리보기 표시
                    const imagePlugin = this.editor.getPlugin('image');
                    if (imagePlugin) {
                        imagePlugin.showImageLinkPreview(link);
                    } else {
                        this.showLinkPreview(link);
                    }
                } else {
                    this.showLinkPreview(link);
                }
            }
        }
    }

    isImageUrl(url) {
        const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)(\?.*)?$/i;
        return imageExtensions.test(url);
    }

    truncateUrl(url, maxLength) {
        if (url.length <= maxLength) return url;
        return url.substring(0, maxLength - 3) + '...';
    }

    autoLinkDetection(text) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return text.replace(urlRegex, (url) => {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #4A90E2; text-decoration: none;">${url}</a>`;
        });
    }

    autoEmailDetection(text) {
        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g;
        return text.replace(emailRegex, (email) => {
            return `<a href="mailto:${email}" style="color: #4A90E2; text-decoration: none;">${email}</a>`;
        });
    }
}

window.T2LinkPlugin = T2LinkPlugin;

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
