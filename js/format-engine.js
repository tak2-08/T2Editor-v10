//Path: T2Editor/js/format-engine.js

// ════════════════════════════════════════════════════════════════════════
// [MODERNIZATION] T2FormatEngine — Selection/Range 기반 서식 엔진
// ────────────────────────────────────────────────────────────────────────
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
// ════════════════════════════════════════════════════════════════════════

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

    // ────────────────────────────────────────────────────────────────────
    // 활성 상태 조회 — document.queryCommandState(command) 대체.
    // 선택 시작 지점에서 editorRoot 까지 조상 노드를 훑어 태그/computed style 로 판별.
    // ────────────────────────────────────────────────────────────────────
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

    // ────────────────────────────────────────────────────────────────────
    // 인라인 서식 토글 — document.execCommand('bold'|'italic'|'underline'|'strikeThrough') 대체.
    // 반환값: true(엔진이 처리함) / false(호출측에서 폴백 처리 필요).
    // ────────────────────────────────────────────────────────────────────
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
                    // [BUG-FIX/미구현 보완] 기존에는 여기서 그냥 true 를 반환하고
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

            if (isActive) {
                this._unwrapInline(editorRoot, range, tagName);
            } else {
                this._wrapInline(sel, range, tagName);
            }
            return true;
        } catch (err) {
            console.warn('[T2FormatEngine] toggleInline 실패, 레거시 execCommand로 폴백:', err);
            return false;
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // [미구현 보완] 캐럿이 서식 태그 내부에 있을 때(선택 영역 없음) 토글을
    // 눌러 "여기서부터는 서식 없이 입력"을 가능하게 한다.
    //
    // 방법: 캐럿 위치에서 해당 태그를 앞/뒤 두 조각으로 분리하고, 그 사이에
    // 태그 밖의 ZWSP 텍스트 노드를 삽입해 캐럿을 그곳에 둔다. 뒷조각에 내용이
    // 있으면 동일 태그로 다시 감싸 원래 서식을 유지시킨다.
    //
    // 반환값은 항상 true — 대상 태그를 못 찾는 등 예외적인 상황에서도
    // "엔진이 처리를 시도했다"는 의미로 true 를 반환해 호출측이 레거시
    // execCommand 폴백으로 새지 않게 한다(어차피 execCommand 도 이 케이스를
    // 안정적으로 처리하지 못한다).
    // ────────────────────────────────────────────────────────────────────
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

    // ────────────────────────────────────────────────────────────────────
    // 글자색/배경색 — document.execCommand('foreColor'|'backColor', false, hex) 대체.
    // core.js 기존 fontSize 구현과 동일하게 Range.surroundContents 로 <span> 랩핑.
    // ────────────────────────────────────────────────────────────────────
    static applyColor(command, hexValue) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;

        const range = sel.getRangeAt(0);
        if (range.collapsed) return false;

        const styleProp = command === 'backColor' ? 'backgroundColor' : 'color';

        try {
            const existingSpan = range.commonAncestorContainer.parentElement;
            const fullyWrapsExistingSpan =
                existingSpan && existingSpan.tagName === 'SPAN' &&
                range.toString().length > 0 &&
                range.toString() === existingSpan.textContent;

            if (fullyWrapsExistingSpan) {
                existingSpan.style[styleProp] = hexValue;
                return true;
            }

            const span = document.createElement('span');
            span.style[styleProp] = hexValue;
            try {
                range.surroundContents(span);
            } catch (e) {
                const contents = range.extractContents();
                span.appendChild(contents);
                range.insertNode(span);
            }

            const newRange = document.createRange();
            newRange.selectNodeContents(span);
            sel.removeAllRanges();
            sel.addRange(newRange);
            return true;
        } catch (err) {
            console.warn('[T2FormatEngine] applyColor 실패, 레거시 execCommand로 폴백:', err);
            return false;
        }
    }
    // ────────────────────────────────────────────────────────────────────
    // 글자 크기 — core.js가 기존에 execCommand 없이 Range.surroundContents로
    // 직접 구현하던 부분을 이 엔진으로 옮긴다. 원래 구현에는 applyColor()에는
    // 있던 "선택 영역이 여러 노드/블록에 걸쳐 surroundContents가 실패하는 경우"의
    // try/catch 안전망이 빠져 있었다 — 예를 들어 <strong>일부만 겹치는 선택에
    // 폰트 크기를 적용하면 DOMException이 그대로 던져져 툴바 클릭 핸들러까지
    // 전파되는 버그가 있었다. applyColor()와 동일한 extractContents 폴백을 적용.
    // ────────────────────────────────────────────────────────────────────
    static applyFontSize(pxValue) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;

        const range = sel.getRangeAt(0);

        try {
            const existingSpan = range.commonAncestorContainer.parentElement;
            if (existingSpan && existingSpan.style && existingSpan.style.fontSize) {
                existingSpan.style.fontSize = pxValue + 'px';
                return true;
            }

            const span = document.createElement('span');
            span.style.fontSize = pxValue + 'px';

            try {
                range.surroundContents(span);
            } catch (e) {
                // 선택 영역이 하나의 컨테이너 안에 완전히 들어있지 않은 경우
                // (여러 노드/부분적으로 겹치는 인라인 태그를 가로지르는 선택).
                const contents = range.extractContents();
                span.appendChild(contents);
                range.insertNode(span);
            }

            const newRange = document.createRange();
            newRange.selectNodeContents(span);
            sel.removeAllRanges();
            sel.addRange(newRange);
            return true;
        } catch (err) {
            console.warn('[T2FormatEngine] applyFontSize 실패, 레거시 경로로 폴백:', err);
            return false;
        }
    }
}

// 전역 노출 (core.js 에서 클래스 로딩 순서 문제 없이 참조할 수 있도록).
window.T2FormatEngine = T2FormatEngine;
