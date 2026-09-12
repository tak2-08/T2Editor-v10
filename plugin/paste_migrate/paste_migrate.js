// Path: T2Editor/plugin/paste_migrate/paste_migrate.js
//
// [자동 붙여넣기 마이그레이션]
// T2_MIGRATION_MODE(기존 콘텐츠 로드시 타 에디터 콘텐츠 변환)와는 별개로,
// "지금 이 순간 사용자가 붙여넣는" 콘텐츠를 항상 자동으로 T2Editor 자체 포맷으로
// 변환해 삽입한다. (옵션 없음 — 기본 동작)
//
// 처리 대상:
//   1) 순수 텍스트(textarea 등에서 복사) — 줄바꿈을 <br>/<p> 로 명시적 변환
//      (raw \n 문자를 textContent 에 그대로 남기면 white-space:normal 블록에서
//       편집 중엔 우연히 보이다가, 최종 렌더링/서버 처리 과정에서 소실될 수 있음)
//   2) 리치 HTML(타 사이트) — bold/italic/underline/strikethrough 보존
//      (semantic 태그는 물론 인라인 style 기반 표현도 semantic 태그로 승격 후 새니타이즈)
//      또한 div-in-p 등 잘못된 중첩 없이 항상 형제 <p> 블록으로 분해해 삽입한다.
//   3) 순수 URL 텍스트 → 자체 링크(link 플러그인 스타일)로 자동 변환
//   4) 이미지/동영상 URL → 모달로 블록 변환 여부를 물어봄
//        - 붙여넣기 전체가 URL 하나뿐이면: 유형별(이미지/동영상) 단독 확인 모달
//        - 다른 텍스트와 섞여 있거나 여러 개면: 통합 리스트 모달로 한번에 확인
//      "블록으로 변환"을 선택하면 각 플러그인의 정식 삽입 파이프라인
//      (이미지: 업로드+NSFW 검사 동일 적용 / 동영상: 임베드 생성)을 그대로 재사용한다.
//
// 코어(core.js/editor.lib.php) 수정 없이 plugin/handlePaste 훅 + extend/php 플러그인
// 등록만으로 동작하도록 설계했다.

class T2Paste_migratePlugin {
    constructor(editor) {
        this.editor = editor;
        this.commands = [];
        this._idSeq = 0;
    }

    // ── [FIX] collab.recordChange 안전 호출 헬퍼 (plugin/file/file.js 와 동일 패턴) ──
    // this.editor.collab 객체가 존재하더라도 recordChange 가 함수가 아닌 경우
    // "is not a function" TypeError 가 발생할 수 있다 (collab 플러그인 로딩 타이밍,
    // 버전 불일치 등). typeof 로 먼저 확인하고, 없으면 createUndoPoint() 로 폴백.
    _recordChange() {
        if (this.editor.collab && typeof this.editor.collab.recordChange === 'function') {
            this.editor.collab.recordChange();
        } else {
            this.editor.createUndoPoint();
        }
    }

    // =====================================================================
    // 진입점 — core.js 의 handlePaste() 훅에서 순서대로 호출됨.
    // true 를 반환하면 core 의 기본(레거시) 처리로 넘어가지 않고 여기서 종료.
    // =====================================================================
    async handlePaste(e) {
        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData) return false;

        // 실제 이미지 파일(진짜 클립보드 이미지)이 섞여 있으면 image 플러그인이
        // 우선 처리해야 한다. image 플러그인이 paste_migrate 보다 먼저 로드되므로
        // 보통 이 지점까지 오지 않지만, 방어적으로 한번 더 확인한다.
        if (clipboardData.items) {
            for (let i = 0; i < clipboardData.items.length; i++) {
                const item = clipboardData.items[i];
                if (item && item.type && item.type.indexOf('image') !== -1) {
                    return false;
                }
            }
        }

        // 코드 블록/테이블 셀 내부는 각자의 편집 규칙(공백 보존 등)이 다르므로
        // 블록 재구성 로직을 적용하지 않고 core 기본 처리(또는 table 플러그인)에 맡긴다.
        if (this._isInsideStructuredBlock(e)) return false;

        const html = clipboardData.getData('text/html');
        const text = clipboardData.getData('text/plain');
        if (!html && !text) return false;

        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return true;
        const range = selection.getRangeAt(0).cloneRange();
        if (!this.editor.editor.contains(range.startContainer)) return false;

        e.preventDefault();

        try {
            await this._process(range, html, text);
        } catch (err) {
            console.error('[T2PasteMigrate] 처리 중 오류, 일반 텍스트로 대체 삽입합니다:', err);
            try {
                this._insertPlainFallback(range, text || this._stripHtml(html));
            } catch (err2) {
                console.error('[T2PasteMigrate] 폴백 삽입도 실패:', err2);
            }
        }

        return true;
    }

    _isInsideStructuredBlock(e) {
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        let node = selection.getRangeAt(0).startContainer;
        const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!el || !el.closest) return false;
        return !!el.closest('.t2-code-block, pre, code, table, .t2-table, .t2-table-wrapper');
    }

    _stripHtml(html) {
        if (!html) return '';
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || '';
    }

    // =====================================================================
    // 메인 처리 파이프라인
    // =====================================================================
    async _process(range, html, text) {
        let blocks;
        let wholeTextForSingleUrlCheck;

        if (html && html.trim() && /<[a-z][\s\S]*>/i.test(html)) {
            const raw = document.createElement('div');
            raw.innerHTML = html;
            this._promoteStyledInlineFormatting(raw);
            const sanitized = this.editor.sanitizeHTML(raw.innerHTML);
            blocks = this._splitIntoBlocks(sanitized);
            wholeTextForSingleUrlCheck = (text && text.trim()) ? text : raw.textContent;
        } else {
            blocks = this._blocksFromPlainText(text || '');
            wholeTextForSingleUrlCheck = text || '';
        }

        this._linkifyBlocks(blocks);

        const insertedBlocks = this._insertBlocksAtRange(range, blocks);

        this.editor.normalizeContent();
        this._recordChange();
        if (typeof this.editor.autoSave === 'function') this.editor.autoSave();
        if (typeof this.editor.updateCharCount === 'function') this.editor.updateCharCount();

        const candidates = this._collectCandidates(insertedBlocks);
        if (candidates.length === 0) return;

        const trimmedWhole = (wholeTextForSingleUrlCheck || '').trim();
        const isSingleUrlPaste = candidates.length === 1 && /^https?:\/\/\S+$/i.test(trimmedWhole);

        let proceed;
        if (isSingleUrlPaste) {
            proceed = await this._showSingleTypeModal(candidates[0]);
        } else {
            proceed = await this._showUnifiedModal(candidates);
        }

        if (proceed) {
            for (const candidate of candidates) {
                await this._convertCandidate(candidate);
            }
        }

        // 마커 정리 (변환되지 않고 링크로 남은 것들의 임시 속성 제거)
        this.editor.editor.querySelectorAll('[data-t2-pm-id]').forEach(a => a.removeAttribute('data-t2-pm-id'));
    }

    // =====================================================================
    // 1) 인라인 style 기반 굵게/기울임/밑줄/취소선 → semantic 태그로 승격
    //    (sanitizeHTML 은 style 속성을 모두 제거하므로, 제거되기 전에 의미를 보존)
    // =====================================================================
    _promoteStyledInlineFormatting(root) {
        const isBoldWeight = (w) => {
            if (!w) return false;
            const n = parseInt(w, 10);
            if (!isNaN(n)) return n >= 600;
            return /^(bold|bolder)$/i.test(w);
        };

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
        const targets = [];
        let node;
        while ((node = walker.nextNode())) {
            if (!node.style) continue;
            const tags = [];
            const tag = node.tagName;

            if (isBoldWeight(node.style.fontWeight) && tag !== 'B' && tag !== 'STRONG') tags.push('b');
            if (/italic|oblique/i.test(node.style.fontStyle || '') && tag !== 'I' && tag !== 'EM') tags.push('i');

            const deco = `${node.style.textDecorationLine || ''} ${node.style.textDecoration || ''}`;
            if (/underline/i.test(deco) && tag !== 'U') tags.push('u');
            if (/line-through/i.test(deco) && tag !== 'S' && tag !== 'STRIKE' && tag !== 'DEL') tags.push('s');

            if (tags.length) targets.push({ el: node, tags });
        }

        targets.forEach(({ el, tags }) => {
            let inner = el.innerHTML;
            tags.forEach(t => { inner = `<${t}>${inner}</${t}>`; });
            el.innerHTML = inner;
        });
    }

    // =====================================================================
    // 2) 새니타이즈된 HTML → 형제 블록(<p>/<h1-6>) 배열로 분해
    //    (block 요소를 다른 block/<p> 내부에 중첩시키지 않는다 — 이것이
    //     "편집 중엔 줄바꿈이 보이는데 저장/게시 후 사라지는" 문제의 핵심 원인이다:
    //     <p> 안에 <div>/<p> 가 중첩된 잘못된 마크업은 브라우저마다, 그리고
    //     호스트 게시판의 서버측 처리 단계마다 서로 다르게 "복구"되어 줄바꿈이
    //     유실될 수 있다. 항상 형제 블록으로 평탄화하면 이 문제 자체가 사라진다.)
    // =====================================================================
    _splitIntoBlocks(sanitizedHtml) {
        const container = document.createElement('div');
        container.innerHTML = sanitizedHtml;

        const blocks = [];
        let currentInline = null;

        const ensureInline = () => {
            if (!currentInline) currentInline = document.createElement('p');
            return currentInline;
        };
        const flushInline = () => {
            if (currentInline && (currentInline.childNodes.length > 0)) {
                blocks.push(currentInline);
            }
            currentInline = null;
        };

        Array.from(container.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent.trim() === '') return;
                ensureInline().appendChild(node.cloneNode(true));
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const tag = node.tagName;

            if (tag === 'UL' || tag === 'OL') {
                flushInline();
                Array.from(node.querySelectorAll(':scope > li')).forEach(li => {
                    const p = document.createElement('p');
                    p.appendChild(document.createTextNode('\u2022 '));
                    Array.from(li.childNodes).forEach(c => p.appendChild(c.cloneNode(true)));
                    if (!p.textContent.trim()) p.innerHTML = '<br>';
                    blocks.push(p);
                });
                return;
            }

            if (/^H[1-6]$/.test(tag)) {
                flushInline();
                blocks.push(node.cloneNode(true));
                return;
            }

            if (tag === 'P' || tag === 'DIV') {
                flushInline();
                const p = document.createElement('p');
                Array.from(node.childNodes).forEach(c => p.appendChild(c.cloneNode(true)));
                if (!p.textContent.trim() && !p.querySelector('img, a, br')) p.innerHTML = '<br>';
                blocks.push(p);
                return;
            }

            if (tag === 'BR') {
                ensureInline().appendChild(document.createElement('br'));
                return;
            }

            // 인라인 허용 태그(b/i/u/s/strong/em/span/a/img 등) → 누적
            ensureInline().appendChild(node.cloneNode(true));
        });
        flushInline();

        if (blocks.length === 0) {
            const p = document.createElement('p');
            p.innerHTML = '<br>';
            blocks.push(p);
        }
        return blocks;
    }

    // =====================================================================
    // 3) 순수 텍스트 → 블록 배열
    //    빈 줄(연속 개행) = 새 문단(<p>), 단일 개행 = 문단 내 강제 줄바꿈(<br>)
    // =====================================================================
    _blocksFromPlainText(text) {
        const normalized = String(text || '').replace(/\r\n?/g, '\n');
        const paragraphs = normalized.split(/\n{2,}/);
        const blocks = [];

        paragraphs.forEach(para => {
            const p = document.createElement('p');
            const lines = para.split('\n');
            lines.forEach((line, idx) => {
                if (idx > 0) p.appendChild(document.createElement('br'));
                if (line.length) p.appendChild(document.createTextNode(line));
            });
            if (!p.textContent.trim()) p.innerHTML = '<br>';
            blocks.push(p);
        });

        if (blocks.length === 0) {
            const p = document.createElement('p');
            p.innerHTML = '<br>';
            blocks.push(p);
        }
        return blocks;
    }

    // =====================================================================
    // 4) 블록 내부의 순수 URL 텍스트를 자체 링크(<a>)로 변환.
    //    이미 <a> 인데 "표시 텍스트 == href" 형태(=단순 URL 붙여넣기 링크)도
    //    후보로 표시해 이미지/동영상 변환 대상에 포함시킨다.
    // =====================================================================
    _linkifyBlocks(blocks) {
        const linkPlugin = this.editor.getPlugin('link');
        const urlRe = /https?:\/\/[^\s<>"'`]+/gi;

        const trimTrailingPunct = (url) => {
            const m = url.match(/^(.*?)[),.;:!?'"”’」』]*$/);
            return (m && m[1]) ? m[1] : url;
        };

        const makeAnchor = (url) => {
            let anchor;
            if (linkPlugin && typeof linkPlugin.createLinkElement === 'function') {
                anchor = linkPlugin.createLinkElement(url, url, true);
            } else {
                anchor = document.createElement('a');
                anchor.href = url;
                anchor.textContent = url;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
            }
            anchor.setAttribute('data-t2-pm-id', 'pm' + (this._idSeq++));
            return anchor;
        };

        blocks.forEach(block => {
            const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null, false);
            const textNodes = [];
            let n;
            while ((n = walker.nextNode())) {
                if (n.parentNode && n.parentNode.closest && n.parentNode.closest('a')) continue;
                textNodes.push(n);
            }

            textNodes.forEach(textNode => {
                const text = textNode.textContent;
                urlRe.lastIndex = 0;
                if (!urlRe.test(text)) return;
                urlRe.lastIndex = 0;

                const frag = document.createDocumentFragment();
                let lastIndex = 0;
                let match;
                let found = false;

                while ((match = urlRe.exec(text))) {
                    const rawUrl = trimTrailingPunct(match[0]);
                    if (!rawUrl) continue;
                    found = true;
                    const idx = match.index;
                    if (idx > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, idx)));
                    frag.appendChild(makeAnchor(rawUrl));
                    lastIndex = idx + rawUrl.length;
                    urlRe.lastIndex = lastIndex;
                }
                if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));

                if (found) textNode.parentNode.replaceChild(frag, textNode);
            });
        });

        blocks.forEach(block => {
            if (!block.querySelectorAll) return;
            block.querySelectorAll('a[href]').forEach(a => {
                if (a.hasAttribute('data-t2-pm-id')) return;
                const href = a.getAttribute('href') || '';
                const txt = (a.textContent || '').trim();
                if (txt && (txt === href || txt === href.replace(/^https?:\/\//i, ''))) {
                    a.setAttribute('data-t2-pm-id', 'pm' + (this._idSeq++));
                }
            });
        });
    }

    // =====================================================================
    // 5) 커서 위치 기준으로 블록 배열을 삽입 (현재 블록을 앞/뒤로 분할)
    // =====================================================================
    _insertBlocksAtRange(range, blocks) {
        if (!range.collapsed) range.deleteContents();

        let currentBlock = this.editor.getClosestBlock(range.startContainer);
        if (!currentBlock || currentBlock === this.editor.editor) {
            currentBlock = document.createElement('p');
            currentBlock.innerHTML = '<br>';
            this.editor.editor.appendChild(currentBlock);
            range.selectNodeContents(currentBlock);
            range.collapse(true);
        }

        const beforeRange = document.createRange();
        beforeRange.selectNodeContents(currentBlock);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        const beforeFrag = beforeRange.cloneContents();

        const afterRange = document.createRange();
        afterRange.selectNodeContents(currentBlock);
        afterRange.setStart(range.startContainer, range.startOffset);
        const afterFrag = afterRange.cloneContents();

        const insertedBlocks = [];

        currentBlock.innerHTML = '';
        currentBlock.appendChild(beforeFrag);

        const firstNew = blocks[0];
        if (firstNew) {
            Array.from(firstNew.childNodes).forEach(c => currentBlock.appendChild(c.cloneNode(true)));
        }
        if (!currentBlock.textContent.trim() && !currentBlock.querySelector('img, br, a')) {
            currentBlock.innerHTML = '<br>';
        }
        insertedBlocks.push(currentBlock);

        let anchorNode = currentBlock;
        for (let i = 1; i < blocks.length; i++) {
            const clone = blocks[i].cloneNode(true);
            anchorNode.parentNode.insertBefore(clone, anchorNode.nextSibling);
            anchorNode = clone;
            insertedBlocks.push(clone);
        }

        const hasAfterContent = (afterFrag.textContent && afterFrag.textContent.trim()) || afterFrag.querySelector('img, a');
        if (hasAfterContent) {
            const tailBlock = document.createElement('p');
            tailBlock.appendChild(afterFrag);
            anchorNode.parentNode.insertBefore(tailBlock, anchorNode.nextSibling);
            insertedBlocks.push(tailBlock);
            this._setCaretToStart(tailBlock);
        } else {
            this._setCaretToEnd(anchorNode);
        }

        return insertedBlocks;
    }

    _setCaretToStart(el) {
        if (typeof this.editor.setCaretToStart === 'function') {
            this.editor.setCaretToStart(el);
            return;
        }
        const range = document.createRange();
        const selection = window.getSelection();
        range.setStart(el, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    _setCaretToEnd(el) {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    _insertPlainFallback(range, text) {
        const blocks = this._blocksFromPlainText(text);
        this._insertBlocksAtRange(range, blocks);
        this.editor.normalizeContent();
        this._recordChange();
        if (typeof this.editor.autoSave === 'function') this.editor.autoSave();
    }

    // =====================================================================
    // 6) 이미지/동영상 URL 후보 수집 및 분류
    // =====================================================================
    _collectCandidates(insertedBlocks) {
        const candidates = [];
        insertedBlocks.forEach(block => {
            if (!block.querySelectorAll) return;
            block.querySelectorAll('a[data-t2-pm-id]').forEach(a => {
                const url = a.getAttribute('href') || '';
                const kind = this._classifyUrl(url);
                if (kind === 'image' || kind === 'video') {
                    candidates.push({ el: a, url, kind });
                }
            });
        });
        return candidates;
    }

    _classifyUrl(url) {
        if (!url) return 'link';

        try {
            if (typeof T2Utils !== 'undefined' && T2Utils.getVideoType && T2Utils.getVideoType(url)) {
                return 'video';
            }
        } catch (_) { /* 무시 */ }

        const imagePlugin = this.editor.getPlugin('image');
        const imageExts = (imagePlugin && imagePlugin.config && imagePlugin.config.allowedExtensions
            && imagePlugin.config.allowedExtensions.image)
            || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

        let pathPart;
        try {
            pathPart = new URL(url).pathname;
        } catch (_) {
            pathPart = url.split('?')[0].split('#')[0];
        }
        const ext = (pathPart.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (ext && imageExts.includes(ext)) return 'image';

        return 'link';
    }

    // =====================================================================
    // 7) 후보 URL → 실제 블록으로 변환 (이미지: 업로드 파이프라인 재사용 /
    //    동영상: 임베드 파이프라인 재사용)
    // =====================================================================
    async _convertCandidate(candidate) {
        const { el, url, kind } = candidate;
        if (!el || !el.isConnected) return;

        const insertRange = document.createRange();
        insertRange.setStartBefore(el);
        insertRange.collapse(true);
        el.remove();

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(insertRange);

        if (kind === 'image') {
            await this._convertImageCandidate(url, insertRange);
        } else if (kind === 'video') {
            await this._convertVideoCandidate(url, insertRange);
        }
    }

    async _convertImageCandidate(url, insertRange) {
        const imagePlugin = this.editor.getPlugin('image');
        if (!imagePlugin) return;

        try {
            const file = await this._fetchAsImageFile(url, imagePlugin);
            if (!file) throw new Error('지원하지 않는 이미지 형식이거나 다운로드에 실패했습니다.');
            // handleMultipleImageInsert 는 image 플러그인의 정식 업로드+NSFW 파이프라인이다.
            // (processImageFile → applyNSFWFilter → insertImageBlocks → queueUpload)
            await imagePlugin.handleMultipleImageInsert([file]);
        } catch (err) {
            console.warn('[T2PasteMigrate] 이미지 재업로드 실패, 외부 링크(핫링크)로 대체 삽입:', err);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(insertRange);
            if (typeof imagePlugin._saveEditorRange === 'function') imagePlugin._saveEditorRange();
            const imageData = {
                url,
                width: 320,
                height: 180,
                blockId: imagePlugin.generateBlockId(),
                isUploading: false
            };
            imagePlugin.insertImageBlocks([imageData]);
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification(
                    T2Utils.tf('paste_migrate.image_fallback_hotlink', {}, '외부 이미지를 서버로 가져올 수 없어 원본 링크로 삽입했습니다.'),
                    'warning'
                );
            }
        }
    }

    async _fetchAsImageFile(url, imagePlugin) {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();

        const allowedExts = (imagePlugin.config && imagePlugin.config.allowedExtensions
            && imagePlugin.config.allowedExtensions.image)
            || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

        let ext = (url.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!allowedExts.includes(ext)) {
            const mimeExtMap = {
                'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
                'image/webp': 'webp', 'image/bmp': 'bmp'
            };
            ext = mimeExtMap[blob.type] || '';
        }
        if (!ext || !allowedExts.includes(ext)) return null;

        const filename = `pasted-image-${Date.now()}.${ext}`;
        return new File([blob], filename, { type: blob.type || `image/${ext}` });
    }

    async _convertVideoCandidate(url, insertRange) {
        const videoPlugin = this.editor.getPlugin('video');
        if (!videoPlugin) return;

        let videoInfo = (typeof T2Utils !== 'undefined' && T2Utils.getVideoType) ? T2Utils.getVideoType(url) : null;
        if (typeof videoPlugin._sanitizeVideoInfo === 'function') {
            videoInfo = videoPlugin._sanitizeVideoInfo(videoInfo);
        }
        if (!videoInfo) return;

        let w = null, h = null;
        if (videoInfo.type === 'video'
            && typeof videoPlugin._isHlsVideoURL === 'function'
            && !videoPlugin._isHlsVideoURL(videoInfo.url)
            && typeof videoPlugin._detectVideoDimensions === 'function') {
            try {
                const dims = await videoPlugin._detectVideoDimensions(videoInfo.url);
                if (dims) { w = dims.width; h = dims.height; }
            } catch (_) { /* 감지 실패 시 기본 비율 사용 */ }
        }

        const videoBlock = videoPlugin.createVideoBlock(videoInfo, w, h);
        const selection = window.getSelection();
        const savedRange = (selection && selection.rangeCount) ? selection.getRangeAt(0).cloneRange() : insertRange;

        if (typeof videoPlugin._insertBlockAtSavedRange === 'function') {
            videoPlugin._insertBlockAtSavedRange(savedRange, videoBlock);
        }

        this.editor.normalizeContent();
        this._recordChange();
        if (typeof this.editor.autoSave === 'function') this.editor.autoSave();
    }

    // =====================================================================
    // 8) 모달 UI
    // ── [I18N] T2Utils.tf(key, vars, fallback) 사용 — T2I18N 로드 시 locales/*.json
    //    번역을 우선 사용하고, 미로드/키 누락 시 한국어 fallback 그대로 표시된다.
    //    (locales/*.json 에 'paste_migrate.*' 키를 추가하면 자동으로 다국어 지원됨)
    // =====================================================================
    _showSingleTypeModal(candidate) {
        return new Promise(resolve => {
            const isImage = candidate.kind === 'image';
            const title = isImage
                ? T2Utils.tf('paste_migrate.image_detected_title', {}, '이미지 링크 감지됨')
                : T2Utils.tf('paste_migrate.video_detected_title', {}, '동영상 링크 감지됨');
            const desc = isImage
                ? T2Utils.tf('paste_migrate.image_detected_desc', {}, '붙여넣은 링크가 이미지 주소로 보입니다. 이미지 블록으로 추가할까요?')
                : T2Utils.tf('paste_migrate.video_detected_desc', {}, '붙여넣은 링크가 동영상 주소로 보입니다. 동영상 블록으로 추가할까요?');
            const cancelLabel = T2Utils.tf('paste_migrate.keep_as_link', {}, '링크로 유지');
            const confirmLabel = isImage
                ? T2Utils.tf('paste_migrate.convert_to_image', {}, '이미지 블록으로 추가')
                : T2Utils.tf('paste_migrate.convert_to_video', {}, '동영상 블록으로 추가');
            const safeUrl = T2Utils.escapeHtml(candidate.url);
            const safeTitle = T2Utils.escapeHtml(title);
            const safeDesc = T2Utils.escapeHtml(desc);
            const safeCancel = T2Utils.escapeHtml(cancelLabel);
            const safeConfirm = T2Utils.escapeHtml(confirmLabel);

            // [I18N] data-i18n 속성은 의도적으로 사용하지 않는다 — createModal() 이 호출하는
            // T2I18N.applyTranslations() 는 [data-i18n] 요소를 무조건 t(key) 결과로 덮어쓰며,
            // 공식 locales/*.json 에 'paste_migrate.*' 키가 없으면 humanizeKey() 로 만든
            // 어색한 텍스트가 tf() 의 한국어 폴백을 그대로 덮어써버린다. locales/*.json 에
            // 정식으로 키를 등록한 뒤에만 data-i18n 을 추가해야 한다.
            const content = `
                <div class="t2-pm-modal">
                    <div class="t2-pm-icon"><span class="material-icons">${isImage ? 'image' : 'movie'}</span></div>
                    <h3 class="t2-pm-title">${safeTitle}</h3>
                    <p class="t2-pm-desc">${safeDesc}</p>
                    <div class="t2-pm-url" title="${safeUrl}">${safeUrl}</div>
                    <div class="t2-pm-actions">
                        <button type="button" class="t2-pm-btn t2-pm-btn-cancel" data-action="cancel">${safeCancel}</button>
                        <button type="button" class="t2-pm-btn t2-pm-btn-confirm" data-action="confirm">${safeConfirm}</button>
                    </div>
                </div>
            `;

            const modal = T2Utils.createModal(content, 't2-pm-overlay');
            const finish = (val) => { modal.remove(); resolve(val); };
            modal.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(false));
            modal.querySelector('[data-action="confirm"]').addEventListener('click', () => finish(true));
        });
    }

    _showUnifiedModal(candidates) {
        return new Promise(resolve => {
            const rows = candidates.map(c => {
                const icon = c.kind === 'image' ? 'image' : 'movie';
                const safeUrl = T2Utils.escapeHtml(c.url);
                return `
                    <li class="t2-pm-row">
                        <span class="material-icons t2-pm-row-icon">${icon}</span>
                        <span class="t2-pm-row-url" title="${safeUrl}">${safeUrl}</span>
                    </li>
                `;
            }).join('');

            const title = T2Utils.tf('paste_migrate.multi_detected_title', {}, '콘텐츠 링크 감지됨');
            const desc = T2Utils.tf('paste_migrate.multi_detected_desc', {}, '붙여넣은 내용에서 아래 링크를 찾았습니다. 이미지/동영상 블록으로 변환할까요?');
            const cancelLabel = T2Utils.tf('paste_migrate.keep_as_link', {}, '링크로 유지');
            const confirmLabel = T2Utils.tf('paste_migrate.convert_all', {}, '블록으로 변환');
            const safeTitle = T2Utils.escapeHtml(title);
            const safeDesc = T2Utils.escapeHtml(desc);
            const safeCancel = T2Utils.escapeHtml(cancelLabel);
            const safeConfirm = T2Utils.escapeHtml(confirmLabel);

            const content = `
                <div class="t2-pm-modal t2-pm-modal-list">
                    <div class="t2-pm-icon"><span class="material-icons">auto_fix_high</span></div>
                    <h3 class="t2-pm-title">${safeTitle}</h3>
                    <p class="t2-pm-desc">${safeDesc}</p>
                    <ul class="t2-pm-list">${rows}</ul>
                    <div class="t2-pm-actions">
                        <button type="button" class="t2-pm-btn t2-pm-btn-cancel" data-action="cancel">${safeCancel}</button>
                        <button type="button" class="t2-pm-btn t2-pm-btn-confirm" data-action="confirm">${safeConfirm}</button>
                    </div>
                </div>
            `;

            const modal = T2Utils.createModal(content, 't2-pm-overlay');
            const finish = (val) => { modal.remove(); resolve(val); };
            modal.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(false));
            modal.querySelector('[data-action="confirm"]').addEventListener('click', () => finish(true));
        });
    }
}

window.T2Paste_migratePlugin = T2Paste_migratePlugin;
