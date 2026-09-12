// Path: T2Editor/extend/js/t2ext_editor_resize_handle.js
// Developer note: extend 자동 로딩 순서와 전역 이름 충돌을 고려하고, 코어 공개 API만 호출한다.
// 데스크톱 편집 영역의 중앙 높이 조절 핸들
// 설치: 이 파일을 extend/js/에 두면 자동 로드된다. 코어 마크업·CSS·JS를 수정하지 않는다.

(function () {
    'use strict';

    if (window.__t2EditorResizeHandleExtendLoaded) return;
    window.__t2EditorResizeHandleExtendLoaded = true;

    var SETUP_FLAG = '__t2EditorResizeHandle';
    var STYLE_ID = 't2ext-editor-resize-handle-style';
    var MAX_HEIGHT = 4000;
    var desktopPointer = (typeof window.matchMedia === 'function')
        ? window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 768px)')
        : { matches: false };

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .t2ext-editor-resize-handle { display: none; }
            @media (hover: hover) and (pointer: fine) and (min-width: 768px) {
                .t2-editor-container.t2ext-resize-ready > .t2-editor {
                    resize: none !important;
                    border-radius: 0;
                }
                .t2-editor-container.t2ext-resize-ready > .t2-editor-status {
                    position: relative;
                }
                .t2ext-editor-resize-handle {
                    position: absolute;
                    left: 50%;
                    top: 0;
                    z-index: 4;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 30px;
                    height: 30px;
                    padding: 0;
                    border: 1px solid #cbd5e1;
                    border-radius: 50%;
                    background: #fff;
                    color: #0187fe;
                    box-shadow: 0 3px 10px rgba(15, 23, 42, .16);
                    transform: translate(-50%, -50%);
                    cursor: ns-resize;
                    touch-action: none;
                    transition: color .15s ease, border-color .15s ease, background .15s ease, box-shadow .15s ease, transform .15s ease;
                }
                .t2ext-editor-resize-handle .material-icons {
                    font-size: 18px;
                    line-height: 1;
                    pointer-events: none;
                }
                .t2ext-editor-resize-handle:hover,
                .t2ext-editor-resize-handle:focus-visible {
                    color: #fff;
                    border-color: #0187fe;
                    background: #0187fe;
                    box-shadow: 0 4px 14px rgba(1, 135, 254, .28);
                    outline: none;
                }
                .t2ext-editor-resize-handle:focus-visible {
                    box-shadow: 0 0 0 3px rgba(1, 135, 254, .2), 0 4px 14px rgba(1, 135, 254, .25);
                }
                .t2ext-editor-resize-handle.is-dragging {
                    transform: translate(-50%, -50%) scale(1.08);
                }
                html[data-t2editor-theme="dark"] .t2ext-editor-resize-handle {
                    background: #2d2d2d;
                    border-color: #555;
                    color: #55aaff;
                    box-shadow: 0 3px 12px rgba(0, 0, 0, .45);
                }
                html[data-t2editor-theme="dark"] .t2ext-editor-resize-handle:hover,
                html[data-t2editor-theme="dark"] .t2ext-editor-resize-handle:focus-visible {
                    background: #168dec;
                    border-color: #55aaff;
                    color: #fff;
                }
                body.t2ext-editor-height-resizing,
                body.t2ext-editor-height-resizing * {
                    cursor: ns-resize !important;
                    user-select: none !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function currentLocale() {
        if (window.T2I18N && typeof window.T2I18N.getLocale === 'function') {
            return String(window.T2I18N.getLocale() || '').toLowerCase();
        }
        return String(document.documentElement.lang || navigator.language || 'en').toLowerCase();
    }

    function labels() {
        var locale = currentLocale();
        if (locale.indexOf('ko') === 0) return {
            aria: '편집 영역 높이 조절',
            title: '위아래로 드래그하여 편집 영역 높이 조절'
        };
        if (locale.indexOf('ja') === 0) return {
            aria: '編集領域の高さを調整',
            title: '上下にドラッグして編集領域の高さを調整'
        };
        if (locale.indexOf('zh') === 0) return {
            aria: '调整编辑区域高度',
            title: '上下拖动以调整编辑区域高度'
        };
        return {
            aria: 'Resize editor height',
            title: 'Drag up or down to resize the editor'
        };
    }

    function applyLabel(handle) {
        var text = labels();
        handle.setAttribute('aria-label', text.aria);
        handle.title = text.title;
    }

    function setupContainer(container) {
        if (!container || container[SETUP_FLAG]) return;
        var editor = container.querySelector('.t2-editor');
        var status = container.querySelector('.t2-editor-status');
        if (!editor || !status) return;

        container[SETUP_FLAG] = true;
        container.classList.add('t2ext-resize-ready');

        var handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 't2ext-editor-resize-handle';
        handle.setAttribute('aria-valuemin', '200');
        handle.setAttribute('aria-valuemax', String(MAX_HEIGHT));
        var icon = document.createElement('span');
        icon.className = 'material-icons';
        icon.textContent = 'height';
        icon.setAttribute('aria-hidden', 'true');
        handle.appendChild(icon);
        applyLabel(handle);
        status.insertBefore(handle, status.firstChild);

        var computed = window.getComputedStyle(editor);
        var baseHeight = Math.max(200, parseInt(computed.minHeight || computed.height, 10) || 350);
        var editorKey = editor.id || container.id || 'default';
        var storageKey = 't2editor-content-height:' + editorKey;
        var dragState = null;

        function clampHeight(height) {
            return Math.max(baseHeight, Math.min(MAX_HEIGHT, Math.round(height)));
        }

        function updateAria(height) {
            handle.setAttribute('aria-valuemin', String(baseHeight));
            handle.setAttribute('aria-valuenow', String(clampHeight(height)));
        }

        function applyHeight(height, persist) {
            var next = clampHeight(height);
            editor.style.height = next + 'px';
            updateAria(next);
            if (persist) {
                try { localStorage.setItem(storageKey, String(next)); } catch (_) { /* 저장 불가 환경 */ }
            }
            return next;
        }

        try {
            var stored = parseInt(localStorage.getItem(storageKey), 10);
            if (Number.isFinite(stored) && stored >= baseHeight) applyHeight(stored, false);
        } catch (_) { /* 저장 불가 환경 */ }
        updateAria(editor.getBoundingClientRect().height || baseHeight);

        function stopDragging() {
            if (!dragState) return;
            var pointerId = dragState.pointerId;
            dragState = null;
            handle.classList.remove('is-dragging');
            document.body.classList.remove('t2ext-editor-height-resizing');
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerEnd);
            window.removeEventListener('pointercancel', onPointerEnd);
            if (handle.hasPointerCapture && handle.hasPointerCapture(pointerId)) {
                try { handle.releasePointerCapture(pointerId); } catch (_) { /* noop */ }
            }
            applyHeight(editor.getBoundingClientRect().height, true);
        }

        function onPointerMove(event) {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            event.preventDefault();
            applyHeight(dragState.startHeight + (event.clientY - dragState.startY), false);
        }

        function onPointerEnd(event) {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            stopDragging();
        }

        handle.addEventListener('pointerdown', function (event) {
            if (!desktopPointer.matches || event.button !== 0) return;
            event.preventDefault();
            dragState = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startHeight: editor.getBoundingClientRect().height
            };
            if (handle.setPointerCapture) {
                try { handle.setPointerCapture(event.pointerId); } catch (_) { /* noop */ }
            }
            handle.classList.add('is-dragging');
            document.body.classList.add('t2ext-editor-height-resizing');
            window.addEventListener('pointermove', onPointerMove, { passive: false });
            window.addEventListener('pointerup', onPointerEnd);
            window.addEventListener('pointercancel', onPointerEnd);
        });

        handle.addEventListener('keydown', function (event) {
            if (!desktopPointer.matches) return;
            var delta = event.shiftKey ? 48 : 16;
            if (event.key === 'ArrowUp') delta *= -1;
            else if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            applyHeight(editor.getBoundingClientRect().height + delta, true);
        });

        if (typeof ResizeObserver === 'function') {
            var observer = new ResizeObserver(function () {
                updateAria(editor.getBoundingClientRect().height || baseHeight);
            });
            observer.observe(editor);
            container.__t2EditorResizeObserver = observer;
        }
    }

    function scan() {
        installStyle();
        document.querySelectorAll('.t2-editor-container').forEach(setupContainer);
    }

    function refreshLabels() {
        document.querySelectorAll('.t2ext-editor-resize-handle').forEach(applyLabel);
    }

    scan();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
    setTimeout(scan, 500);
    setTimeout(scan, 2000);

    if (typeof MutationObserver === 'function') {
        var scanFrame = 0;
        var domObserver = new MutationObserver(function () {
            if (scanFrame) return;
            scanFrame = requestAnimationFrame(function () {
                scanFrame = 0;
                scan();
            });
        });
        domObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (window.T2Utils && typeof window.T2Utils.onLocaleChange === 'function') {
        window.T2Utils.onLocaleChange(refreshLabels);
    }
})();

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
