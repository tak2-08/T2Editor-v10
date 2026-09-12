// Path: T2Editor/js/core.js

// Developer settings: runtime plugin IDs come from PHP configuration; do not hardcode plugin registration in this file.

class T2Editor {
    constructor(container) {
        this.container = container;
        this.editor = container.querySelector('.t2-editor');
        this.toolbar = container.querySelector('.t2-toolbar');
        this.plugins = new Map();
        this.pluginLoadStatus = new Map();
        this.pluginLoadPromises = new Map();
        this.contentSetQueue = null;

        this.config = {
            autoSave: true,
            plugins: window.T2EDITOR_PLUGINS || []
        };

        // 마이그레이션 모드: 'auto' | 'prompt' | false
        this.migrationMode = (window.T2EDITOR_MIGRATION_MODE !== undefined)
            ? window.T2EDITOR_MIGRATION_MODE
            : 'prompt';

        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        // WebKit: iOS의 한국어 IME는 isComposing을 잘못 보고할 수 있다.
        // compositionstart/end로 조합 상태를 직접 추적해야 Enter가 문자를 끊지 않는다.
        this._isComposing = false;
        // 조합이 막 끝난 직후에 들어오는 합성 Enter(첫 탭이 commit 으로 소비된 뒤 곧이어
        // 발생하는 keydown/beforeinput) 를 식별하기 위해 짧은 grace window 를 둔다.
        this._lastCompositionEndAt = 0;

        // 블록(이미지/비디오/파일/코드 등) 앞뒤의 입력 가능 문단을 식별하는 표식.
        // 일반 빈 문단과 구분해야 사용자가 의도적으로 만든 빈 줄을 정규화 과정에서
        // 지우지 않고, 플러그인 블록 경계만 안전하게 복구할 수 있다.
        this._boundaryAttribute = 'data-t2-boundary';
        this._normalizingContent = false;
        this._pendingNormalizeFrame = 0;

        // Empty paragraphs must stay as <p><br data-t2-placeholder="true"></p>.
        // Do not reintroduce ZWSP: WebKit treats it as content and destabilizes Enter/caret restoration.
        // Legacy ZWSP content is migrated during normalization.

        this.alignmentState = 'left';
        this.bulletState = { active: false, type: null, count: 1 };
        this.undoStack = [];
        this.redoStack = [];
        this.lastCheckpoint = null;
        this._historyInputGroup = null;
        this.savedSelection = null;
        // Selection/Range는 DOM 변경 뒤 쉽게 끊어진다. 원본 Range는 빠른 복원용으로
        // 유지하되, 경로·텍스트 오프셋·직계 블록 위치를 함께 가진 북마크를 진실값으로 쓴다.
        this._lastEditorRange = null;
        this._lastEditorBookmark = null;
        this._selectionBookmarkOwner = `t2bm_${this.generateUid()}`;
        this._dropDragDepth = 0;
        this._dropUploading = false;
        this._dropOverlay = null;

        this.undoBtn = container.querySelector('[data-command="undo"]');
        this.redoBtn = container.querySelector('[data-command="redo"]');
        this.charCount = container.querySelector('.t2-char-count span');

        this.autoSaveStorageKey = this._getAutoSaveStorageKey();
        this.autoSaveEnabled = this._storageGet('t2editor-autosave-enabled') !== 'false';
        this.collab = null;

        this.init();
    }

    init() {
        this.setupEditor();
        this._resetHistoryBaseline();
        this.setupEditorHeightResize();
        this.setupEventListeners();
        this.setupCoreFileDrop();
        this.setupAutoSaveToggle();
        this.setupBeforeUnload();
        this.setupI18nIntegration();   // [I18N] 번역 시스템 연동 (코어 문자열 동적 번역)

        if (this.autoSaveEnabled) {
            this.loadAutoSave();
        }

        this.updateUndoRedoButtons();
        this.updateCharCount();
        this.loadPluginsWithPriority();

        // I18N: 페이지 로드 시 코어 UI 번역 적용
        this.applyCoreTranslations();
    }

    // I18N: 번역 시스템 연동 — T2Editor 10.2.1-beta2+
    // 1. T2Editor.t() 정적 별칭 설정 (플러그인이 T2Editor.t('key') 호출 가능)
    // 2. 언어 변경 시 코어 UI 자동 갱신 리스너 등록
    // 3. 자동저장 토글 라벨 등 동적 텍스트 갱신
    setupI18nIntegration() {
        // T2Editor.t 정적 별칭 — 플러그인이 T2Editor.t('key') 로 접근 가능
        if (typeof T2I18N !== 'undefined' && T2I18N.t) {
            T2Editor.t = function(key, vars) { return T2I18N.t(key, vars); };
            T2Editor.getLocale = function() { return T2I18N.getLocale(); };
            T2Editor.setLocale = function(lang) { return T2I18N.setLocale(lang); };
            T2Editor.onLocaleChange = function(cb) { return T2I18N.onLocaleChange(cb); };
        }

        // 언어 변경 시 코어 UI 자동 갱신
        if (typeof T2I18N !== 'undefined' && T2I18N.onLocaleChange) {
            this._i18nUnsubscribe = T2I18N.onLocaleChange((newLang, oldLang) => {
                this.applyCoreTranslations();
            });
        }
    }

     /** Refresh dynamic core labels and data-i18n elements after a locale change. */
    applyCoreTranslations() {
        if (typeof T2I18N === 'undefined' || !T2I18N.t) return;

        const t = T2I18N.t;

        // 자동저장 라벨 갱신
        const autosaveLabel = this.container.querySelector('.t2-autosave-text');
        if (autosaveLabel) {
            autosaveLabel.textContent = t('editor.autosave_label');
        }

        // 마이그레이션 모달 (열려있을 경우)
        const migTitle = this.container.querySelector('.t2-mig-title');
        if (migTitle) migTitle.textContent = t('editor.migration_title');

        const migBody = this.container.querySelector('.t2-mig-body');
        if (migBody) migBody.innerHTML = t('editor.migration_body');

        const migCancel = this.container.querySelector('.t2-mig-btn-cancel');
        if (migCancel) migCancel.textContent = t('editor.migration_btn_cancel');

        const migConfirm = this.container.querySelector('.t2-mig-btn-confirm');
        if (migConfirm) migConfirm.textContent = t('editor.migration_btn_confirm');

        // 코어 파일 드래그앤드롭 오버레이
        this._translateDropOverlay();

        // 색상피커 적용 버튼
        const applyBtn = this.container.querySelector('.t2-color-apply-btn');
        if (applyBtn) applyBtn.textContent = t('common.apply');

        // data-i18n 속성 가진 모든 요소 (서드파티 플러그인 호환)
        if (T2I18N.applyTranslations) {
            T2I18N.applyTranslations(this.container);
        }
    }

    setupEditor() {
        if (!this.editor) return;

        // 서버 렌더링/복원 콘텐츠가 이미 들어온 경우 초기 빈 문단을 중복 추가하지 않는다.
        // 단, 템플릿 들여쓰기에서 생긴 공백 텍스트 노드만 있는 경우는 실제 콘텐츠가
        // 아니므로 제거하고 정상적인 입력 문단을 만든다.
        const hasMeaningfulContent = Array.from(this.editor.childNodes).some((node) => {
            return node.nodeType === Node.ELEMENT_NODE ||
                (node.nodeType === Node.TEXT_NODE && (node.nodeValue || '').trim() !== '');
        });
        if (hasMeaningfulContent) {
            this.editor.style.whiteSpace = 'pre-wrap';
            this.editor.style.wordBreak = 'break-word';
            return;
        }
        this.editor.replaceChildren();

        // 초기 상태도 콘텐츠 블록 경계와 같은 표준 빈 문단 계약을 사용한다.
        // 플랫폼별 마크업을 만들면 복원·Undo·모바일 beforeinput 경로가 다시 갈라진다.
        this.editor.appendChild(this._createEmptyParagraph(true));

        this.editor.style.whiteSpace = 'pre-wrap';
        this.editor.style.wordBreak = 'break-word';
    }

    setupEditorHeightResize() {
        if (!this.editor || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

        // 마우스/트랙패드가 있는 PC에서만 네이티브 세로 리사이즈를 활성화한다.
        // CSS의 min-height가 관리자 기본값보다 작아지는 것을 막고, 사용자가 늘린
        // 높이는 에디터 필드별로 localStorage에 보존한다.
        const desktopPointer = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 768px)');
        if (!desktopPointer.matches) return;

        const computed = window.getComputedStyle(this.editor);
        const baseHeight = Math.max(200, parseInt(computed.minHeight || computed.height, 10) || 350);
        const editorKey = this.editor.id || this.container.id || 'default';
        const storageKey = `t2editor-content-height:${editorKey}`;

        try {
            const stored = parseInt(localStorage.getItem(storageKey), 10);
            if (Number.isFinite(stored) && stored >= baseHeight) {
                this.editor.style.height = `${Math.min(stored, 4000)}px`;
            }
        } catch (e) {}

        let lastHeight = Math.round(this.editor.getBoundingClientRect().height);
        const persistHeight = () => {
            const height = Math.round(this.editor.getBoundingClientRect().height);
            if (!Number.isFinite(height) || height < baseHeight || height === lastHeight) return;
            lastHeight = height;
            try { localStorage.setItem(storageKey, String(Math.min(height, 4000))); } catch (e) {}
        };

        if (typeof ResizeObserver === 'function') {
            this._editorHeightObserver = new ResizeObserver(persistHeight);
            this._editorHeightObserver.observe(this.editor);
        } else {
            this.editor.addEventListener('mouseup', persistHeight);
            this.editor.addEventListener('pointerup', persistHeight);
        }
    }

    setupEventListeners() {
        if (!this.editor) return;

        if (this.toolbar) {
            // 버튼이 포커스를 가져가기 전에 에디터 선택을 저장한다. click 단계에서
            // 저장하면 이미 Selection이 툴바로 이동한 뒤라 서식/플러그인 삽입이
            // 문서 끝으로 폴백할 수 있다.
            const captureToolbarSelection = (e) => {
                const button = e.target && e.target.closest ? e.target.closest('.t2-btn') : null;
                if (!button || button.disabled) return;
                this._historyInputGroup = null;
                this._captureLastEditorRange();
            };
            this.toolbar.addEventListener('pointerdown', captureToolbarSelection, true);
            this.toolbar.addEventListener('mousedown', (e) => {
                const button = e.target && e.target.closest ? e.target.closest('.t2-btn') : null;
                if (!button || button.disabled) return;
                captureToolbarSelection(e);
                // 데스크톱 브라우저가 mousedown에서 선택을 지우는 것을 방지한다.
                e.preventDefault();
            }, true);

            this.toolbar.addEventListener('click', (e) => {
                const button = e.target.closest('.t2-btn');
                if (!button) return;

                e.preventDefault();
                e.stopPropagation();

                const command = button.dataset.command;
                this.handleCommand(command, button);
            });
        }

        document.addEventListener('selectionchange', () => {
            const selection = window.getSelection();
            const insideEditor = selection && selection.rangeCount > 0 && (() => {
                const range = selection.getRangeAt(0);
                return range.startContainer === this.editor || this.editor.contains(range.startContainer);
            })();
            if (insideEditor) {
                this._captureLastEditorRange();
                this.updateFormatButtons();
            }
        });

        // selectionchange가 누락되는 모바일 브라우저까지 포괄해 마지막 커서 위치를
        // 가능한 한 자주 갱신한다. 저장된 Range가 손상되면 드롭 시 문서 끝으로 폴백한다.
        ['keyup', 'mouseup', 'touchend', 'focus', 'input'].forEach((eventName) => {
            this.editor.addEventListener(eventName, () => this._captureLastEditorRange(), { passive: true });
        });

        // Atomic blocks can leave Selection inside a non-editable node, especially on iOS.
        // Move the caret to the nearest boundary paragraph without intercepting real controls or editable code.
        const placeCaretNearAtomicBlock = (e) => {
            const target = e.target && e.target.nodeType === Node.ELEMENT_NODE ? e.target : e.target?.parentElement;
            if (!target || !target.closest) return;
            if (target.closest('[contenteditable="true"]:not(.t2-editor)')) return;
            if (target.closest('button, a, input, textarea, select, video, audio, [role="button"], .t2-media-controls, .t2-move-controls')) return;

            const block = target.closest('.t2-media-block, .t2-table-wrapper, .t2-drawing-block, [data-t2-block]');
            if (!block || block.parentElement !== this.editor) return;

            const rect = block.getBoundingClientRect();
            const y = (typeof e.clientY === 'number' && e.clientY > 0)
                ? e.clientY
                : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : rect.top + rect.height);
            const after = y >= rect.top + rect.height / 2;

            this.ensureBlockBoundaryLines(block);
            const landing = after ? block.nextElementSibling : block.previousElementSibling;
            if (this._isDirectEditableParagraph(landing)) {
                if (e.cancelable) e.preventDefault();
                this._focusEditableParagraph(landing, after ? 'start' : 'end');
            }
        };
        this.editor.addEventListener('pointerdown', placeCaretNearAtomicBlock);
        this.editor.addEventListener('touchend', placeCaretNearAtomicBlock, { passive: false });

        // 원자 블록 근처에서 Selection이 에디터 루트/비편집 블록에 남은 채 입력이
        // 시작되는 최후의 방어선. 입력 전에 경계 문단을 복구하고, 일반 텍스트/Enter는
        // 직접 삽입해 "키보드는 열렸지만 아무것도 써지지 않는" 상태를 해소한다.
        this.editor.addEventListener('beforeinput', (e) => {
            this._repairAtomicSelectionBeforeInput(e);
        }, true);

        this.editor.addEventListener('keydown', (e) => {
            if (this._isNestedEditableTarget(e.target)) return;
            if (e.key === 'Enter') {
                this._lastEnterIntent = { soft: !!e.shiftKey, at: Date.now() };
            }
        }, true);

        // Empty boundary paragraphs use custom Enter handling because WebKit may visually create a line
        // while restoring Selection to the old node. beforeinput covers virtual keyboards without keydown.
        this.editor.addEventListener('beforeinput', (e) => {
            this._handleEmptyParagraphBeforeInput(e);
        });

        // IME 조합 상태는 플랫폼과 무관하게 공통 추적한다. 기존에는 iOS/Safari
        // 분기에서만 플래그가 갱신되어 Android/Windows 한국어·일본어 입력 중
        // Enter/Backspace 커스텀 핸들러가 조합 문자열을 끊을 수 있었다.
        this.editor.addEventListener('compositionstart', () => {
            this._isComposing = true;
        });
        this.editor.addEventListener('compositionend', () => {
            this._isComposing = false;
            this._lastCompositionEndAt = Date.now();
            this._scheduleNormalizeContent();
        });

        // WebKit invariant: composition events, not KeyboardEvent.isComposing, are the source of truth.
        // Handle insertParagraph in beforeinput and keep the active placeholder BR node stable.
        // Do not add ZWSP or replace that caret node; both revive the first-Enter/caret-return regression.
        if (this.isIOS) {
            // WebKit: beforeinput is the reliable source for virtual-keyboard Enter.
            // Insert NBSP only for the first/trailing visible space so WebKit does not collapse it.
            this.editor.addEventListener('beforeinput', (e) => {
                if (e.defaultPrevented) return;
                const t = e.inputType;

                // (1) Enter 처리
                if (t === 'insertParagraph' || t === 'insertLineBreak') {
                    // 사용자가 IME 조합 도중 ↵ 를 눌렀다면, 그 첫 탭은 "조합 commit" 으로
                    // 양보(=preventDefault 하지 않음)한다. 그래야 글자가 사라지지 않는다.
                    if (this._isComposing) return;
                    e.preventDefault();
                    if (t === 'insertLineBreak') this.handleSoftBreak();
                    else this.handleEnterKey();
                    return;
                }

                // (2) 스페이스 처리 (빈 블록 + trailing whitespace 영역)
                // Apple WebKit Input Events 권장 처리: beforeinput 에서 직접 텍스트 삽입.
                // (B) 케이스 — 캐럿 오른쪽이 줄 끝(BR/블록 끝) 이면 NBSP 로 삽입해
                //              WebKit 의 trailing-space collapse 를 회피.
                if (t === 'insertText' && e.data === ' ' && !this._isComposing) {
                    this._handleEmptyBlockSpace(e);
                    return;
                }
            });

            // Backspace 는 기존 정책 그대로 유지
            this.editor.addEventListener('keydown', (e) => {
                if (this._isNestedEditableTarget(e.target)) return;
                if (e.key === 'Backspace' && !e.isComposing && !this._isComposing && e.keyCode !== 229) {
                    this.handleBackspace(e);
                }
            });
        } else if (this.isSafari) {
            // macOS 데스크톱 Safari — 기존 동작 유지 (Enter 는 사용자 보고 문제 없음)
            // 단, 빈 블록 / trailing whitespace SP 버그는 macOS Safari 에서도
            // 동일하게 재현되므로 [iOS-SPACE-FIX v3] 의 beforeinput insertText
            // 가로채기는 동일하게 적용한다.
            this.editor.addEventListener('beforeinput', (e) => {
                if (e.defaultPrevented) return;
                if (e.inputType === 'insertLineBreak' && !e.isComposing && !this._isComposing) {
                    e.preventDefault();
                    this.handleSoftBreak();
                    return;
                }
                if (e.inputType === 'insertText' && e.data === ' ' && !this._isComposing) {
                    this._handleEmptyBlockSpace(e);
                }
            });
            this.editor.addEventListener('keydown', (e) => {
                if (this._isNestedEditableTarget(e.target)) return;
                if (e.key === 'Backspace' && !e.isComposing && !this._isComposing && e.keyCode !== 229) {
                    this.handleBackspace(e);
                }
            });
        } else {
            // Android / Windows / Linux 등. IME 조합 중(특히 keyCode 229)은
            // 브라우저 기본 동작에 맡겨 조합 문자열이 중간 확정/삭제되지 않게 한다.
            this.editor.addEventListener('keydown', (e) => {
                if (this._isNestedEditableTarget(e.target)) return;
                if (e.key === 'Enter' && !e.isComposing && !this._isComposing && e.keyCode !== 229) {
                    e.preventDefault();
                    if (e.shiftKey) this.handleSoftBreak();
                    else this.handleEnterKey();
                } else if (e.key === 'Backspace' && !e.isComposing && !this._isComposing && e.keyCode !== 229) {
                    this.handleBackspace(e);
                }
            });
        }

        this.editor.addEventListener('input', (e) => {
            this.handleInput(e);
        });

        // 구조적 이동/마우스 재배치는 연속 입력 undo 그룹을 끝낸다.
        this.editor.addEventListener('keydown', (e) => {
            if (this._isNestedEditableTarget(e.target)) return;
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'].includes(e.key)) {
                this._historyInputGroup = null;
            }
            if (e.key === 'Delete' && !e.isComposing && !this._isComposing && e.keyCode !== 229) {
                this.handleDelete(e);
            }
        });
        this.editor.addEventListener('pointerdown', () => { this._historyInputGroup = null; }, true);

        this.editor.addEventListener('paste', async (e) => {
            await this.handlePaste(e);
        });

        // DOMNodeInserted 는 Mutation Events 스펙으로
        // 모든 주요 브라우저에서 deprecated, Chrome 124+ 에서 제거 예정.
        // 성능 저하(동기 이벤트) 문제도 있어 MutationObserver 로 교체.
        // childList: true 로 editor 직계 자식 추가만 감지하여 handleNodeInserted 위임.
        this._nodeInsertedObserver = new MutationObserver((mutations) => {
            let needsNormalize = false;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    this.handleNodeInserted({ target: node });
                    if (node.nodeType === Node.ELEMENT_NODE && this._isEditorBlockNode(node)) {
                        needsNormalize = true;
                    }
                }
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE && this._isEditorBlockNode(node)) {
                        needsNormalize = true;
                    }
                }
            }
            if (needsNormalize) this._scheduleNormalizeContent();
        });
        this._nodeInsertedObserver.observe(this.editor, { childList: true });
    }

    // 코어 파일 드래그앤드롭 업로드
    // 실제 검증·전송·블록 생성은 file 플러그인의 공개 API에 위임한다.
    _dropT(key, vars = {}, fallback = '') {
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

    _isRangeInsideEditor(range) {
        if (!range || !this.editor) return false;
        const inside = (node) => !!(node && (node === this.editor || this.editor.contains(node)));
        try {
            return inside(range.startContainer) && inside(range.endContainer);
        } catch (_) {
            return false;
        }
    }

    _nodePathFromEditor(node) {
        if (!node || !this.editor) return null;
        if (node === this.editor) return [];
        const path = [];
        let current = node;
        while (current && current !== this.editor) {
            const parent = current.parentNode;
            if (!parent) return null;
            const index = Array.prototype.indexOf.call(parent.childNodes, current);
            if (index < 0) return null;
            path.unshift(index);
            current = parent;
        }
        return current === this.editor ? path : null;
    }

    _resolveEditorNodePath(path) {
        if (!Array.isArray(path) || !this.editor) return null;
        let node = this.editor;
        for (const rawIndex of path) {
            const index = Number(rawIndex);
            if (!Number.isInteger(index) || index < 0 || !node.childNodes || index >= node.childNodes.length) return null;
            node = node.childNodes[index];
        }
        return node;
    }

    _clampRangeOffset(node, offset) {
        const max = node && node.nodeType === Node.TEXT_NODE
            ? node.length
            : (node && node.childNodes ? node.childNodes.length : 0);
        const value = Number.isFinite(Number(offset)) ? Number(offset) : 0;
        return Math.max(0, Math.min(max, value));
    }

    _textOffsetFromPoint(root, node, offset) {
        if (!root || !node || !(node === root || root.contains(node))) return null;
        try {
            const probe = document.createRange();
            probe.selectNodeContents(root);
            probe.setEnd(node, this._clampRangeOffset(node, offset));
            return probe.toString().length;
        } catch (_) {
            return null;
        }
    }

    _pointAtTextOffset(root, requestedOffset) {
        if (!root) return null;
        let remaining = Math.max(0, Number(requestedOffset) || 0);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        let node;
        let lastText = null;
        while ((node = walker.nextNode())) {
            lastText = node;
            if (remaining <= node.length) return { node, offset: remaining };
            remaining -= node.length;
        }
        if (lastText) return { node: lastText, offset: lastText.length };
        return { node: root, offset: Math.min(root.childNodes ? root.childNodes.length : 0, remaining) };
    }

    _createSelectionBookmark(sourceRange = null) {
        let range = sourceRange;
        if (!range) {
            const selection = window.getSelection();
            if (!selection || !selection.rangeCount) return null;
            range = selection.getRangeAt(0);
        }
        if (!this._isRangeInsideEditor(range)) return null;

        try {
            const startBlock = this._getDirectEditorChild(range.startContainer);
            const endBlock = this._getDirectEditorChild(range.endContainer);
            const children = Array.from(this.editor.childNodes);
            const startTextOffset = this._textOffsetFromPoint(this.editor, range.startContainer, range.startOffset);
            const endTextOffset = this._textOffsetFromPoint(this.editor, range.endContainer, range.endOffset);
            return {
                version: 1,
                owner: this._selectionBookmarkOwner,
                collapsed: range.collapsed,
                startPath: this._nodePathFromEditor(range.startContainer),
                startOffset: range.startOffset,
                endPath: this._nodePathFromEditor(range.endContainer),
                endOffset: range.endOffset,
                startTextOffset,
                endTextOffset,
                totalTextLength: (this.editor.textContent || '').length,
                startBlockIndex: startBlock && startBlock !== this.editor ? children.indexOf(startBlock) : -1,
                endBlockIndex: endBlock && endBlock !== this.editor ? children.indexOf(endBlock) : -1,
                startBlockTextOffset: startBlock && startBlock !== this.editor
                    ? this._textOffsetFromPoint(startBlock, range.startContainer, range.startOffset)
                    : null,
                endBlockTextOffset: endBlock && endBlock !== this.editor
                    ? this._textOffsetFromPoint(endBlock, range.endContainer, range.endOffset)
                    : null,
                rawRange: range.cloneRange()
            };
        } catch (_) {
            return null;
        }
    }

    captureSelectionBookmark(sourceRange = null) {
        return this._createSelectionBookmark(sourceRange);
    }

    _bookmarkPoint(bookmark, edge, options = {}) {
        if (!bookmark) return null;
        const preferTextOffset = options.preferTextOffset === true;
        const pathKey = `${edge}Path`;
        const offsetKey = `${edge}Offset`;
        const textKey = `${edge}TextOffset`;
        const blockIndexKey = `${edge}BlockIndex`;
        const blockTextKey = `${edge}BlockTextOffset`;

        if (!preferTextOffset) {
            const pathNode = this._resolveEditorNodePath(bookmark[pathKey]);
            if (pathNode) return { node: pathNode, offset: this._clampRangeOffset(pathNode, bookmark[offsetKey]) };

            const blockIndex = Number(bookmark[blockIndexKey]);
            const block = Number.isInteger(blockIndex) && blockIndex >= 0 ? this.editor.childNodes[blockIndex] : null;
            if (block) {
                const point = this._pointAtTextOffset(block, bookmark[blockTextKey]);
                if (point) return point;
            }
        }

        if (bookmark[textKey] !== null && bookmark[textKey] !== undefined) {
            const point = this._pointAtTextOffset(this.editor, bookmark[textKey]);
            if (point) return point;
        }

        if (preferTextOffset) {
            const blockIndex = Number(bookmark[blockIndexKey]);
            const block = Number.isInteger(blockIndex) && blockIndex >= 0 ? this.editor.childNodes[blockIndex] : null;
            if (block) {
                const point = this._pointAtTextOffset(block, bookmark[blockTextKey]);
                if (point) return point;
            }
            const pathNode = this._resolveEditorNodePath(bookmark[pathKey]);
            if (pathNode) return { node: pathNode, offset: this._clampRangeOffset(pathNode, bookmark[offsetKey]) };
        }
        return null;
    }

    _fallbackEditorRange(edge = 'end') {
        const range = document.createRange();
        range.selectNodeContents(this.editor);
        range.collapse(edge !== 'start');
        return range;
    }

    _rangeFromSelectionBookmark(bookmark, options = {}) {
        if (!bookmark) return null;
        if (bookmark.owner && bookmark.owner !== this._selectionBookmarkOwner) return null;
        if (typeof bookmark.cloneRange === 'function') {
            try {
                const directRange = bookmark.cloneRange();
                return this._isRangeInsideEditor(directRange) ? directRange : null;
            } catch (_) {
                return null;
            }
        }

        // DOM에서 노드가 제거되면 브라우저는 기존 Range를 예외 없이 에디터 루트
        // offset 0으로 재지정할 수 있다. 단순 contains 검사만으로는 이를 정상 Range로
        // 오인하므로, 북마크는 항상 경로/텍스트 오프셋을 먼저 복원하고 rawRange는
        // 경로 정보 자체가 없는 레거시 북마크의 최후 폴백으로만 사용한다.
        const start = this._bookmarkPoint(bookmark, 'start', options);
        const end = options.collapse === true ? start : this._bookmarkPoint(bookmark, 'end', options);
        if ((!start || !end) && bookmark.rawRange) {
            try {
                const raw = bookmark.rawRange.cloneRange();
                if (this._isRangeInsideEditor(raw)) return raw;
            } catch (_) { /* no-op */ }
        }
        if (!start || !end) return null;
        try {
            const range = document.createRange();
            range.setStart(start.node, this._clampRangeOffset(start.node, start.offset));
            range.setEnd(end.node, this._clampRangeOffset(end.node, end.offset));
            if (options.collapse === true) range.collapse(true);
            return this._isRangeInsideEditor(range) ? range : null;
        } catch (_) {
            return null;
        }
    }

    restoreSelectionBookmark(bookmark, options = {}) {
        const range = this._rangeFromSelectionBookmark(bookmark, options);
        if (!range) return false;
        const selection = window.getSelection();
        if (!selection) return false;
        try {
            if (options.focus !== false) {
                try { this.editor.focus({ preventScroll: options.preventScroll !== false }); }
                catch (_) { this.editor.focus(); }
            }
            selection.removeAllRanges();
            selection.addRange(range);
            this._lastEditorRange = range.cloneRange();
            this._lastEditorBookmark = this._createSelectionBookmark(range);
            return true;
        } catch (_) {
            return false;
        }
    }

    _getActiveEditorRange(preferred = null, options = {}) {
        const candidates = [preferred];
        const selection = window.getSelection();
        if (selection && selection.rangeCount) candidates.push(selection.getRangeAt(0));
        candidates.push(this._lastEditorBookmark, this._lastEditorRange);

        for (const candidate of candidates) {
            const resolved = this._rangeFromSelectionBookmark(candidate, options);
            if (resolved && this._isRangeInsideEditor(resolved)) return resolved;
        }
        return this._fallbackEditorRange(options.fallback === 'start' ? 'start' : 'end');
    }

    _captureLastEditorRange() {
        if (!this.editor) return null;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount < 1) return null;
        const range = selection.getRangeAt(0);
        if (!this._isRangeInsideEditor(range)) return null;
        try {
            this._lastEditorRange = range.cloneRange();
            this._lastEditorBookmark = this._createSelectionBookmark(range);
            // 콘텐츠가 변하지 않은 동안의 커서 이동은 현재 undo 체크포인트에도 반영한다.
            if (this.lastCheckpoint && typeof this.lastCheckpoint === 'object' &&
                this.lastCheckpoint.html === this.editor.innerHTML) {
                this.lastCheckpoint.selection = this._lastEditorBookmark;
            }
            return this._lastEditorRange;
        } catch (_) {
            this._lastEditorRange = null;
            this._lastEditorBookmark = null;
            return null;
        }
    }

    _getRangeFromPoint(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
        try {
            if (typeof document.caretRangeFromPoint === 'function') {
                const range = document.caretRangeFromPoint(clientX, clientY);
                return this._isRangeInsideEditor(range) ? range : null;
            }
            if (typeof document.caretPositionFromPoint === 'function') {
                const pos = document.caretPositionFromPoint(clientX, clientY);
                if (!pos) return null;
                const range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.collapse(true);
                return this._isRangeInsideEditor(range) ? range : null;
            }
        } catch (_) { /* last selection fallback */ }
        return null;
    }

    _getDropInsertionRange(event = null) {
        const pointRange = event ? this._getRangeFromPoint(event.clientX, event.clientY) : null;
        const range = pointRange || this._getActiveEditorRange(this._lastEditorBookmark, { fallback: 'end' });
        return range ? (this.captureSelectionBookmark(range) || range) : null;
    }

    _hasDraggedFiles(event) {
        const dt = event && event.dataTransfer;
        if (!dt) return false;
        if (dt.files && dt.files.length > 0) return true;
        return Array.from(dt.types || []).includes('Files');
    }

    _dropExtensionSummary() {
        const cfg = window.T2EDITOR_UPLOAD_CONFIG || {};
        const groups = cfg.extensions || {};
        const extensions = [];
        ['image', 'video', 'document', 'audio', 'other'].forEach((group) => {
            (Array.isArray(groups[group]) ? groups[group] : []).forEach((ext) => {
                const normalized = String(ext || '').toLowerCase();
                if (normalized && !extensions.includes(normalized)) extensions.push(normalized);
            });
        });
        return {
            extensions: extensions.map((ext) => `.${ext}`).join(', ') || '.jpg, .png, .mp4, .pdf, .zip',
            max: Number(cfg.maxSizeMB) > 0 ? Number(cfg.maxSizeMB) : 50
        };
    }

    _ensureDropOverlay() {
        if (this._dropOverlay && this._dropOverlay.isConnected) return this._dropOverlay;
        const overlay = document.createElement('div');
        overlay.className = 't2-core-drop-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <span class="material-icons t2-core-drop-icon">cloud_upload</span>
            <strong class="t2-core-drop-title"></strong>
            <span class="t2-core-drop-hint"></span>
            <span class="t2-core-drop-size"></span>
        `;
        this.container.appendChild(overlay);
        this._dropOverlay = overlay;
        this._translateDropOverlay();
        return overlay;
    }

    _translateDropOverlay() {
        const overlay = this._dropOverlay;
        if (!overlay) return;
        const info = this._dropExtensionSummary();
        const title = overlay.querySelector('.t2-core-drop-title');
        const hint = overlay.querySelector('.t2-core-drop-hint');
        const size = overlay.querySelector('.t2-core-drop-size');
        if (title) title.textContent = this._dropT('drop_title', {}, 'Drop files here to upload');
        if (hint) hint.textContent = this._dropT('drop_hint', { extensions: info.extensions }, `Allowed files: ${info.extensions}`);
        if (size) size.textContent = this._dropT('drop_size', { max: info.max }, `Maximum ${info.max} MB per file`);
    }

    _positionDropOverlay() {
        const overlay = this._ensureDropOverlay();
        const containerRect = this.container.getBoundingClientRect();
        const editorRect = this.editor.getBoundingClientRect();
        overlay.style.left = `${Math.max(0, editorRect.left - containerRect.left)}px`;
        overlay.style.top = `${Math.max(0, editorRect.top - containerRect.top)}px`;
        overlay.style.width = `${editorRect.width}px`;
        overlay.style.height = `${editorRect.height}px`;
    }

    _showDropOverlay() {
        this._positionDropOverlay();
        this._translateDropOverlay();
        this.container.classList.add('t2-core-drop-active');
        this._dropOverlay?.setAttribute('aria-hidden', 'false');
    }

    _hideDropOverlay() {
        this._dropDragDepth = 0;
        this.container.classList.remove('t2-core-drop-active');
        this._dropOverlay?.setAttribute('aria-hidden', 'true');
    }

    setupCoreFileDrop() {
        if (!this.editor || !this.container || this.container.dataset.t2CoreDropReady === 'true') return;
        this.container.dataset.t2CoreDropReady = 'true';
        this._ensureDropOverlay();

        this.editor.addEventListener('dragenter', (event) => {
            if (!this._hasDraggedFiles(event) || this._dropUploading) return;
            event.preventDefault();
            this._dropDragDepth += 1;
            this._showDropOverlay();
        });
        this.editor.addEventListener('dragover', (event) => {
            if (!this._hasDraggedFiles(event) || this._dropUploading) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
            this._showDropOverlay();
        });
        this.editor.addEventListener('dragleave', (event) => {
            if (!this._hasDraggedFiles(event)) return;
            this._dropDragDepth = Math.max(0, this._dropDragDepth - 1);
            if (this._dropDragDepth === 0) this._hideDropOverlay();
        });
        this.editor.addEventListener('drop', async (event) => {
            if (!this._hasDraggedFiles(event)) return;
            event.preventDefault();
            event.stopPropagation();
            const files = Array.from(event.dataTransfer?.files || []);
            const insertionRange = this._getDropInsertionRange(event);
            this._hideDropOverlay();
            if (!files.length) {
                T2Utils.showNotification(this._dropT('drop_no_files', {}, 'No uploadable files were found.'), 'warning');
                return;
            }
            await this._uploadDroppedFiles(files, insertionRange);
        });
        window.addEventListener('dragend', () => this._hideDropOverlay());
        window.addEventListener('drop', (event) => {
            if (!this.container.contains(event.target)) this._hideDropOverlay();
        });
        window.addEventListener('resize', () => {
            if (this.container.classList.contains('t2-core-drop-active')) this._positionDropOverlay();
        }, { passive: true });

        if (typeof T2I18N !== 'undefined' && T2I18N.onLocaleChange) {
            T2I18N.onLocaleChange(() => this._translateDropOverlay());
        }
    }

    async _uploadDroppedFiles(files, insertionRange) {
        if (this._dropUploading) return;
        this._dropUploading = true;
        this.container.classList.add('t2-core-drop-uploading');
        T2Utils.showNotification(this._dropT('drop_uploading', {}, 'Uploading dropped files…'), 'info');
        try {
            await this.loadPluginImmediately('file');
            const filePlugin = this.getPlugin('file');
            if (!filePlugin || typeof filePlugin.uploadDroppedFiles !== 'function') {
                throw new Error(this._dropT('drop_plugin_error', {}, 'The file upload feature could not be loaded.'));
            }
            const result = await filePlugin.uploadDroppedFiles(files, insertionRange);
            const success = Number(result?.success || 0);
            const failed = Number(result?.failed || 0);
            if (failed > 0) {
                T2Utils.showNotification(this._dropT('drop_partial', { success, failed }, `Added ${success}; ${failed} failed.`), failed === files.length ? 'error' : 'warning');
            } else {
                T2Utils.showNotification(this._dropT('drop_complete', { count: success }, `Added ${success} dropped files as content blocks.`), 'success');
            }
        } catch (error) {
            console.error('[T2Editor core drop upload]', error);
            T2Utils.showNotification(error?.message || this._dropT('drop_plugin_error', {}, 'The file upload feature could not be loaded.'), 'error');
        } finally {
            this._dropUploading = false;
            this.container.classList.remove('t2-core-drop-uploading');
            this._captureLastEditorRange();
        }
    }

    _scheduleNormalizeContent() {
        if (this._pendingNormalizeFrame) return;
        const schedule = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
        this._pendingNormalizeFrame = schedule(() => {
            this._pendingNormalizeFrame = 0;
            this.normalizeContent();
        });
    }

    updateFormatButtons() {
        if (!this.toolbar) return;
        // document.queryCommandState 는 MDN에서 Deprecated로
        // 명시된 API다. Selection/Range 기반 T2FormatEngine.queryState() 를
        // 1차 경로로 쓰고, 엔진이 없을 때만 기존 queryCommandState 로 폴백한다
        // (기존 로직은 삭제하지 않고 안전망으로 보존).
        const formatCommands = ['bold', 'italic', 'underline', 'strikeThrough'];

        formatCommands.forEach(command => {
            const button = this.toolbar.querySelector(`[data-command="${command}"]`);
            if (!button) return;

            let isActive = false;
            if (typeof T2FormatEngine !== 'undefined') {
                isActive = T2FormatEngine.queryState(this.editor, command);
            } else {
                // [FALLBACK-LEGACY]
                try {
                    isActive = document.queryCommandState(command);
                } catch (e) {
                    // queryCommandState 실패 시 무시
                }
            }

            if (isActive) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }

    async handleCommand(command, button) {
        if (!button) return;

        // 툴바/보조 툴바가 포커스를 가져간 브라우저에서도 명령은 사용자가 마지막으로
        // 선택한 본문 위치에 적용되어야 한다. 선택이 이미 에디터 안에 있으면 그대로
        // 두고, 바깥으로 이동했을 때만 인스턴스 전용 북마크를 복원한다.
        if (command !== 'undo' && command !== 'redo') {
            const selection = window.getSelection();
            const activeRange = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
            if (!activeRange || !this._isRangeInsideEditor(activeRange)) {
                this.restoreSelectionBookmark(this.savedSelection || this._lastEditorBookmark, {
                    focus: false,
                    preventScroll: true
                });
            }
        }

        const pluginName = button.dataset ? button.dataset.plugin : null;

        if (pluginName && !this.plugins.has(pluginName)) {
            this.showButtonLoading(button);
            try {
                await this.loadPluginImmediately(pluginName);
            } catch (error) {
                console.error(`Plugin '${pluginName}' could not be loaded:`, error);
                this._showPluginLoadError(pluginName);
                return;
            } finally {
                this.hideButtonLoading(button);
            }
        }

        for (const [name, plugin] of this.plugins) {
            if (plugin.commands && plugin.commands.includes(command)) {
                console.log(`Command '${command}' handled by plugin '${name}'`);
                try {
                    await Promise.resolve(plugin.handleCommand(command, button));
                    this.createUndoPoint();
                } catch (error) {
                    console.error(`Plugin '${name}' command '${command}' failed:`, error);
                    this._showPluginLoadError(name, true);
                }
                return;
            }
        }

        switch(command) {
            case 'undo':
                this.undo();
                break;
            case 'redo':
                this.redo();
                break;
            case 'fontSize':
                this.saveSelection();
                this.showFontSizeList(button);
                break;
            case 'justifyContent':
                this.toggleAlignment(button);
                break;
            case 'foreColor':
            case 'backColor':
                this.saveSelection();
                this.showColorPalette(command, button);
                break;
            case 'bold':
            case 'italic':
            case 'underline':
            case 'strikeThrough':
                this.execCommand(command);
                this.editor.focus();
                setTimeout(() => this.updateFormatButtons(), 0);
                break;
            default:
                console.warn(`Unknown command: ${command}`);
                return;
        }

        this.createUndoPoint();
    }

    _showPluginLoadError(pluginName, commandFailed = false) {
        const key = commandFailed ? 'editor.plugin_command_failed' : 'editor.plugin_load_failed';
        let message = commandFailed
            ? `The ${pluginName} feature could not complete the requested action.`
            : `The ${pluginName} feature could not be loaded. Please try again.`;

        if (typeof T2I18N !== 'undefined' && T2I18N.t) {
            const translated = T2I18N.t(key, { plugin: pluginName });
            if (translated && translated !== key) message = translated;
        }

        if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
            T2Utils.showNotification(message, 'error', 3500);
        }
    }

    async loadPluginImmediately(pluginName) {
        if (this.pluginLoadStatus.get(pluginName) === 'loaded') return;
        console.log(`Loading plugin '${pluginName}' immediately due to user interaction`);
        return this.loadPlugin(pluginName);
    }

    _getConfiguredEssentialPlugins() {
        const essential = ['image', 'code', 'video', 'file', 'table'];
        return essential.filter(name => this.config.plugins.includes(name));
    }

    _areConfiguredEssentialPluginsSettled() {
        return this._getConfiguredEssentialPlugins().every(name => {
            const status = this.pluginLoadStatus.get(name);
            return status === 'loaded' || status === 'failed';
        });
    }

    _processQueuedContentIfReady() {
        if (!this.contentSetQueue || !this._areConfiguredEssentialPluginsSettled()) return;
        const queued = this.contentSetQueue;
        this.contentSetQueue = null;
        this.processContentSet(queued);
    }

    _setPluginButtonsLoading(pluginName, loading) {
        if (!this.toolbar) return;
        this.toolbar.querySelectorAll('.t2-btn[data-plugin]').forEach(button => {
            if (button.dataset.plugin !== pluginName) return;
            if (loading) this.showButtonLoading(button);
            else this.hideButtonLoading(button);
        });
    }

    async _loadPluginGroup(plugins) {
        const results = await Promise.all(plugins.map(async pluginName => {
            try {
                await this.loadPlugin(pluginName);
                return { status: 'fulfilled' };
            } catch (reason) {
                return { status: 'rejected', reason };
            } finally {
                this._setPluginButtonsLoading(pluginName, false);
            }
        }));

        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.warn(`Plugin '${plugins[index]}' failed during background loading:`, result.reason);
            }
        });
        this._processQueuedContentIfReady();
    }

    async loadPluginsWithPriority() {
        const priorities = window.T2EDITOR_PLUGIN_PRIORITY || {};
        const priorityGroups = new Map();
        const unassignedPlugins = [];

        this.config.plugins.forEach(pluginName => {
            const priority = priorities[pluginName];
            if (priority === undefined || priority === null) {
                unassignedPlugins.push(pluginName);
            } else {
                if (!priorityGroups.has(priority)) priorityGroups.set(priority, []);
                priorityGroups.get(priority).push(pluginName);
            }
        });

        const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b);
        if (unassignedPlugins.length > 0) {
            const maxPriority = sortedPriorities.length > 0 ? Math.max(...sortedPriorities) + 1 : 1;
            sortedPriorities.push(maxPriority);
            priorityGroups.set(maxPriority, unassignedPlugins);
        }

        for (const priority of sortedPriorities) {
            const plugins = priorityGroups.get(priority).map((name, index) => ({
                name,
                size: this.getPluginFileSize(name),
                index
            }));
            plugins.sort((a, b) => (a.size - b.size) || (a.index - b.index));
            priorityGroups.set(priority, plugins.map(item => item.name));
        }

        if (this.toolbar) {
            this.toolbar.querySelectorAll('.t2-btn[data-plugin]').forEach(button => {
                if (this.config.plugins.includes(button.dataset.plugin)) this.showButtonLoading(button);
            });
        }

        if (sortedPriorities.includes(0)) {
            const immediatePlugins = priorityGroups.get(0);
            console.log('Loading priority 0 plugins immediately:', immediatePlugins);
            await this._loadPluginGroup(immediatePlugins);
        }

        const delayedPriorities = sortedPriorities.filter(priority => priority > 0);
        delayedPriorities.forEach((priority, index) => {
            const plugins = priorityGroups.get(priority);
            setTimeout(() => {
                console.log(`Loading priority ${priority} plugins:`, plugins);
                this._loadPluginGroup(plugins).catch(error => {
                    console.error(`Priority ${priority} plugin group failed:`, error);
                });
            }, index * 50);
        });

        if (sortedPriorities.length === 0) this._processQueuedContentIfReady();
    }

    getPluginFileSize(pluginName) {
        const sizes = window.T2EDITOR_PLUGIN_SIZES || {};
        const size = Number(sizes[pluginName]);
        return Number.isFinite(size) && size >= 0 ? size : Number.MAX_SAFE_INTEGER;
    }

    _resolvePluginClass(name) {
        const registry = window.T2EDITOR_PLUGIN_CLASSES;
        if (registry && typeof registry[name] === 'function') {
            return { PluginClass: registry[name], className: `T2EDITOR_PLUGIN_CLASSES[${name}]` };
        }

        const legacyName = `T2${name.charAt(0).toUpperCase() + name.slice(1)}Plugin`;
        const pascal = name.split(/[-_]+/).filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
        const normalizedName = `T2${pascal}Plugin`;
        const candidates = Array.from(new Set([legacyName, normalizedName]));

        for (const className of candidates) {
            if (typeof window[className] === 'function') {
                return { PluginClass: window[className], className };
            }
        }
        return { PluginClass: null, className: candidates.join(' or ') };
    }

    _instantiateResolvedPlugin(name, resolved) {
        if (!resolved || !resolved.PluginClass) {
            throw new Error(`Plugin class not found: ${resolved ? resolved.className : name}`);
        }
        const plugin = new resolved.PluginClass(this);
        this.registerPlugin(name, plugin);
        this.pluginLoadStatus.set(name, 'loaded');
        console.log(`✓ Plugin ${name} loaded successfully (${resolved.className})`);
    }

    async loadPlugin(name) {
        if (this.pluginLoadStatus.get(name) === 'loaded') return;

        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            console.error(`[SEC] Plugin name rejected (invalid characters): "${name}"`);
            this.pluginLoadStatus.set(name, 'failed');
            throw new Error(`Invalid plugin name: ${name}`);
        }

        if (this.pluginLoadPromises.has(name)) return this.pluginLoadPromises.get(name);

        const alreadyAvailable = this._resolvePluginClass(name);
        if (alreadyAvailable.PluginClass) {
            try {
                this._instantiateResolvedPlugin(name, alreadyAvailable);
                return;
            } catch (error) {
                this.pluginLoadStatus.set(name, 'failed');
                throw error;
            }
        }

        this.pluginLoadStatus.set(name, 'loading');
        const loadPromise = new Promise((resolve, reject) => {
            let settled = false;
            let timer = null;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                if (error) {
                    this.pluginLoadStatus.set(name, 'failed');
                    reject(error);
                } else {
                    resolve();
                }
            };

            try {
                const script = document.createElement('script');
                const assetVersion = String(window.T2EDITOR_ASSET_VERSION || '');
                const versionQuery = assetVersion ? `?v=${encodeURIComponent(assetVersion)}` : '';
                const pluginBase = (window.T2EDITOR_PLUGIN_URLS && window.T2EDITOR_PLUGIN_URLS[name]) || `${window.T2EDITOR_ASSET_URL || window.T2EDITOR_URL}/plugin/${name}`;
                script.src = `${pluginBase}/${name}.js${versionQuery}`;
                script.async = true;
                script.dataset.t2Plugin = name;

                timer = setTimeout(() => {
                    script.remove();
                    finish(new Error(`Plugin load timed out: ${name}`));
                }, 15000);

                script.onload = () => {
                    try {
                        const resolved = this._resolvePluginClass(name);
                        this._instantiateResolvedPlugin(name, resolved);
                        finish();
                    } catch (error) {
                        finish(error);
                    }
                };

                script.onerror = () => finish(new Error(`Failed to load plugin script: ${name}`));
                document.head.appendChild(script);
            } catch (error) {
                finish(error);
            }
        });

        this.pluginLoadPromises.set(name, loadPromise);
        loadPromise.then(
            () => this.pluginLoadPromises.delete(name),
            () => this.pluginLoadPromises.delete(name)
        );
        return loadPromise;
    }

    handleInput(e) {
        this.scheduleAutoSave();
        this.handleBulletPoints();

        // IME 조합 중 DOM을 정규화하면 WebKit/Android의 조합 텍스트 노드가
        // 교체되어 한글·일본어·중국어 입력이 끊길 수 있다. 조합이 끝난 뒤 한 프레임에
        // 한 번만 정규화하도록 통일한다.
        if (!this._isComposing && !(e && e.isComposing)) {
            this._scheduleNormalizeContent();
        }

        const inputType = e && typeof e.inputType === 'string' ? e.inputType : '';
        const coalesceFamily = /^(insertText|insertCompositionText|deleteContentBackward|deleteContentForward)$/.test(inputType)
            ? (inputType.indexOf('delete') === 0 ? 'delete' : 'insert')
            : null;
        this.createUndoPoint(coalesceFamily ? { coalesce: true, groupKey: coalesceFamily } : null);
        this.updateCharCount();
    }

    _getDirectEditorChild(node) {
        if (!node || !this.editor) return null;
        if (node === this.editor) return this.editor;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        while (node && node.parentNode && node.parentNode !== this.editor) {
            node = node.parentNode;
        }
        return node && node.parentNode === this.editor ? node : null;
    }

    _isNestedEditableTarget(node) {
        const el = node && node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        if (!el || !el.closest) return false;
        const nested = el.closest('[contenteditable="true"]');
        return !!(nested && nested !== this.editor);
    }

    _findAtomicBlockFromSelection(range) {
        if (!range) return null;
        const direct = this._getDirectEditorChild(range.startContainer);
        if (direct && direct !== this.editor && this._isEditorBlockNode(direct)) return direct;

        if (range.startContainer === this.editor) {
            const children = this.editor.childNodes;
            const at = Math.min(range.startOffset, children.length);
            const before = at > 0 ? children[at - 1] : null;
            const after = at < children.length ? children[at] : null;
            if (before && before.nodeType === Node.ELEMENT_NODE && this._isEditorBlockNode(before)) return before;
            if (after && after.nodeType === Node.ELEMENT_NODE && this._isEditorBlockNode(after)) return after;
        }
        return null;
    }

    _insertTextAtCurrentSelection(text) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(String(text || ''));
        range.insertNode(node);
        range.setStart(node, node.length);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        this.autoSave();
        this.createUndoPoint();
        this.updateCharCount();
        return true;
    }

    _repairAtomicSelectionBeforeInput(e) {
        if (!e || e.defaultPrevented || this._isComposing || e.isComposing) return false;
        if (this._isNestedEditableTarget(e.target)) return false;

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        let range = selection.getRangeAt(0);

        // 이미지/파일/표를 포함한 선택 영역에 입력하면 선택 전체를 치환해야 한다.
        // 기존 로직은 시작점 근처 원자 블록만 감지해 경계 문단으로 커서를 옮겼고,
        // 선택된 블록은 남긴 채 새 글자가 옆에 써지는 역동작을 만들었다.
        if (!range.collapsed) {
            const selectedAtomic = Array.from(this.editor.children).some((node) => {
                if (!this._isEditorBlockNode(node)) return false;
                try { return range.intersectsNode(node); } catch (_) { return false; }
            });
            if (selectedAtomic) {
                range = this._deleteSelectionForStructuredInput(range);
                if (!range) return false;
                const type = e.inputType || '';
                if ((type === 'insertText' || type === 'insertReplacementText') && typeof e.data === 'string') {
                    e.preventDefault();
                    this._insertTextAtCurrentSelection(e.data);
                    return true;
                }
                if (type === 'insertParagraph' || type === 'insertLineBreak') {
                    e.preventDefault();
                    this.handleEnterKey();
                    return true;
                }
                return false;
            }
        }

        const atomic = this._findAtomicBlockFromSelection(range);
        if (!atomic) return false;

        this.ensureBlockBoundaryLines(atomic);

        // 루트 경계에서 블록의 앞/뒤 중 어느 쪽이었는지 최대한 보존한다.
        let useAfter = true;
        if (range.startContainer === this.editor) {
            const index = Array.prototype.indexOf.call(this.editor.childNodes, atomic);
            useAfter = range.startOffset > index;
        }
        const landing = useAfter ? atomic.nextElementSibling : atomic.previousElementSibling;
        if (!this._isDirectEditableParagraph(landing)) return false;
        this._focusEditableParagraph(landing, useAfter ? 'start' : 'end');

        const type = e.inputType || '';
        if ((type === 'insertText' || type === 'insertReplacementText') && typeof e.data === 'string') {
            e.preventDefault();
            this._insertTextAtCurrentSelection(e.data);
            return true;
        }
        if (type === 'insertParagraph' || type === 'insertLineBreak') {
            e.preventDefault();
            this.handleEnterKey();
            return true;
        }
        return false;
    }

    // WebKit: insert one NBSP at an empty block start or visual line end so the caret advances.
    // Return false elsewhere and let native input preserve ordinary spaces.
    _handleEmptyBlockSpace(e) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return false;

        const block = this.getClosestBlock(range.startContainer);
        if (!block || block === this.editor) return false;

        // (A) 빈 블록 분기
        // 블록의 "실질 텍스트" (ZWSP/제로폭 문자 제거) 가 비어 있으면 풀 리셋.
        const realText = (block.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
        if (realText.length === 0) {
            e.preventDefault();

            // 빈 문단의 placeholder를 NBSP로 교체한다. ZWSP를 함께 두면 WebKit이
            // Enter 분리 시 이를 실제 내용으로 판정할 수 있으므로 사용하지 않는다.
            const textNode = document.createTextNode('\u00A0');
            block.replaceChildren(textNode);

            const newRange = document.createRange();
            newRange.setStart(textNode, textNode.length);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);

            // input 이벤트가 자동으로 발화되지 않으므로 후처리를 명시적으로 실행
            this.autoSave();
            this.createUndoPoint();
            this.updateCharCount();
            return true;
        }

        // (B) trailing whitespace 영역 분기
        // 캐럿 "오른쪽" 에 보이는 컨텐츠가 없는지(=BR 뿐이거나 블록 끝) 확인.
        if (!this._isCaretAtTrailingWhitespaceZone(range, block)) return false;

        e.preventDefault();

        // 캐럿 위치에 NBSP(U+00A0) 텍스트를 삽입한다.
        // 가능하면 현재 텍스트 노드의 그 위치에 직접 데이터 추가(undo 친화적, 노드 분열 최소).
        const startNode = range.startContainer;
        const startOffset = range.startOffset;

        if (startNode.nodeType === Node.TEXT_NODE) {
            // 텍스트 노드 내부 → insertData 로 NBSP 삽입
            startNode.insertData(startOffset, '\u00A0');
            const newRange = document.createRange();
            newRange.setStart(startNode, startOffset + 1);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        } else {
            // 요소 노드 경계 → NBSP 텍스트 노드를 삽입하고 캐럿을 그 뒤로
            const nbspNode = document.createTextNode('\u00A0');
            range.insertNode(nbspNode);
            const newRange = document.createRange();
            newRange.setStart(nbspNode, nbspNode.length);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }

        this.autoSave();
        this.createUndoPoint();
        this.updateCharCount();
        return true;
    }

    // A caret is trailing only when the remaining range has no visible text or inline media.
    // Keep the element scan because textContent cannot detect images/SVG.
    _isCaretAtTrailingWhitespaceZone(range, block) {
        try {
            const tailRange = document.createRange();
            tailRange.setStart(range.startContainer, range.startOffset);
            tailRange.setEndAfter(block.lastChild || block);

            // 가시 요소(이미지/미디어/플레이스홀더가 아닌 인라인 컨텐츠) 가 있으면 trailing 아님
            const frag = tailRange.cloneContents();
            if (frag.querySelector && frag.querySelector(
                'img, svg, video, audio, iframe, canvas, object, embed, input, button, select, textarea, code, .t2-media-block, .t2-file-block, .t2-drawing-block, .t2-code-block'
            )) {
                return false;
            }

            // 남은 텍스트에서 제로폭/공백/NBSP 까지 모두 제거 후 길이 0 이면 trailing 영역
            const tailText = (frag.textContent || '')
                .replace(/[\u200B\u200C\u200D\uFEFF\u00A0\s]/g, '');
            return tailText.length === 0;
        } catch (_) {
            return false;
        }
    }

    _fragmentHasEditableContent(fragment) {
        if (!fragment) return false;
        const text = (fragment.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
        if (text.length > 0) return true;
        if (fragment.querySelector) {
            return !!fragment.querySelector('img, video, audio, iframe, table, hr, br:not(:only-child), .t2-media-block, [data-t2-block]');
        }
        return false;
    }

    _setCollapsedSelection(range, focus = true) {
        if (!range || !this._isRangeInsideEditor(range)) return false;
        const selection = window.getSelection();
        if (!selection) return false;
        try {
            if (focus) {
                try { this.editor.focus({ preventScroll: true }); }
                catch (_) { this.editor.focus(); }
            }
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            this._captureLastEditorRange();
            return true;
        } catch (_) {
            return false;
        }
    }

    _collapsedRangeAtTextOffset(element, offset) {
        const point = this._pointAtTextOffset(element, offset);
        if (!point) return null;
        try {
            const range = document.createRange();
            range.setStart(point.node, this._clampRangeOffset(point.node, point.offset));
            range.collapse(true);
            return range;
        } catch (_) {
            return null;
        }
    }

    _deleteSelectionForStructuredInput(sourceRange) {
        if (!sourceRange || !this._isRangeInsideEditor(sourceRange)) return null;
        let range;
        try { range = sourceRange.cloneRange(); } catch (_) { return null; }
        if (range.collapsed) return range;

        const startBlock = this._getDirectEditorChild(range.startContainer);
        const endBlock = this._getDirectEditorChild(range.endContainer);
        const canMergeTextBlocks = startBlock && endBlock && startBlock !== this.editor && endBlock !== this.editor &&
            startBlock.parentNode === this.editor && endBlock.parentNode === this.editor &&
            !this._isEditorBlockNode(startBlock) && !this._isEditorBlockNode(endBlock);

        if (canMergeTextBlocks && startBlock !== endBlock) {
            try {
                const prefixRange = document.createRange();
                prefixRange.selectNodeContents(startBlock);
                prefixRange.setEnd(range.startContainer, range.startOffset);
                const suffixRange = document.createRange();
                suffixRange.selectNodeContents(endBlock);
                suffixRange.setStart(range.endContainer, range.endOffset);
                const prefix = prefixRange.cloneContents();
                const suffix = suffixRange.cloneContents();
                const caretOffset = prefix.textContent.length;

                let node = startBlock.nextSibling;
                while (node) {
                    const next = node.nextSibling;
                    const isEnd = node === endBlock;
                    node.remove();
                    if (isEnd) break;
                    node = next;
                }

                startBlock.replaceChildren(prefix, suffix);
                if (!this._fragmentHasEditableContent(startBlock)) startBlock.innerHTML = '<br>';
                range = this._collapsedRangeAtTextOffset(startBlock, caretOffset) || this._fallbackEditorRange('start');
                this._setCollapsedSelection(range, false);
                return range;
            } catch (_) {
                // 복잡한 브라우저 Selection이면 아래 표준 Range 삭제로 폴백한다.
            }
        }

        try {
            range.deleteContents();
            range.collapse(true);
            this._setCollapsedSelection(range, false);
            return range;
        } catch (_) {
            return null;
        }
    }

    handleSoftBreak() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;
        let range = selection.getRangeAt(0);
        if (!this._isRangeInsideEditor(range)) {
            range = this._getActiveEditorRange(this._lastEditorBookmark, { fallback: 'end' });
            if (!range) return;
            this._setCollapsedSelection(range, false);
        }

        if (!range.collapsed) {
            range = this._deleteSelectionForStructuredInput(range);
            if (!range) return;
        }

        let currentBlock = this.getClosestBlock(range.startContainer);
        if (!currentBlock || currentBlock === this.editor) {
            currentBlock = document.createElement('p');
            currentBlock.innerHTML = '<br>';
            const rootOffset = range.startContainer === this.editor
                ? Math.min(range.startOffset, this.editor.childNodes.length)
                : this.editor.childNodes.length;
            this.editor.insertBefore(currentBlock, this.editor.childNodes[rootOffset] || null);
            range = this._collapsedRangeAtTextOffset(currentBlock, 0);
            if (!range) return;
        }

        const br = document.createElement('br');
        if (this._isEditorEmptyParagraph(currentBlock)) {
            // 빈 문단에서 Shift+Enter는 실제 줄바꿈 BR 하나와 다음 입력을 위한
            // placeholder BR 하나만 남긴다. 기존 placeholder 앞에 BR을 삽입한 뒤
            // 다시 보조 BR을 추가하면 세 개가 되어 빈 줄이 두 칸 생길 수 있다.
            const placeholder = document.createElement('br');
            placeholder.setAttribute('data-t2-placeholder', 'true');
            currentBlock.replaceChildren(br, placeholder);
        } else {
            try {
                range.insertNode(br);
            } catch (_) {
                return;
            }
        }

        // 줄 끝의 단일 BR 뒤에는 WebKit/Chromium 모두 캐럿을 안정적으로 두지 못하는
        // 경우가 있으므로 편집용 placeholder BR 하나를 더 둔다. 사용자가 다음 글자를
        // 입력하면 그 글자는 두 BR 사이에 들어가며, 외부 출력에서는 정상 줄바꿈 하나로
        // 보인다.
        let hasVisibleAfter = false;
        try {
            const afterRange = document.createRange();
            afterRange.selectNodeContents(currentBlock);
            afterRange.setStartAfter(br);
            hasVisibleAfter = this._fragmentHasEditableContent(afterRange.cloneContents());
        } catch (_) { /* 끝 위치로 간주 */ }
        if (!hasVisibleAfter && !br.nextElementSibling?.hasAttribute('data-t2-placeholder')) {
            br.parentNode.insertBefore(document.createElement('br'), br.nextSibling);
        }

        const caret = document.createRange();
        caret.setStartAfter(br);
        caret.collapse(true);
        this._setCollapsedSelection(caret);
        this._captureLastEditorRange();
        this.createUndoPoint();
        this.autoSave();
        this.updateCharCount();
    }

    handleEnterKey() {
        const selection = window.getSelection();
        // selection이 없거나 Range가 없으면 getRangeAt(0)이 예외를 던짐
        if (!selection || !selection.rangeCount) return;
        let range = selection.getRangeAt(0);

        // Enter는 선택 영역을 먼저 지운 뒤 그 접점에서 문단을 분리해야 한다.
        // 기존 코드는 non-collapsed Range를 모델에 그대로 넘겨 선택 텍스트가 남거나
        // 새 빈 문단만 뒤에 생겼다.
        if (!range.collapsed) {
            range = this._deleteSelectionForStructuredInput(range);
            if (!range) return;
        }

        let currentBlock = this.getClosestBlock(range.startContainer);

        if (!currentBlock || currentBlock === this.editor) {
            currentBlock = this._createEmptyParagraph(true);
            const rootOffset = range.startContainer === this.editor
                ? Math.min(range.startOffset, this.editor.childNodes.length)
                : this.editor.childNodes.length;
            this.editor.insertBefore(currentBlock, this.editor.childNodes[rootOffset] || null);
            this._placeCaretInEmptyParagraph(currentBlock, true);
            this._captureLastEditorRange();
            this.createUndoPoint();
            this.autoSave();
            this.updateCharCount();
            return;
        }

        // 빈 문단의 Enter는 일반 split 모델로 보내지 않는다. placeholder를
        // cloneContents()로 나누거나 정규화 중 교체하면 WebKit Selection이 이전 줄로
        // 되돌아갈 수 있으므로, 새 문단 생성과 캐럿 배치를 원자적으로 처리한다.
        if (this._isEditorEmptyParagraph(currentBlock)) {
            this._insertParagraphAfterEmptyParagraph(currentBlock);
            return;
        }

        const newBlock = document.createElement('p');
        // 분할 결과가 비어 있으면 모든 플랫폼에서 같은 placeholder를 사용한다.
        // data 속성은 편집 중에만 유지되고 저장·내보내기 시 제거된다.
        const emptyBlockHTML = '<br data-t2-placeholder="true">';

        // T2DocumentModel — "무엇이 되어야 하는가"(plan, 순수 계산)와
        // "DOM에 어떻게 반영하는가"(apply, 최소 패치)를 분리한 경로를 우선 사용한다.
        // 모듈이 없거나(구형 캐시된 페이지 등) 예외를 던지면 기존 인라인 로직으로
        // 안전 폴백한다 — format-engine.js와 동일한 strangler-fig 계약.
        try {
            if (typeof T2DocumentModel === 'undefined') throw new Error('T2DocumentModel not loaded');
            const plan = T2DocumentModel.planSplit(range, currentBlock);
            T2DocumentModel.applySplit(currentBlock, newBlock, plan, emptyBlockHTML);
        } catch (err) {
            // 레거시 폴백 경로 (기존 로직 그대로 보존)
            if (range.collapsed) {
                const beforeRange = document.createRange();
                beforeRange.selectNodeContents(currentBlock);
                beforeRange.setEnd(range.startContainer, range.startOffset);
                const afterRange = document.createRange();
                afterRange.selectNodeContents(currentBlock);
                afterRange.setStart(range.startContainer, range.startOffset);

                const beforeContent = beforeRange.cloneContents();
                const afterContent = afterRange.cloneContents();

                if (beforeContent.textContent.trim()) {
                    currentBlock.innerHTML = '';
                    currentBlock.appendChild(beforeContent);
                } else {
                    currentBlock.innerHTML = emptyBlockHTML;
                }

                if (afterContent.textContent.trim()) {
                    newBlock.appendChild(afterContent);
                } else {
                    newBlock.innerHTML = emptyBlockHTML;
                }
            } else {
                newBlock.innerHTML = emptyBlockHTML;
            }
        }

        currentBlock.parentNode.insertBefore(newBlock, currentBlock.nextSibling);
        // 구조 정규화를 먼저 끝낸 뒤 최종 캐럿을 둔다. WebKit에서는 캐럿을 먼저
        // 배치하고 자식 노드를 정규화하면 Selection이 이전 문단으로 되붙을 수 있다.
        this.normalizeContent();
        this.setCaretToStart(newBlock);
        this._captureLastEditorRange();
        this.createUndoPoint();
        this.autoSave();
    }

    handleBackspace(e) {
        const selection = window.getSelection();
        // selection이 없거나 Range가 없으면 getRangeAt(0)이 예외를 던짐
        if (!selection || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);

        if (this.editor.childNodes.length <= 1) {
            const onlyBlock = this.editor.firstElementChild;
            if (!onlyBlock || onlyBlock.textContent.trim() === '') {
                e.preventDefault();
                if (!onlyBlock || onlyBlock.tagName !== 'P') {
                    this.resetEditor();
                }
                return;
            }
        }

        if (range.collapsed && this.isAtBlockStart(range)) {
            e.preventDefault();

            const currentBlock = this.getClosestBlock(range.startContainer);
            if (!currentBlock || currentBlock === this.editor) return;

            const previousBlock = currentBlock.previousElementSibling;
            if (!previousBlock) return;

            // Never merge text into a contenteditable=false plugin block; it corrupts the plugin DOM contract.
            // Skip the atomic block and restore a boundary paragraph instead.
            if (this._isEditorBlockNode(previousBlock)) {
                if (this._isEditorEmptyParagraph(currentBlock)) {
                    currentBlock.remove();
                }
                this.ensureBlockBoundaryLines(previousBlock);
                const landingParagraph = previousBlock.previousElementSibling;
                if (landingParagraph) this._focusEditableParagraph(landingParagraph, 'end');
                this.normalizeContent();
                this.createUndoPoint();
                return;
            }

            this.mergeBlocks(previousBlock, currentBlock);
            this.createUndoPoint();
        }

        setTimeout(() => this.normalizeContent(), 0);
    }

    _normalizePastedTopLevelNodes(container) {
        const output = [];
        let inlineBuffer = [];
        const flushInline = () => {
            if (!inlineBuffer.length) return;
            const p = document.createElement('p');
            inlineBuffer.forEach((node) => p.appendChild(node));
            if (!this._fragmentHasEditableContent(p)) p.innerHTML = '<br>';
            output.push(p);
            inlineBuffer = [];
        };
        const blockTags = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'HR']);
        Array.from(container.childNodes).forEach((node) => {
            const isBlock = node.nodeType === Node.ELEMENT_NODE &&
                (blockTags.has(node.tagName) || this._isEditorBlockNode(node));
            if (isBlock) {
                flushInline();
                output.push(node);
            } else {
                inlineBuffer.push(node);
            }
        });
        flushInline();
        return output;
    }

    _insertPastedBlockSequence(nodes, sourceRange) {
        const validNodes = Array.from(nodes || []).filter(Boolean);
        if (!validNodes.length) return false;
        let range = sourceRange;
        if (!range || !this._isRangeInsideEditor(range)) return false;
        if (!range.collapsed) range = this._deleteSelectionForStructuredInput(range);
        if (!range) return false;

        const currentBlock = this._getDirectEditorChild(range.startContainer);
        let referenceNode = null;
        let suffixBlock = null;
        if (currentBlock && currentBlock !== this.editor && currentBlock.parentNode === this.editor && !this._isEditorBlockNode(currentBlock)) {
            try {
                const beforeRange = document.createRange();
                beforeRange.selectNodeContents(currentBlock);
                beforeRange.setEnd(range.startContainer, range.startOffset);
                const afterRange = document.createRange();
                afterRange.selectNodeContents(currentBlock);
                afterRange.setStart(range.startContainer, range.startOffset);
                const before = beforeRange.cloneContents();
                const after = afterRange.cloneContents();
                const hasBefore = this._fragmentHasEditableContent(before);
                const hasAfter = this._fragmentHasEditableContent(after);

                if (hasBefore) {
                    currentBlock.replaceChildren(before);
                    referenceNode = currentBlock.nextSibling;
                } else {
                    referenceNode = currentBlock;
                }
                if (hasAfter) {
                    suffixBlock = currentBlock.cloneNode(false);
                    suffixBlock.removeAttribute('id');
                    suffixBlock.removeAttribute(this._boundaryAttribute || 'data-t2-boundary');
                    suffixBlock.removeAttribute('data-t2-generated');
                    suffixBlock.removeAttribute('contenteditable');
                    suffixBlock.appendChild(after);
                }
                if (!hasBefore) currentBlock.remove();
            } catch (_) {
                referenceNode = currentBlock.nextSibling;
            }
        } else if (range.startContainer === this.editor) {
            referenceNode = this.editor.childNodes[Math.min(range.startOffset, this.editor.childNodes.length)] || null;
        }

        let lastInserted = null;
        validNodes.forEach((node) => {
            this.editor.insertBefore(node, referenceNode);
            lastInserted = node;
        });
        if (suffixBlock) this.editor.insertBefore(suffixBlock, referenceNode);

        this.normalizeContent();
        if (lastInserted) {
            if (this._isEditorBlockNode(lastInserted)) {
                this.ensureBlockBoundaryLines(lastInserted);
                const landing = lastInserted.nextElementSibling;
                if (this._isDirectEditableParagraph(landing)) this._focusEditableParagraph(landing, 'start');
            } else {
                const caret = this._collapsedRangeAtTextOffset(lastInserted, (lastInserted.textContent || '').length);
                if (caret) this._setCollapsedSelection(caret);
                else if (suffixBlock) this.setCaretToStart(suffixBlock);
            }
        }
        return true;
    }

    _getNestedEditablePasteHost(range) {
        if (!range || !this._isRangeInsideEditor(range)) return null;
        let start = range.startContainer;
        let end = range.endContainer;
        if (start.nodeType !== Node.ELEMENT_NODE) start = start.parentElement;
        if (end.nodeType !== Node.ELEMENT_NODE) end = end.parentElement;
        if (!start || !end || !start.closest) return null;

        const host = start.closest('[contenteditable="true"], td, th');
        if (!host || host === this.editor || !this.editor.contains(host) || !host.contains(end)) return null;
        return host;
    }

    _nestedPasteFragment(html, text, host) {
        const fragment = document.createDocumentFragment();
        const plainOnly = !!(host && host.closest && host.closest('.t2-code-block, pre, code'));
        const appendPlain = (value) => {
            const normalized = String(value || '').replace(/\r\n?/g, '\n');
            const lines = normalized.split('\n');
            lines.forEach((line, index) => {
                if (line) fragment.appendChild(document.createTextNode(line));
                if (index < lines.length - 1) {
                    fragment.appendChild(plainOnly ? document.createTextNode('\n') : document.createElement('br'));
                }
            });
        };

        if (plainOnly || !html) {
            appendPlain(text || '');
            return fragment;
        }

        const raw = document.createElement('div');
        raw.innerHTML = html;
        raw.querySelectorAll('table').forEach((table) => {
            const replacement = document.createDocumentFragment();
            const rows = Array.from(table.rows || []);
            rows.forEach((row, rowIndex) => {
                Array.from(row.cells || []).forEach((cell, cellIndex) => {
                    if (cellIndex) replacement.appendChild(document.createTextNode('\t'));
                    replacement.appendChild(document.createTextNode(cell.textContent || ''));
                });
                if (rowIndex < rows.length - 1) replacement.appendChild(document.createElement('br'));
            });
            table.replaceWith(replacement);
        });

        const temp = document.createElement('div');
        temp.innerHTML = this.sanitizeHTML(raw.innerHTML);
        temp.querySelectorAll('ol').forEach((list) => {
            Array.from(list.children).filter((li) => li.tagName === 'LI').forEach((li, index) => {
                li.insertBefore(document.createTextNode(`${index + 1}. `), li.firstChild);
            });
        });
        temp.querySelectorAll('ul').forEach((list) => {
            Array.from(list.children).filter((li) => li.tagName === 'LI').forEach((li) => {
                li.insertBefore(document.createTextNode('• '), li.firstChild);
            });
        });

        const blockSelector = 'p,div,h1,h2,h3,h4,h5,h6,blockquote,section,article,ul,ol,li';
        Array.from(temp.querySelectorAll(blockSelector)).reverse().forEach((block) => {
            const before = block.previousSibling;
            const after = block.nextSibling;
            if (before && !(before.nodeType === Node.ELEMENT_NODE && before.tagName === 'BR')) {
                block.parentNode.insertBefore(document.createElement('br'), block);
            }
            if (after && !(after.nodeType === Node.ELEMENT_NODE && after.tagName === 'BR')) {
                block.parentNode.insertBefore(document.createElement('br'), after);
            }
            block.replaceWith(...Array.from(block.childNodes));
        });

        let previousWasBreak = false;
        Array.from(temp.childNodes).forEach((node) => {
            const isBreak = node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR';
            if (isBreak && previousWasBreak) return;
            fragment.appendChild(node.cloneNode(true));
            previousWasBreak = isBreak;
        });
        while (fragment.firstChild && fragment.firstChild.nodeType === Node.ELEMENT_NODE && fragment.firstChild.tagName === 'BR') {
            fragment.removeChild(fragment.firstChild);
        }
        while (fragment.lastChild && fragment.lastChild.nodeType === Node.ELEMENT_NODE && fragment.lastChild.tagName === 'BR') {
            fragment.removeChild(fragment.lastChild);
        }
        return fragment;
    }

    _insertPasteIntoNestedEditable(range, html, text, host) {
        if (!range || !host) return false;
        const fragment = this._nestedPasteFragment(html, text, host);
        if (!fragment.childNodes.length) return true;
        range.deleteContents();
        const marker = document.createComment('t2-nested-paste-caret');
        fragment.appendChild(marker);
        range.insertNode(fragment);
        const selection = window.getSelection();
        const caret = document.createRange();
        caret.setStartBefore(marker);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);
        marker.remove();
        this._captureLastEditorRange();
        return true;
    }

    async handlePaste(e) {
        if (!e) return;
        // clipboardData와 Selection은 이벤트 콜스택을 벗어나면 브라우저가 폐기하거나
        // 다른 포커스로 바꿀 수 있으므로 await 전에 동기적으로 보존한다.
        e.preventDefault();
        const pasteBookmark = this.captureSelectionBookmark() || this._lastEditorBookmark;
        const clipboardData = e.clipboardData || window.clipboardData;
        const pastedHtml = clipboardData ? clipboardData.getData('text/html') : '';
        const pastedText = clipboardData ? clipboardData.getData('text/plain') : '';
        const initialRange = this._getActiveEditorRange(pasteBookmark, { fallback: 'end' });
        const nestedHost = this._getNestedEditablePasteHost(initialRange);
        const hasClipboardImageFile = !!(clipboardData && clipboardData.items && Array.from(clipboardData.items).some(item =>
            item && typeof item.type === 'string' && item.type.indexOf('image') !== -1
        ));
        if (nestedHost && !hasClipboardImageFile) {
            this.restoreSelectionBookmark(pasteBookmark, { focus: false });
            if (this._insertPasteIntoNestedEditable(initialRange, pastedHtml, pastedText, nestedHost)) {
                this.createUndoPoint();
                this.autoSave();
                this.updateCharCount();
                nestedHost.focus();
                return;
            }
        }

        for (const [, plugin] of this.plugins) {
            if (typeof plugin.handlePaste !== 'function') continue;
            // 앞선 비동기 플러그인이 포커스를 옮겼더라도 다음 플러그인에는 원래 위치를 제공한다.
            this.restoreSelectionBookmark(pasteBookmark, { focus: false });
            try {
                const handled = await plugin.handlePaste(e);
                if (handled) return;
            } catch (error) {
                console.error('[T2Editor] Plugin paste handler failed:', error);
            }
        }

        const range = this._getActiveEditorRange(pasteBookmark, { fallback: 'end' });
        this.restoreSelectionBookmark(pasteBookmark, { focus: false });
        const rawContent = pastedHtml || pastedText;
        if (!rawContent) {
            this.normalizeContent();
            this.createUndoPoint();
            this.autoSave();
            return;
        }

        const tempDiv = document.createElement('div');
        const hasHTML = !!pastedHtml;
        if (hasHTML) tempDiv.innerHTML = this.sanitizeHTML(pastedHtml);
        else tempDiv.textContent = pastedText;

        const hasTopLevelBlocks = hasHTML && Array.from(tempDiv.childNodes).some((node) =>
            node.nodeType === Node.ELEMENT_NODE &&
            (/^(P|DIV|H[1-6]|PRE|BLOCKQUOTE|UL|OL|TABLE|HR)$/.test(node.tagName) || this._isEditorBlockNode(node))
        );
        const hasPlainTextLines = !hasHTML && /\r|\n/.test(pastedText);

        if (hasTopLevelBlocks) {
            this._insertPastedBlockSequence(this._normalizePastedTopLevelNodes(tempDiv), range);
        } else if (hasPlainTextLines) {
            const lines = pastedText.replace(/\r\n?/g, '\n').split('\n');
            const blocks = lines.map((line) => {
                const p = document.createElement('p');
                if (line) p.textContent = line;
                else p.innerHTML = '<br>';
                return p;
            });
            this._insertPastedBlockSequence(blocks, range);
        } else {
            let insertionRange = range;
            if (!insertionRange.collapsed) insertionRange = this._deleteSelectionForStructuredInput(insertionRange);
            if (!insertionRange) return;
            let currentBlock = this.getClosestBlock(insertionRange.startContainer);
            if (!currentBlock || currentBlock === this.editor) {
                currentBlock = document.createElement('p');
                currentBlock.innerHTML = '<br>';
                const rootOffset = insertionRange.startContainer === this.editor ? insertionRange.startOffset : this.editor.childNodes.length;
                this.editor.insertBefore(currentBlock, this.editor.childNodes[rootOffset] || null);
                insertionRange = this._collapsedRangeAtTextOffset(currentBlock, 0);
            }

            try {
                if (typeof T2DocumentModel === 'undefined') throw new Error('T2DocumentModel not loaded');
                const plan = T2DocumentModel.planInsertAtCaret(insertionRange, currentBlock);
                let newOffset;
                if (hasHTML) newOffset = T2DocumentModel.applyInsertHTML(currentBlock, plan, tempDiv.innerHTML);
                else newOffset = T2DocumentModel.applyInsertText(currentBlock, plan, pastedText);
                this.setCaretPosition(currentBlock, newOffset);
            } catch (error) {
                const node = hasHTML ? document.createRange().createContextualFragment(tempDiv.innerHTML) : document.createTextNode(pastedText);
                insertionRange.insertNode(node);
                insertionRange.collapse(false);
                this._setCollapsedSelection(insertionRange);
            }
        }

        this.normalizeContent();
        this.createUndoPoint();
        this.autoSave();
        this.updateCharCount();
        this.editor.focus();
    }

    handleNodeInserted(e) {
        if (e.target.nodeType === Node.TEXT_NODE && e.target.parentNode === this.editor) {
            const p = document.createElement('p');
            e.target.parentNode.insertBefore(p, e.target);
            p.appendChild(e.target);
            this.normalizeContent();
        }
    }

    getClosestBlock(node) {
        const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'];
        while (node && node !== this.editor) {
            // 에디터의 직계 자식만 문서 블록으로 취급한다. 플러그인 내부의 div/pre를
            // 반환하면 이미지/비디오 블록 내부에 새 블록을 삽입하는 구조 파손이 발생한다.
            if (node.parentNode === this.editor && blockTags.includes(node.nodeName)) {
                return node;
            }
            node = node.parentNode;
        }
        return null;
    }

    isBlockElement(element) {
        const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE'];
        return blockTags.includes(element.tagName);
    }

    isAtBlockStart(range) {
        const block = range ? this.getClosestBlock(range.startContainer) : null;
        if (!block) return false;
        try {
            const before = document.createRange();
            before.selectNodeContents(block);
            before.setEnd(range.startContainer, range.startOffset);
            return !this._fragmentHasEditableContent(before.cloneContents());
        } catch (_) {
            return false;
        }
    }

    isAtBlockEnd(range) {
        const block = range ? this.getClosestBlock(range.endContainer) : null;
        if (!block) return false;
        try {
            const after = document.createRange();
            after.selectNodeContents(block);
            after.setStart(range.endContainer, range.endOffset);
            return !this._fragmentHasEditableContent(after.cloneContents());
        } catch (_) {
            return false;
        }
    }

    handleDelete(e) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!range.collapsed || !this.isAtBlockEnd(range)) return;

        const currentBlock = this.getClosestBlock(range.endContainer);
        if (!currentBlock || currentBlock === this.editor || currentBlock.parentNode !== this.editor) return;
        let nextBlock = currentBlock.nextElementSibling;
        if (!nextBlock) return;

        // 생성 경계 바로 뒤가 원자 블록이면 Delete로 블록 내부를 손상시키지 않고
        // 블록 다음 입력 경계로 이동한다.
        if (this._isEditorEmptyParagraph(nextBlock) && nextBlock.hasAttribute('data-t2-generated') &&
            this._isEditorBlockNode(nextBlock.nextElementSibling)) {
            const atomic = nextBlock.nextElementSibling;
            e.preventDefault();
            this.ensureBlockBoundaryLines(atomic);
            const landing = atomic.nextElementSibling;
            if (this._isDirectEditableParagraph(landing)) this._focusEditableParagraph(landing, 'start');
            return;
        }

        if (this._isEditorBlockNode(nextBlock)) {
            e.preventDefault();
            this.ensureBlockBoundaryLines(nextBlock);
            const landing = nextBlock.nextElementSibling;
            if (this._isDirectEditableParagraph(landing)) this._focusEditableParagraph(landing, 'start');
            return;
        }

        if (!this._isEditorBlockNode(currentBlock) && !this._isEditorBlockNode(nextBlock)) {
            e.preventDefault();
            this.mergeBlocks(currentBlock, nextBlock);
            this.createUndoPoint();
            this.autoSave();
        }
    }

    setCaretToStart(element) {
        if (this._isEditorEmptyParagraph(element)) {
            this._placeCaretInEmptyParagraph(element, true);
            return;
        }

        const range = document.createRange();
        const selection = window.getSelection();
        try { this.editor.focus({ preventScroll: true }); } catch (_) { this.editor.focus(); }

        let target = element.firstChild;
        while (target && target.nodeType === Node.ELEMENT_NODE && target.tagName !== 'BR') {
            target = target.firstChild;
        }

        if (!target) {
            range.setStart(element, 0);
        } else if (target.nodeType === Node.TEXT_NODE) {
            // WebKit: 텍스트 노드가 ZWSP(U+200B) 로만 시작하면, 커서를 그 "뒤" (offset 1)
            // 에 둔다. 이렇게 해야 사용자의 첫 입력(특히 스페이스)이 ZWSP 보호 영역
            // 안에서 발생해 WebKit 의 markup-whitespace 압축을 우회한다.
            // (꼼수 우회의 핵심 — 본 개발자 실측 발견)
            const text = target.textContent || '';
            if (text.charCodeAt(0) === 0x200B) {
                range.setStart(target, 1);
            } else {
                range.setStart(target, 0);
            }
        } else {
            range.setStartBefore(target);
        }

        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    setCaretPosition(element, offset) {
        const range = document.createRange();
        const selection = window.getSelection();
        try { this.editor.focus({ preventScroll: true }); } catch (_) { this.editor.focus(); }

        function findTextNode(node, offset) {
            let currentOffset = 0;

            const walk = document.createTreeWalker(
                node,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            let textNode;
            while (textNode = walk.nextNode()) {
                const length = textNode.textContent.length;
                if (currentOffset + length >= offset) {
                    return {
                        node: textNode,
                        offset: offset - currentOffset
                    };
                }
                currentOffset += length;
            }

            // walk.previousNode() 를 return 문에서 여러 번 호출하면
            // 호출마다 TreeWalker 커서가 이동하여 서로 다른 노드를 참조하는 버그 발생.
            // 변수에 한 번만 저장 후 재사용.
            const fallbackNode = walk.previousNode();
            return {
                node: fallbackNode || element,
                offset: fallbackNode ? fallbackNode.textContent.length : 0
            };
        }

        const target = findTextNode(element, offset);

        try {
            range.setStart(target.node, Math.min(target.offset, target.node.length || 0));
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        } catch (e) {
            console.warn('Caret positioning failed:', e);
            range.setStart(element, 0);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    mergeBlocks(target, source) {
        // T2DocumentModel — handleEnterKey와 동일한 plan/apply 계약.
        // 실패 시 기존 인라인 로직으로 폴백.
        let caretPosition;
        try {
            if (typeof T2DocumentModel === 'undefined') throw new Error('T2DocumentModel not loaded');
            const plan = T2DocumentModel.planMerge(target, source);
            caretPosition = T2DocumentModel.applyMerge(target, source, plan);
        } catch (err) {
            // 레거시 폴백 경로 (기존 로직 그대로 보존)
            caretPosition = target.textContent.length;

            if (target.innerHTML === '<br>') {
                target.innerHTML = '';
            }
            if (source.innerHTML === '<br>') {
                source.innerHTML = '';
            }

            while (source.firstChild) {
                target.appendChild(source.firstChild);
            }
            source.remove();
        }

        this.setCaretPosition(target, caretPosition);
        this.normalizeContent();
    }


    _createEmptyParagraph(includeBreak = true) {
        const p = document.createElement('p');
        this._setEmptyParagraphPlaceholder(p, includeBreak);
        return p;
    }

    _createInvisibleBoundaryParagraph(includeBreak = true, role = 'boundary') {
        const p = this._createEmptyParagraph(includeBreak);
        p.setAttribute(this._boundaryAttribute || 'data-t2-boundary', role);
        p.setAttribute('data-t2-generated', 'true');
        p.contentEditable = true;
        return p;
    }

    _isEditorEmptyParagraph(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE || node.tagName !== 'P') return false;
        if (node.querySelector('img, iframe, video, audio, table, pre, code, .t2-media-block, .t2-table-wrapper, .t2-code-block, .t2-file-block, .t2-drawing-block')) return false;

        // ZWSP/BOM은 과거 편집 placeholder로만 취급한다. NBSP는 사용자가
        // 실제로 입력한 공백이므로 trim()으로 지워 빈 문단으로 오판하지 않는다.
        const text = (node.textContent || '')
            .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
            .replace(/[\t\n\r\f ]/g, '');
        if (text) return false;

        const clone = node.cloneNode(true);
        clone.querySelectorAll('br[data-t2-placeholder]').forEach((br) => br.removeAttribute('data-t2-placeholder'));
        const html = (clone.innerHTML || '')
            .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
            .replace(/&ZeroWidthSpace;/gi, '')
            .trim()
            .toLowerCase();

        return !html || html === '<br>' || html === '<br/>' || html === '<br />' || /^(\s|<br\s*\/?>)*$/i.test(html);
    }

    _isCanonicalEmptyParagraph(p, includeBreak = true) {
        if (!p || p.tagName !== 'P') return false;
        const children = Array.from(p.childNodes);
        if (!includeBreak) return children.length === 0;
        return children.length === 1 && children[0].nodeType === Node.ELEMENT_NODE &&
            children[0].tagName === 'BR' && children[0].getAttribute('data-t2-placeholder') === 'true';
    }

    _selectionInsideElement(element) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        const range = selection.getRangeAt(0);
        return range.collapsed && (range.startContainer === element || element.contains(range.startContainer));
    }

    _setEmptyParagraphPlaceholder(p, includeBreak = true) {
        if (!p || p.tagName !== 'P') return;
        if (this._isCanonicalEmptyParagraph(p, includeBreak)) return;

        const restoreCaret = this._selectionInsideElement(p);
        p.replaceChildren();
        if (includeBreak) {
            const br = document.createElement('br');
            br.setAttribute('data-t2-placeholder', 'true');
            p.appendChild(br);
        }

        // DOM 정규화 중 현재 Selection 컨테이너를 제거하면 WebKit이 Selection을
        // 이전 형제나 에디터 끝으로 재배치한다. 해당 문단 안에 캐럿이 있었다면
        // 같은 문단의 placeholder 앞에 즉시 복원한다.
        if (restoreCaret) this._placeCaretInEmptyParagraph(p, false);
    }

    _normalizeInvisibleBoundaryParagraph(p, includeBreak = true, role = null) {
        if (!this._isEditorEmptyParagraph(p)) return;

        if (role) p.setAttribute(this._boundaryAttribute || 'data-t2-boundary', role);
        if (p.hasAttribute(this._boundaryAttribute || 'data-t2-boundary')) {
            p.setAttribute('data-t2-generated', 'true');
            p.contentEditable = true;
        } else {
            p.removeAttribute('contenteditable');
        }

        // 이미 표준 placeholder 구조라면 자식 노드를 교체하지 않는다. 이 멱등성은
        // Enter 직후 normalizeContent()가 새 문단의 살아 있는 Range를 끊지 않게 한다.
        this._setEmptyParagraphPlaceholder(p, includeBreak);
    }

    _placeCaretInEmptyParagraph(p, focus = true) {
        if (!p || p.tagName !== 'P') return false;
        this._setEmptyParagraphPlaceholder(p, true);

        const selection = window.getSelection();
        if (!selection) return false;
        if (focus) {
            try { this.editor.focus({ preventScroll: true }); }
            catch (_) { this.editor.focus(); }
        }

        const range = document.createRange();
        const placeholder = p.querySelector(':scope > br[data-t2-placeholder]') || p.firstChild;
        if (placeholder) range.setStartBefore(placeholder);
        else range.setStart(p, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
    }

    _focusBoundaryParagraph(p, edge = 'start') {
        if (!this._isEditorEmptyParagraph(p)) return false;
        const role = p.getAttribute(this._boundaryAttribute || 'data-t2-boundary') || null;
        this._normalizeInvisibleBoundaryParagraph(p, true, role);
        return this._placeCaretInEmptyParagraph(p, true);
    }

    _getEmptyDirectParagraphFromSelection() {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return null;
        const range = selection.getRangeAt(0);
        if (!range.collapsed || !this._isRangeInsideEditor(range)) return null;
        const block = this._getDirectEditorChild(range.startContainer);
        return block && block.parentNode === this.editor && this._isEditorEmptyParagraph(block) ? block : null;
    }

    _insertTextIntoEmptyParagraph(p, text) {
        if (!p || !this._isEditorEmptyParagraph(p)) return false;
        const value = String(text ?? '');
        if (!value) return false;
        p.removeAttribute(this._boundaryAttribute || 'data-t2-boundary');
        p.removeAttribute('data-t2-generated');
        p.removeAttribute('contenteditable');
        const node = document.createTextNode(value);
        p.replaceChildren(node);

        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(node, node.length);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        this._captureLastEditorRange();
        this.createUndoPoint({ coalesce: true, groupKey: 'insert' });
        this.scheduleAutoSave();
        this.updateCharCount();
        return true;
    }

    _insertParagraphAfterEmptyParagraph(currentBlock) {
        if (!currentBlock || currentBlock.parentNode !== this.editor || !this._isEditorEmptyParagraph(currentBlock)) return false;

        // 현재 줄은 그대로 보존하고 그 다음 줄을 새 사용자 문단으로 만든다. 현재 줄이
        // 블록 위 경계였다면 normalizeContent()가 새 줄을 블록 직전 경계로 승계하고,
        // 기존 줄은 일반 빈 줄로 전환한다. 블록 아래 경계에서는 기존 경계가 유지된다.
        const newBlock = this._createEmptyParagraph(true);
        currentBlock.parentNode.insertBefore(newBlock, currentBlock.nextSibling);
        this.normalizeContent();

        // normalizeContent()가 속성만 조정하고 표준 placeholder 노드는 유지하므로
        // Selection을 새 줄에 확정할 수 있다. 브라우저가 root로 보낸 경우에도 재복원.
        this._placeCaretInEmptyParagraph(newBlock, true);
        this._captureLastEditorRange();
        this.createUndoPoint();
        this.autoSave();
        this.updateCharCount();
        return true;
    }

    _handleEmptyParagraphBeforeInput(e) {
        if (!e || e.defaultPrevented || e.isComposing || this._isComposing) return false;
        if (this._isNestedEditableTarget(e.target)) return false;

        const paragraph = this._getEmptyDirectParagraphFromSelection();
        if (!paragraph) return false;
        const type = e.inputType || '';

        if (type === 'insertParagraph' || type === 'insertLineBreak') {
            e.preventDefault();
            const intent = this._lastEnterIntent;
            this._lastEnterIntent = null;
            const isSoftBreak = !!(intent && intent.soft && Date.now() - intent.at < 800);
            if (isSoftBreak) {
                this.handleSoftBreak();
                return true;
            }
            return this._insertParagraphAfterEmptyParagraph(paragraph);
        }

        if ((type === 'insertText' || type === 'insertReplacementText') && typeof e.data === 'string') {
            if (e.data === ' ') return this._handleEmptyBlockSpace(e);
            e.preventDefault();
            return this._insertTextIntoEmptyParagraph(paragraph, e.data);
        }
        return false;
    }

    _isDirectEditableParagraph(node) {
        return !!(node && node.nodeType === Node.ELEMENT_NODE && node.tagName === 'P' &&
            node.parentNode === this.editor && node.getAttribute('contenteditable') !== 'false');
    }

    _focusEditableParagraph(p, edge = 'start') {
        if (!this._isDirectEditableParagraph(p)) return false;
        if (this._isEditorEmptyParagraph(p)) return this._focusBoundaryParagraph(p, edge);

        const selection = window.getSelection();
        if (!selection) return false;
        try { this.editor.focus({ preventScroll: true }); }
        catch (_) { this.editor.focus(); }
        const range = document.createRange();
        range.selectNodeContents(p);
        range.collapse(edge !== 'end');
        selection.removeAllRanges();
        selection.addRange(range);
        this._captureLastEditorRange();
        return true;
    }

    _isEditorBlockNode(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        return !!(
            node.classList?.contains('t2-media-block') ||
            node.classList?.contains('t2-code-block') ||
            node.classList?.contains('t2-file-block') ||
            node.classList?.contains('t2-table-wrapper') ||
            node.classList?.contains('t2-drawing-block') ||
            node.getAttribute?.('data-t2-block')
        );
    }

    ensureBlockBoundaryLines(block) {
        if (!this._isEditorBlockNode(block) || !block.parentNode || block.parentNode !== this.editor) return;

        block.contentEditable = false;
        const clearGeneratedState = (p) => {
            if (!p || this._isEditorEmptyParagraph(p)) return;
            p.removeAttribute(this._boundaryAttribute || 'data-t2-boundary');
            p.removeAttribute('data-t2-generated');
            p.removeAttribute('contenteditable');
        };

        let prev = block.previousElementSibling;
        if (!this._isDirectEditableParagraph(prev)) {
            prev = this._createInvisibleBoundaryParagraph(true, 'before');
            block.parentNode.insertBefore(prev, block);
        } else if (this._isEditorEmptyParagraph(prev)) {
            this._normalizeInvisibleBoundaryParagraph(prev, true, 'before');
        } else {
            clearGeneratedState(prev);
        }

        let next = block.nextElementSibling;
        if (!this._isDirectEditableParagraph(next)) {
            next = this._createInvisibleBoundaryParagraph(true, 'after');
            block.parentNode.insertBefore(next, block.nextSibling);
        } else if (this._isEditorEmptyParagraph(next)) {
            this._normalizeInvisibleBoundaryParagraph(next, true, 'after');
        } else {
            clearGeneratedState(next);
        }
    }

    insertBlockWithBoundaryLines(block, savedRange = null) {
        return this.insertBlocksWithBoundaryLines([block], savedRange);
    }

    insertBlocksWithBoundaryLines(blocks, savedRange = null) {
        const validBlocks = Array.from(blocks || []).filter(Boolean);
        if (!validBlocks.length) return false;

        let range = this._getActiveEditorRange(savedRange, { fallback: 'end' });
        if (!range.collapsed) range = this._deleteSelectionForStructuredInput(range);
        if (!range) return false;

        let referenceNode = null;
        let topBreak = null;
        let suffixBlock = null;
        const currentBlock = this._getDirectEditorChild(range.startContainer);

        if (currentBlock && currentBlock !== this.editor && currentBlock.parentNode === this.editor && !this._isEditorBlockNode(currentBlock)) {
            try {
                const beforeRange = document.createRange();
                beforeRange.selectNodeContents(currentBlock);
                beforeRange.setEnd(range.startContainer, range.startOffset);
                const afterRange = document.createRange();
                afterRange.selectNodeContents(currentBlock);
                afterRange.setStart(range.startContainer, range.startOffset);
                const before = beforeRange.cloneContents();
                const after = afterRange.cloneContents();
                const hasBefore = this._fragmentHasEditableContent(before);
                const hasAfter = this._fragmentHasEditableContent(after);

                if (hasBefore) {
                    currentBlock.replaceChildren(before);
                    topBreak = this._createInvisibleBoundaryParagraph(true, 'before');
                    referenceNode = currentBlock.nextSibling;
                    this.editor.insertBefore(topBreak, referenceNode);
                } else {
                    topBreak = currentBlock;
                    this._normalizeInvisibleBoundaryParagraph(topBreak, true, 'before');
                    topBreak.setAttribute(this._boundaryAttribute || 'data-t2-boundary', 'before');
                    topBreak.setAttribute('data-t2-generated', 'true');
                    referenceNode = topBreak.nextSibling;
                }

                if (hasAfter) {
                    suffixBlock = currentBlock.cloneNode(false);
                    suffixBlock.removeAttribute('id');
                    suffixBlock.removeAttribute(this._boundaryAttribute || 'data-t2-boundary');
                    suffixBlock.removeAttribute('data-t2-generated');
                    suffixBlock.removeAttribute('contenteditable');
                    suffixBlock.appendChild(after);
                }
            } catch (_) {
                topBreak = this._createInvisibleBoundaryParagraph(true, 'before');
                referenceNode = currentBlock.nextSibling;
                this.editor.insertBefore(topBreak, referenceNode);
            }
        } else if (range.startContainer === this.editor) {
            referenceNode = this.editor.childNodes[Math.min(range.startOffset, this.editor.childNodes.length)] || null;
            topBreak = this._createInvisibleBoundaryParagraph(true, 'before');
            this.editor.insertBefore(topBreak, referenceNode);
        } else if (currentBlock && this._isEditorBlockNode(currentBlock)) {
            this.ensureBlockBoundaryLines(currentBlock);
            topBreak = currentBlock.nextElementSibling;
            referenceNode = topBreak ? topBreak.nextSibling : currentBlock.nextSibling;
        }

        if (!topBreak) {
            // 사용자 선택 기록이 전혀 없는 프로그램적 삽입만 기존 호환을 위해 끝에 둔다.
            topBreak = this._createInvisibleBoundaryParagraph(true, 'before');
            this.editor.appendChild(topBreak);
            referenceNode = null;
        }

        let cursor = topBreak;
        validBlocks.forEach((block, index) => {
            block.contentEditable = false;
            this.editor.insertBefore(block, referenceNode);
            cursor = block;
            if (index < validBlocks.length - 1) {
                const between = this._createInvisibleBoundaryParagraph(true, 'between');
                this.editor.insertBefore(between, referenceNode);
                cursor = between;
            }
        });

        const bottomBreak = this._createInvisibleBoundaryParagraph(true, 'after');
        this.editor.insertBefore(bottomBreak, referenceNode);
        if (suffixBlock) this.editor.insertBefore(suffixBlock, referenceNode);
        validBlocks.forEach((block) => this.ensureBlockBoundaryLines(block));
        this.normalizeContent();

        if (suffixBlock) this.setCaretToStart(suffixBlock);
        else this._focusBoundaryParagraph(bottomBreak, 'start');
        this._captureLastEditorRange();
        return true;
    }

     /** Move atomic content blocks as units; boundary paragraphs are not independent move targets. */
    moveBlockWithBoundaryLines(block, direction) {
        if (!this._isEditorBlockNode(block) || block.parentNode !== this.editor) return false;
        if (direction !== 'up' && direction !== 'down') return false;

        this.normalizeContent();

        const isGeneratedBoundary = (node) => !!(
            node && node.nodeType === Node.ELEMENT_NODE && node.tagName === 'P' &&
            (node.hasAttribute(this._boundaryAttribute || 'data-t2-boundary') || node.hasAttribute('data-t2-generated'))
        );

        let target = direction === 'up' ? block.previousElementSibling : block.nextElementSibling;
        while (target && isGeneratedBoundary(target)) {
            target = direction === 'up' ? target.previousElementSibling : target.nextElementSibling;
        }
        if (!target) return false;

        if (direction === 'up') {
            this.editor.insertBefore(block, target);
        } else {
            this.editor.insertBefore(block, target.nextSibling);
        }

        // 이동으로 인해 더 이상 어떤 원자 블록에도 붙어 있지 않은 "생성 경계"는
        // 프로그램이 만든 임시 노드이므로 제거한다. 이를 일반 빈 줄로 남기면 이동을
        // 반복할 때마다 빈 문단이 하나씩 누적된다. 사용자가 만든 무표식 빈 문단은
        // 이 선택자에 포함되지 않아 그대로 보존된다.
        this.editor.querySelectorAll(':scope > p[data-t2-boundary], :scope > p[data-t2-generated]').forEach((p) => {
            const adjacentToBlock = this._isEditorBlockNode(p.previousElementSibling) ||
                this._isEditorBlockNode(p.nextElementSibling);
            if (!adjacentToBlock) p.remove();
        });

        // 이동 전 위치의 생성 경계가 고아가 되면 일반 빈 줄로 전환하고,
        // 새 위치에는 다시 입력 가능한 경계를 보장한다.
        this.normalizeContent();
        this.ensureBlockBoundaryLines(block);
        return true;
    }

    normalizeContent() {
        if (!this.editor || this._normalizingContent) return;
        this._normalizingContent = true;

        try {
        const blocks = Array.from(this.editor.childNodes);

        blocks.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const p = document.createElement('p');
                node.parentNode.insertBefore(p, node);
                p.appendChild(node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const isMediaBlock = this._isEditorBlockNode(node);

                if (isMediaBlock) {
                    this.ensureBlockBoundaryLines(node);
                } else {
                    if (this._isEditorEmptyParagraph(node)) {
                        // 생성 경계 문단만 구조적으로 정규화한다. 일반 빈 문단은 사용자가
                        // 만든 줄바꿈일 수 있으므로 삭제/병합하지 않고 입력 가능 상태만 보장.
                        const role = node.getAttribute(this._boundaryAttribute || 'data-t2-boundary');
                        this._normalizeInvisibleBoundaryParagraph(node, true, role || null);
                    }
                }
            }
        });

        // 블록 삭제 후 남은 생성 경계는 일반 빈 문단으로 되돌린다. 제거하지 않는 이유는
        // 사용자의 캐럿/빈 줄을 보존하고 undo 시 DOM 위치 급변을 줄이기 위함이다.
        this.editor.querySelectorAll(`:scope > p[${this._boundaryAttribute || 'data-t2-boundary'}]`).forEach((p) => {
            const adjacentToBlock = this._isEditorBlockNode(p.previousElementSibling) || this._isEditorBlockNode(p.nextElementSibling);
            if (!adjacentToBlock) {
                p.removeAttribute(this._boundaryAttribute || 'data-t2-boundary');
                p.removeAttribute('data-t2-generated');
                p.removeAttribute('contenteditable');
            }
        });

        if (!this.editor.firstChild) {
            this.editor.appendChild(this._createEmptyParagraph(true));
        }
        } finally {
            this._normalizingContent = false;
        }
    }

    cleanupPastedHTML(element) {
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_ELEMENT,
            null,
            false
        );

        const nodesToRemove = [];
        let node;

        while (node = walker.nextNode()) {
            node.removeAttribute('style');
            node.removeAttribute('class');

            if (['STYLE', 'SCRIPT', 'META'].includes(node.tagName)) {
                nodesToRemove.push(node);
            }

            if (this.isBlockElement(node) && !node.textContent.trim()) {
                node.innerHTML = '<br>';
            }
        }

        nodesToRemove.forEach(node => node.parentNode.removeChild(node));
    }

    resetEditor() {
        const p = this._createEmptyParagraph(true);
        this.editor.innerHTML = '';
        this.editor.appendChild(p);
        this._placeCaretInEmptyParagraph(p, true);
    }

    // WebKit: 외부 출력/DB 제출용 제로폭 제거 헬퍼
    // 과거 저장물이나 외부 플러그인에서 들어온 ZWSP/BOM은 편집 중 읽기 호환하되,
    // DB 저장·폼 제출·출력 등 외부로 나갈 때 제거한다.
    getSanitizedContent() {
        const tmp = document.createElement('div');
        tmp.innerHTML = this.editor.innerHTML;

        // 에디터 내부 전용 경계 표식/편집 속성은 DB·외부 HTML에 노출하지 않는다.
        // 빈 줄 자체는 의미가 있으므로 <p><br></p> 형태로 보존한다.
        tmp.querySelectorAll('p[data-t2-boundary], p[data-t2-generated]').forEach((p) => {
            p.removeAttribute('data-t2-boundary');
            p.removeAttribute('data-t2-generated');
            p.removeAttribute('contenteditable');
        });
        tmp.querySelectorAll(':scope > p[contenteditable]').forEach((p) => p.removeAttribute('contenteditable'));
        tmp.querySelectorAll('br[data-t2-placeholder]').forEach((br) => br.removeAttribute('data-t2-placeholder'));

        // 1) 에디터 placeholder로 사용하는 ZWSP/BOM만 제거한다.
        // ZWNJ(U+200C)·ZWJ(U+200D)는 페르시아어 형태/복합 이모지 등에 실제 의미가
        // 있으므로 사용자 본문에서 제거하면 안 된다.
        const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT, null, false);
        const txts = [];
        let n;
        while ((n = walker.nextNode())) txts.push(n);
        txts.forEach((t) => {
            const cleaned = t.nodeValue.replace(/[\u200B\uFEFF]/g, '');
            if (cleaned === '') {
                // 텍스트가 제로폭 뿐이었다면 노드 자체를 제거 (항상 BR 이 남아 빈 줄 표현은 유지됨)
                t.parentNode && t.parentNode.removeChild(t);
            } else {
                t.nodeValue = cleaned;
            }
        });

        return tmp.innerHTML.replace(/<p(?:\s[^>]*)?>\s*<\/p>/gi, (emptyParagraph) => {
            // 속성이 있는 일반 빈 문단은 속성을 보존해야 하므로 실제 태그를 파싱하지
            // 않고, 속성이 없는 <p></p>만 표준 빈 줄로 치환한다.
            return /^<p>\s*<\/p>$/i.test(emptyParagraph) ? '<p><br></p>' : emptyParagraph;
        });
    }

    _makeHistorySnapshot() {
        return {
            version: 1,
            html: this.editor ? this.editor.innerHTML : '',
            selection: this.captureSelectionBookmark() || this._lastEditorBookmark || null
        };
    }

    _historyHtml(entry) {
        if (typeof entry === 'string') return entry;
        return entry && typeof entry.html === 'string' ? entry.html : '';
    }

    _normalizeHistoryEntry(entry) {
        return typeof entry === 'string' ? { version: 1, html: entry, selection: null } :
            (entry && typeof entry.html === 'string' ? entry : { version: 1, html: '', selection: null });
    }

    _resetHistoryBaseline() {
        this.undoStack = [];
        this.redoStack = [];
        this.lastCheckpoint = this._makeHistorySnapshot();
        this._historyInputGroup = null;
        this.updateUndoRedoButtons();
    }

    createUndoPoint(options = null) {
        const current = this._makeHistorySnapshot();
        if (current.html === this._historyHtml(this.lastCheckpoint)) {
            if (this.lastCheckpoint && typeof this.lastCheckpoint === 'object') {
                this.lastCheckpoint.selection = current.selection;
            }
            return;
        }

        const now = Date.now();
        const bookmark = current.selection;
        const blockIndex = bookmark && Number.isInteger(bookmark.startBlockIndex) ? bookmark.startBlockIndex : -1;
        const canCoalesce = !!(options && options.coalesce && this._historyInputGroup &&
            this._historyInputGroup.key === options.groupKey &&
            this._historyInputGroup.blockIndex === blockIndex &&
            now - this._historyInputGroup.at <= 900);

        if (!canCoalesce && this.lastCheckpoint !== null && this.lastCheckpoint !== undefined) {
            this.undoStack.push(this.lastCheckpoint);
        }
        this.lastCheckpoint = current;
        this.redoStack = [];

        if (options && options.coalesce) {
            this._historyInputGroup = { key: options.groupKey, blockIndex, at: now };
        } else {
            this._historyInputGroup = null;
        }

        if (this.undoStack.length > 100) this.undoStack.shift();
        this.updateUndoRedoButtons();
    }

    _restoreHistoryContent(entry) {
        const snapshot = this._normalizeHistoryEntry(entry);
        if (!snapshot.html.trim()) this.resetEditor();
        else this.editor.innerHTML = snapshot.html;

        this.normalizeContent();
        this._reinitializePluginBlocks();
        const restored = snapshot.selection
            ? this.restoreSelectionBookmark(snapshot.selection, { focus: true, preventScroll: true, preferTextOffset: true })
            : false;
        if (!restored) {
            const fallback = this._fallbackEditorRange('start');
            this._setCollapsedSelection(fallback);
        }
        this.lastCheckpoint = {
            version: 1,
            html: this.editor.innerHTML,
            selection: this.captureSelectionBookmark() || snapshot.selection || null
        };
        this.updateCharCount();
        this.autoSave();
    }

    undo() {
        if (this.undoStack.length === 0) return;
        this._historyInputGroup = null;

        this.redoStack.push(this._makeHistorySnapshot());
        const previous = this.undoStack.pop();
        this._restoreHistoryContent(previous);
        this.updateUndoRedoButtons();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        this._historyInputGroup = null;

        this.undoStack.push(this._makeHistorySnapshot());
        const next = this.redoStack.pop();
        this._restoreHistoryContent(next);
        this.updateUndoRedoButtons();
    }

    updateUndoRedoButtons() {
        // undoBtn/redoBtn 은 생성자에서 container.querySelector 로
        // 찾은 요소로, 툴바 마크업이 커스터마이징되어 [data-command="undo"/"redo"]
        // 버튼이 없는 임베드/미니 구성에서는 null 이 된다. null.disabled 대입은
        // 예외를 던져 init() 전체가 실패하고 에디터가 아예 뜨지 않게 되므로 가드.
        if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
        if (this.redoBtn) this.redoBtn.disabled = this.redoStack.length === 0;
    }

    execCommand(command, value = null) {
        // T2FormatEngine is the primary formatting path; execCommand remains a 10.4.0 compatibility fallback.
        // Remove the fallback only after supported browsers pass collapsed and multi-node selection tests.
        switch(command) {
            case 'fontSize': {
                // switch-case 내 const/let 선언은 블록 스코프({})가 없으면
                // switch 전체가 하나의 스코프로 취급되어 중복 선언 오류 및 strict mode
                // SyntaxError 발생 가능. 명시적 블록으로 스코프를 격리.
                const handled = (typeof T2FormatEngine !== 'undefined')
                    && T2FormatEngine.applyFontSize(value, this.editor);
                if (!handled) {
                    // 레거시 폴백 경로 (기존 로직 그대로 보존)
                    console.warn('[T2Editor] fontSize: modern format engine unavailable, falling back to raw Range.surroundContents');
                    // rangeCount 미검증 시 getRangeAt(0) 예외 — 가드 추가.
                    const selection = window.getSelection();
                    if (!selection || !selection.rangeCount) break;
                    const range = selection.getRangeAt(0);

                    const span = document.createElement('span');
                    span.style.fontSize = value + 'px';

                    const existingSpan = range.commonAncestorContainer.parentElement;
                    if (existingSpan && existingSpan.style.fontSize) {
                        existingSpan.style.fontSize = value + 'px';
                    } else {
                        range.surroundContents(span);
                    }
                }
                break;
            }
            case 'bold':
            case 'italic':
            case 'underline':
            case 'strikeThrough': {
                const handled = (typeof T2FormatEngine !== 'undefined')
                    && T2FormatEngine.toggleInline(this.editor, command);
                if (!handled) {
                    // [FALLBACK-LEGACY] 엔진 미탑재/처리 실패 시에만 도달.
                    console.warn(`[T2Editor] ${command}: modern format engine unavailable, falling back to execCommand`);
                    document.execCommand('styleWithCSS', false, true);
                    document.execCommand(command, false, value);
                }
                break;
            }
            case 'foreColor':
            case 'backColor': {
                const handled = (typeof T2FormatEngine !== 'undefined')
                    && T2FormatEngine.applyColor(command, value, this.editor);
                if (!handled) {
                    console.warn(`[T2Editor] ${command}: modern format engine unavailable, falling back to execCommand`);
                    document.execCommand('styleWithCSS', false, true);
                    document.execCommand(command, false, value);
                }
                break;
            }
            case 'justifyLeft':
            case 'justifyCenter':
            case 'justifyRight':
                // Alignment is applied directly to selected blocks; the duplicate execCommand call is intentionally omitted.
                break;
            default:
                // 알려지지 않은 커맨드 — 기존 동작 그대로 execCommand 위임.
                document.execCommand('styleWithCSS', false, true);
                document.execCommand(command, false, value);
        }

        this.normalizeContent();
    }

    saveSelection() {
        const bookmark = this.captureSelectionBookmark();
        if (bookmark) {
            this.savedSelection = bookmark;
            this._lastEditorBookmark = bookmark;
        }
        return bookmark;
    }

    restoreSelection() {
        return this.restoreSelectionBookmark(this.savedSelection || this._lastEditorBookmark, { focus: true });
    }

    _storageGet(key) {
        try {
            return window.localStorage ? window.localStorage.getItem(key) : null;
        } catch (error) {
            console.warn(`LocalStorage read failed for ${key}:`, error);
            return null;
        }
    }

    _storageSet(key, value) {
        try {
            if (!window.localStorage) return false;
            window.localStorage.setItem(key, value);
            return true;
        } catch (error) {
            console.warn(`LocalStorage write failed for ${key}:`, error);
            return false;
        }
    }

    _storageRemove(key) {
        try {
            if (!window.localStorage) return false;
            window.localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.warn(`LocalStorage remove failed for ${key}:`, error);
            return false;
        }
    }

    _getAutoSaveStorageKey() {
        const page = (window.location ? `${window.location.pathname}${window.location.search}` : 'unknown-page');
        const editorId = (this.editor && (this.editor.id || this.editor.getAttribute('name'))) ||
            (this.container && this.container.id) || 'default-editor';
        const identity = `${page}|${editorId}`;
        let hash = 2166136261;
        for (let i = 0; i < identity.length; i++) {
            hash ^= identity.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return `t2editor-autosave:v2:${(hash >>> 0).toString(36)}`;
    }

    _createAutoSaveSnapshot(content) {
        return JSON.stringify({
            version: 2,
            content,
            savedAt: Date.now(),
            editorId: (this.editor && this.editor.id) || '',
            page: window.location ? window.location.pathname : ''
        });
    }

    setupAutoSaveToggle() {
        const statusBar = this.container.querySelector('.t2-editor-status');
        if (!statusBar || statusBar.querySelector('.t2-autosave-toggle')) return;
        const autoSaveToggle = document.createElement('div');
        autoSaveToggle.className = 't2-autosave-toggle';
        const toggleId = `t2-autosave-${this.generateUid()}`;

        autoSaveToggle.innerHTML = `
            <label class="t2-switch" for="${toggleId}">
                <input type="checkbox" id="${toggleId}" ${this.autoSaveEnabled ? 'checked' : ''}>
                <span class="t2-slider"></span>
            </label>
            <label for="${toggleId}" class="t2-autosave-text" data-i18n="editor.autosave_label">${(typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t('editor.autosave_label') : 'Auto Save'}</label>
        `;

        const toggleCheckbox = autoSaveToggle.querySelector('input[type="checkbox"]');
        toggleCheckbox.addEventListener('change', (event) => {
            this.autoSaveEnabled = event.target.checked;
            this._storageSet('t2editor-autosave-enabled', String(this.autoSaveEnabled));
            if (!this.autoSaveEnabled) this.clearAutoSave();
            else this.autoSave();
        });

        const logoElement = statusBar.querySelector('.t2-logo');
        const logo = logoElement ? logoElement.parentElement : null;
        if (logo && logo.parentNode) logo.parentNode.insertBefore(autoSaveToggle, logo.nextSibling);
        else statusBar.appendChild(autoSaveToggle);
    }

    scheduleAutoSave(delay = 350) {
        if ((this.collab && this.collab.isActive) || !this.autoSaveEnabled) return;
        if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
        this._autoSaveTimer = setTimeout(() => {
            this._autoSaveTimer = null;
            this.autoSave();
        }, Math.max(0, Number(delay) || 0));
    }

    autoSave() {
        if (this._autoSaveTimer) {
            clearTimeout(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
        if ((this.collab && this.collab.isActive) || !this.autoSaveEnabled) return;
        const content = this.editor.innerHTML;
        const normalizedContent = content.replace(/<p>\s*<\/p>/g, '<p><br></p>');
        const ok = this._storageSet(this.autoSaveStorageKey, this._createAutoSaveSnapshot(normalizedContent));
        if (!ok) {
            this.autoSaveEnabled = false;
            this._storageSet('t2editor-autosave-enabled', 'false');
            const toggle = this.container.querySelector('.t2-autosave-toggle input[type="checkbox"]');
            if (toggle) toggle.checked = false;
        }
    }

    _parseAutoSaveSnapshot(raw) {
        if (!raw || !String(raw).trim()) return null;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.content === 'string') {
                return {
                    content: parsed.content,
                    savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : null
                };
            }
        } catch (error) {
            // 10.4.0 이전 순수 HTML 저장 형식은 아래에서 호환 처리한다.
        }
        return { content: String(raw), savedAt: null };
    }

    loadAutoSave() {
        if ((this.collab && this.collab.isActive) || !this.autoSaveEnabled) return;

        let raw = this._storageGet(this.autoSaveStorageKey);
        let legacy = false;
        if (!raw) {
            const editorsOnPage = document.querySelectorAll('.t2-editor').length;
            const legacyRaw = this._storageGet('t2editor-autosave');
            if (legacyRaw && editorsOnPage === 1) {
                const key = 'editor.autosave_legacy_restore_prompt';
                let prompt = 'An autosave created by an earlier T2Editor version was found. Restore it on this page?';
                if (typeof T2I18N !== 'undefined' && T2I18N.t) {
                    const translated = T2I18N.t(key);
                    if (translated && translated !== key) prompt = translated;
                }
                if (window.confirm(prompt)) {
                    raw = legacyRaw;
                    legacy = true;
                } else {
                    this._storageRemove('t2editor-autosave');
                }
            }
        }

        const snapshot = this._parseAutoSaveSnapshot(raw);
        if (!snapshot || !snapshot.content || !snapshot.content.trim()) return;

        const currentContent = this.editor.innerHTML;
        const directChildren = Array.from(this.editor.children || []);
        const isEmpty = !currentContent || currentContent.trim() === '' ||
            (directChildren.length === 1 && this._isEditorEmptyParagraph(directChildren[0]));
        if (!isEmpty) return;

        const staleMs = 48 * 60 * 60 * 1000;
        if (snapshot.savedAt !== null && (Date.now() - snapshot.savedAt) > staleMs) {
            const hoursAgo = Math.round((Date.now() - snapshot.savedAt) / 3600000);
            const t = (typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t : key => key;
            const prompt1 = t('editor.autosave_restore_prompt_1');
            const prompt2 = t('editor.autosave_restore_prompt_2');
            const first = prompt1 === 'editor.autosave_restore_prompt_1'
                ? `Auto-saved content from about ${hoursAgo} hours ago exists.\n`
                : prompt1.replace('{hours}', hoursAgo);
            const second = prompt2 === 'editor.autosave_restore_prompt_2'
                ? 'Restore it?\n(Canceling will delete the saved content.)'
                : prompt2;
            if (!window.confirm(first + second)) {
                this.clearAutoSave();
                return;
            }
        }

        this._doSetContent(snapshot.content);
        if (legacy) {
            this._storageSet(this.autoSaveStorageKey, this._createAutoSaveSnapshot(snapshot.content));
            this._storageRemove('t2editor-autosave');
        }
        console.log(`AutoSave: Content restored from ${this.autoSaveStorageKey}`);
    }

    clearAutoSave() {
        this._storageRemove(this.autoSaveStorageKey);
    }

    setupBeforeUnload() {
        window.addEventListener('beforeunload', () => {
            if ((this.collab && this.collab.isActive) || !this.autoSaveEnabled) return;
            const normalizedContent = this.editor.innerHTML.replace(/<p>\s*<\/p>/g, '<p><br></p>');
            this._storageSet(this.autoSaveStorageKey, this._createAutoSaveSnapshot(normalizedContent));
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.autoSaveEnabled && !(this.collab && this.collab.isActive)) {
                this.autoSave();
            }
        });
    }

    updateCharCount() {
        // this.charCount 도 undoBtn/redoBtn 과 동일하게 마크업에
        // '.t2-char-count span' 이 없으면 null 이 된다. 이전에는 가드가 없어
        // handleInput()/handleEnterKey() 등 거의 모든 입력 경로에서 예외가
        // 발생해 자동저장·undo 포인트 생성까지 함께 중단되는 연쇄 장애였다.
        if (!this.charCount) return;
        let text = this.editor.textContent;
        text = text.replace(/\s+/g, '');
        this.charCount.textContent = text.length;
    }

    showFontSizeList(button) {
        const sizes = ['11', '13', '15', '16', '19', '24', '30', '34', '38'];
        const list = document.createElement('div');
        list.className = 't2-font-size-list';
        list.style.cssText = `
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 5px 0;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            min-width: 120px;
        `;

        const currentFontSize = this.getCurrentFontSize();

        sizes.forEach(size => {
            const option = document.createElement('div');
            option.className = 't2-font-size-option';

            const isCurrentSize = parseInt(size) === currentFontSize;

            const optionContent = document.createElement('div');
            optionContent.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
            `;

            const sizeText = document.createElement('span');
            sizeText.textContent = `${size}px`;
            optionContent.appendChild(sizeText);

            if (isCurrentSize) {
                const checkmark = document.createElement('span');
                checkmark.className = 'material-icons';
                checkmark.textContent = 'check';
                checkmark.style.fontSize = '16px';
                checkmark.style.color = '#1a73e8';
                optionContent.appendChild(checkmark);
            }

            option.appendChild(optionContent);

            option.style.cssText = `
                padding: 5px 15px;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.1s ease;
                ${isCurrentSize ? 'background-color: #e8f0fe; font-weight: 500;' : ''}
            `;

            option.addEventListener('mouseenter', () => {
                option.style.backgroundColor = isCurrentSize ? '#d2e3fc' : '#f5f5f5';
            });

            option.addEventListener('mouseleave', () => {
                option.style.backgroundColor = isCurrentSize ? '#e8f0fe' : 'transparent';
            });

            option.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.restoreSelection();
                this.execCommand('fontSize', size);
                if (list.parentElement) list.parentElement.remove();
                this.createUndoPoint();
            });

            list.appendChild(option);
        });

        this.showDropdown(list, button);
    }

    getCurrentFontSize() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;

        const range = selection.getRangeAt(0);
        let node = range.commonAncestorContainer;

        if (node.nodeType === Node.TEXT_NODE) {
            node = node.parentNode;
        }

        while (node && node !== this.editor) {
            const fontSize = window.getComputedStyle(node).fontSize;
            if (fontSize && fontSize !== 'inherit') {
                return parseInt(fontSize);
            }
            node = node.parentNode;
        }

        return parseInt(window.getComputedStyle(this.editor).fontSize);
    }

    showColorPalette(command, button) {
        const self = this;

        // 1. Viewport-safe fixed positioning
        // Picker is appended to document.body with position:fixed so it is never
        // clipped by the editor container or toolbar overflow, and works equally
        // on desktop and mobile.
        const PICKER_W    = 224;   // must match CSS width (.t2-color-picker-container)
        const PICKER_H_EST = 320;  // estimated rendered height (used only for flip logic)

        const btnRect = button.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left = btnRect.left;
        let top  = btnRect.bottom + 8;

        // Clamp horizontally
        if (left + PICKER_W > vw - 8) left = vw - PICKER_W - 8;
        if (left < 8) left = 8;

        // Flip upward when there is not enough space below
        if (top + PICKER_H_EST > vh - 8) top = Math.max(8, btnRect.top - PICKER_H_EST - 8);

        // 2. Build DOM (CSS classes drive all visual styling)
        const pickerContainer = document.createElement('div');
        pickerContainer.className = 't2-color-picker-container';
        // Only position-related props are set inline; colours come from CSS/dark.css
        pickerContainer.style.cssText = `left:${left}px; top:${top}px;`;

        let currentHue        = 0;
        let currentSaturation = 100;
        let currentLightness  = 50;

        // Hue quick-select row
        const hueRow = document.createElement('div');
        hueRow.className = 't2-cp-hue-row';
        const HUE_COLORS = [
            { hue: 0,   color: '#ef4444' }, { hue: 30,  color: '#f97316' },
            { hue: 60,  color: '#eab308' }, { hue: 120, color: '#22c55e' },
            { hue: 200, color: '#3b82f6' }, { hue: 270, color: '#a855f7' },
            { hue: 330, color: '#ec4899' }, { hue: 240, color: '#6366f1' },
            { hue: 180, color: '#14b8a6' }, { hue: 190, color: '#06b6d4' }
        ];
        HUE_COLORS.forEach(({ hue, color }) => {
            const circle = document.createElement('div');
            circle.className = 't2-cp-hue-circle';
            circle.style.backgroundColor = color;
            circle.addEventListener('click', () => {
                currentHue = hue;
                drawCanvas();
                updateAll();
            });
            hueRow.appendChild(circle);
        });

        // Main area: canvas (hue/lightness) + vertical lightness fine-tune slider
        const mainArea = document.createElement('div');
        mainArea.className = 't2-cp-main';

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 't2-cp-canvas';

        const rainbowCanvas = document.createElement('canvas');
        rainbowCanvas.style.cssText = 'width:100%; height:100%; display:block;';
        canvasWrapper.appendChild(rainbowCanvas);

        const mainIndicator = document.createElement('div');
        mainIndicator.className = 't2-cp-indicator';
        mainIndicator.style.cssText = 'left:50%; top:50%;';
        canvasWrapper.appendChild(mainIndicator);

        // Vertical lightness slider
        const lSlider = document.createElement('div');
        lSlider.className = 't2-cp-l-slider';
        const lHandle = document.createElement('div');
        lHandle.className = 't2-cp-handle';
        lHandle.style.cssText = 'top:50%; left:50%;';
        lSlider.appendChild(lHandle);

        mainArea.appendChild(canvasWrapper);
        mainArea.appendChild(lSlider);

        // Horizontal saturation slider
        const sSlider = document.createElement('div');
        sSlider.className = 't2-cp-s-slider';
        const sHandle = document.createElement('div');
        sHandle.className = 't2-cp-handle';
        sHandle.style.cssText = 'top:50%; left:100%;';
        sSlider.appendChild(sHandle);

        // Preview row: colour swatch + hex input
        const previewArea = document.createElement('div');
        previewArea.className = 't2-cp-preview';
        const colorSwatch = document.createElement('div');
        colorSwatch.className = 't2-cp-swatch';
        colorSwatch.style.backgroundColor = '#ff0000';
        const hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.className = 't2-cp-hex-input';
        hexInput.value = '#ff0000';
        previewArea.appendChild(colorSwatch);
        previewArea.appendChild(hexInput);

        // Apply button
        const applyBtn = document.createElement('button');
        applyBtn.className = 't2-cp-apply';
        applyBtn.textContent = (typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t('common.apply') : '적용';
        applyBtn.className = 't2-cp-apply t2-color-apply-btn';  // [I18N] t2-color-apply-btn 추가 (언어 변경 시 자동 갱신용)
        applyBtn.setAttribute('data-i18n', 'common.apply');

        pickerContainer.appendChild(hueRow);
        pickerContainer.appendChild(mainArea);
        pickerContainer.appendChild(sSlider);
        pickerContainer.appendChild(previewArea);
        pickerContainer.appendChild(applyBtn);
        document.body.appendChild(pickerContainer);  // ← body, not toolbar

        // 3. Colour math helpers
        function hslToHex(h, s, l) {
            l /= 100;
            const a = s * Math.min(l, 1 - l) / 100;
            const f = n => {
                const k = (n + h / 30) % 12;
                const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                return Math.round(255 * c).toString(16).padStart(2, '0');
            };
            return `#${f(0)}${f(8)}${f(4)}`;
        }
        function hexToHsl(hex) {
            const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            if (!m) return { h: 0, s: 0, l: 0 };
            let r = parseInt(m[1], 16) / 255;
            let g = parseInt(m[2], 16) / 255;
            let b = parseInt(m[3], 16) / 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            let h, s, l = (max + min) / 2;
            if (max === min) { h = s = 0; }
            else {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                    case g: h = ((b - r) / d + 2) / 6; break;
                    case b: h = ((r - g) / d + 4) / 6; break;
                }
            }
            return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
        }

        // 4. Canvas draw & slider update
        function drawCanvas() {
            const rect = rainbowCanvas.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const dpr = window.devicePixelRatio || 1;
            rainbowCanvas.width  = Math.round(rect.width  * dpr);
            rainbowCanvas.height = Math.round(rect.height * dpr);
            const ctx = rainbowCanvas.getContext('2d');
            for (let x = 0; x < rainbowCanvas.width; x++) {
                ctx.fillStyle = `hsl(${(x / (rainbowCanvas.width - 1)) * 360}, 100%, 50%)`;
                ctx.fillRect(x, 0, 1, rainbowCanvas.height);
            }
            const g1 = ctx.createLinearGradient(0, 0, 0, rainbowCanvas.height / 2);
            g1.addColorStop(0, 'rgba(255,255,255,1)');
            g1.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g1;
            ctx.fillRect(0, 0, rainbowCanvas.width, rainbowCanvas.height / 2);
            const g2 = ctx.createLinearGradient(0, rainbowCanvas.height / 2, 0, rainbowCanvas.height);
            g2.addColorStop(0, 'rgba(0,0,0,0)');
            g2.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = g2;
            ctx.fillRect(0, rainbowCanvas.height / 2, rainbowCanvas.width, rainbowCanvas.height / 2);
        }

        function updateSSlider() {
            sSlider.style.background = `linear-gradient(to right,
                hsl(${currentHue},0%,${currentLightness}%),
                hsl(${currentHue},100%,${currentLightness}%))`;
            sHandle.style.left = `${currentSaturation}%`;
        }
        function updateLSlider() {
            lSlider.style.background = `linear-gradient(to bottom,
                hsl(${currentHue},${currentSaturation}%,100%),
                hsl(${currentHue},${currentSaturation}%,0%))`;
            lHandle.style.top = `${100 - currentLightness}%`;
        }
        function updateIndicator() {
            mainIndicator.style.left = `${(currentHue / 360) * 100}%`;
            mainIndicator.style.top  = `${100 - currentLightness}%`;
        }
        function updateAll() {
            const hex = hslToHex(currentHue, currentSaturation, currentLightness);
            colorSwatch.style.backgroundColor = hex;
            hexInput.value = hex;
            updateSSlider();
            updateLSlider();
            updateIndicator();
        }

        // 5. Unified pointer/mouse drag handling
        // Handles have pointer-events:none (CSS), so events fall through to the
        // slider element — no separate handle listeners needed.
        let dragging    = null;   // 'main' | 'sat' | 'light'
        let capturedId  = null;

        function relPos(e, el) {
            const r = el.getBoundingClientRect();
            return {
                x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                y: Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height))
            };
        }
        function applyMove(e) {
            if      (dragging === 'main')  { const p = relPos(e, rainbowCanvas); currentHue = Math.round(p.x * 360); currentLightness = Math.round((1 - p.y) * 100); }
            else if (dragging === 'sat')   { currentSaturation = Math.round(relPos(e, sSlider).x * 100); }
            else if (dragging === 'light') { currentLightness  = Math.round((1 - relPos(e, lSlider).y) * 100); }
            updateAll();
        }
        function startDrag(type, captureEl, e) {
            e.preventDefault();
            dragging = type;
            if (window.PointerEvent) {
                capturedId = e.pointerId;
                try { captureEl.setPointerCapture(e.pointerId); } catch (_) {}
            }
            applyMove(e);
        }
        const onMove = (e) => {
            if (!dragging) return;
            if (window.PointerEvent && e.pointerId !== capturedId) return;
            applyMove(e);
        };
        const onUp = (e) => {
            if (window.PointerEvent && e.pointerId !== capturedId) return;
            dragging = null; capturedId = null;
        };

        if (window.PointerEvent) {
            rainbowCanvas.addEventListener('pointerdown', (e) => startDrag('main',  rainbowCanvas, e));
            sSlider.addEventListener(      'pointerdown', (e) => startDrag('sat',   sSlider,       e));
            lSlider.addEventListener(      'pointerdown', (e) => startDrag('light', lSlider,       e));
            document.addEventListener('pointermove',   onMove);
            document.addEventListener('pointerup',     onUp);
            document.addEventListener('pointercancel', onUp);
        } else {
            rainbowCanvas.addEventListener('mousedown', (e) => startDrag('main',  rainbowCanvas, e));
            sSlider.addEventListener(      'mousedown', (e) => startDrag('sat',   sSlider,       e));
            lSlider.addEventListener(      'mousedown', (e) => startDrag('light', lSlider,       e));
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        }

        // 6. Hex input
        hexInput.addEventListener('input', () => {
            const v = hexInput.value.trim();
            if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                const hsl = hexToHsl(v);
                currentHue = hsl.h; currentSaturation = hsl.s; currentLightness = hsl.l;
                drawCanvas();
                updateAll();
            }
        });

        // 7. Apply
        applyBtn.addEventListener('click', () => {
            // Security: hexInput.value 를 execCommand 에 전달하기 전 형식 검증.
            // 비정상 값(e.g. 'expression(alert(1))')이 CSS color 값으로 주입되는 경로를 차단.
            const hexVal = hexInput.value.trim();
            if (!/^#[0-9A-Fa-f]{6}$/.test(hexVal)) {
                console.warn('[SEC] Invalid hex color rejected:', hexVal);
                return;
            }
            self.restoreSelection();
            self.execCommand(command, hexVal);
            closeModal();
            self.createUndoPoint();
        });

        // 8. Close & cleanup
        function closeModal() {
            pickerContainer.remove();
            document.removeEventListener('pointerdown',   outsideClose);
            document.removeEventListener('touchstart',    outsideClose, { passive: true });
            document.removeEventListener('mousedown',     outsideClose);
            document.removeEventListener('pointermove',   onMove);
            document.removeEventListener('pointerup',     onUp);
            document.removeEventListener('pointercancel', onUp);
            document.removeEventListener('mousemove',     onMove);
            document.removeEventListener('mouseup',       onUp);
            document.removeEventListener('keydown',       onEsc);
            window.removeEventListener('resize',          onResize);
            window.removeEventListener('scroll',          onScroll, true);
            dragging = null; capturedId = null;
        }
        const outsideClose = (e) => {
            if (!pickerContainer.contains(e.target) && e.target !== button) closeModal();
        };
        const onEsc = (e) => { if (e.key === 'Escape') closeModal(); };
        // On resize: redraw canvas and keep sliders correct
        const onResize = () => requestAnimationFrame(() => { drawCanvas(); updateAll(); });
        // On scroll: reposition picker to track the (sticky) toolbar button
        const onScroll = () => {
            const r = button.getBoundingClientRect();
            let l2 = r.left, t2 = r.bottom + 8;
            if (l2 + PICKER_W > vw - 8) l2 = vw - PICKER_W - 8;
            if (l2 < 8) l2 = 8;
            if (t2 + PICKER_H_EST > vh - 8) t2 = Math.max(8, r.top - PICKER_H_EST - 8);
            pickerContainer.style.left = l2 + 'px';
            pickerContainer.style.top  = t2 + 'px';
        };

        // Attach close listeners after current event has fully propagated
        requestAnimationFrame(() => {
            document.addEventListener('pointerdown',  outsideClose);
            document.addEventListener('touchstart',   outsideClose, { passive: true });
            document.addEventListener('mousedown',    outsideClose);
            document.addEventListener('keydown',      onEsc);
            window.addEventListener('resize',         onResize);
            window.addEventListener('scroll',         onScroll, true);
        });

        // 9. Initial render
        requestAnimationFrame(() => { drawCanvas(); updateAll(); });
    }

    toggleAlignment(button) {
        const alignments = ['left', 'center', 'right'];
        const icons = ['format_align_left', 'format_align_center', 'format_align_right'];
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        if (!this._isRangeInsideEditor(range)) return;

        const directBlock = (node) => {
            let current = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            while (current && current.parentElement !== this.editor) current = current.parentElement;
            return current && current.parentElement === this.editor ? current : null;
        };

        let blocks = [];
        if (range.collapsed) {
            const block = directBlock(range.startContainer);
            if (block && !this._isEditorBlockNode(block)) blocks = [block];
        } else {
            blocks = Array.from(this.editor.children).filter((child) => {
                if (this._isEditorBlockNode(child)) return false;
                try { return range.intersectsNode(child); } catch (_) { return false; }
            });
        }
        if (!blocks.length) return;

        const current = (blocks[0].style.textAlign || 'left').replace('start', 'left').replace('end', 'right');
        const currentIndex = Math.max(0, alignments.indexOf(current));
        const nextIndex = (currentIndex + 1) % alignments.length;
        const nextAlignment = alignments[nextIndex];

        blocks.forEach((block) => { block.style.textAlign = nextAlignment; });
        this.alignmentState = nextAlignment;
        const icon = button.querySelector('.material-icons');
        if (icon) icon.textContent = icons[nextIndex];

        this.normalizeContent();
        this.createUndoPoint();
    }

    showDropdown(element, button) {
        const buttonRect = button.getBoundingClientRect();
        const toolbarRect = this.toolbar.getBoundingClientRect();

        const dropdownContainer = document.createElement('div');
        dropdownContainer.style.cssText = `
            position: absolute;
            top: ${buttonRect.bottom - toolbarRect.top}px;
            left: ${buttonRect.left - toolbarRect.left}px;
            z-index: 10000;
        `;

        dropdownContainer.appendChild(element);
        this.toolbar.appendChild(dropdownContainer);

        const dropdownRect = element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;

        if (dropdownRect.right > viewportWidth) {
            const overflow = dropdownRect.right - viewportWidth;
            dropdownContainer.style.left = `${parseInt(dropdownContainer.style.left) - overflow - 10}px`;
        }

        const closeHandler = (e) => {
            if (!element.contains(e.target) && e.target !== button) {
                dropdownContainer.remove();
                document.removeEventListener('mousedown', closeHandler);
            }
        };

        requestAnimationFrame(() => {
            document.addEventListener('mousedown', closeHandler);
        });
    }

    insertAtCursor(element) {
        if (!element) return false;
        const wrapper = document.createElement('div');
        wrapper.appendChild(element);
        const inserted = this.insertBlockWithBoundaryLines(wrapper, this._lastEditorBookmark);
        if (inserted) this.createUndoPoint();
        return inserted;
    }

    // 콘텐츠 마이그레이션

    /**
     * 타 에디터로 작성된 콘텐츠인지 감지.
     * 반환: true = 외부 에디터 콘텐츠, false = T2Editor 네이티브 or 단순 텍스트
     */
    detectForeignContent(html) {
        if (!html || !html.trim()) return false;

        const temp = document.createElement('div');
        temp.innerHTML = html;

        // T2Editor 네이티브 클래스가 있으면 자체 콘텐츠
        if (temp.querySelector('[class*="t2-"]')) return false;

        // 알려진 타 에디터 시그니처
        const foreignSelectors = [
            '[class*="ql-"]',          // Quill
            '[class*="mce-"]',         // TinyMCE
            '[data-mce-src]',
            '[data-mce-href]',
            '[class*="ck-"]',          // CKEditor 5
            '[data-cke-saved-src]',    // CKEditor 4
            '[data-cke-saved-href]',
            '[class*="fr-"]',          // Froala
            '[class*="note-"]',        // Summernote
            '[class*="ProseMirror"]',  // ProseMirror 기반
            '[class*="trix-"]',        // Trix
        ];
        for (const sel of foreignSelectors) {
            if (temp.querySelector(sel)) return true;
        }

        // 리치 미디어/구조 요소가 있으면 외부 에디터로 간주
        const richTags = ['img', 'iframe', 'table', 'pre', 'figure', 'blockquote',
                          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol'];
        for (const tag of richTags) {
            if (temp.querySelector(tag)) return true;
        }

        // 인라인 스타일이 과도하게 붙어 있는 경우 (복붙 등)
        const styledEls = temp.querySelectorAll('[style]');
        if (styledEls.length >= 3) return true;

        return false;
    }

    /**
     * 외부 에디터 HTML → T2Editor 전용 구조로 변환.
     */
    migrateContent(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // 1. 알려진 외부 에디터 클래스/속성 제거 + 이벤트 핸들러/script 일괄 제거
        const foreignAttrPatterns = [
            'data-mce-src', 'data-mce-href', 'data-mce-style',
            'data-cke-saved-src', 'data-cke-saved-href',
        ];

        // Security: <script> 요소 선제 제거 — innerHTML 파싱 직후 즉시 처리.
        // 이후 단계(blockquote → p, div → p)에서 innerHTML을 복사하기 전에
        // 위험 요소를 완전히 제거하여 이벤트 핸들러 실행 경로를 차단함.
        Array.from(temp.querySelectorAll('script, style')).forEach(el => el.remove());

        temp.querySelectorAll('*').forEach(el => {
            foreignAttrPatterns.forEach(attr => el.removeAttribute(attr));

            if (el.className && typeof el.className === 'string') {
                const isForeign = /\b(ql-|mce-|ck-|fr-|note-|ProseMirror|trix-)/.test(el.className);
                if (isForeign) el.removeAttribute('class');
            }

            // Security: 인라인 이벤트 핸들러 일괄 제거 (on* 속성).
            // cloneNode / innerHTML 복사 시 이벤트 핸들러가 전파되는 것을 방지.
            // 배열 스냅샷 사용: 순회 중 속성 제거 시 NamedNodeMap 인덱스 이동 방지.
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
            });
        });

        // 2. figure/figcaption 언랩 (자식 노드를 부모로 올림, figcaption 제거)
        temp.querySelectorAll('figcaption').forEach(fc => fc.remove());
        temp.querySelectorAll('figure').forEach(figure => {
            const frag = document.createDocumentFragment();
            while (figure.firstChild) frag.appendChild(figure.firstChild);
            figure.parentNode.replaceChild(frag, figure);
        });

        // 3. blockquote → 스타일 적용된 p
        temp.querySelectorAll('blockquote').forEach(bq => {
            const p = document.createElement('p');
            p.style.cssText = 'border-left:3px solid #ccc; padding-left:14px; color:#555; margin:8px 0;';
            p.innerHTML = bq.innerHTML;
            bq.parentNode.replaceChild(p, bq);
        });

        // 4. img → t2-media-block
        // 깊은 복사 순회이므로 querySelectorAll 스냅샷 사용
        Array.from(temp.querySelectorAll('img')).forEach(img => {
            if (img.closest('.t2-media-block')) return;
            const block = this._migration_createImageBlock(img);
            img.parentNode.replaceChild(block, img);
        });

        // 5. iframe → t2-media-block
        Array.from(temp.querySelectorAll('iframe')).forEach(iframe => {
            if (iframe.closest('.t2-media-block')) return;
            const block = this._migration_createIframeBlock(iframe);
            iframe.parentNode.replaceChild(block, iframe);
        });

        // 6. pre → t2-code-block
        Array.from(temp.querySelectorAll('pre')).forEach(pre => {
            if (pre.closest('.t2-code-block')) return;
            const block = this._migration_createCodeBlock(pre);
            pre.parentNode.replaceChild(block, pre);
        });

        // 7. table → t2-table-wrapper
        Array.from(temp.querySelectorAll('table')).forEach(table => {
            if (table.closest('.t2-table-wrapper')) return;
            const block = this._migration_createTableBlock(table);
            table.parentNode.replaceChild(block, table);
        });

        // 8. h1-h6 유지 (T2Editor는 block으로 취급), div → p 변환
        Array.from(temp.querySelectorAll('div')).forEach(div => {
            if (div.querySelector('.t2-media-block, .t2-code-block, .t2-table-wrapper, .t2-file-block')) return;
            const p = document.createElement('p');
            p.innerHTML = div.innerHTML;
            // 인라인 스타일 중 text-align만 유지
            const align = div.style.textAlign;
            if (align) p.style.textAlign = align;
            div.parentNode.replaceChild(p, div);
        });

        // 9. 최상위 텍스트 노드 → p 래핑
        Array.from(temp.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                const p = document.createElement('p');
                node.parentNode.insertBefore(p, node);
                p.appendChild(node);
            }
        });

        console.log('T2Editor: 마이그레이션 완료');
        return temp.innerHTML;
    }

    _migration_createImageBlock(img) {
        const block = document.createElement('div');
        block.className = 't2-media-block';
        block.contentEditable = false;

        const inner = document.createElement('div');
        // Security: preserve image dimensions only after clamping them to 1..10000; never copy raw style values.
        const parseImgDim = (attrVal, styleVal, fallback) => {
            const raw = (attrVal || '').toString().trim() || (styleVal || '').toString().trim();
            if (!raw) return 0;
            // 'px', '%', 숫자만 추출
            const m = String(raw).match(/^(\d+)/);
            if (!m) return 0;
            const n = parseInt(m[1], 10);
            if (!Number.isFinite(n) || n < 1) return 0;
            return Math.min(10000, n);
        };
        const w = parseImgDim(img.getAttribute('width'), img.style.width, 320);
        const h = parseImgDim(img.getAttribute('height'), img.style.height, 180);
        let styleStr = 'display:inline-block; max-width:100%; position:relative; box-sizing:border-box; overflow:hidden;';
        if (w > 0) styleStr += ` width:${w}px;`;
        if (h > 0) styleStr += ` height:${h}px;`;
        inner.style.cssText = styleStr;

        const newImg = img.cloneNode(true);
        newImg.style.maxWidth = '100%';
        newImg.style.width = '100%';
        newImg.style.height = 'auto';
        newImg.style.display = 'block';
        newImg.style.boxSizing = 'border-box';
        // [OVERFLOW-FIX] 모바일 터치 차단 속성 추가 (createImageBlock 과 일관성)
        newImg.style.webkitUserDrag = 'none';
        newImg.style.webkitTouchCallout = 'none';
        newImg.setAttribute('draggable', 'false');
        // 불필요한 width/height 어트리뷰트 제거 (style로 대체)
        newImg.removeAttribute('width');
        newImg.removeAttribute('height');

        // Security: cloneNode(true)는 원본의 모든 어트리뷰트를 복사함.
        // 위험 프로토콜(javascript:, vbscript:, data:) src 및
        // 인라인 이벤트 핸들러(onload, onerror 등) 제거.
        const imgSrc = newImg.getAttribute('src') || '';
        const normalizedImgSrc = imgSrc.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript|data):/i.test(normalizedImgSrc)) {
            newImg.removeAttribute('src');
        }
        Array.from(newImg.attributes).forEach(attr => {
            if (/^on/i.test(attr.name)) newImg.removeAttribute(attr.name);
        });

        inner.appendChild(newImg);
        block.appendChild(inner);
        return block;
    }

    _migration_createIframeBlock(iframe) {
        const block = document.createElement('div');
        block.className = 't2-media-block';
        block.contentEditable = false;

        const inner = document.createElement('div');
        const w = iframe.getAttribute('width') || '560';
        const h = iframe.getAttribute('height') || '315';
        inner.style.cssText = `display:inline-block; width:${isNaN(w) ? w : w + 'px'}; height:${isNaN(h) ? h : h + 'px'};`;

        const newIframe = iframe.cloneNode(true);
        newIframe.style.width = '100%';
        newIframe.style.height = '100%';
        newIframe.setAttribute('allowfullscreen', '');

        // Security: cloneNode(true)는 원본의 모든 어트리뷰트를 복사함.
        // 위험 프로토콜(javascript:, vbscript:, data:) src 및
        // 인라인 이벤트 핸들러(onload, onerror 등) 제거.
        const iframeSrc = newIframe.getAttribute('src') || '';
        const normalizedIframeSrc = iframeSrc.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript|data):/i.test(normalizedIframeSrc)) {
            newIframe.removeAttribute('src');
        }
        Array.from(newIframe.attributes).forEach(attr => {
            if (/^on/i.test(attr.name)) newIframe.removeAttribute(attr.name);
        });

        // Security: 허용되지 않는 도메인의 iframe 차단.
        // 마이그레이션 과정에서 타 에디터의 임의 iframe 이 삽입되는 경우를 방지.
        const finalSrc = newIframe.getAttribute('src') || '';
        if (!T2Editor._isAllowedIframeSrc(finalSrc)) {
            // 비허용 iframe → 플레이스홀더 텍스트 단락으로 대체
            const placeholder = document.createElement('p');
            // Security: finalSrc 를 textContent 로 삽입 (innerHTML 아님)
            // I18N: 외부 미디어 제거 라벨 다국어 처리
            const _t = (typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t : (k => k);
            const _unknownLabel = (_t('editor.media_removed_unknown') === 'editor.media_removed_unknown') ? '출처 불명' : _t('editor.media_removed_unknown');
            const _template = (_t('editor.media_removed_label') === 'editor.media_removed_label')
                ? '[외부 미디어 제거됨: {src}]'
                : _t('editor.media_removed_label');
            placeholder.textContent = _template.replace('{src}', finalSrc || _unknownLabel);
            return placeholder;
        }

        // Security: 허용된 iframe 에 sandbox 속성 적용
        // srcdoc 속성 제거 (임의 HTML 인젝션 벡터)
        newIframe.removeAttribute('srcdoc');
        T2Editor._applyIframeSandbox(newIframe, finalSrc);

        inner.appendChild(newIframe);
        block.appendChild(inner);
        return block;
    }

    _migration_createCodeBlock(pre) {
        const codeEl = pre.querySelector('code');
        const content = codeEl ? codeEl.textContent : pre.textContent;
        const langMatch = codeEl?.className?.match(/language-(\w+)/);
        const lang = langMatch ? langMatch[1] : 'text';

        const block = document.createElement('div');
        block.className = 't2-code-block';
        block.contentEditable = false;
        block.setAttribute('data-language', lang);

        const header = document.createElement('div');
        header.className = 't2-code-header';
        header.innerHTML = `<span class="t2-code-language">${lang}</span>`;

        const newPre = document.createElement('pre');
        const newCode = document.createElement('code');
        if (lang !== 'text') newCode.className = `language-${lang}`;
        newCode.textContent = content;
        newPre.appendChild(newCode);

        block.appendChild(header);
        block.appendChild(newPre);
        return block;
    }

    _migration_createTableBlock(table) {
        const wrapper = document.createElement('div');
        wrapper.className = 't2-table-wrapper';
        wrapper.contentEditable = false;

        const newTable = table.cloneNode(true);
        if (!newTable.classList.contains('t2-table')) newTable.classList.add('t2-table');

        const isLarge = newTable.rows.length > 10 ||
                        (newTable.rows[0] && newTable.rows[0].cells.length > 10);

        if (isLarge) {
            newTable.classList.add('t2-table-large');
            const scrollWrapper = document.createElement('div');
            scrollWrapper.className = 't2-table-scroll-wrapper';
            scrollWrapper.appendChild(newTable);
            wrapper.appendChild(scrollWrapper);
        } else {
            wrapper.appendChild(newTable);
        }

        return wrapper;
    }

    /**
     * 마이그레이션 확인 팝업 표시.
     * 확인 시 migratedHtml로 에디터 재설정.
     */
    showMigrationPrompt(originalHtml) {
        const self = this;

        // 다크모드 감지
        const isDark = document.documentElement.getAttribute('data-t2editor-theme') === 'dark';

        const overlay = document.createElement('div');
        overlay.className = 't2-migration-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.45);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: t2FadeIn 0.15s ease;
        `;

        const dialog = document.createElement('div');
        dialog.className = 't2-migration-dialog';
        dialog.style.cssText = `
            background: ${isDark ? '#1e1e2e' : '#ffffff'};
            color: ${isDark ? '#cdd6f4' : '#1f2937'};
            border-radius: 14px;
            padding: 28px 32px 24px;
            max-width: 400px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.25);
            border: 1px solid ${isDark ? '#313244' : '#e5e7eb'};
            text-align: center;
            animation: t2SlideUp 0.2s ease;
        `;

        dialog.innerHTML = `
            <style>
                @keyframes t2FadeIn { from { opacity:0 } to { opacity:1 } }
                @keyframes t2SlideUp { from { transform:translateY(12px); opacity:0 } to { transform:translateY(0); opacity:1 } }
                .t2-mig-icon { font-size:40px; margin-bottom:12px; }
                .t2-mig-title { font-size:17px; font-weight:700; margin-bottom:8px; }
                .t2-mig-desc { font-size:13px; line-height:1.6; opacity:0.75; margin-bottom:22px; }
                .t2-mig-actions { display:flex; gap:10px; justify-content:center; }
                .t2-mig-btn {
                    padding: 9px 22px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    border: none;
                    transition: opacity 0.15s, transform 0.1s;
                }
                .t2-mig-btn:hover { opacity:0.85; transform:translateY(-1px); }
                .t2-mig-btn:active { transform:translateY(0); }
                .t2-mig-btn-cancel {
                    background: ${isDark ? '#313244' : '#f3f4f6'};
                    color: ${isDark ? '#cdd6f4' : '#374151'};
                }
                .t2-mig-btn-confirm {
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: #fff;
                }
            </style>
            <div class="t2-mig-icon">
                <span class="material-icons" style="font-size:40px; color:#667eea; vertical-align:middle;">transform</span>
            </div>
            <div class="t2-mig-title" data-i18n="editor.migration_title">${(typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t('editor.migration_title') : 'Content Migration'}</div>
            <div class="t2-mig-desc t2-mig-body" data-i18n-html="editor.migration_body">
                ${(typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t('editor.migration_body') : 'Content created by another editor was detected.<br>Convert to T2Editor format?'}
            </div>
            <div class="t2-mig-actions">
                <button class="t2-mig-btn t2-mig-btn-cancel" data-i18n="editor.migration_btn_cancel">${(typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t('editor.migration_btn_cancel') : 'Cancel'}</button>
                <button class="t2-mig-btn t2-mig-btn-confirm" data-i18n="editor.migration_btn_confirm">${(typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t('editor.migration_btn_confirm') : 'Convert'}</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // ESC 닫기
        const escHandler = (e) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', escHandler);

        // 오버레이 외부 클릭 닫기
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        function close() {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }

        dialog.querySelector('.t2-mig-btn-cancel').addEventListener('click', close);

        dialog.querySelector('.t2-mig-btn-confirm').addEventListener('click', () => {
            close();
            const migratedHtml = self.migrateContent(originalHtml);
            self._doSetContent(migratedHtml);
            self.createUndoPoint();
            T2Utils.showNotification((typeof T2I18N !== 'undefined' && T2I18N.t) ? T2I18N.t('editor.migration_done') : 'Content has been converted to T2Editor format.', 'success', 2500);
        });
    }

    // setContent: 마이그레이션 게이트웨이

    setContent(html) {
        html = html === null || html === undefined ? '' : String(html);

        if (html.trim() === '') {
            this.contentSetQueue = null;
            this.resetEditor();
            this.normalizeContent();
            this.updateCharCount();
            this._resetHistoryBaseline();
            return;
        }

        if (this.migrationMode !== false && this.detectForeignContent(html)) {
            if (this.migrationMode === 'auto') {
                console.log('T2Editor: 자동 마이그레이션 실행');
                this._doSetContent(this.migrateContent(html));
            } else {
                this._doSetContent(html);
                setTimeout(() => this.showMigrationPrompt(html), 150);
            }
        } else {
            this._doSetContent(html);
        }
    }

    /**
     * 실제 에디터 콘텐츠 설정 (구 setContent 로직)
     */
    _doSetContent(html) {
        const safeHtml = this._sanitizeStoredContent(String(html || ''));
        if (!safeHtml || !safeHtml.trim()) {
            this.contentSetQueue = null;
            this.resetEditor();
            this.normalizeContent();
            this.updateCharCount();
            this._resetHistoryBaseline();
            return;
        }

        this.editor.innerHTML = safeHtml;
        this._resetHistoryBaseline();
        if (this._areConfiguredEssentialPluginsSettled()) {
            this.processContentSet(safeHtml);
        } else {
            console.log('Configured essential plugins are not settled, queuing content initialization');
            this.contentSetQueue = safeHtml;
            setTimeout(() => {
                if (!this.contentSetQueue) return;
                const queued = this.contentSetQueue;
                this.contentSetQueue = null;
                console.warn('Timeout: Processing content with available plugins');
                this.processContentSet(queued);
            }, 3000);
        }
        this.updateCharCount();
    }

    processContentSet(html) {
        console.log('Processing content set with plugins');

        for (let [name, plugin] of this.plugins) {
            if (plugin.onContentSet) {
                try {
                    plugin.onContentSet(html);
                } catch (error) {
                    console.error(`Plugin ${name} onContentSet failed:`, error);
                }
            }
        }

        this.normalizeContent();

        this._reinitializePluginBlocks();
    }

     /**
      * Reattach plugin controls after any full innerHTML replacement (restore, undo or redo).
      * Discover initialize<Something>Blocks methods dynamically so new plugins do not require core edits.
      * Keep initializeTables as the legacy alias; do not call onContentSet for internal history restores.
      */
    _reinitializePluginBlocks() {
        setTimeout(() => {
            for (let [name, plugin] of this.plugins) {
                const methodNames = this._getInitializeBlocksMethodNames(plugin);

                if (methodNames.length > 0) {
                    for (const methodName of methodNames) {
                        try {
                            plugin[methodName]();
                        } catch (err) {
                            console.error(`[T2Editor] ${name}.${methodName}() 재초기화 실패:`, err);
                        }
                    }
                } else if (typeof plugin.initializeTables === 'function') {
                    // [LEGACY] "initialize<X>Blocks" 규칙 이전의 예외적 구 별칭.
                    try {
                        plugin.initializeTables();
                    } catch (err) {
                        console.error(`[T2Editor] ${name}.initializeTables() 재초기화 실패:`, err);
                    }
                }
            }
        }, 100);
    }

     /** Find initialize<Something>Blocks methods on the instance and prototype chain, including non-enumerable class methods. */
    _getInitializeBlocksMethodNames(plugin) {
        const names = new Set();
        const pattern = /^initialize[A-Z]\w*Blocks$/;

        let obj = plugin;
        while (obj && obj !== Object.prototype) {
            for (const key of Object.getOwnPropertyNames(obj)) {
                if (pattern.test(key) && typeof plugin[key] === 'function') {
                    names.add(key);
                }
            }
            obj = Object.getPrototypeOf(obj);
        }

        return Array.from(names);
    }


    registerPlugin(name, plugin) {
        this.plugins.set(name, plugin);

        if (name === 'collab') {
            this.collab = plugin;
        }
    }

    getPlugin(name) {
        return this.plugins.get(name);
    }

    generateUid() {
        // Math.random() + timestamp 조합은 동일 밀리초 내에
        // 복수 에디터가 초기화될 때 충돌 가능 (e.g. 페이지 내 다중 에디터).
        // crypto.randomUUID()는 RFC 4122 v4 UUID를 암호학적으로 안전하게 생성.
        // 구형 브라우저(iOS 14 이하 등) 폴백으로 기존 방식 유지.
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID().replace(/-/g, '');
        }
        const random = Math.floor(Math.random() * 1000000000);
        const timestamp = new Date().getTime();
        return `${random}${timestamp}`;
    }

    sanitizeHTML(html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // Security: iframe 은 의도적으로 allowedTags 에서 제외한다.
        // paste 경로로 삽입된 임의 iframe 은 항상 textContent 로 변환.
        // video 플러그인이 정식으로 iframe 을 생성할 때는 이 함수를 거치지 않고
        // createVideoBlock() → _applyIframeSandbox() 경로를 사용한다.
        const allowedTags = ['b', 'i', 'u', 's', 'strong', 'em', 'br', 'p', 'div', 'span', 'a', 'img', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
        // Security: 'style' 속성 제거: CSS expression()/data-URI 기반 인젝션 차단
        const allowedAttributes = ['href', 'src', 'alt', 'title'];

        // Security: href/src에서 위험 프로토콜 차단
        // 공백·제어문자 제거 후 소문자로 비교하여 인코딩 우회 방지
        const isSafeUrl = (value) => {
            const normalized = value.replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
            return !/^(javascript|vbscript|data):/i.test(normalized);
        };

        const cleanNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return node;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                const tagName = node.tagName.toLowerCase();

                if (!allowedTags.includes(tagName)) {
                    return document.createTextNode(node.textContent);
                }

                const attributes = Array.from(node.attributes);
                attributes.forEach(attr => {
                    if (!allowedAttributes.includes(attr.name)) {
                        node.removeAttribute(attr.name);
                    } else if ((attr.name === 'href' || attr.name === 'src') && !isSafeUrl(attr.value)) {
                        // Security: javascript:, vbscript:, data: URL 제거
                        node.removeAttribute(attr.name);
                    }
                });

                const childNodes = Array.from(node.childNodes);
                childNodes.forEach(child => {
                    const cleaned = cleanNode(child);
                    if (cleaned !== child) {
                        node.replaceChild(cleaned, child);
                    }
                });
            }

            return node;
        };

        const nodes = Array.from(tempDiv.childNodes);
        nodes.forEach((node, index) => {
            const cleaned = cleanNode(node);
            if (cleaned !== node) {
                tempDiv.replaceChild(cleaned, node);
            }
        });

        return tempDiv.innerHTML;
    }

    handleBulletPoints() {
        // 추후 구현
    }

    // Security boundary for plugin HTML writes.
    // Plugins should use setPluginHTML() or sanitizePluginHTML() instead of assigning untrusted innerHTML.
    // Profiles remove executable tags/handlers, validate URLs and iframe origins, enforce sandboxing,
    // and constrain data-* attributes. Keep direct DOM construction for trusted textContent/attribute paths.

     /** Return the minimal HTML capability profile for a plugin. */
    static _getPluginProfile(pluginName) {
        // 공통 data-* 속성 (모든 블록 타입이 사용)
        const COMMON = ['data-t2-block', 'data-block-id', 'data-events-setup'];

        const PROFILES = {
            // 비디오 플러그인
            // iframe 허용, allowlist 필수, img/audio/table 불허
            video: {
                allowIframe:            true,
                iframeRequireAllowlist: true,
                allowImg:               false,
                allowAudio:             false,
                allowPreCode:           false,
                allowTable:             false,
                allowDownloadLink:      false,
                allowedDataAttrs: [
                    ...COMMON,
                    'data-video-type', 'data-video-url', 'data-video-id',
                ],
            },

            // 이미지 플러그인
            // img 허용, iframe 불허
            image: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               true,
                allowAudio:             false,
                allowPreCode:           false,
                allowTable:             false,
                allowDownloadLink:      false,
                allowedDataAttrs:       COMMON,
            },

            // 파일 플러그인
            // img(아이콘), audio(미리듣기), download 링크 허용
            file: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               true,
                allowAudio:             true,
                allowPreCode:           false,
                allowTable:             false,
                allowDownloadLink:      true,
                allowedDataAttrs: [
                    ...COMMON,
                    'data-file-type', 'data-file-name', 'data-file-size',
                    'data-file-url',  'data-mime',
                ],
            },

            // 코드 플러그인
            // pre/code 허용, iframe/img/audio 불허
            code: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               false,
                allowAudio:             false,
                allowPreCode:           true,
                allowTable:             false,
                allowDownloadLink:      false,
                allowedDataAttrs: [
                    ...COMMON,
                    'data-language',
                ],
            },

            // 테이블 플러그인
            // table 구조 + 셀 내 img 허용
            table: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               true,
                allowAudio:             false,
                allowPreCode:           false,
                allowTable:             true,
                allowDownloadLink:      false,
                allowedDataAttrs:       COMMON,
            },

            // 드로우 플러그인
            // img (canvas export) 허용
            draw: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               true,
                allowAudio:             false,
                allowPreCode:           false,
                allowTable:             false,
                allowDownloadLink:      false,
                allowedDataAttrs:       COMMON,
            },

            // 링크 플러그인
            link: {
                allowIframe:            false,
                iframeRequireAllowlist: false,
                allowImg:               false,
                allowAudio:             false,
                allowPreCode:           false,
                allowTable:             false,
                allowDownloadLink:      false,
                allowedDataAttrs:       [],
            },

            // AI / AI-rearrange / export / search / collab / clipurl
            // 이 플러그인들은 직접 블록 HTML 을 쓰지 않거나,
            // 최종 패치 세션에서 개별 분석 후 프로필을 구체화한다.
            // 그 전까지 안전 기본값(img 허용, iframe 불허) 적용.
        };

        // 등록되지 않은 플러그인 → 최소 허용 프로필 (안전 기본값)
        return PROFILES[pluginName] || {
            allowIframe:            false,
            iframeRequireAllowlist: true,
            allowImg:               true,
            allowAudio:             false,
            allowPreCode:           false,
            allowTable:             false,
            allowDownloadLink:      false,
            allowedDataAttrs:       COMMON,
        };
    }

     /**
      * Sanitize plugin HTML: remove executable nodes/handlers/srcdoc, validate URLs and iframes,
      * enforce sandboxing and profile-specific element/data-attribute allowlists.
      * @returns {string} Sanitized HTML.
      */
    sanitizePluginHTML(html, pluginName) {
        if (!html) return '';

        const profile = T2Editor._getPluginProfile(pluginName);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // 1. 즉시 실행 가능 태그 제거
        tempDiv.querySelectorAll('script,object,embed,base,meta,link[rel="import"]')
               .forEach(el => el.remove());

        // 2-8. 전체 요소 순회
        // querySelectorAll 은 정적 NodeList → 순회 중 remove() 안전
        tempDiv.querySelectorAll('*').forEach(el => {
            const tag = el.tagName.toLowerCase();

            // (2) on* 이벤트 핸들러 무조건 제거
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
            });

            // (3) srcdoc 제거
            if (el.hasAttribute('srcdoc')) el.removeAttribute('srcdoc');

            // (4) href 검증
            if (el.hasAttribute('href')) {
                const safe = T2Utils.sanitizeURL(el.getAttribute('href'), 'href');
                if (!safe) el.removeAttribute('href');
            }

            // (5) src 검증 (data: URI 는 img/audio 허용 — context='src')
            if (el.hasAttribute('src')) {
                const safe = T2Utils.sanitizeURL(el.getAttribute('src'), 'src');
                if (!safe) el.removeAttribute('src');
            }

            // (6) iframe 처리
            if (tag === 'iframe') {
                if (!profile.allowIframe) { el.remove(); return; }
                const src = el.getAttribute('src') || '';
                if (profile.iframeRequireAllowlist && !T2Editor._isAllowedIframeSrc(src)) {
                    el.remove(); return;
                }
                // sandbox 강제 재적용 (기존 속성 덮어쓰기)
                el.removeAttribute('sandbox');
                T2Editor._applyIframeSandbox(el, src);
                return; // iframe 은 이후 data-* 검사 불필요
            }

            // (7a) audio — 프로필 불허
            if (tag === 'audio' && !profile.allowAudio) { el.remove(); return; }

            // (7b) img — 프로필 불허
            if (tag === 'img' && !profile.allowImg) { el.remove(); return; }

            // (7c) pre/code — code 플러그인 전용
            if ((tag === 'pre' || tag === 'code') && !profile.allowPreCode) {
                const text = document.createTextNode(el.textContent);
                if (el.parentNode) el.parentNode.replaceChild(text, el);
                return;
            }

            // (7d) table 구조 — table 플러그인 전용
            if (['table','thead','tbody','tr','th','td','colgroup','col'].includes(tag) &&
                !profile.allowTable) {
                el.remove(); return;
            }

            // (8) 허용된 data-* 속성만 유지 (화이트리스트)
            const allowedData = profile.allowedDataAttrs || [];
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.startsWith('data-') && !allowedData.includes(attr.name)) {
                    el.removeAttribute(attr.name);
                }
            });
        });

        return tempDiv.innerHTML;
    }

     /** Sanitize and assign plugin HTML, then add optional development audit metadata. */
    setPluginHTML(target, html, opts) {
        opts = opts || {};

        if (!target || !(target instanceof Element)) {
            console.error('[T2Editor][SEC] setPluginHTML: target is not valid.', target);
            return;
        }

        const pluginName = opts.plugin     || 'unknown';
        const label      = opts.debugLabel || pluginName;

        // 1. 새니타이즈
        const safeHtml = this.sanitizePluginHTML(html, pluginName);

        // 2. 블록 마커 경고
        const hasBlockClass =
            target.classList.contains('t2-media-block')   ||
            target.classList.contains('t2-code-block')    ||
            target.classList.contains('t2-table-wrapper') ||
            target.classList.contains('t2-file-block');
        if (!hasBlockClass) {
            console.warn(
                `[T2Editor][SEC] setPluginHTML: target has no block class ` +
                `(plugin: ${label}). Please add t2-media-block etc. first.`
            );
        }

        // 3. DOM 반영
        target.innerHTML = safeHtml;

        // 4. 개발 모드 감사 마커
        // window.__T2EDITOR_DEV__ = true; 로 활성화 (배포 환경에서는 미정의)
        if (typeof window.__T2EDITOR_DEV__ !== 'undefined' && window.__T2EDITOR_DEV__) {
            target.setAttribute('data-t2-writer',   label);
            target.setAttribute('data-t2-write-ts', String(Date.now()));
        }
    }

    showButtonLoading(button) {
        if (!button || button.querySelector('.t2-btn-loading-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 't2-btn-loading-overlay';

        const spinner = document.createElement('div');
        spinner.className = 't2-btn-loading-spinner';

        overlay.appendChild(spinner);
        button.appendChild(overlay);
        button.disabled = true;
    }

    hideButtonLoading(button) {
        if (!button) return;

        const overlay = button.querySelector('.t2-btn-loading-overlay');
        if (overlay) {
            overlay.remove();
        }
        button.disabled = false;
    }

    // Security: iframe origins come from the PHP allowlist plus the current host.
    // All accepted iframes must receive the appropriate same-origin or cross-origin sandbox.

    /**
     * 허용 iframe 도메인 Set 반환 (한 페이지에서 1회만 계산, 이후 캐시).
     * @returns {Set<string>}
     */
    static _iframeAllowedDomains() {
        if (T2Editor._iframeDomainsCache) return T2Editor._iframeDomainsCache;

        const configured = Array.isArray(window.T2EDITOR_ALLOWED_IFRAME_DOMAINS)
            ? window.T2EDITOR_ALLOWED_IFRAME_DOMAINS.map(d => String(d).toLowerCase().trim()).filter(Boolean)
            : [];

        // 현재 서버 호스트는 항상 허용 (video_view.php 등 same-origin 콘텐츠)
        const serverHost = (typeof location !== 'undefined' ? location.hostname : '').toLowerCase();

        T2Editor._iframeDomainsCache = new Set([...configured, serverHost].filter(Boolean));
        return T2Editor._iframeDomainsCache;
    }

     /** Accept safe relative URLs or exact/subdomain matches in the iframe allowlist; reject script/data protocols. */
    static _isAllowedIframeSrc(src) {
        if (!src || String(src).trim() === '') return false;

        // 위험 프로토콜 선제 차단 (공백·제어문자 제거 후 소문자 비교)
        const normalized = String(src).replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
        if (/^(javascript|vbscript|data):/i.test(normalized)) return false;

        // 절대 URL / 프로토콜 상대 URL 여부 확인
        const isAbsolute = /^(https?:)?\/\//i.test(src);
        if (!isAbsolute) return true; // 상대 경로 → same-origin → 허용

        // 도메인 추출 및 허용 목록 대조
        try {
            const url = new URL(src.startsWith('//') ? 'https:' + src : src);
            const host = url.hostname.toLowerCase();
            if (!host) return false;

            const allowed = T2Editor._iframeAllowedDomains();
            if (allowed.has(host)) return true;

            // 서브도메인 매칭: host 가 허용 도메인의 서브도메인인 경우
            for (const domain of allowed) {
                if (domain && host.endsWith('.' + domain)) return true;
            }
            return false;
        } catch {
            return false;
        }
    }

     /**
      * Apply restrictive sandbox tokens. Same-origin viewers may use forms; cross-origin media may use
      * popups/presentation but never top-navigation. Preserve an existing explicit sandbox.
      */
    static _applyIframeSandbox(iframe, src) {
        if (iframe.hasAttribute('sandbox')) return; // 이미 설정됨 → 유지

        let isSameOrigin = false;
        try {
            if (!src || !/^(https?:)?\/\//i.test(src)) {
                isSameOrigin = true; // 상대 경로 = same-origin
            } else {
                const url = new URL(src.startsWith('//') ? 'https:' + src : src);
                isSameOrigin = url.hostname.toLowerCase() ===
                               (typeof location !== 'undefined' ? location.hostname.toLowerCase() : '');
            }
        } catch { /* URL 파싱 실패 → cross-origin 으로 취급 */ }

        if (isSameOrigin) {
            iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
        } else {
            iframe.setAttribute('sandbox',
                'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation');
        }
    }

    // Security: stored-content sanitization preserves T2 block structure but removes executable tags,
    // event handlers, dangerous URLs/srcdoc and unapproved iframes. Paste sanitization remains stricter.
    _sanitizeStoredContent(html) {
        if (!html) return html;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // 1. 즉시 실행 가능한 태그 제거
        tempDiv.querySelectorAll('script, object, embed').forEach(el => el.remove());

        // Preserve video recovery data-* fields and the sanitized source anchor; video restore depends on them.
        const isSafeUrl = (v) => {
            const n = String(v).replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
            // Security: href 의 data: 프로토콜 차단 추가.
            // data:text/html,<script>... 형태로 클릭 시 스크립트 실행 가능(Chrome 등).
            // src 는 img/video 의 data: URI 가 정상 사용 케이스이므로 계속 허용.
            // 이 함수는 href 와 src 양쪽에 쓰이므로, 호출 시 컨텍스트를 인자로 받아 구분한다.
            return !/^(javascript|vbscript):/i.test(n);
        };
        const isSafeHref = (v) => {
            const n = String(v).replace(/[\s\u0000-\u001F\u200B-\u200D\uFEFF]/g, '').toLowerCase();
            // href: javascript:, vbscript:, data: 모두 차단
            return !/^(javascript|vbscript|data):/i.test(n);
        };

        tempDiv.querySelectorAll('*').forEach(el => {
            // (a) on* 이벤트 핸들러 제거
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
            });

            // (b) href / src 위험 프로토콜 차단
            if (el.hasAttribute('href') && !isSafeHref(el.getAttribute('href'))) {
                el.removeAttribute('href');
            }
            if (el.hasAttribute('src') && !isSafeUrl(el.getAttribute('src'))) {
                el.removeAttribute('src');
            }

            // (c) srcdoc 속성 제거 (임의 HTML 인젝션 벡터)
            if (el.hasAttribute('srcdoc')) el.removeAttribute('srcdoc');

            // (d) iframe: 허용 도메인 확인 + sandbox 적용
            if (el.tagName === 'IFRAME') {
                const src = el.getAttribute('src') || '';
                if (!T2Editor._isAllowedIframeSrc(src)) {
                    // 비허용 도메인 iframe 제거
                    el.remove();
                } else {
                    // 허용 도메인이지만 sandbox 미적용 → 적용
                    T2Editor._applyIframeSandbox(el, src);
                }
            }
        });

        return tempDiv.innerHTML;
    }
}

window.T2EDITOR_PLUGIN_CLASSES = window.T2EDITOR_PLUGIN_CLASSES || Object.create(null);
T2Editor.registerPluginClass = function(name, PluginClass) {
    if (!/^[a-zA-Z0-9_-]+$/.test(String(name || '')) || typeof PluginClass !== 'function') {
        throw new TypeError('registerPluginClass(name, PluginClass) requires a valid plugin name and constructor.');
    }
    window.T2EDITOR_PLUGIN_CLASSES[name] = PluginClass;
};

window.T2Editor = T2Editor;

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
