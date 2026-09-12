// Path: T2Editor/plugin/code/code.js
// Developer note: 플러그인 ID "code"과 command/button ID는 등록 설정·button.json·locale 키와 함께 변경한다.

class T2CodePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = ['insertCodeBlock'];

        // Reinitialize existing code blocks after delayed loading because an earlier plugin may consume contentSetQueue.
        setTimeout(() => {
            if (this.editor.editor && this.editor.editor.innerHTML.trim()) {
                this.initializeCodeBlocks();
            }
        }, 100); // file(50ms)보다 늦게 실행 — file 블록 처리 완료 후 동작
    }

    handleCommand(command, button) {
        switch (command) {
            case 'insertCodeBlock':
                this.insertCodeBlock();
                break;
        }
    }

    onContentSet(html) {
        console.log('Code plugin: onContentSet called');
        setTimeout(() => {
            this.initializeCodeBlocks();
        }, 50);
    }

    insertCodeBlock() {
        const selection = window.getSelection();
        let range = null;
        if (selection && selection.rangeCount > 0) {
            const candidate = selection.getRangeAt(0);
            if (candidate.startContainer === this.editor.editor || this.editor.editor.contains(candidate.startContainer)) {
                range = candidate.cloneRange();
            }
        }

        const codeBlock = this.createCodeBlock();
        if (!codeBlock) return;

        const inserted = typeof this.editor.insertBlockWithBoundaryLines === 'function'
            ? this.editor.insertBlockWithBoundaryLines(codeBlock, range)
            : false;
        if (!inserted) return;

        const codeElement = codeBlock.querySelector('code');
        if (codeElement) {
            setTimeout(() => {
                codeElement.focus();
                if (codeElement.classList.contains('code-placeholder')) {
                    codeElement.textContent = '';
                    codeElement.classList.remove('code-placeholder');
                }
                const newRange = document.createRange();
                newRange.selectNodeContents(codeElement);
                newRange.collapse(true);
                const sel = window.getSelection();
                if (sel) {
                    sel.removeAllRanges();
                    sel.addRange(newRange);
                }
            }, 0);
        }

        this.editor.createUndoPoint();
        this.editor.autoSave();
    }

    createCodeBlock() {
        const mediaBlock = document.createElement('div');
        mediaBlock.className = 't2-media-block t2-code-block';
        mediaBlock.contentEditable = false;
        mediaBlock.style.position = 'relative';

        const blockId = this.generateBlockId();
        mediaBlock.setAttribute('data-block-id', blockId);

        const container = document.createElement('div');
        container.style.width = '100%';
        container.style.margin = '0 auto';

        const pre = document.createElement('pre');
        pre.contentEditable = false;
        // 긴 코드로 인한 에디터 영역/textarea 강제 확장 방지
        pre.style.overflowX = 'auto';
        pre.style.maxWidth = '100%';

        const codeElement = document.createElement('code');
        codeElement.textContent = T2Utils.t('code.code_placeholder');
        codeElement.classList.add('code-placeholder');
        codeElement.setAttribute('contenteditable', 'true');

        this.setupCodeEvents(codeElement);

        pre.appendChild(codeElement);
        container.appendChild(pre);
        mediaBlock.appendChild(container);

        const controls = this.createCodeControls();
        mediaBlock.appendChild(controls);

        const moveControls = this.createMoveControls();
        mediaBlock.appendChild(moveControls);

        return mediaBlock;
    }

    createCodeControls() {
        const controls = document.createElement('div');
        controls.className = 't2-media-controls';
        controls.contentEditable = false;

        controls.innerHTML = `
            <button class="t2-btn delete-btn" type="button">
                <span class="material-icons">delete</span>
            </button>
        `;

        const deleteBtn = controls.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const mediaBlock = controls.closest('.t2-media-block');
                if (mediaBlock) {
                    mediaBlock.remove();
                    this.editor.createUndoPoint();
                    this.editor.autoSave();
                }
            });
        }

        return controls;
    }

    createMoveControls() {
        const moveWrapper = document.createElement('div');
        moveWrapper.className = 't2-move-controls';
        moveWrapper.contentEditable = false;
        moveWrapper.style.cssText = `
            position: absolute;
            bottom: -35px;
            right: 8px;
            display: inline-flex;
            background: rgba(50, 50, 50, 0.9);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            z-index: 10;
        `;

        moveWrapper.innerHTML = `
            <button class="t2-btn t2-move-btn" type="button" data-direction="up"
                style="padding: 6px 12px; border: none; border-radius: 0; border-right: 2px solid rgba(255,255,255,0.3); background: transparent; color: white; transition: all 0.2s; cursor: pointer;">
                <span class="material-icons" style="font-size: 20px;">arrow_upward</span>
            </button>
            <button class="t2-btn t2-move-btn" type="button" data-direction="down"
                style="padding: 6px 12px; border: none; border-radius: 0; background: transparent; color: white; transition: all 0.2s; cursor: pointer;">
                <span class="material-icons" style="font-size: 20px;">arrow_downward</span>
            </button>
        `;

        const upBtn = moveWrapper.querySelector('[data-direction="up"]');
        const downBtn = moveWrapper.querySelector('[data-direction="down"]');

        [upBtn, downBtn].forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = 'rgba(255,255,255,0.15)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = 'transparent';
            });
        });

        upBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.moveBlock('up', moveWrapper);
        });

        downBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.moveBlock('down', moveWrapper);
        });

        return moveWrapper;
    }

    moveBlock(direction, controlElement) {
        const mediaBlock = controlElement.closest('.t2-media-block');
        if (!mediaBlock) return;

        if (typeof this.editor.moveBlockWithBoundaryLines === 'function') {
            if (!this.editor.moveBlockWithBoundaryLines(mediaBlock, direction)) return;
        } else {
            const sibling = direction === 'up'
                ? mediaBlock.previousElementSibling
                : mediaBlock.nextElementSibling;
            if (!sibling) return;

            if (direction === 'up') {
                mediaBlock.parentNode.insertBefore(mediaBlock, sibling);
            } else {
                mediaBlock.parentNode.insertBefore(mediaBlock, sibling.nextElementSibling);
            }
            if (typeof this.editor.normalizeContent === 'function') this.editor.normalizeContent();
        }

        this.editor.createUndoPoint();
        this.editor.autoSave();

        if (this.editor.getPlugin('collab')) {
            this.editor.getPlugin('collab')._debounceUpdate();
        }
    }

    setupCodeEvents(codeElement) {
        codeElement.addEventListener('click', function (e) {
            e.stopPropagation();
            if (this.classList.contains('code-placeholder')) {
                this.textContent = '';
                this.classList.remove('code-placeholder');
                const range = document.createRange();
                const sel = window.getSelection();
                range.setStart(this, 0);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        });

        codeElement.addEventListener('focus', function (e) {
            e.stopPropagation();
            if (this.classList.contains('code-placeholder')) {
                this.textContent = '';
                this.classList.remove('code-placeholder');
            }
        });

        codeElement.addEventListener('blur', function () {
            if (this.textContent.trim() === '') {
                this.textContent = T2Utils.t('code.code_placeholder');
                this.classList.add('code-placeholder');
            }
        });

        codeElement.addEventListener('paste', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (codeElement.classList.contains('code-placeholder')) {
                codeElement.textContent = '';
                codeElement.classList.remove('code-placeholder');
            }

            const text = (e.clipboardData || window.clipboardData).getData('text/plain');
            const selection = window.getSelection();
            if (!selection.rangeCount) return;

            const range = selection.getRangeAt(0);
            range.deleteContents();

            const lines = text.split(/\r?\n/);
            const fragment = document.createDocumentFragment();
            lines.forEach((line, index) => {
                if (line) fragment.appendChild(document.createTextNode(line));
                if (index < lines.length - 1) {
                    fragment.appendChild(document.createTextNode('\n'));
                }
            });

            range.insertNode(fragment);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);

            this.editor.createUndoPoint();
            this.editor.autoSave();
        });

        // WebKit code-block Enter: beforeinput is primary and autocorrect/spellcheck stay disabled.
        // getTargetRanges supplies the caret; keydown remains a desktop fallback.

        // iOS Safari autocorrect/자동수정 비활성화
        // (텍스트 있을 때 Enter가 단어 커밋에 소비되는 근본 원인 차단)
        codeElement.setAttribute('autocorrect', 'off');
        codeElement.setAttribute('autocapitalize', 'none');
        codeElement.setAttribute('spellcheck', 'false');
        codeElement.setAttribute('data-gramm', 'false'); // Grammarly 충돌 방지

        // Keep execCommand(insertText) as the tested iOS composition/undo path; use Range insertion only if unavailable or failing.
        const _insertTextCompat = (text) => {
            if (typeof document.execCommand === 'function') {
                try {
                    const ok = document.execCommand('insertText', false, text);
                    if (ok !== false) return; // true 또는 undefined = 성공으로 간주(기존 동작)
                } catch (e) {
                    // 아래 폴백으로 진행
                }
            }
            // [FALLBACK-LEGACY-REMOVED] execCommand 미지원/실패 시에만 도달.
            const selection = window.getSelection();
            if (!selection || !selection.rangeCount) return;
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const node = document.createTextNode(text);
            range.insertNode(node);
            range.setStartAfter(node);
            range.setEndAfter(node);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        };

        // 공통 줄바꿈 삽입 헬퍼
        // rangeOverride: beforeinput의 getTargetRanges()에서 가져온 range (없으면 null)
        const _insertNewline = (rangeOverride) => {
            if (codeElement.classList.contains('code-placeholder')) {
                codeElement.textContent = '';
                codeElement.classList.remove('code-placeholder');
            }

            const selection = window.getSelection();
            if (!selection) return;

            let range = rangeOverride;
            if (!range) {
                if (!selection.rangeCount) return;
                range = selection.getRangeAt(0);
            }

            // 커서 앞 텍스트를 텍스트 노드 트리 순회로 정확히 계산 (들여쓰기용)
            // 기존 range.startOffset은 자식 노드 인덱스로 문자 오프셋과 달라 버그 있었음
            let charOffset = 0;
            const calcOffset = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    if (node === range.startContainer) {
                        charOffset += range.startOffset;
                        return true;
                    }
                    charOffset += node.textContent.length;
                    return false;
                }
                for (const child of node.childNodes) {
                    if (calcOffset(child)) return true;
                }
                return false;
            };
            calcOffset(codeElement);

            const textBeforeCursor = codeElement.textContent.substring(0, charOffset);
            const lastLine = textBeforeCursor.split('\n').pop();
            const leadingSpaces = lastLine.match(/^(\s*)/)[1];

            // selection을 range에 맞춰 동기화 후 삽입.
            // iOS Safari에서 range.insertNode()보다 execCommand('insertText')가
            // composition 상태·undo 히스토리를 올바르게 처리함 — 아래 헬퍼가
            // 그 경로를 1차로 쓰고, execCommand 자체가 사라졌을 때만 폴백한다.
            selection.removeAllRanges();
            selection.addRange(range);
            _insertTextCompat('\n' + leadingSpaces);
        };

        // 중복 삽입 방지 플래그
        // (keydown이 먼저 처리한 경우 beforeinput에서 _insertNewline 스킵)
        let _enterHandledByKeydown = false;

        // beforeinput: iOS Safari 주(主) 트리거
        // iOS는 keydown의 preventDefault를 무시하지만 beforeinput은 반드시 존중함
        codeElement.addEventListener('beforeinput', (e) => {
            if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
            e.preventDefault();
            e.stopPropagation();
            if (_enterHandledByKeydown) return;

            // getTargetRanges(): iOS Safari에서 window.getSelection()보다
            // 신뢰할 수 있는 range를 제공하는 InputEvent 전용 API
            let range = null;
            if (typeof e.getTargetRanges === 'function') {
                const targets = e.getTargetRanges();
                if (targets.length > 0) {
                    const sr = targets[0];
                    range = document.createRange();
                    range.setStart(sr.startContainer, sr.startOffset);
                    range.setEnd(sr.endContainer, sr.endOffset);
                }
            }
            _insertNewline(range);
        });

        // keydown: 데스크톱 및 isComposing=false 모바일 환경의 보조 트리거
        codeElement.addEventListener('keydown', (e) => {
            e.stopPropagation();

            if (e.key === 'Tab') {
                e.preventDefault();
                _insertTextCompat('    ');
            } else if (e.key === 'Enter') {
                // isComposing=true: CJK IME 조합 중 → beforeinput에 위임
                if (e.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                _enterHandledByKeydown = true;
                _insertNewline(null);
                // beforeinput이 이어서 발생해도 중복 삽입 방지
                setTimeout(() => { _enterHandledByKeydown = false; }, 0);
            }
        });

        codeElement.addEventListener('input', (e) => {
            e.stopPropagation();
            this.editor.createUndoPoint();
            this.editor.autoSave();

            if (this.editor.getPlugin('collab')) {
                this.editor.getPlugin('collab')._debounceUpdate();
            }
        });

        codeElement.addEventListener('mouseup', (e) => { e.stopPropagation(); });
        codeElement.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    }

    generateBlockId() {
        return `code_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    cleanupEmptyLines(codeBlock) {
        // 빈 줄 개수는 사용자 콘텐츠의 일부다. 플러그인이 임의로 연속 빈 문단을
        // 삭제하지 않고, 코어가 관리하는 블록 직전/직후 입력 경계만 보장한다.
        if (this.editor && typeof this.editor.ensureBlockBoundaryLines === 'function') {
            this.editor.ensureBlockBoundaryLines(codeBlock);
            return;
        }

        // 구형 코어 호환 폴백: 필요한 경계만 추가하고 기존 빈 줄은 보존한다.
        const makeBoundary = () => {
            const p = document.createElement('p');
            p.appendChild(document.createTextNode('\u200B'));
            p.appendChild(document.createElement('br'));
            return p;
        };
        const isEmptyParagraph = (node) => !!(node && node.tagName === 'P' &&
            !(node.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim());

        if (!isEmptyParagraph(codeBlock.previousElementSibling)) {
            codeBlock.parentNode.insertBefore(makeBoundary(), codeBlock);
        }
        if (!isEmptyParagraph(codeBlock.nextElementSibling)) {
            codeBlock.parentNode.insertBefore(makeBoundary(), codeBlock.nextSibling);
        }
    }

    // Restore code blocks from class/data markers or <pre><code>, recover malformed encoded content,
    // reset stale listeners by cloning controls, sanitize code as text and enforce horizontal overflow.
    initializeCodeBlocks() {
        console.log('Initializing code blocks...');
        const editorEl = this.editor.editor;

        // 에디터 직계 자식 탐색 헬퍼
        const getEditorDirectChild = (el) => {
            if (!el || el === editorEl) return null;
            let node = el;
            while (node.parentElement && node.parentElement !== editorEl) {
                node = node.parentElement;
            }
            return node.parentElement === editorEl ? node : null;
        };

        // Pass 1: 구형 블록 변환 (.t2-code-block without .t2-media-block)
        // querySelectorAll 결과를 배열로 고정 후 DOM 변경
        Array.from(
            editorEl.querySelectorAll('.t2-code-block:not(.t2-media-block)')
        ).forEach(oldBlock => {
            const codeElement = oldBlock.querySelector('code');
            if (!codeElement) return;

            const mediaBlock = document.createElement('div');
            mediaBlock.className = 't2-media-block t2-code-block';
            mediaBlock.contentEditable = false;
            mediaBlock.style.position = 'relative';
            mediaBlock.setAttribute('data-block-id', this.generateBlockId());

            const container = document.createElement('div');
            container.style.width = '100%';
            container.style.margin = '0 auto';

            const pre = (codeElement.closest('pre') || codeElement.parentElement).cloneNode(true);
            pre.contentEditable = false;
            pre.style.overflowX = 'auto';
            pre.style.maxWidth = '100%';
            container.appendChild(pre);
            mediaBlock.appendChild(container);

            if (oldBlock.parentNode && oldBlock.parentNode.nodeName === 'P') {
                const p = oldBlock.parentNode;
                p.parentNode.insertBefore(mediaBlock, p);
                p.remove();
            } else if (oldBlock.parentNode) {
                oldBlock.parentNode.replaceChild(mediaBlock, oldBlock);
            }

            this.cleanupEmptyLines(mediaBlock);
        });

        // Detect code blocks by canonical class, data-block-id, then <pre><code> as the final structural fallback.
        const allBlocks = new Set();

        // 전략 1: class 기반
        editorEl.querySelectorAll('.t2-media-block.t2-code-block').forEach(el => {
            const root = getEditorDirectChild(el);
            if (root) allBlocks.add(root);
        });

        // 전략 2: data-block-id 기반 (class 손실 케이스)
        editorEl.querySelectorAll('[data-block-id^="code_"]:not(.t2-code-block)').forEach(el => {
            const root = getEditorDirectChild(el);
            if (root) allBlocks.add(root);
        });

        // 전략 3: <pre><code> 구조 탐지
        // — class·data-block-id 가 모두 소실된 경우의 최후 수단.
        // — 파일/이미지/비디오 콘텐츠가 없는 div 안의 pre>code 구조만 대상.
        editorEl.querySelectorAll('pre > code').forEach(codeEl => {
            const root = getEditorDirectChild(codeEl);
            if (!root) return;
            // 다른 플러그인 블록 제외
            if (root.classList.contains('t2-video-block') ||
                root.classList.contains('t2-file-block') ||
                root.classList.contains('t2-table-wrapper') ||
                root.classList.contains('t2-drawing-block')) return;
            // 파일·이미지 콘텐츠가 없는 경우만 코드 블록으로 처리
            if (!root.querySelector('img, iframe, video, audio, .file-container, a[download]')) {
                allBlocks.add(root);
            }
        });

        // Pass 3: 수집된 블록 재초기화
        allBlocks.forEach(block => {

            // 필수 클래스·속성 복원
            block.classList.add('t2-media-block', 't2-code-block');
            block.contentEditable = false;
            block.style.position = 'relative';
            if (!block.getAttribute('data-block-id')) {
                block.setAttribute('data-block-id', this.generateBlockId());
            }

            // <p> 래핑 탈출
            if (block.parentNode && block.parentNode.nodeName === 'P') {
                const p = block.parentNode;
                p.parentNode.insertBefore(block, p);
                const pText = p.textContent.replace(/\u200B/g, '').trim();
                if (!pText && !p.querySelector('img, iframe, video')) {
                    p.remove();
                }
            }

            // <pre> 구조 확인 및 복원
            let pre = block.querySelector('pre');
            if (!pre) {
                // <pre>가 없으면 컨테이너를 찾아 구조 재생성
                const container = block.querySelector(':scope > div') || block;
                pre = document.createElement('pre');
                pre.contentEditable = false;
                const orphanCode = container.querySelector('code');
                if (orphanCode) {
                    // <code>가 있으면 <pre> 안으로 이동
                    pre.appendChild(orphanCode);
                } else {
                    // 텍스트만 있으면 <code>로 감싸기
                    const code = document.createElement('code');
                    code.textContent = container.textContent.trim();
                    pre.appendChild(code);
                    container.textContent = '';
                }
                container.appendChild(pre);
            }

            // overflow 처리 — <pre>의 긴 코드가
            // 에디터 영역과 textarea를 강제로 확장하는 문제 방지
            pre.contentEditable = false;
            pre.style.overflowX = 'auto';
            pre.style.maxWidth = '100%';

            // <code> 요소 복원 및 파손 구조 재구성
            let codeElement = pre.querySelector('code');

            if (!codeElement) {
                // <code>가 없으면 <pre>의 텍스트를 <code>로 감싸기
                const text = pre.textContent;
                pre.innerHTML = '';
                codeElement = document.createElement('code');
                codeElement.textContent = text;
                pre.appendChild(codeElement);
            } else {
                // If encoded closing tags broke <code>, recover the full pre.textContent and rebuild the code node.
                const preText = pre.textContent;
                if (pre.childNodes.length > 1 || codeElement.textContent !== preText) {
                    codeElement.textContent = preText;
                    // <code> 이외의 형제 노드(잘린 텍스트 등) 제거
                    Array.from(pre.childNodes).forEach(child => {
                        if (child !== codeElement) pre.removeChild(child);
                    });
                }

                // [FIX-XSS] 코드 요소 내 잔류 HTML 마크업 sanitize
                // innerHTML에 실제 HTML 태그가 잔류하는 경우 textContent로 치환.
                // & 를 먼저 처리해야 이중 인코딩 오류가 없음.
                const safeText = codeElement.textContent;
                const expectedHtml = safeText
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
                if (codeElement.innerHTML !== expectedHtml) {
                    codeElement.textContent = safeText;
                }
            }

            codeElement.setAttribute('contenteditable', 'true');

            // Clone stale controls before rebinding so persisted flags/listeners cannot block or duplicate initialization.
            const freshCode = codeElement.cloneNode(true);
            freshCode.removeAttribute('data-events-setup');
            codeElement.parentElement.replaceChild(freshCode, codeElement);
            codeElement = freshCode;

            this.setupCodeEvents(codeElement);
            codeElement.dataset.eventsSetup = 'true';

            // 컨트롤 제거 후 재생성 (이벤트 없는 죽은 버튼 방지)
            const existingControls = block.querySelector('.t2-media-controls');
            if (existingControls) existingControls.remove();
            block.appendChild(this.createCodeControls());

            const existingMoveControls = block.querySelector('.t2-move-controls');
            if (existingMoveControls) existingMoveControls.remove();
            block.appendChild(this.createMoveControls());

            this.cleanupEmptyLines(block);
        });

        console.log('Code blocks initialization complete');
    }
}

window.T2CodePlugin = T2CodePlugin;

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
