// Path: T2Editor/js/hooks.js
// Developer note: 훅 이름과 실행 순서는 플러그인 submit/restore 계약이므로 추가 시 중복 실행 가능성을 확인한다.
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
            console.warn('[T2EditorHooks] onSubmit: invalid arguments', pluginName);
            return;
        }
        register(_submit, pluginName, fn);
    }

    /**
     * 콘텐츠 로드 시 restore 훅 등록.
     * @param {string}   pluginName
     * @param {Function} fn         - fn(tempDiv: HTMLElement): void
     */
    function onRestore(pluginName, fn) {
        if (typeof pluginName !== 'string' || typeof fn !== 'function') {
            console.warn('[T2EditorHooks] onRestore: invalid arguments', pluginName);
            return;
        }
        register(_restore, pluginName, fn);
    }

    // 동일 플러그인의 hooks.js가 CMS 캐시·런타임 전환·서드파티 로더에 의해
    // 재평가되더라도 submit/restore 변환이 중복 실행되지 않게 마지막 등록으로 교체한다.
    // 기존 공개 API와 실행 순서는 유지하며, 서로 다른 플러그인의 훅은 그대로 누적한다.
    function register(list, pluginName, fn) {
        const normalized = pluginName.trim();
        if (!normalized) {
            console.warn('[T2EditorHooks] empty plugin name');
            return;
        }
        const index = list.findIndex(function (hook) { return hook.name === normalized; });
        const row = { name: normalized, fn: fn };
        if (index >= 0) list[index] = row;
        else list.push(row);
    }

    /** 등록된 모든 submit 훅 실행. editor.lib.php _submitContent()에서 호출. */
    function runSubmit(tempDiv) {
        _submit.forEach(function (hook) {
            try {
                hook.fn(tempDiv);
            } catch (e) {
                console.error('[T2EditorHooks] submit error (' + hook.name + '):', e);
            }
        });
    }

    /** 등록된 모든 restore 훅 실행. editor.lib.php 콘텐츠 로드 script에서 호출. */
    function runRestore(tempDiv) {
        _restore.forEach(function (hook) {
            try {
                hook.fn(tempDiv);
            } catch (e) {
                console.error('[T2EditorHooks] restore error (' + hook.name + '):', e);
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

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
