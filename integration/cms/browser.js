// Path: T2Editor/integration/cms/browser.js
// Developer note: 플러그인은 CMS 이름 대신 T2EditorHostAdapters capability를 호출한다.
(function (window, document) {
    'use strict';

    const registry = window.T2EditorHostAdapters = window.T2EditorHostAdapters || {};
    registry.items = Array.isArray(registry.items) ? registry.items : [];
    registry.register = registry.register || function (adapter) {
        if (!adapter || !adapter.id || this.items.some(item => item.id === adapter.id)) return false;
        this.items.push(adapter);
        this.items.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
        return true;
    };
    registry._active = registry._active || function (adapter, args) {
        if (typeof adapter.active !== 'function') return true;
        try { return adapter.active(...args) !== false; }
        catch (error) {
            console.error('[T2Editor host adapter] Activation failed:', adapter.id, error);
            return false;
        }
    };
    registry.callAdapter = registry.callAdapter || function (id, capability, args, fallback) {
        const adapter = this.items.find(item => item.id === id);
        if (!adapter || typeof adapter[capability] !== 'function' || !this._active(adapter, args)) return fallback;
        try {
            const value = adapter[capability](...args);
            return value === null || typeof value === 'undefined' || value === '' ? fallback : value;
        } catch (error) {
            console.error('[T2Editor host adapter] Capability failed:', id, capability, error);
            return fallback;
        }
    };
    registry.callAll = registry.callAll || function (capability, args, initialValue) {
        let value = initialValue;
        this.items.forEach(adapter => {
            if (typeof adapter[capability] !== 'function' || !this._active(adapter, args)) return;
            try {
                const next = adapter[capability](...args, value);
                if (typeof next !== 'undefined') value = next;
            } catch (error) {
                console.error('[T2Editor host adapter] Capability failed:', adapter.id, capability, error);
            }
        });
        return value;
    };
    registry.callFirst = registry.callFirst || function (capability, args, fallback) {
        for (const adapter of this.items) {
            if (typeof adapter[capability] !== 'function' || !this._active(adapter, args)) continue;
            try {
                const value = adapter[capability](...args);
                if (value !== null && typeof value !== 'undefined' && value !== '') return value;
            } catch (error) {
                console.error('[T2Editor host adapter] Capability failed:', adapter.id, capability, error);
            }
        }
        return fallback;
    };

    function editorFromArgs(args) {
        return Array.from(args || []).find(value => value && typeof value === 'object' && value.container) || null;
    }

    function rhymixConfig(editor) {
        const container = editor && editor.container ? editor.container.closest('.rx_t2editor') : null;
        if (container) {
            try {
                const config = JSON.parse(container.getAttribute('data-editor-config') || '{}');
                config.__container = container;
                return config;
            } catch (error) {
                console.error('[T2Editor host adapter] Invalid per-instance configuration.', error);
            }
        }
        return {
            editorSequence: window.T2EDITOR_RHYMIX_EDITOR_SEQUENCE || '',
            uploadTargetSrl: window.T2EDITOR_RHYMIX_UPLOAD_TARGET_SRL || '',
            moduleSrl: window.T2EDITOR_RHYMIX_MODULE_SRL || '',
            mid: window.T2EDITOR_RHYMIX_MID || '',
            csrfToken: window.T2EDITOR_RHYMIX_CSRF_TOKEN || ''
        };
    }

    registry.register({
        id: 'rhymix',
        priority: 200,
        active() { return !!rhymixConfig(editorFromArgs(arguments)).editorSequence; },
        legacyConfig(editor) { return rhymixConfig(editor); },
        appendUploadFields(formData, editor) {
            const config = rhymixConfig(editor);
            const file = formData.get('Filedata') || formData.get('bf_file') || formData.get('bf_file[]');
            if (file) {
                formData.delete('bf_file');
                formData.delete('bf_file[]');
                if (!formData.has('Filedata')) formData.append('Filedata', file);
            }
            formData.set('act', 'procFileUpload');
            formData.set('editor_sequence', config.editorSequence);
            if (config.uploadTargetSrl) formData.set('uploadTargetSrl', config.uploadTargetSrl);
            if (config.moduleSrl) formData.set('module_srl', config.moduleSrl);
            if (config.mid) formData.set('mid', config.mid);
            if (config.csrfToken) formData.set('_rx_csrf_token', config.csrfToken);
            return true;
        },
        uploadUrl() { return window.request_uri || window.location.pathname || '/'; },
        normalizeUrl(value) {
            const decoded = String(value || '').replace(/&(?:amp|#0*38|#x0*26);/gi, '&');
            const base = (typeof window.request_uri === 'string' && window.request_uri)
                || (typeof window.default_url === 'string' && window.default_url)
                || window.location.href;
            try { return new URL(decoded, base).href; } catch (error) { return decoded; }
        },
        normalizeUploadResponse(data, kind) {
            if (!data || typeof data.error === 'undefined') return data;
            const success = Number(data.error) === 0;
            const info = {
                id: 'rhymix', file_srl: Number(data.file_srl || 0), upload_target_srl: Number(data.upload_target_srl || 0),
                source_filename: String(data.source_filename || ''), uploaded_filename: String(data.uploaded_filename || ''),
                download_url: this.normalizeUrl(data.download_url), mime_type: String(data.mime_type || ''),
                direct_download: String(data.direct_download || ''), error: Number(data.error || 0)
            };
            if (kind === 'image') return { success, message: data.message || '', files: success ? [{ url: info.download_url, width: Number(data.width || 0), height: Number(data.height || 0) }] : [], failures: [], host: info, rhymix: info };
            return { success, message: data.message || '', file: success ? { url: info.download_url, original_name: info.source_filename || 'file', size: Number(data.file_size || 0), type: (info.source_filename.split('.').pop() || '').toLowerCase() } : null, host: info, rhymix: info };
        },
        applyUploadResult(data, editor) {
            const info = data && (data.host || data.rhymix);
            if (!info || info.id !== 'rhymix' || !info.upload_target_srl) return false;
            const config = rhymixConfig(editor);
            config.uploadTargetSrl = String(info.upload_target_srl);
            if (config.__container) {
                const container = config.__container;
                delete config.__container;
                container.setAttribute('data-editor-config', JSON.stringify(config));
                const form = container.closest('form');
                if (form && config.primaryKeyName) {
                    const primary = form.elements && form.elements.namedItem(config.primaryKeyName);
                    if (primary && typeof primary.value !== 'undefined' && !primary.value) primary.value = String(info.upload_target_srl);
                }
            }
            window.T2EDITOR_RHYMIX_UPLOAD_TARGET_SRL = String(info.upload_target_srl);
            if (config.editorSequence && window.jQuery) {
                const uploader = window.jQuery('#xefu-container-' + config.editorSequence);
                if (uploader.length) uploader.data('uploadTargetSrl', String(info.upload_target_srl));
            }
            if (config.editorSequence && typeof window.reloadUploader === 'function') window.reloadUploader(config.editorSequence);
            return true;
        }
    });

    registry.register({
        id: 'wordpress',
        priority: 150,
        active() { return !!window.T2EDITOR_WP_NONCE; },
        appendUploadFields(formData) {
            formData.set('_wpnonce', window.T2EDITOR_WP_NONCE);
            formData.set('action', 'upload-attachment');
            if (window.T2EDITOR_WP_POST_ID) formData.set('post_id', window.T2EDITOR_WP_POST_ID);
            return true;
        }
    });
})(window, document);

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
