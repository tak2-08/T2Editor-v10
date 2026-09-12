// Path: T2Editor/js/hooks.js
// Plugin hook registry

'use strict';

window.T2EditorHooks = (function () {

    // 등록된 훅 목록: { name: string, fn: Function }[]
    const _submit  = [];
    const _restore = [];

    /**
     * submit 직전 훅 등록.
     * @param {string}   pluginName  - 플러그인 이름 (등록 식별 / has() 조회용)
     * @param {Function} fn         - fn(tempDiv: HTMLElement): void
     */
    function onSubmit(pluginName, fn) {
        if (typeof pluginName !== 'string' || typeof fn !== 'function') {
            console.warn('[T2EditorHooks] onSubmit: 잘못된 인수', pluginName);
            return;
        }
        _submit.push({ name: pluginName, fn: fn });
    }

    /**
     * 콘텐츠 로드 시 restore 훅 등록.
     * @param {string}   pluginName
     * @param {Function} fn         - fn(tempDiv: HTMLElement): void
     */
    function onRestore(pluginName, fn) {
        if (typeof pluginName !== 'string' || typeof fn !== 'function') {
            console.warn('[T2EditorHooks] onRestore: 잘못된 인수', pluginName);
            return;
        }
        _restore.push({ name: pluginName, fn: fn });
    }

    /** 등록된 모든 submit 훅 실행. editor.lib.php _submitContent()에서 호출. */
    function runSubmit(tempDiv) {
        _submit.forEach(function (hook) {
            try {
                hook.fn(tempDiv);
            } catch (e) {
                console.error('[T2EditorHooks] submit 오류 (' + hook.name + '):', e);
            }
        });
    }

    /** 등록된 모든 restore 훅 실행. editor.lib.php 콘텐츠 로드 script에서 호출. */
    function runRestore(tempDiv) {
        _restore.forEach(function (hook) {
            try {
                hook.fn(tempDiv);
            } catch (e) {
                console.error('[T2EditorHooks] restore 오류 (' + hook.name + '):', e);
            }
        });
    }

    /**
     * 특정 플러그인이 훅을 등록했는지 확인.
     * 다른 플러그인이 특정 훅을 등록했는지 조회할 때 사용.
     * @param {'submit'|'restore'} type
     * @param {string} pluginName
     * @returns {boolean}
     */
    function has(type, pluginName) {
        const list = type === 'submit' ? _submit : _restore;
        return list.some(function (hook) { return hook.name === pluginName; });
    }

    return { onSubmit, onRestore, runSubmit, runRestore, has };

})();
