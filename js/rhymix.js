// Path: T2Editor/js/rhymix.js
// Developer note: insertHtml/setData/getData 시그니처와 숨은 입력 동기화는 Rhymix 연결 계약이다.
/* T2Editor — Rhymix 2.1.x integration bridge */
(function (window, document, $) {
    'use strict';

    var registry = window.T2EditorRhymixRegistry = window.T2EditorRhymixRegistry || {};
    var previousGetInstance = window._getCkeInstance;
    var previousGetContainer = window._getCkeContainer;
    var previousGetIFrame = window.editorGetIFrame;

    function parseConfig(wrapper) {
        try {
            return JSON.parse(wrapper.getAttribute('data-editor-config') || '{}');
        } catch (error) {
            console.error('[T2Editor/Rhymix] Invalid editor configuration.', error);
            return {};
        }
    }

    function namedElement(form, name) {
        if (!form || !name) return null;
        var item = form.elements ? form.elements.namedItem(name) : null;
        if (item && typeof item.value !== 'undefined') return item;
        return form.querySelector('[name="' + String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
    }

    function restoreContent(instance, html) {
        if (html === null || typeof html === 'undefined') return;
        var temp = document.createElement('div');
        temp.innerHTML = html;
        if (window.T2EditorHooks && typeof window.T2EditorHooks.runRestore === 'function') {
            window.T2EditorHooks.runRestore(temp);
        }
        if (window.T2LegacyFallback && typeof window.T2LegacyFallback.runRestoreFallback === 'function') {
            window.T2LegacyFallback.runRestoreFallback(temp);
        }
        instance.setContent(temp.innerHTML);
    }

    function insertHtml(bridge, html) {
        var editable = bridge.editable;
        var instance = bridge.instance;
        if (!editable || !instance) return;
        var safe = typeof instance.sanitizePluginHTML === 'function'
            ? instance.sanitizePluginHTML(String(html || ''), 'file')
            : String(html || '');
        if (!safe) return;

        var bookmark = typeof instance.captureSelectionBookmark === 'function'
            ? (instance.captureSelectionBookmark() || instance._lastEditorBookmark || null)
            : null;
        var selection = window.getSelection && window.getSelection();
        var range = typeof instance._getActiveEditorRange === 'function'
            ? instance._getActiveEditorRange(bookmark, { fallback: 'end' })
            : (selection && selection.rangeCount ? selection.getRangeAt(0) : null);
        if (!range || !(range.startContainer === editable || editable.contains(range.startContainer))) return;

        editable.focus();
        if (typeof instance.restoreSelectionBookmark === 'function' && bookmark) {
            instance.restoreSelectionBookmark(bookmark, { focus: false });
            range = instance._getActiveEditorRange(bookmark, { fallback: 'end' }) || range;
        }

        var temp = document.createElement('div');
        temp.innerHTML = safe;
        var hasTopLevelBlocks = Array.prototype.some.call(temp.childNodes, function (node) {
            return node.nodeType === 1 && (/^(P|DIV|H[1-6]|PRE|BLOCKQUOTE|UL|OL|TABLE|HR)$/.test(node.tagName) ||
                (typeof instance._isEditorBlockNode === 'function' && instance._isEditorBlockNode(node)));
        });
        var inserted = false;
        if (hasTopLevelBlocks && typeof instance._normalizePastedTopLevelNodes === 'function' &&
            typeof instance._insertPastedBlockSequence === 'function') {
            inserted = instance._insertPastedBlockSequence(instance._normalizePastedTopLevelNodes(temp), range);
        } else {
            if (!range.collapsed) {
                if (typeof instance._deleteSelectionForStructuredInput === 'function') {
                    range = instance._deleteSelectionForStructuredInput(range);
                } else {
                    range.deleteContents();
                    range.collapse(true);
                }
            }
            if (range) {
                var fragment = range.createContextualFragment(safe);
                var marker = document.createComment('t2-rhymix-insert-caret');
                fragment.appendChild(marker);
                range.insertNode(fragment);
                var caret = document.createRange();
                caret.setStartBefore(marker);
                caret.collapse(true);
                if (selection) {
                    selection.removeAllRanges();
                    selection.addRange(caret);
                }
                marker.remove();
                inserted = true;
            }
        }

        if (!inserted) return;
        if (typeof instance.normalizeContent === 'function') instance.normalizeContent();
        if (typeof instance._captureLastEditorRange === 'function') instance._captureLastEditorRange();
        if (typeof instance.createUndoPoint === 'function') instance.createUndoPoint();
        if (typeof instance.autoSave === 'function') instance.autoSave();
        if (typeof instance.updateCharCount === 'function') instance.updateCharCount();
        bridge.sync();
    }

    function createBridge(wrapper) {
        var config = parseConfig(wrapper);
        var sequence = parseInt(config.editorSequence || wrapper.getAttribute('data-editor-sequence'), 10);
        if (!sequence || registry[sequence]) return registry[sequence] || null;

        var form = wrapper.closest('form');
        var instance = window[String(config.internalId || '') + '_editor'];
        var internalTextarea = document.getElementById(config.internalId);
        var editable = document.getElementById(String(config.internalId || '') + '_editor');
        var contentInput = namedElement(form, config.contentKeyName);
        var primaryInput = namedElement(form, config.primaryKeyName);
        if (!form || !instance || !internalTextarea || !editable || !contentInput) {
            console.error('[T2Editor/Rhymix] Editor contract could not be initialized.', {
                sequence: sequence, form: !!form, instance: !!instance,
                internalTextarea: !!internalTextarea, editable: !!editable, contentInput: !!contentInput
            });
            return null;
        }

        var bridge = {
            sequence: sequence,
            wrapper: wrapper,
            config: config,
            form: form,
            instance: instance,
            editable: editable,
            contentInput: contentInput,
            primaryInput: primaryInput,
            sync: function () {
                var submitter = window.T2EditorRhymixSubmitters && window.T2EditorRhymixSubmitters[sequence];
                if (typeof submitter === 'function') submitter();
                contentInput.value = internalTextarea.value;
                return contentInput.value;
            },
            getContent: function () {
                return this.sync();
            },
            setContent: function (html) {
                restoreContent(instance, String(html || ''));
                this.sync();
            },
            insertHtml: function (html) {
                insertHtml(this, html);
            }
        };
        registry[sequence] = bridge;

        form.setAttribute('editor_sequence', sequence);
        window.editorRelKeys = window.editorRelKeys || [];
        window.editorRelKeys[sequence] = {
            primary: primaryInput || { value: '' },
            content: contentInput,
            func: function () { return bridge.getContent(); },
            pasteHTML: function (html) { bridge.insertHtml(html); },
            editor: { getFrame: function () { return editable; } }
        };
        editable.setFocus = function () { editable.focus(); };

        // Load the real Rhymix field, not a duplicate textarea created by the skin.
        var initialContent = contentInput.value || '';
        if (form._saved_doc_title && (form._saved_doc_title.value || form._saved_doc_content.value)) {
            if (window.confirm(form._saved_doc_message.value)) {
                if (form.title) form.title.value = form._saved_doc_title.value;
                initialContent = form._saved_doc_content.value;
                if (typeof window.exec_json === 'function') {
                    window.exec_json('editor.procEditorLoadSavedDocument', {
                        editor_sequence: sequence,
                        primary_key: config.primaryKeyName,
                        mid: window.current_mid || config.mid || ''
                    }, function (response) {
                        if (response && response.document_srl && bridge.primaryInput) {
                            bridge.primaryInput.value = response.document_srl;
                            if (typeof window.reloadUploader === 'function') window.reloadUploader(sequence);
                        }
                    });
                }
            } else if (typeof window.editorRemoveSavedDoc === 'function') {
                window.editorRemoveSavedDoc();
            }
        }
        restoreContent(instance, initialContent);
        bridge.sync();

        // Apply Rhymix editor options.
        editable.style.minHeight = Math.max(100, parseInt(config.height, 10) || 300) + 'px';
        if (config.hideToolbar) {
            var toolbar = wrapper.querySelector('.t2-toolbar');
            if (toolbar) toolbar.style.display = 'none';
        } else if (config.toolbar === 'simple') {
            var allowed = ['undo', 'redo', 'bold', 'italic', 'underline', 'strikeThrough', 'justifyContent', 'createLink', 'insertImage'];
            wrapper.querySelectorAll('.t2-toolbar [data-command]').forEach(function (button) {
                if (allowed.indexOf(button.getAttribute('data-command')) === -1) button.style.display = 'none';
            });
        }
        if (!config.allowUpload) {
            wrapper.querySelectorAll('[data-plugin="image"], [data-plugin="video"], [data-plugin="file"], [data-plugin="draw"], [data-plugin="meme"]').forEach(function (button) {
                button.style.display = 'none';
            });
            editable.addEventListener('drop', function (event) {
                if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) event.preventDefault();
            }, true);
            editable.addEventListener('paste', function (event) {
                var items = event.clipboardData && event.clipboardData.items;
                if (items && Array.prototype.some.call(items, function (item) { return item.kind === 'file'; })) event.preventDefault();
            }, true);
        }
        if (config.colorset === 'dark' || config.colorset === 'light') {
            if (window.T2EditorTheme && typeof window.T2EditorTheme.setForcedTheme === 'function') {
                window.T2EditorTheme.setForcedTheme(config.colorset);
            } else {
                document.documentElement.setAttribute('data-t2editor-theme', config.colorset);
                document.documentElement.style.colorScheme = config.colorset;
            }
            wrapper.querySelectorAll('.t2-dark-mode-toggle').forEach(function (el) { el.style.display = 'none'; });
        }

        var syncTimer = null;
        function scheduleSync() {
            window.clearTimeout(syncTimer);
            syncTimer = window.setTimeout(function () { bridge.sync(); }, 80);
        }
        editable.addEventListener('input', scheduleSync);
        editable.addEventListener('change', scheduleSync);
        editable.addEventListener('blur', function () { bridge.sync(); });
        form.addEventListener('submit', function () { bridge.sync(); }, true);

        // Rhymix's legacy controllers inspect these values on submit.
        var useEditor = namedElement(form, 'use_editor');
        var useHtml = namedElement(form, 'use_html');
        if (useEditor) useEditor.value = 'Y';
        if (useHtml) useHtml.value = 'Y';

        if (config.enableAutosave && form._saved_doc_title && typeof window.editorEnableAutoSave === 'function') {
            window.editorEnableAutoSave(form, sequence);
        }
        if (config.focus) window.setTimeout(function () { editable.focus(); }, 0);
        return bridge;
    }

    function boot() {
        document.querySelectorAll('.rx_t2editor').forEach(createBridge);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    // Native Rhymix attachment uploader expects CKEditor-compatible shims.
    window._getCkeInstance = function (sequence) {
        var bridge = registry[sequence];
        if (!bridge && typeof previousGetInstance === 'function') return previousGetInstance(sequence);
        if (!bridge) return null;
        return {
            getData: function () { return bridge.getContent(); },
            setData: function (html) { bridge.setContent(html); },
            insertHtml: function (html) { bridge.insertHtml(html); },
            getText: function () { return bridge.editable.textContent || ''; },
            getSelection: function () {
                return { getSelectedText: function () { return String(window.getSelection ? window.getSelection() : ''); } };
            },
            focus: function () { bridge.editable.focus(); }
        };
    };
    window._getCkeContainer = function (sequence) {
        var bridge = registry[sequence];
        if (!bridge && typeof previousGetContainer === 'function') return previousGetContainer(sequence);
        return bridge ? $(bridge.wrapper) : $();
    };
    window.editorGetIFrame = function (sequence) {
        var bridge = registry[sequence];
        if (!bridge && typeof previousGetIFrame === 'function') return previousGetIFrame(sequence);
        return bridge ? bridge.editable : null;
    };
})(window, document, window.jQuery);

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
