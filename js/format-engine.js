// Path: T2Editor/js/format-engine.js
// Developer note: false 반환은 레거시 폴백 신호다. 지원 범위를 넓힐 때 core.js의 폴백 조건도 함께 검토한다.

// T2FormatEngine — Selection/Range 기반 서식 엔진
// document.execCommand / document.queryCommandState / document.queryCommandValue
// 는 MDN에 "Deprecated"로 명시되어 있고(W3C Editing API 초안 폐기, 브라우저마다
// 동작 불일치), 최근 에디터 스택(ProseMirror, Lexical, Tiptap, Quill 계열)도
// 자체 Selection/Range 기반 모델로 옮겨가는 추세다.
//
// 이 파일은 core.js 가 지금까지 execCommand 에 위임해온 서식 커맨드
// (bold/italic/underline/strikeThrough, foreColor/backColor, 활성 상태 조회)를
// 표준 Selection/Range API 만으로 재구현한 "1차 경로"다.
//
// 설계 원칙 — 기존 로직 보존:
//   core.js 의 execCommand()/updateFormatButtons() 는 이 엔진을 우선 호출하고,
//   엔진이 처리 불가(false/예외) 를 보고하는 경우에만 기존 document.execCommand /
//   queryCommandState 경로로 "폴백"한다. 즉 기존 코드는 삭제하지 않고 안전망으로
//   그대로 남긴다 (레거시 브라우저·예상 못한 DOM 구조 대응).
//
// fontSize 커맨드는 core.js 의 execCommand() 안에 이미 Range.surroundContents
// 기반으로 구현되어 있었으므로(= 이 모듈과 동일한 접근) 그 코드는 그대로 둔다.

class T2FormatEngine {

    static INLINE_TAGS = {
        bold: ['B', 'STRONG'],
        italic: ['I', 'EM'],
        underline: ['U'],
        strikeThrough: ['S', 'STRIKE', 'DEL']
    };

    static WRAP_TAG = {
        bold: 'strong',
        italic: 'em',
        underline: 'u',
        strikeThrough: 's'
    };

    static isSupportedCommand(command) {
        return Object.prototype.hasOwnProperty.call(this.WRAP_TAG, command);
    }

    static _findEditorRoot(range, explicitRoot = null) {
        if (explicitRoot) return explicitRoot;
        if (!range) return null;
        let node = range.commonAncestorContainer;
        if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        while (node && node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && node.classList.contains('t2-editor')) return node;
            if (node.getAttribute && node.getAttribute('contenteditable') === 'true' &&
                (!node.parentElement || node.parentElement.getAttribute('contenteditable') !== 'true')) return node;
            node = node.parentElement;
        }
        return null;
    }

    static _isEditableTextNode(editorRoot, node) {
        if (!editorRoot || !node || node.nodeType !== Node.TEXT_NODE || !editorRoot.contains(node)) return false;
        const parent = node.parentElement;
        if (!parent || parent.closest('script,style,button')) return false;
        const owner = parent.closest('[contenteditable]');
        return !owner || owner === editorRoot || owner.getAttribute('contenteditable') === 'true';
    }

    static _selectedTextParts(editorRoot, range) {
        if (!editorRoot || !range || range.collapsed) return [];
        const parts = [];
        const walker = document.createTreeWalker(editorRoot, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                if (!this._isEditableTextNode(editorRoot, node) || !node.nodeValue.length) return NodeFilter.FILTER_REJECT;
                try { return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
                catch (_) { return NodeFilter.FILTER_REJECT; }
            }
        });
        let node;
        while ((node = walker.nextNode())) {
            let start = range.startContainer === node ? range.startOffset : 0;
            let end = range.endContainer === node ? range.endOffset : node.nodeValue.length;
            start = Math.max(0, Math.min(node.nodeValue.length, start));
            end = Math.max(start, Math.min(node.nodeValue.length, end));
            if (end > start) parts.push({ node, start, end });
        }
        return parts;
    }

    static _textOffset(editorRoot, node, offset) {
        try {
            const range = document.createRange();
            range.selectNodeContents(editorRoot);
            range.setEnd(node, offset);
            return range.toString().length;
        } catch (_) { return null; }
    }

    static _pointAtTextOffset(editorRoot, requested) {
        let remaining = Math.max(0, Number(requested) || 0);
        const walker = document.createTreeWalker(editorRoot, NodeFilter.SHOW_TEXT, null);
        let node, last = null;
        while ((node = walker.nextNode())) {
            last = node;
            if (remaining <= node.length) return { node, offset: remaining };
            remaining -= node.length;
        }
        return last ? { node: last, offset: last.length } : { node: editorRoot, offset: 0 };
    }

    static _restoreTextSelection(editorRoot, startOffset, endOffset) {
        if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) return false;
        const start = this._pointAtTextOffset(editorRoot, startOffset);
        const end = this._pointAtTextOffset(editorRoot, endOffset);
        try {
            const range = document.createRange();
            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            return true;
        } catch (_) { return false; }
    }

    static _nodeHasFormat(editorRoot, node, command) {
        const tags = this.INLINE_TAGS[command] || [];
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        while (current && current !== editorRoot.parentElement) {
            if (current.nodeType === Node.ELEMENT_NODE) {
                if (tags.includes(current.tagName)) return true;
                const cs = window.getComputedStyle(current);
                if (command === 'bold' && parseInt(cs.fontWeight, 10) >= 600) return true;
                if (command === 'italic' && cs.fontStyle === 'italic') return true;
                const decoration = cs.textDecorationLine || cs.textDecoration || '';
                if (command === 'underline' && decoration.includes('underline')) return true;
                if (command === 'strikeThrough' && decoration.includes('line-through')) return true;
            }
            if (current === editorRoot) break;
            current = current.parentElement;
        }
        return false;
    }

    static _selectionFullyFormatted(editorRoot, range, command) {
        const parts = this._selectedTextParts(editorRoot, range)
            .filter(part => part.node.nodeValue.slice(part.start, part.end).length > 0);
        return parts.length > 0 && parts.every(part => this._nodeHasFormat(editorRoot, part.node, command));
    }

    static _splitSelectedPart(part) {
        let selectedNode = part.node;
        if (part.end < selectedNode.nodeValue.length) selectedNode.splitText(part.end);
        if (part.start > 0) selectedNode = selectedNode.splitText(part.start);
        return selectedNode;
    }

    static _mergeAdjacentEquivalent(root, matcher) {
        if (!root) return;
        const all = Array.from(root.querySelectorAll('*'));
        all.forEach((element) => {
            if (!element.parentNode || !matcher(element)) return;
            let next = element.nextSibling;
            while (next && next.nodeType === Node.TEXT_NODE && next.nodeValue === '') {
                const empty = next; next = next.nextSibling; empty.remove();
            }
            while (next && next.nodeType === Node.ELEMENT_NODE && matcher(next) &&
                element.getAttribute('style') === next.getAttribute('style') &&
                element.tagName === next.tagName) {
                while (next.firstChild) element.appendChild(next.firstChild);
                const remove = next;
                next = next.nextSibling;
                remove.remove();
            }
        });
    }

    static _applyTagToRange(editorRoot, range, command, tagName) {
        const startOffset = this._textOffset(editorRoot, range.startContainer, range.startOffset);
        const endOffset = this._textOffset(editorRoot, range.endContainer, range.endOffset);
        const parts = this._selectedTextParts(editorRoot, range);
        if (!parts.length) return false;
        parts.reverse().forEach((part) => {
            if (this._nodeHasFormat(editorRoot, part.node, command)) return;
            const selectedNode = this._splitSelectedPart(part);
            if (!selectedNode.parentNode) return;
            const wrapper = document.createElement(tagName);
            selectedNode.parentNode.insertBefore(wrapper, selectedNode);
            wrapper.appendChild(selectedNode);
        });
        this._mergeAdjacentEquivalent(editorRoot, element => element.tagName === tagName.toUpperCase());
        this._restoreTextSelection(editorRoot, startOffset, endOffset);
        return true;
    }

    static _applyStyleToRange(editorRoot, range, styleProp, styleValue) {
        const startOffset = this._textOffset(editorRoot, range.startContainer, range.startOffset);
        const endOffset = this._textOffset(editorRoot, range.endContainer, range.endOffset);
        const parts = this._selectedTextParts(editorRoot, range);
        if (!parts.length) return false;
        parts.reverse().forEach((part) => {
            const selectedNode = this._splitSelectedPart(part);
            if (!selectedNode.parentNode) return;
            const parent = selectedNode.parentElement;
            if (parent && parent.tagName === 'SPAN' && parent.childNodes.length === 1) {
                parent.style[styleProp] = styleValue;
                return;
            }
            const span = document.createElement('span');
            span.style[styleProp] = styleValue;
            selectedNode.parentNode.insertBefore(span, selectedNode);
            span.appendChild(selectedNode);
        });
        this._mergeAdjacentEquivalent(editorRoot, element => element.tagName === 'SPAN');
        this._restoreTextSelection(editorRoot, startOffset, endOffset);
        return true;
    }

    static _nativeToggleSelection(command) {
        if (typeof document.execCommand !== 'function') return false;
        try {
            document.execCommand('styleWithCSS', false, false);
            return document.execCommand(command, false, null) !== false;
        } catch (_) { return false; }
    }

    // 활성 상태 조회 — document.queryCommandState(command) 대체.
    // 선택 시작 지점에서 editorRoot 까지 조상 노드를 훑어 태그/computed style 로 판별.
    static queryState(editorRoot, command) {
        const tags = this.INLINE_TAGS[command];
        if (!tags || !editorRoot) return false;

        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;

        let node = sel.getRangeAt(0).startContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;

        while (node && node !== editorRoot.parentElement) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (tags.includes(node.tagName)) return true;

                const cs = window.getComputedStyle(node);
                if (command === 'bold' && parseInt(cs.fontWeight, 10) >= 600) return true;
                if (command === 'italic' && cs.fontStyle === 'italic') return true;
                if (command === 'underline' && (cs.textDecorationLine || cs.textDecoration || '').includes('underline')) return true;
                if (command === 'strikeThrough' && (cs.textDecorationLine || cs.textDecoration || '').includes('line-through')) return true;
            }
            if (node === editorRoot) break;
            node = node.parentElement;
        }
        return false;
    }

    // 인라인 서식 토글 — document.execCommand('bold'|'italic'|'underline'|'strikeThrough') 대체.
    // 반환값: true(엔진이 처리함) / false(호출측에서 폴백 처리 필요).
    static toggleInline(editorRoot, command) {
        const tagName = this.WRAP_TAG[command];
        if (!tagName || !editorRoot) return false;

        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;

        const range = sel.getRangeAt(0);
        if (!editorRoot.contains(range.commonAncestorContainer)) return false;

        const isActive = this.queryState(editorRoot, command);

        try {
            if (range.collapsed) {
                // 커서만 있고 선택 영역이 없는 경우 — "다음에 입력할 서식"을 지정하는
                // 시나리오. 폭 0 태그 + ZWSP 앵커를 만들어 캐럿을 그 안에 둔다.
                // (core.js 가 이미 빈 블록에서 사용하는 ZWSP 앵커 패턴과 동일한 기법.)
                if (isActive) {
                    // 기존에는 여기서 그냥 true 를 반환하고
                    // 아무 동작도 하지 않았다. 그 결과 커서가 <strong>/<em>/<u>/<s>
                    // 태그 안에 있을 때 같은 서식 버튼을 다시 눌러도 "이 지점부터는
                    // 서식을 끄고 입력하고 싶다"는 사용자 의도를 처리할 방법이 없었다
                    // (표준 contenteditable 에서 execCommand 는 이를 지원했었음).
                    // 서식 태그를 캐럿 위치에서 둘로 쪼개고, 그 사이에 서식이 없는
                    // ZWSP 앵커를 넣어 이후 입력이 태그 밖에서 이루어지도록 한다.
                    return this._breakOutOfInline(editorRoot, range, tagName);
                }

                const wrapper = document.createElement(tagName);
                const zwsp = document.createTextNode('\u200B');
                wrapper.appendChild(zwsp);
                range.insertNode(wrapper);

                const newRange = document.createRange();
                newRange.setStart(zwsp, 1);
                newRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(newRange);
                return true;
            }

            const removeFormat = this._selectionFullyFormatted(editorRoot, range, command);
            if (removeFormat) {
                // 부분 선택 해제는 조상 태그 전체를 벗기면 선택 밖 서식까지 파괴된다.
                // 브라우저의 네이티브 편집 명령을 정밀 해제 경로로 한정 사용하고,
                // 지원되지 않을 때만 기존 구조적 폴백을 유지한다.
                if (!this._nativeToggleSelection(command)) this._unwrapInline(editorRoot, range, tagName);
            } else {
                this._applyTagToRange(editorRoot, range, command, tagName);
            }
            return true;
        } catch (err) {
            console.warn('[T2FormatEngine] toggleInline 실패, 레거시 execCommand로 폴백:', err);
            return false;
        }
    }

    // Collapsed toggle: split the active formatting element and place the caret outside it.
    // Keep the trailing fragment wrapped so only subsequent input loses the format.
    static _breakOutOfInline(editorRoot, range, tagName) {
        const upper = tagName.toUpperCase();

        let node = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;

        let ancestor = node;
        while (ancestor && ancestor !== editorRoot && ancestor.tagName !== upper) {
            ancestor = ancestor.parentElement;
        }
        if (!ancestor || ancestor.tagName !== upper || !ancestor.parentNode) {
            return true; // 대상 태그를 찾지 못함 — 안전하게 무시
        }

        try {
            // 캐럿부터 태그 끝까지를 추출 ("뒷부분")
            const afterRange = document.createRange();
            afterRange.setStart(range.startContainer, range.startOffset);
            afterRange.setEndAfter(ancestor.lastChild || ancestor);
            const afterContent = afterRange.extractContents();

            const zwsp = document.createTextNode('\u200B');
            const parent = ancestor.parentNode;
            const insertRef = ancestor.nextSibling;

            let afterWrapper = null;
            if (afterContent.textContent) {
                afterWrapper = document.createElement(tagName);
                afterWrapper.appendChild(afterContent);
            }

            parent.insertBefore(zwsp, insertRef);
            if (afterWrapper) parent.insertBefore(afterWrapper, insertRef);

            // 앞부분(ancestor)이 비어버렸으면 (캐럿이 태그 맨 앞에 있던 경우) 제거
            if (!ancestor.textContent) ancestor.remove();

            const sel = window.getSelection();
            const newRange = document.createRange();
            newRange.setStart(zwsp, 1);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
        } catch (err) {
            console.warn('[T2FormatEngine] _breakOutOfInline 실패:', err);
        }
        return true;
    }

    static _wrapInline(sel, range, tagName) {
        const wrapper = document.createElement(tagName);
        try {
            // 선택 영역이 하나의 컨테이너 안에 완전히 들어있는 단순한 경우.
            range.surroundContents(wrapper);
        } catch (e) {
            // 여러 블록/노드에 걸친 선택 — extractContents 후 wrapper 안에 넣고 재삽입.
            const contents = range.extractContents();
            wrapper.appendChild(contents);
            range.insertNode(wrapper);
        }
        const newRange = document.createRange();
        newRange.selectNodeContents(wrapper);
        sel.removeAllRanges();
        sel.addRange(newRange);
    }

    static _unwrapInline(editorRoot, range, tagName) {
        const upper = tagName.toUpperCase();

        // 선택 전체를 감싸는 단일 조상 태그가 있으면 그것만 해제.
        let node = range.commonAncestorContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        let ancestor = node;
        while (ancestor && ancestor !== editorRoot && ancestor.tagName !== upper) {
            ancestor = ancestor.parentElement;
        }
        if (ancestor && ancestor.tagName === upper) {
            this._unwrapElement(ancestor);
            return;
        }

        // 선택 범위와 교차하는 모든 tagName 요소를 찾아 개별 해제.
        const walker = document.createTreeWalker(editorRoot, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (n) => (n.tagName === upper && range.intersectsNode(n))
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_SKIP
        });
        const toUnwrap = [];
        let cur;
        while ((cur = walker.nextNode())) toUnwrap.push(cur);
        toUnwrap.forEach((el) => this._unwrapElement(el));
    }

    static _unwrapElement(el) {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
    }

    // 글자색/배경색 — document.execCommand('foreColor'|'backColor', false, hex) 대체.
    // core.js 기존 fontSize 구현과 동일하게 Range.surroundContents 로 <span> 랩핑.
    static applyColor(command, hexValue, explicitRoot = null) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        const range = sel.getRangeAt(0);
        if (range.collapsed) return false;
        const editorRoot = this._findEditorRoot(range, explicitRoot);
        if (!editorRoot || !editorRoot.contains(range.commonAncestorContainer)) return false;
        const styleProp = command === 'backColor' ? 'backgroundColor' : 'color';
        try {
            return this._applyStyleToRange(editorRoot, range, styleProp, hexValue);
        } catch (err) {
            console.warn('[T2FormatEngine] applyColor 실패, 레거시 execCommand로 폴백:', err);
            return false;
        }
    }
    // 글자 크기 — core.js가 기존에 execCommand 없이 Range.surroundContents로
    // 직접 구현하던 부분을 이 엔진으로 옮긴다. 원래 구현에는 applyColor()에는
    // 있던 "선택 영역이 여러 노드/블록에 걸쳐 surroundContents가 실패하는 경우"의
    // try/catch 안전망이 빠져 있었다 — 예를 들어 <strong>일부만 겹치는 선택에
    // 폰트 크기를 적용하면 DOMException이 그대로 던져져 툴바 클릭 핸들러까지
    // 전파되는 버그가 있었다. applyColor()와 동일한 extractContents 폴백을 적용.
    static applyFontSize(pxValue, explicitRoot = null) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        const range = sel.getRangeAt(0);
        const editorRoot = this._findEditorRoot(range, explicitRoot);
        if (!editorRoot || !editorRoot.contains(range.commonAncestorContainer)) return false;
        try {
            if (!range.collapsed) {
                return this._applyStyleToRange(editorRoot, range, 'fontSize', pxValue + 'px');
            }
            const span = document.createElement('span');
            span.style.fontSize = pxValue + 'px';
            const zwsp = document.createTextNode('\u200B');
            span.appendChild(zwsp);
            range.insertNode(span);
            const caret = document.createRange();
            caret.setStart(zwsp, 1);
            caret.collapse(true);
            sel.removeAllRanges();
            sel.addRange(caret);
            return true;
        } catch (err) {
            console.warn('[T2FormatEngine] applyFontSize 실패, 레거시 경로로 폴백:', err);
            return false;
        }
    }
}

// 전역 노출 (core.js 에서 클래스 로딩 순서 문제 없이 참조할 수 있도록).
window.T2FormatEngine = T2FormatEngine;

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
