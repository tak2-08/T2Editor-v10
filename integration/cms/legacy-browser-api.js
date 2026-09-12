// Path: T2Editor/integration/cms/legacy-browser-api.js
// Developer note: 10.4.0 aliases target their original adapter; new code uses the generic Host API.
(function (window) {
    'use strict';
    var utils = window.T2Utils;
    if (!utils) return;

    function call(id, capability, args, fallback) {
        var adapters = utils._hostAdapters ? utils._hostAdapters() : null;
        return adapters && typeof adapters.callAdapter === 'function'
            ? adapters.callAdapter(id, capability, args, fallback)
            : fallback;
    }

    utils._getRhymixConfig = utils._getRhymixConfig || function (editor) {
        return call('rhymix', 'legacyConfig', [editor], {});
    };
    utils.appendRhymixUploadFields = utils.appendRhymixUploadFields || function (formData, editor) {
        return !!call('rhymix', 'appendUploadFields', [formData, editor], false);
    };
    utils.getRhymixUploadUrl = utils.getRhymixUploadUrl || function (editor) {
        return call('rhymix', 'uploadUrl', [editor], '');
    };
    utils._normalizeRhymixUrl = utils._normalizeRhymixUrl || function (value, editor) {
        return call('rhymix', 'normalizeUrl', [value, editor], String(value || ''));
    };
    utils.normalizeRhymixUploadResponse = utils.normalizeRhymixUploadResponse || function (data, kind, editor) {
        return call('rhymix', 'normalizeUploadResponse', [data, kind, editor], data);
    };
    utils.applyRhymixUploadResult = utils.applyRhymixUploadResult || function (data, editor) {
        return !!call('rhymix', 'applyUploadResult', [data, editor], false);
    };
    utils.appendWordPressUploadFields = utils.appendWordPressUploadFields || function (formData, editor) {
        return !!call('wordpress', 'appendUploadFields', [formData, editor], false);
    };
})(window);
// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
