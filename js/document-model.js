// Path: T2Editor/js/document-model.js
// Developer note: false 반환은 레거시 폴백 신호다. 지원 범위를 넓힐 때 core.js의 폴백 조건도 함께 검토한다.

// T2DocumentModel — Plan/Apply 기반 블록 재조정(reconciliation) 계층
// 배경:
//   core.js 는 레거시 위지윅 에디터와 같은 "브라우저 DOM을 신뢰하고, 그 결과를
//   브라우저·OS·IME 조합별로 사후 패치"하는 방식이다 (isIOS/isSafari 분기,
//   ZWSP/NBSP 삽입, beforeinput 가로채기 등 55곳 이상의 브라우저별 예외 코드가
//   그 증거다). 반대로 ProseMirror/Lexical 같은 최신 에디터는 "브라우저를
//   완전히 배제"하지 않는다 — IME 조합(compositionstart~compositionend) 구간은
//   여전히 네이티브 contenteditable 에 맡기고, 그 바깥의 구조적 편집(문단 분리/
//   병합/삽입)만 자체 모델에서 계산한 뒤 DOM에 "패치"로 반영한다. 조합 중인
//   텍스트를 가상 모델이 가로채면 한글/일본어/중국어 입력이 깨지기 때문이다.
//
//   이 파일은 그 절충안을 core.js에 최소 침습으로 도입하는 1차 모듈이다.
//   대상은 가장 많은 브라우저별 패치가 몰려 있는 두 연산 — 문단 분리(Enter)와
//   문단 병합(Backspace) — 이다. 전체 문서를 관리하는 범용 가상 DOM이 아니라,
//   "지금 사용자가 편집 중인 블록 1~2개"만 대상으로 하는 스코프 한정 모델이다.
//   전체 에디터를 이 방식으로 즉시 전환하는 것은 3,338줄에 걸친 IME/iOS 패치를
//   전부 재검증해야 하는 과도한 비용이므로, format-engine.js 와 동일한
//   strangler-fig 패턴(신규 경로 우선 시도 → 실패 시 기존 로직으로 폴백)을 따른다.
//
// 설계 원칙:
//   1) plan*() 함수는 순수 함수다 — 기존 DOM을 Range로 "읽기"만 하고(cloneContents
//      는 원본을 변경하지 않는다) 어떤 노드도 직접 mutate 하지 않는다. 반환값은
//      일반 객체(plan)이며, 이 자체로 단위 테스트가 가능하다.
//   2) apply*() 함수만 실제 DOM을 변경한다. 이때도 전체 에디터를 innerHTML로
//      통째로 재작성(destructive re-render)하지 않고, 이번 편집에 관련된
//      블록 노드 1~2개만 최소 패치한다. 포커스, 언두 스택, 플러그인이 관리하는
//      다른 블록(.t2-media-block 등)의 DOM 참조를 건드리지 않기 위함이다.
//   3) IME 조합 구간, beforeinput 라우팅, ZWSP/NBSP 정책 같은 "브라우저 호환성
//      지식"은 여전히 core.js가 소유한다 — 이 모듈은 그 판단이 끝난 뒤 "무엇이
//      결과물이어야 하는가"만 계산한다. 관심사를 분리해 향후 각 정책을
//      core.js를 건드리지 않고 이 모듈만 교체/테스트할 수 있게 한다.

class T2DocumentModel {

    // splitBlock — Enter 키로 인한 문단 분리

    /**
     * "분리 후 두 블록에 각각 무엇이 들어가야 하는가"를 순수하게 계산한다.
     * DOM은 변경하지 않는다(cloneContents만 사용).
     * @returns {{type:'collapsed-split'}|{type:'split', beforeFragment:DocumentFragment,
     *           afterFragment:DocumentFragment, beforeHasContent:boolean, afterHasContent:boolean}}
     */
    static planSplit(range, currentBlock) {
        if (!range.collapsed) {
            // 선택 영역이 있는 상태의 Enter는 core.js 쪽에서 별도 삭제 처리를
            // 기대하는 특수 케이스이므로, 모델은 "새 블록은 비어 있어야 한다"는
            // 판단만 내리고 실제 삭제/서식 유지는 caller에 맡긴다.
            return { type: 'collapsed-split' };
        }

        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(currentBlock);
        beforeRange.setEnd(range.startContainer, range.startOffset);

        const afterRange = document.createRange();
        afterRange.selectNodeContents(currentBlock);
        afterRange.setStart(range.startContainer, range.startOffset);

        const beforeFragment = beforeRange.cloneContents();
        const afterFragment = afterRange.cloneContents();

        const hasMeaningfulContent = (fragment) => {
            const text = (fragment.textContent || '')
                .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
                .replace(/[\t\n\r\f ]/g, '');
            if (text) return true;
            if (!fragment.querySelector) return false;
            return !!fragment.querySelector('img, video, audio, iframe, table, pre, code, hr, [data-t2-block]');
        };

        return {
            type: 'split',
            beforeFragment,
            afterFragment,
            beforeHasContent: hasMeaningfulContent(beforeFragment),
            afterHasContent: hasMeaningfulContent(afterFragment),
        };
    }

    /**
     * plan을 실제 DOM에 반영한다. currentBlock과 newBlock 두 노드만 patch하며,
     * 그 외 어떤 노드도 건드리지 않는다(reconciliation, not re-render).
     * emptyBlockHTML은 core.js가 플랫폼별 정책(ZWSP+<br> vs <br>)에 따라 넘겨준다.
     */
    static applySplit(currentBlock, newBlock, plan, emptyBlockHTML) {
        if (plan.type === 'collapsed-split') {
            newBlock.innerHTML = emptyBlockHTML;
            return;
        }

        if (plan.beforeHasContent) {
            currentBlock.replaceChildren(plan.beforeFragment);
        } else {
            currentBlock.innerHTML = emptyBlockHTML;
        }

        if (plan.afterHasContent) {
            newBlock.replaceChildren(plan.afterFragment);
        } else {
            newBlock.innerHTML = emptyBlockHTML;
        }
    }

    // mergeBlocks — Backspace로 인한 문단 병합

    /**
     * 병합 전 상태를 읽어 "병합 후 caret이 어디에 와야 하는가"와
     * "빈 블록(<br>만 있는) 특수 케이스인가"만 판단한다. DOM은 변경하지 않는다.
     */
    static planMerge(target, source) {
        return {
            caretOffset: target.textContent.length,
            targetWasEmpty: target.innerHTML === '<br>',
            sourceWasEmpty: source.innerHTML === '<br>',
        };
    }

    /**
     * source의 자식 노드들을 target 끝으로 옮기고 source를 제거한다.
     * target/source 외 노드는 건드리지 않는다. 반환값은 caller가
     * setCaretPosition에 사용할 offset.
     */
    static applyMerge(target, source, plan) {
        if (plan.targetWasEmpty) target.innerHTML = '';
        if (plan.sourceWasEmpty) source.innerHTML = '';

        while (source.firstChild) {
            target.appendChild(source.firstChild);
        }
        source.remove();

        return plan.caretOffset;
    }
    // insertAtCaret — 붙여넣기(paste)로 인한 캐럿 위치 콘텐츠 삽입
    // 기존 handlePaste()는 currentBlock.textContent를 통째로 문자열로 꺼낸 뒤
    // range.startOffset을 그 문자열의 인덱스로 취급해 beforeText/afterText를
    // substring으로 잘라냈다. 이 방식은 currentBlock에 <strong>/<em> 같은
    // 인라인 서식 태그가 섞여 있으면 두 가지 문제가 있었다:
    //   ① range.startOffset은 "startContainer 노드 내부"의 오프셋이지 블록
    //      전체 텍스트의 오프셋이 아니다 — 서식이 섞인 블록에서는 값이 어긋난다.
    //   ② beforeText/afterText가 textContent로 flatten되므로, 붙여넣기 지점을
    //      감싸고 있던 서식(굵게 등)이 사라진다.
    // splitBlock(Enter)에서 이미 쓰던 것과 동일하게, Range.cloneContents()로
    // "구조를 보존한 채" 앞/뒤 조각을 얻는 방식으로 교체한다.

    /**
     * 캐럿(range) 기준으로 currentBlock을 앞/뒤 DocumentFragment로 나눈다.
     * 순수 함수 — DOM은 변경하지 않는다.
     * 주의: range가 non-collapsed(선택 영역)인 경우 "선택 영역을 지운 뒤"의
     * 상태를 기준으로 해야 하므로, caller가 range.deleteContents()를 먼저
     * 호출해 range를 collapse시킨 뒤 이 함수를 호출해야 한다(기존 계약과 동일).
     */
    static planInsertAtCaret(range, currentBlock) {
        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(currentBlock);
        beforeRange.setEnd(range.startContainer, range.startOffset);

        const afterRange = document.createRange();
        afterRange.selectNodeContents(currentBlock);
        afterRange.setStart(range.startContainer, range.startOffset);

        const beforeFragment = beforeRange.cloneContents();
        return {
            beforeFragment,
            afterFragment: afterRange.cloneContents(),
            beforeTextLength: beforeFragment.textContent.length,
        };
    }

    /**
     * 순수 텍스트를 캐럿 위치에 삽입한다(클립보드에 text/html이 없는 경우).
     * @returns {number} 삽입 후 caret이 위치해야 할, 블록 시작 기준 문자 오프셋.
     */
    static applyInsertText(currentBlock, plan, text) {
        currentBlock.replaceChildren(plan.beforeFragment, document.createTextNode(text), plan.afterFragment);
        return plan.beforeTextLength + text.length;
    }

    /**
     * 이미 sanitize된 HTML 문자열을 캐럿 위치에 삽입한다.
     * beforeFragment/afterFragment는 cloneContents()로 얻은 "실제 DOM
     * 노드"이며 문자열로 직렬화·재파싱되지 않으므로 그 경로에는 XSS 위험이 없다.
     * 마크업으로 해석되는 유일한 입력은 sanitizedHTML이며, 이는 호출측에서
     * this.sanitizeHTML()을 통과한 값이어야 한다(기존과 동일한 책임 분담).
     * @returns {number} 삽입 후 caret이 위치해야 할, 블록 시작 기준 문자 오프셋.
     */
    static applyInsertHTML(currentBlock, plan, sanitizedHTML) {
        const temp = document.createElement('div');
        temp.innerHTML = sanitizedHTML;
        const insertedTextLength = temp.textContent.length;
        const insertedNodes = Array.from(temp.childNodes);
        currentBlock.replaceChildren(plan.beforeFragment, ...insertedNodes, plan.afterFragment);
        return plan.beforeTextLength + insertedTextLength;
    }
}

// CommonJS 환경(단위 테스트 등)에서도 import 가능하도록.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = T2DocumentModel;
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
