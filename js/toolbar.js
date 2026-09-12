// Path: T2Editor/js/toolbar.js

(function() {
    'use strict';

    const style = document.createElement('style');
    style.textContent = `
        .t2-toolbar {
            --t2-toolbar-button-size: 44px;
            --t2-toolbar-gap: 6px;
            --t2-toolbar-row-gap: 6px;
            --t2-toolbar-track-size: 25px;
            --t2-toolbar-track-count: 2;
            box-sizing: border-box;
        }

        .t2-toolbar.t2-toolbar-balanced {
            display: grid;
            grid-template-columns: repeat(var(--t2-toolbar-track-count), var(--t2-toolbar-track-size));
            justify-content: center;
            align-content: start;
            column-gap: 0;
            row-gap: var(--t2-toolbar-row-gap);
        }

        .t2-toolbar.t2-toolbar-balanced > .t2-btn:not(.t2-hidden) {
            width: var(--t2-toolbar-button-size);
            min-width: var(--t2-toolbar-button-size);
            max-width: var(--t2-toolbar-button-size);
            grid-column: span 2;
            justify-self: center;
            margin: 0;
        }

        .t2-toolbar-group-btn {
            position: relative;
            min-width: var(--t2-toolbar-button-size);
            transition: background-color 0.2s;
        }
        
        .t2-toolbar-group-btn.active {
            background-color: rgba(99, 102, 241, 0.15);
        }

        [data-t2editor-theme="dark"] .t2-toolbar-group-btn.active {
            background-color: rgba(99, 102, 241, 0.25);
        }

        .t2-subtoolbar-container {
            position: relative;
            width: 100%;
            overflow: hidden;
            max-height: 0;
            opacity: 0;
            transition: max-height 0.2s ease-out, opacity 0.2s ease-out;
            background: #f8f9fa;
            border-bottom: 1px solid #e0e0e0;
        }

        [data-t2editor-theme="dark"] .t2-subtoolbar-container {
            background: #1e1e1e;
            border-bottom-color: #333;
        }

        .t2-subtoolbar-container.active {
            max-height: 60px;
            opacity: 1;
        }

        .t2-subtoolbar {
            display: flex;
            gap: 4px;
            padding: 8px 50px 8px 8px;
            overflow-x: auto;
            overflow-y: hidden;
            scrollbar-width: none;
            -ms-overflow-style: none;
        }

        .t2-subtoolbar::-webkit-scrollbar {
            display: none;
        }

        .t2-subtoolbar .t2-btn {
            flex-shrink: 0;
        }

        .t2-subtoolbar-close {
            position: absolute;
            top: 8px;
            right: 8px;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
            border: 1px solid #aaa;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            z-index: 10;
        }

        [data-t2editor-theme="dark"] .t2-subtoolbar-close {
            background: rgba(255, 255, 255, 0.1);
        }

        .t2-subtoolbar-close:hover {
            background: rgba(0, 0, 0, 0.2);
            transform: scale(1.05);
        }

        [data-t2editor-theme="dark"] .t2-subtoolbar-close:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .t2-subtoolbar-close .material-icons {
            font-size: 20px;
            color: #666;
        }

        [data-t2editor-theme="dark"] .t2-subtoolbar-close .material-icons {
            color: #aaa;
        }

        .t2-btn.t2-hidden {
            display: none !important;
        }
    `;
    document.head.appendChild(style);

    class T2Toolbar {
        constructor(container) {
            this.container = container;
            this.toolbar = container.querySelector('.t2-toolbar');
            if (!this.toolbar) return;

            this.config = window.T2_TOOLBAR_GROUPS || this.getT2DefaultConfig();
            this.currentRange = null;
            this.groupButtons = new Map();
            this.subtoolbarContainer = null;
            this.activeGroupId = null;
            this.observers = new Map();
            this.currentGroupButtons = [];
            this.buttonHandlerMap = new Map();
            this.layoutFrame = null;
            this.layoutKey = null;
            this.minVisualGap = 5;
            this.maxVisualGap = 10;
            this.buttonSize = 44;
            this.lastObservedWidth = 0;
            this.structureFrame = null;
            this.structureObserver = null;

            this.initT2Toolbar();
        }

        getT2DefaultConfig() {
            // [I18N] groupLabel 은 T2Utils.t() 로 번역 조회 — 폴백으로 한국어 문자열 유지.
            // T2Utils 가 아직 로드되지 않았을 때를 대비한 안전 장치.
            var _t = (typeof T2Utils !== 'undefined' && T2Utils.t) ? T2Utils.t : function (k, fb) { return fb; };
            return {
                '0-599': [
                    {
                        groupIcon: 'text_fields',
                        groupLabel: _t('toolbar.group_text', 'Text'),
                        buttons: ['fontSize', 'bold', 'italic', 'underline', 'strikeThrough', 'justifyContent', 'foreColor', 'backColor', 'createLink', 'insertCodeBlock'],
                        position: 3
                    },
                    {
                        groupIcon: 'photo_camera',
                        groupLabel: _t('toolbar.group_upload', 'Content upload'),
                        buttons: ['attachFile', 'insertImage', 'insertYouTube', 'insertTable'],
                        position: 4
                    },
                    {
                        groupIcon: 'more_horiz',
                        groupLabel: _t('toolbar.group_more', 'More'),
                        buttons: ['insertCodeBlock', 'createLink', 'insertMeme', 'createClipUrl', 'insertDrawing', 'collab', 'exportHTML'],
                        position: 19
                    }
                ],
                '600-1023': [
                    {
                        groupIcon: 'text_fields',
                        groupLabel: _t('toolbar.group_text', 'Text'),
                        buttons: ['fontSize', 'strikeThrough', 'justifyContent', 'foreColor', 'backColor', 'insertCodeBlock'],
                        position: 2
                    },
                    {
                        groupIcon: 'more_horiz',
                        groupLabel: _t('toolbar.group_more', 'More'),
                        buttons: ['insertTable', 'insertCodeBlock', 'insertMeme', 'createClipUrl', 'insertDrawing', 'collab', 'exportHTML'],
                        position: 19
                    }
                ]
            };
        }

        initT2Toolbar() {
            this.createT2Subtoolbar();
            this.setupT2ResizeObserver();
            this.setupT2ToolbarMutationObserver();
            this.setupT2MainToolbarClick();
            this.handleT2Resize();
        }

        createT2Subtoolbar() {
            this.subtoolbarContainer = document.createElement('div');
            this.subtoolbarContainer.className = 't2-subtoolbar-container';
            
            const subtoolbar = document.createElement('div');
            subtoolbar.className = 't2-subtoolbar';
            
            const closeBtn = document.createElement('button');
            closeBtn.className = 't2-subtoolbar-close';
            closeBtn.type = 'button';
            closeBtn.innerHTML = '<span class="material-icons">close</span>';
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeT2Subtoolbar();
            });
            
            this.subtoolbarContainer.appendChild(subtoolbar);
            this.subtoolbarContainer.appendChild(closeBtn);
            this.toolbar.parentNode.insertBefore(this.subtoolbarContainer, this.toolbar.nextSibling);
        }

        setupT2ResizeObserver() {
            if (typeof ResizeObserver !== 'undefined') {
                const resizeObserver = new ResizeObserver((entries) => {
                    const entry = entries && entries[0];
                    const borderBox = entry && entry.borderBoxSize;
                    const width = borderBox && borderBox.length
                        ? borderBox[0].inlineSize
                        : this.toolbar.offsetWidth;
                    // 그리드 행 수가 바뀌면 toolbar 높이도 달라진다. 폭 변화 없이
                    // 높이만 바뀐 알림을 다시 처리하면 ResizeObserver 루프가 생길 수 있다.
                    if (!width || Math.abs(width - this.lastObservedWidth) < 0.5) return;
                    this.lastObservedWidth = width;
                    this.handleT2Resize(width);
                });
                resizeObserver.observe(this.toolbar);
            } else {
                window.addEventListener('resize', () => this.handleT2Resize());
            }
        }

        setupT2ToolbarMutationObserver() {
            if (typeof MutationObserver === 'undefined') return;
            this.structureObserver = new MutationObserver(() => {
                if (this.structureFrame) return;
                this.structureFrame = requestAnimationFrame(() => {
                    this.structureFrame = null;
                    this.handleT2Resize();
                });
            });
            this.structureObserver.observe(this.toolbar, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'hidden', 'aria-hidden']
            });
        }

        setupT2MainToolbarClick() {
            this.toolbar.addEventListener('click', (e) => {
                const button = e.target.closest('.t2-btn');
                
                if (!button || button.classList.contains('t2-toolbar-group-btn')) {
                    return;
                }
                
                const command = button.getAttribute('data-command');
                if (!command) return;
                
                const isInCurrentGroup = this.currentGroupButtons.includes(command);
                
                if (!isInCurrentGroup) {
                    this.closeT2Subtoolbar();
                }
            });
        }

        handleT2Resize(observedWidth) {
            const width = observedWidth || this.toolbar.offsetWidth || this.toolbar.clientWidth;
            if (!width) return;

            const newRange = this.getT2ActiveRange(width);
            const newLayoutKey = this.getT2LayoutKey(width, newRange);

            if (newRange !== this.currentRange || newLayoutKey !== this.layoutKey) {
                this.currentRange = newRange;
                this.layoutKey = newLayoutKey;
                this.updateT2Toolbar(width);
            } else {
                this.scheduleT2AestheticLayout();
            }
        }

        getT2LayoutKey(width, range) {
            const originals = this.getT2OriginalButtons();
            const signature = originals
                .map(button => button.getAttribute('data-command') || '')
                .join('|');
            if (range) return 'range:' + range + ':' + signature;
            const capacity = this.getT2OneRowCapacity(width);
            const total = originals.length;
            const overflowCount = total > capacity ? Math.max(2, total - capacity + 1) : 0;
            return 'adaptive:' + capacity + ':' + overflowCount + ':' + signature;
        }

        isT2ButtonAvailable(button) {
            if (!button || button.hidden || button.getAttribute('aria-hidden') === 'true') return false;
            if (button.style && button.style.display === 'none') return false;
            // t2-hidden은 현재 그룹화 때문에 숨겨진 상태이므로 원본 수 계산에는 포함한다.
            if (button.classList.contains('t2-hidden')) return true;
            return window.getComputedStyle(button).display !== 'none';
        }

        getT2OriginalButtons() {
            return Array.from(this.toolbar.querySelectorAll('.t2-btn:not(.t2-toolbar-group-btn)'))
                .filter(button => this.isT2ButtonAvailable(button));
        }

        getT2HorizontalSpace() {
            const style = window.getComputedStyle(this.toolbar);
            const left = parseFloat(style.paddingLeft) || 0;
            const right = parseFloat(style.paddingRight) || 0;
            return left + right;
        }

        getT2OneRowCapacity(width) {
            const usable = Math.max(0, width - this.getT2HorizontalSpace());
            return Math.max(1, Math.floor((usable + this.minVisualGap) / (this.buttonSize + this.minVisualGap)));
        }

        getT2ActiveRange(width) {
            for (const range in this.config) {
                const [min, max] = range.split('-').map(Number);
                if (width >= min && width <= max) {
                    return range;
                }
            }
            return null;
        }

        updateT2Toolbar(width) {
            this.groupButtons.forEach((btn, id) => {
                btn.remove();
                this.stopObservingT2Buttons(id);
            });
            this.groupButtons.clear();
            this.buttonHandlerMap.clear();
            this.closeT2Subtoolbar();

            this.toolbar.querySelectorAll('.t2-btn').forEach(btn => {
                btn.classList.remove('t2-hidden');
            });

            if (this.currentRange) {
                const groups = this.config[this.currentRange];
                if (groups && Array.isArray(groups)) {
                    const sortedGroups = [...groups].sort((a, b) => (b.position || 0) - (a.position || 0));
                    sortedGroups.forEach((group, idx) => {
                        this.createT2GroupButton(group, `group-${this.currentRange}-${idx}`);
                    });
                }
            } else {
                this.createT2AdaptiveOverflowGroup(width || this.toolbar.offsetWidth || this.toolbar.clientWidth);
            }

            this.scheduleT2AestheticLayout();
        }

        createT2AdaptiveOverflowGroup(width) {
            const originals = this.getT2OriginalButtons();
            const capacity = this.getT2OneRowCapacity(width);
            if (originals.length <= capacity) return;

            // 숨긴 버튼들을 그룹 버튼 하나로 치환하므로, 초과분보다 하나 더
            // 그룹 안으로 보내야 전체 버튼 수가 정확히 한 줄 capacity에 맞는다.
            const overflowCount = Math.min(
                originals.length,
                Math.max(2, originals.length - capacity + 1)
            );
            const firstOverflowIndex = originals.length - overflowCount;
            const overflowButtons = originals.slice(firstOverflowIndex);
            const commands = overflowButtons
                .map(btn => btn.getAttribute('data-command'))
                .filter(Boolean);

            if (!commands.length) return;

            const label = (typeof T2Utils !== 'undefined' && T2Utils.t)
                ? T2Utils.t('toolbar.group_more', 'More')
                : 'More';

            this.createT2GroupButton({
                groupIcon: 'more_horiz',
                groupLabel: label,
                buttons: commands,
                position: firstOverflowIndex
            }, 'group-adaptive-overflow');
        }

        scheduleT2AestheticLayout() {
            if (this.layoutFrame) cancelAnimationFrame(this.layoutFrame);
            this.layoutFrame = requestAnimationFrame(() => {
                this.layoutFrame = null;
                this.applyT2AestheticLayout();
            });
        }

        applyT2AestheticLayout() {
            const visible = Array.from(this.toolbar.querySelectorAll('.t2-btn:not(.t2-hidden)'))
                .filter(button => this.isT2ButtonAvailable(button));
            visible.forEach(btn => {
                btn.style.removeProperty('grid-column-start');
            });

            if (!visible.length) return;

            this.toolbar.classList.add('t2-toolbar-balanced');
            const width = this.toolbar.clientWidth || this.toolbar.offsetWidth;
            const usable = Math.max(0, width - this.getT2HorizontalSpace());
            const maxColumns = Math.max(
                1,
                Math.floor((usable + this.minVisualGap) / (this.buttonSize + this.minVisualGap))
            );

            // 마지막 줄에 버튼 한두 개만 고립되지 않도록 같은 행 수 안에서
            // 열 수를 줄여 각 행의 버튼 개수를 최대한 균등하게 맞춘다.
            const rows = Math.max(1, Math.ceil(visible.length / maxColumns));
            const columns = Math.max(1, Math.ceil(visible.length / rows));
            const rawGap = columns > 1
                ? (usable - (columns * this.buttonSize)) / columns
                : this.minVisualGap;
            const gap = Math.max(this.minVisualGap, Math.min(this.maxVisualGap, rawGap));
            const trackSize = (this.buttonSize + gap) / 2;
            const trackCount = columns * 2;

            this.toolbar.style.setProperty('--t2-toolbar-gap', gap.toFixed(2) + 'px');
            this.toolbar.style.setProperty('--t2-toolbar-track-size', trackSize.toFixed(2) + 'px');
            this.toolbar.style.setProperty('--t2-toolbar-track-count', String(trackCount));
            this.toolbar.dataset.t2ToolbarColumns = String(columns);
            this.toolbar.dataset.t2ToolbarRows = String(rows);

            const remainder = visible.length % columns;
            if (remainder > 0 && rows > 1) {
                const firstInLastRow = visible.length - remainder;
                const halfTrackOffset = columns - remainder;
                // 마지막 행의 모든 시작 열을 명시해 브라우저별 grid auto-placement
                // 차이와 DOM 순서 역전을 막는다. 1/2 버튼 폭 단위라 홀수 여백도
                // 양쪽에 정확히 반 칸씩 배분할 수 있다.
                for (let index = 0; index < remainder; index++) {
                    visible[firstInLastRow + index].style.gridColumnStart = String(
                        halfTrackOffset + 1 + (index * 2)
                    );
                }
            }
        }

        createT2GroupButton(group, groupId) {
            const buttons = this.toolbar.querySelectorAll('.t2-btn');
            const buttonsToHide = [];
            
            group.buttons.forEach(cmd => {
                const btn = Array.from(buttons).find(b =>
                    b.getAttribute('data-command') === cmd &&
                    !b.classList.contains('t2-hidden') &&
                    this.isT2ButtonAvailable(b)
                );
                if (btn) buttonsToHide.push(btn);
            });

            if (buttonsToHide.length === 0) return;

            const groupBtn = document.createElement('button');
            groupBtn.className = 't2-btn t2-toolbar-group-btn';
            groupBtn.type = 'button';
            groupBtn.title = group.groupLabel || '';
            groupBtn.innerHTML = `<span class="material-icons">${group.groupIcon}</span>`;
            groupBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleT2Subtoolbar(groupId, buttonsToHide, group.buttons);
            });

            const position = group.position || 0;
            const allButtons = Array.from(this.toolbar.querySelectorAll('.t2-btn'));
            const insertBefore = allButtons[position] || null;
            
            if (insertBefore) {
                this.toolbar.insertBefore(groupBtn, insertBefore);
            } else {
                this.toolbar.appendChild(groupBtn);
            }

            this.groupButtons.set(groupId, groupBtn);

            buttonsToHide.forEach(btn => btn.classList.add('t2-hidden'));
        }

        toggleT2Subtoolbar(groupId, buttons, commandList) {
            if (this.activeGroupId === groupId) {
                this.closeT2Subtoolbar();
            } else {
                this.openT2Subtoolbar(groupId, buttons, commandList);
            }
        }

        openT2Subtoolbar(groupId, buttons, commandList) {
            this.closeT2Subtoolbar();
            
            this.currentGroupButtons = commandList || [];
            
            const subtoolbar = this.subtoolbarContainer.querySelector('.t2-subtoolbar');
            subtoolbar.innerHTML = '';

            buttons.forEach(originalBtn => {
                const clonedBtn = originalBtn.cloneNode(true);
                clonedBtn.classList.remove('t2-hidden');
                
                const handleClick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const command = originalBtn.getAttribute('data-command');
                    
                    const editorContainer = this.container;
                    const editorId = editorContainer.id.replace('_container', '');
                    const editorInstance = window[editorId + '_editor'];
                    
                    if (editorInstance && editorInstance.handleCommand) {
                        editorInstance.handleCommand(command, originalBtn);
                    } else {
                        const clickEvent = new MouseEvent('click', {
                            bubbles: true,
                            cancelable: true,
                            view: window
                        });
                        originalBtn.dispatchEvent(clickEvent);
                    }
                };
                
                clonedBtn.addEventListener('click', handleClick);
                this.buttonHandlerMap.set(clonedBtn, handleClick);

                subtoolbar.appendChild(clonedBtn);

                this.observeT2Button(groupId, originalBtn, clonedBtn);
            });

            this.subtoolbarContainer.classList.add('active');
            this.activeGroupId = groupId;
            
            const groupBtn = this.groupButtons.get(groupId);
            if (groupBtn) groupBtn.classList.add('active');
        }

        closeT2Subtoolbar() {
            if (!this.activeGroupId) return;

            this.subtoolbarContainer.classList.remove('active');
            
            const groupBtn = this.groupButtons.get(this.activeGroupId);
            if (groupBtn) groupBtn.classList.remove('active');

            this.stopObservingT2Buttons(this.activeGroupId);
            
            const subtoolbar = this.subtoolbarContainer.querySelector('.t2-subtoolbar');
            if (subtoolbar) {
                subtoolbar.querySelectorAll('.t2-btn').forEach(btn => {
                    const handler = this.buttonHandlerMap.get(btn);
                    if (handler) {
                        btn.removeEventListener('click', handler);
                        this.buttonHandlerMap.delete(btn);
                    }
                });
            }
            
            this.activeGroupId = null;
            this.currentGroupButtons = [];
        }

        observeT2Button(groupId, original, clone) {
            if (!this.observers.has(groupId)) {
                this.observers.set(groupId, []);
            }

            const observer = new MutationObserver(() => {
                this.syncT2ButtonState(original, clone);
            });

            observer.observe(original, {
                attributes: true,
                attributeFilter: ['disabled', 'class', 'style'],
                childList: true,
                characterData: true,
                subtree: true
            });

            this.observers.get(groupId).push(observer);
            this.syncT2ButtonState(original, clone);
        }

        syncT2ButtonState(original, clone) {
            if (original.disabled) {
                clone.disabled = true;
            } else {
                clone.disabled = false;
            }

            const classesToSync = ['active', 'disabled'];
            classesToSync.forEach(cls => {
                if (original.classList.contains(cls)) {
                    clone.classList.add(cls);
                } else {
                    clone.classList.remove(cls);
                }
            });

            if (original.style.color) {
                clone.style.color = original.style.color;
            }

            const originalIcon = original.querySelector('.material-icons');
            const cloneIcon = clone.querySelector('.material-icons');
            if (originalIcon && cloneIcon && originalIcon.textContent !== cloneIcon.textContent) {
                cloneIcon.textContent = originalIcon.textContent;
            }
        }

        stopObservingT2Buttons(groupId) {
            const observers = this.observers.get(groupId);
            if (observers) {
                observers.forEach(obs => obs.disconnect());
                this.observers.delete(groupId);
            }
        }
    }

    function initT2Toolbar() {
        const containers = document.querySelectorAll('.t2-editor-container');
        containers.forEach(container => {
            if (!container._t2Toolbar) {
                container._t2Toolbar = new T2Toolbar(container);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initT2Toolbar, 300);
        });
    } else {
        setTimeout(initT2Toolbar, 300);
    }

    window.T2Toolbar = T2Toolbar;
})();