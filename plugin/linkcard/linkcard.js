// Path: T2Editor/plugin/linkcard/linkcard.js
// Developer note: 플러그인 ID "linkcard"과 command/button ID는 등록 설정·button.json·locale 키와 함께 변경한다.
// Plain single-link paste keeps the original hyperlink and inserts a preview card below it.
// Consume only non-media single-link text before paste_migrate; return false for all mixed/rich/media cases.
// Priority changes may disable card creation but must never lose pasted content.

// Cards include essential inline layout because editor-only CSS may not be present on published CMS pages.
// linkcard.css remains responsible for interaction, responsive and dark-theme overrides.
const T2LC_INLINE_STYLE = {
    block: 'position:relative;margin:8px 0;',
    link: 'display:flex;align-items:stretch;text-decoration:none;color:#1a1a1a;'
        + 'background:#fff;border:1px solid #e1e1e1;border-radius:12px;overflow:hidden;min-height:96px;',
    thumb: 'flex:0 0 144px;width:144px;background:#f3f3f3;display:flex;align-items:center;'
        + 'justify-content:center;overflow:hidden;',
    thumbImg: 'width:100%;height:100%;object-fit:cover;display:block;border:0;',
    placeholder: 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;'
        + 'background:linear-gradient(135deg, rgba(1,135,254,.12), rgba(1,135,254,.04));',
    placeholderBadge: 'width:44px;height:44px;border-radius:50%;background:rgba(1,135,254,.18);'
        + 'color:#0187fe;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;',
    body: 'flex:1;min-width:0;padding:12px 16px;display:flex;flex-direction:column;justify-content:center;gap:4px;',
    domainRow: 'display:flex;align-items:center;gap:5px;color:#8a8a8a;font-size:12px;',
    domainIcon: 'font-size:14px;line-height:1;flex:0 0 auto;',
    domainFavicon: 'width:14px;height:14px;flex:0 0 14px;object-fit:contain;border-radius:3px;display:block;border:0;',
    domainText: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
    title: 'font-size:15px;font-weight:600;color:#1a1a1a;line-height:1.4;display:-webkit-box;'
        + '-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;',
    titleLoading: 'color:#999;font-weight:500;',
    desc: 'font-size:13px;color:#666;line-height:1.4;display:-webkit-box;'
        + '-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;',
};

class T2LinkcardPlugin {
    constructor(editor) {
        this.editor = editor;
    }

    // paste 진입점
    async handlePaste(e) {
        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData) return false;

        // 실제 파일(이미지 등)이 붙여넣기에 섞여 있으면 관여하지 않는다 —
        // image/video 플러그인이 처리해야 할 영역.
        if (clipboardData.items) {
            for (const item of clipboardData.items) {
                if (item && item.kind === 'file') return false;
            }
        }

        const text = (clipboardData.getData('text/plain') || '').trim();
        if (!text || !/^https?:\/\/\S+$/i.test(text)) return false; // "URL 단 하나만"이 아니면 관여 안 함

        // 브라우저 주소창 복사 등에서 text/html 이 함께 채워지는 경우가 있는데,
        // 그 HTML이 실제로 서식이 있는 리치 콘텐츠라면(텍스트 표현이 순수
        // URL과 다르면) 우리가 판단할 문제가 아니므로 기존 파이프라인에 맡긴다.
        const html = clipboardData.getData('text/html') || '';
        if (html && html.trim()) {
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const htmlText = (tmp.textContent || '').trim();
            if (htmlText !== text) return false;
        }

        // 이미지/동영상 URL은 paste_migrate + image/video 플러그인 파이프라인이
        // NSFW 검사·임베드 생성까지 훨씬 잘 처리하므로 절대 가로채지 않는다.
        if (this._looksLikeImageUrl(text) || this._looksLikeVideoUrl(text)) return false;

        e.preventDefault();
        this._insertPendingCardAndFetch(text);
        return true;
    }

    _looksLikeImageUrl(url) {
        return /\.(jpe?g|png|gif|webp|bmp|svg|avif)(\?.*)?(#.*)?$/i.test(url);
    }

    _looksLikeVideoUrl(url) {
        // paste_migrate/video 플러그인과 동일한 판별 유틸을 재사용(있으면).
        if (window.T2Utils && typeof window.T2Utils.getVideoType === 'function') {
            try {
                const info = window.T2Utils.getVideoType(url);
                if (info && info.type) return true;
            } catch (_) { /* 무시하고 확장자 검사로 폴백 */ }
        }
        return /\.(mp4|webm|ogg|mov|m4v)(\?.*)?(#.*)?$/i.test(url);
    }

    // Keep the original link and add the asynchronous card below it so metadata failure never removes user content.
    _insertPendingCardAndFetch(url) {
        const savedRange = this.editor && typeof this.editor.captureSelectionBookmark === 'function'
            ? (this.editor.captureSelectionBookmark() || this.editor._lastEditorBookmark || null)
            : ((window.getSelection() && window.getSelection().rangeCount) ? window.getSelection().getRangeAt(0).cloneRange() : null);

        const cardBlock = this._createCardElement(url, 'loading');
        const inserted = this._insertLinkAndCardAtSavedRange(savedRange, url, cardBlock);
        if (!inserted) return;

        this.editor.createUndoPoint();
        this.editor.autoSave();

        const endpoint = `${t2editor_url}/plugin/linkcard/linkcard_fetch.php?url=${encodeURIComponent(url)}`;

        // 응답이 지나치게 늦으면(네트워크 문제 등) 무한정 로딩 상태로 남기지 않는다.
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : null;

        fetch(endpoint, controller ? { signal: controller.signal } : undefined)
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(json => {
                if (!cardBlock.isConnected) return; // 그 사이 사용자가 삭제/undo 했을 수 있음
                if (json && json.success && json.data) {
                    this._applyCardData(cardBlock, json.data);
                } else {
                    // 메타데이터를 못 가져온 경우: 위에 이미 평범한 링크가
                    // 남아있으므로 중복 링크를 또 만들 필요 없이 카드만 걷어낸다.
                    this._removeFailedCard(cardBlock);
                }
            })
            .catch(() => {
                if (cardBlock.isConnected) this._removeFailedCard(cardBlock);
            })
            .finally(() => {
                if (timeoutId) clearTimeout(timeoutId);
                this.editor.createUndoPoint();
                this.editor.autoSave();
            });
    }

     /** Build card DOM with textContent/attribute APIs so remote OG metadata is never parsed as markup. */
    _createCardElement(url, status) {
        const blockId = this._generateBlockId();

        const block = document.createElement('div');
        block.className = 't2-media-block t2-linkcard-block t2-linkcard-' + status;
        block.setAttribute('contenteditable', 'false');
        block.setAttribute('data-block-id', blockId);
        block.style.cssText = T2LC_INLINE_STYLE.block;
        // CMS compatibility: url만이라도 우선 기록해 둔다. 실제 메타데이터는
        // fetch 완료 시 _applyCardData()가 마저 채운다(아래 주석 참고).
        block.dataset.lcUrl = url;

        const link = document.createElement('a');
        link.className = 't2-linkcard-link';
        link.href = (window.T2Utils && window.T2Utils.sanitizeURL) ? window.T2Utils.sanitizeURL(url, 'href') : url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer nofollow ugc';
        link.style.cssText = T2LC_INLINE_STYLE.link;
        // CMS compatibility: duplicate the recovery URL on the anchor because sanitizers may unwrap the outer block.
        link.dataset.lcUrl = url;

        // CMS compatibility: use only span/img descendants inside the anchor; HTML4-style sanitizers may split links around divs.
        const thumb = document.createElement('span');
        thumb.className = 't2-linkcard-thumb';
        thumb.style.cssText = T2LC_INLINE_STYLE.thumb;
        // 이미지가 아직 없으므로(로딩 중) 플레이스홀더만 둔다.
        thumb.appendChild(this._createPlaceholderThumb(url));

        const body = document.createElement('span');
        body.className = 't2-linkcard-body';
        body.style.cssText = T2LC_INLINE_STYLE.body;

        const domainRow = document.createElement('span');
        domainRow.className = 't2-linkcard-domain';
        domainRow.style.cssText = T2LC_INLINE_STYLE.domainRow;
        // 파비콘은 fetch 완료 후에나 알 수 있으므로, 로딩 중에는 우선 범용
        // 아이콘을 둔다(파비콘이 도착하면 _applyCardData 가 교체).
        domainRow.appendChild(this._createGenericDomainIcon());
        const domainText = document.createElement('span');
        domainText.style.cssText = T2LC_INLINE_STYLE.domainText;
        domainText.textContent = this._extractHostname(url);
        domainRow.appendChild(domainText);

        // CMS compatibility: use <strong> for the title so it remains distinguishable even if class/style attributes are removed.
        const titleEl = document.createElement('strong');
        titleEl.className = 't2-linkcard-title';
        titleEl.style.cssText = T2LC_INLINE_STYLE.title + (status === 'loading' ? T2LC_INLINE_STYLE.titleLoading : '');
        titleEl.textContent = status === 'loading'
            ? (window.T2Utils && window.T2Utils.tf ? window.T2Utils.tf('linkcard.loading', {}, '미리보기를 불러오는 중…') : '미리보기를 불러오는 중…')
            : url;

        const descEl = document.createElement('span');
        descEl.className = 't2-linkcard-desc';
        descEl.style.cssText = T2LC_INLINE_STYLE.desc;

        body.appendChild(domainRow);
        // CMS compatibility: display:flex(body)가 style과 함께 걷어내지면
        // domain/title/desc가 공백 하나 없이 한 줄로 붙어버린다. <br>은
        // <a> 자손으로도 허용되는 순수 인라인 요소라 거의 모든 정제기를
        // 통과하므로, CSS 없이도 최소한 줄바꿈은 유지되게 해 둔다.
        body.appendChild(document.createElement('br'));
        body.appendChild(titleEl);
        body.appendChild(document.createElement('br'));
        body.appendChild(descEl);

        link.appendChild(thumb);
        link.appendChild(body);
        block.appendChild(link);
        block.appendChild(this._createControls());

        return block;
    }

    _createPlaceholderThumb(url) {
        const wrap = document.createElement('span');
        wrap.className = 't2-linkcard-placeholder';
        wrap.style.cssText = T2LC_INLINE_STYLE.placeholder;
        const badge = document.createElement('span');
        badge.style.cssText = T2LC_INLINE_STYLE.placeholderBadge;
        const host = this._extractHostname(url);
        badge.textContent = (host.replace(/^www\./, '')[0] || '#').toUpperCase();
        wrap.appendChild(badge);
        return wrap;
    }

    /** Use a Unicode fallback icon so published cards do not depend on the editor-only Material Icons font. */
    _createGenericDomainIcon() {
        const icon = document.createElement('span');
        icon.className = 't2-linkcard-domain-icon';
        icon.style.cssText = T2LC_INLINE_STYLE.domainIcon;
        icon.textContent = '\u{1F310}'; // 🌐
        return icon;
    }

     /** Try server-discovered favicon, then the favicon service, then the local Unicode fallback; stop after final failure. */
    _setDomainIcon(cardBlock, data) {
        const domainRow = cardBlock.querySelector('.t2-linkcard-domain');
        if (!domainRow) return;

        const hostname = this._extractHostname(data.url || '');
        const sanitize = (u) => (window.T2Utils && window.T2Utils.sanitizeURL) ? window.T2Utils.sanitizeURL(u, 'src') : u;

        const candidates = [];
        if (data.favicon) {
            const safe = sanitize(data.favicon);
            if (safe) candidates.push(safe);
        }
        if (hostname) {
            // 구글 파비콘 서비스: 대상 사이트에 직접 요청하지 않아도 되고,
            // 사이트가 아이콘을 감춰뒀거나(SSR에 없는 JS 삽입 등) 우리
            // 서버가 못 찾은 경우에도 대개 뭔가를 반환해준다.
            candidates.push('https://www.google.com/s2/favicons?sz=32&domain=' + encodeURIComponent(hostname));
        }

        if (candidates.length === 0) return; // 폴백 아이콘(범용)을 그대로 둔다.

        const oldIcon = domainRow.querySelector('.t2-linkcard-domain-icon');
        const img = document.createElement('img');
        img.className = 't2-linkcard-domain-icon';
        img.style.cssText = T2LC_INLINE_STYLE.domainFavicon;
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';

        let step = 0;
        const tryNext = () => {
            if (step >= candidates.length) {
                // 전부 실패 — 범용 아이콘으로 되돌린다.
                img.replaceWith(this._createGenericDomainIcon());
                return;
            }
            img.src = candidates[step++];
        };
        img.addEventListener('error', tryNext);
        tryNext();

        if (oldIcon) {
            oldIcon.replaceWith(img);
        } else {
            domainRow.insertBefore(img, domainRow.firstChild);
        }
    }

    _extractHostname(url) {
        try {
            return new URL(url).hostname;
        } catch (_) {
            return url;
        }
    }

    _createControls() {
        const controls = document.createElement('div');
        controls.className = 't2-media-controls';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 't2-btn delete-btn';
        deleteBtn.title = (window.T2Utils && window.T2Utils.tf) ? window.T2Utils.tf('linkcard.delete', {}, '삭제') : '삭제';
        deleteBtn.setAttribute('aria-label', deleteBtn.title);
        const icon = document.createElement('i');
        icon.className = 'material-icons';
        icon.textContent = 'close';
        deleteBtn.appendChild(icon);

        this._bindDeleteButton(deleteBtn);

        controls.appendChild(deleteBtn);
        return controls;
    }

    _bindDeleteButton(btn) {
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const block = btn.closest('.t2-linkcard-block');
            if (block) {
                block.remove();
                this.editor.createUndoPoint();
                this.editor.autoSave();
            }
        });
        // 카드(<a>) 클릭 시 새 탭으로 이동하는 것은 의도된 동작이지만,
        // 컨트롤 영역 자체를 클릭했을 때는 링크로 전파되면 안 된다.
        btn.parentElement && btn.parentElement.addEventListener('click', (ev) => ev.stopPropagation());
    }

    /** 로딩 카드에 실제 fetch 결과를 채워 넣는다. */
    _applyCardData(cardBlock, data) {
        cardBlock.classList.remove('t2-linkcard-loading');
        cardBlock.classList.add('t2-linkcard-loaded');

        const link = cardBlock.querySelector('.t2-linkcard-link');
        const safeHref = (link && data.url)
            ? ((window.T2Utils && window.T2Utils.sanitizeURL) ? window.T2Utils.sanitizeURL(data.url, 'href') : data.url)
            : null;
        if (link && safeHref) link.href = safeHref;

        const siteName = data.siteName || this._extractHostname(data.url || '');
        const domainText = cardBlock.querySelector('.t2-linkcard-domain span');
        if (domainText) domainText.textContent = siteName;

        // 파비콘: 서버가 찾아준 값 → 구글 파비콘 서비스 → 범용 아이콘 순으로 폴백.
        this._setDomainIcon(cardBlock, data);

        const titleEl = cardBlock.querySelector('.t2-linkcard-title');
        if (titleEl) {
            titleEl.textContent = data.title || '';
            // 로딩 상태 전용 색상(#999)을 걷어내고 완료 상태 스타일로 되돌린다.
            titleEl.style.cssText = T2LC_INLINE_STYLE.title;
        }

        const descEl = cardBlock.querySelector('.t2-linkcard-desc');
        if (descEl) {
            if (data.description) {
                descEl.textContent = data.description;
            } else {
                descEl.remove();
            }
        }

        let safeImage = '';
        if (data.image) {
            const thumb = cardBlock.querySelector('.t2-linkcard-thumb');
            if (thumb) {
                safeImage = (window.T2Utils && window.T2Utils.sanitizeURL) ? window.T2Utils.sanitizeURL(data.image, 'src') : data.image;
                if (safeImage) {
                    const img = document.createElement('img');
                    img.style.cssText = T2LC_INLINE_STYLE.thumbImg;
                    // CMS compatibility: retain intrinsic width/height attributes so an unstyled OG image cannot overflow the article.
                    img.setAttribute('width', '144');
                    img.setAttribute('height', '96');
                    img.alt = '';
                    img.loading = 'lazy';
                    img.referrerPolicy = 'no-referrer';
                    // Security: 이미지 로드 실패 시(깨진 링크, 차단 등) 자리표시자로 되돌아간다.
                    img.addEventListener('error', () => {
                        thumb.innerHTML = '';
                        thumb.appendChild(this._createPlaceholderThumb(data.url || ''));
                    }, { once: true });
                    img.src = safeImage;
                    thumb.innerHTML = '';
                    thumb.appendChild(img);
                } else {
                    safeImage = '';
                }
            }
        }

        // CMS compatibility: persist card metadata in data-lc-* so editor restore can rebuild markup stripped by the CMS.
        cardBlock.dataset.lcUrl   = safeHref || data.url || cardBlock.dataset.lcUrl || '';
        cardBlock.dataset.lcTitle = data.title || '';
        if (data.description) cardBlock.dataset.lcDesc = data.description;
        else delete cardBlock.dataset.lcDesc;
        if (safeImage) cardBlock.dataset.lcImage = safeImage;
        else delete cardBlock.dataset.lcImage;
        cardBlock.dataset.lcSite = siteName;
        if (data.favicon) cardBlock.dataset.lcFavicon = data.favicon;
        else delete cardBlock.dataset.lcFavicon;

        // Duplicate recovery metadata on the anchor in case the CMS removes the outer wrapper.
        if (link) {
            link.dataset.lcUrl   = cardBlock.dataset.lcUrl;
            link.dataset.lcTitle = cardBlock.dataset.lcTitle;
            if (cardBlock.dataset.lcDesc) link.dataset.lcDesc = cardBlock.dataset.lcDesc;
            else delete link.dataset.lcDesc;
            if (cardBlock.dataset.lcImage) link.dataset.lcImage = cardBlock.dataset.lcImage;
            else delete link.dataset.lcImage;
            link.dataset.lcSite = cardBlock.dataset.lcSite;
        }
    }

    /** 메타데이터를 가져오지 못한 경우: 카드만 제거한다. 붙여넣은 URL은
     *  이미 위쪽에 평범한 링크 문단으로 남아있으므로 별도 폴백 링크를
     *  또 만들 필요가 없다. 카드 삽입 때 함께 넣었던 빈 여백 문단(zero-width
     *  space)이 앞뒤로 남아있다면 그것도 같이 정리한다. */
    _removeFailedCard(cardBlock) {
        const prev = cardBlock.previousElementSibling;
        const next = cardBlock.nextElementSibling;

        cardBlock.remove();

        [prev, next].forEach((el) => {
            if (el && el.tagName === 'P' && !el.textContent.trim() && !el.querySelector('img, iframe, video, a')) {
                el.remove();
            }
        });
    }

    /** 붙여넣은 URL을 표시할 평범한 하이퍼링크 <a> 요소를 만든다.
     *  (메타데이터 fetch 성공 여부와 무관하게 항상 이 링크가 먼저 남는다.) */
    _createPlainLinkAnchor(url) {
        const a = document.createElement('a');
        a.href = (window.T2Utils && window.T2Utils.sanitizeURL) ? window.T2Utils.sanitizeURL(url, 'href') : url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer nofollow ugc';
        a.textContent = url;
        return a;
    }

    // 링크 문단 + 카드 삽입 유틸 — plugin/video/video.js
    // _insertBlockAtSavedRange() / cleanupEmptyLines() 와 동일한 패턴을
    // 바탕으로 하되, "카드로 대체" 대신 "링크 문단 뒤에 카드 추가"로 확장한
    // 버전이다.
    _insertLinkAndCardAtSavedRange(savedRange, url, cardBlock) {
        if (!cardBlock) return false;
        const linkHost = document.createElement('p');
        linkHost.appendChild(this._createPlainLinkAnchor(url));

        if (this.editor && typeof this.editor._getActiveEditorRange === 'function' &&
            typeof this.editor._insertPastedBlockSequence === 'function') {
            const range = this.editor._getActiveEditorRange(savedRange, { fallback: 'end' });
            const inserted = this.editor._insertPastedBlockSequence([linkHost, cardBlock], range);
            if (inserted) {
                this.editor.ensureBlockBoundaryLines(cardBlock);
                return true;
            }
        }

        // 10.4.0 이전 코어 호환 폴백.
        this.editor.editor.appendChild(linkHost);
        this.editor.editor.appendChild(cardBlock);
        this.editor.normalizeContent();
        return true;
    }

    _cleanupEmptyLines(cardBlock) {
        // 카드 주변의 연속 빈 문단은 사용자 본문일 수 있으므로 삭제하지 않는다.
        if (this.editor && typeof this.editor.ensureBlockBoundaryLines === 'function') {
            this.editor.ensureBlockBoundaryLines(cardBlock);
            return;
        }
        const makeBoundary = () => {
            const p = document.createElement('p');
            p.innerHTML = '<br>';
            return p;
        };
        const isEmpty = (node) => !!(node && node.tagName === 'P' &&
            !(node.textContent || '').replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim());
        if (!isEmpty(cardBlock.previousElementSibling)) cardBlock.parentNode.insertBefore(makeBoundary(), cardBlock);
        if (!isEmpty(cardBlock.nextElementSibling)) cardBlock.parentNode.insertBefore(makeBoundary(), cardBlock.nextSibling);
    }

    _generateBlockId() {
        return `linkcard_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // initializeLinkCardBlocks participates in core restore/undo discovery.
    // Reclone the delete control instead of persisting an initialized flag, which would block listeners after reload.
    /** 카드 내부 구조(썸네일/본문/제목)가 온전한지 확인한다. 하나라도
     *  없으면 CMS 필터 등에 의해 훼손된 것으로 본다. */
    _isCardIntact(block) {
        const link = block.querySelector(':scope > .t2-linkcard-link');
        if (!link) return false;
        return !!(
            link.querySelector('.t2-linkcard-thumb') &&
            link.querySelector('.t2-linkcard-body') &&
            link.querySelector('.t2-linkcard-title')
        );
    }

    /** [CMS-FILTER-FIX] block에 남아있는 data-lc-* 속성만으로 카드 내부
     *  구조(.t2-linkcard-link 이하)를 처음부터 다시 그린다. _createCardElement/
     *  _applyCardData 와 동일한 span 기반 구조·인라인 style을 그대로 재사용해
     *  화면상 차이가 없게 한다. */
    _rebuildCardFromData(block) {
        const url = block.dataset.lcUrl || '';
        if (!url) return false; // 복구에 필요한 최소 정보조차 없음

        const oldLink = block.querySelector(':scope > .t2-linkcard-link');
        if (oldLink) oldLink.remove();

        const fresh = this._createCardElement(url, 'loaded');
        const freshLink = fresh.querySelector('.t2-linkcard-link');
        // block(래퍼)은 그대로 두고 새로 만든 <a> 만 옮겨 붙인다.
        const controls = block.querySelector('.t2-media-controls');
        block.insertBefore(freshLink, controls || null);

        this._applyCardData(block, {
            url: url,
            title: block.dataset.lcTitle || '',
            description: block.dataset.lcDesc || '',
            image: block.dataset.lcImage || '',
            siteName: block.dataset.lcSite || '',
            favicon: block.dataset.lcFavicon || '',
        });
        block.classList.remove('t2-linkcard-loading');
        block.classList.add('t2-linkcard-loaded');
        return true;
    }

    initializeLinkCardBlocks() {
        const blocks = this.editor.editor.querySelectorAll('.t2-linkcard-block');
        blocks.forEach((block) => {
            if (!block.classList.contains('t2-media-block')) {
                block.classList.add('t2-media-block');
            }
            block.setAttribute('contenteditable', 'false');

            // CMS compatibility: 저장된 글을 다시 "수정"하러 들어왔을 때, CMS
            // 필터가 카드 내부 마크업(썸네일/본문 등)을 걷어냈다면 여기서
            // data-lc-* 속성만으로 복구한다. 속성 자체도 없다면(아주 오래된
            // 게시물 등) 복구할 데이터가 없으므로 손대지 않는다.
            if (!this._isCardIntact(block) && block.dataset.lcUrl) {
                this._rebuildCardFromData(block);
            }

            let oldBtn = block.querySelector('.t2-media-controls .delete-btn');
            if (!oldBtn) {
                // 컨트롤 자체가 통째로 사라진 경우(서드파티 정제기 등) 재생성.
                const controls = block.querySelector('.t2-media-controls');
                if (controls) controls.remove();
                block.appendChild(this._createControls());
                return;
            }
            const freshBtn = oldBtn.cloneNode(true);
            oldBtn.replaceWith(freshBtn);
            this._bindDeleteButton(freshBtn);
        });
    }
}

window.T2LinkcardPlugin = T2LinkcardPlugin;

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
