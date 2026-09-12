// Path: T2Editor/plugin/linkcard/linkcard.js
//
// 사용자가 순수 텍스트로 URL 하나만 붙여넣으면(예: "https://example.com/post"),
// 붙여넣은 URL은 평범한 하이퍼링크 문단으로 그대로 남겨두고, 그 바로 아래에
// 서버(linkcard_fetch.php)에서 OG/메타 태그를 가져와 만든 미리보기 카드를
// 추가로 삽입한다(카드로 "대체"하지 않음 — 카드 미리보기를 가져오지 못해도
// 최소한 원래 링크는 항상 남는다).
//
// [충돌 방지] plugin/paste_migrate/paste_migrate.js 는 이미 "붙여넣은 URL"을
// 감지해 이미지/동영상이면 자동으로 블록으로 전환해주는 기능을 갖고 있다
// (_classifyUrl()이 'image'|'video'|'link' 로 분류하되, 'link' 로 분류된
// URL은 그냥 <a> 하이퍼링크로 남긴다 — 카드로 만들지 않는다). 이 플러그인은
// 정확히 그 "link"로 분류될 URL만 노려서 카드로 승격시키는 역할이므로,
// paste_migrate 의 기존 로직을 대체하거나 수정할 필요가 없다.
//
// 우선순위(plugin.json 의 priority=6)를 paste_migrate(7)보다 낮은 숫자로
// 두어, core.js의 handlePaste() 루프에서 이 플러그인이 paste_migrate보다
// 먼저 paste 이벤트를 검사한다. 다만 이 플러그인은 "순수 텍스트로 URL 단
// 하나만" 붙여넣은, 아주 좁은 케이스에서만 true(이벤트 소비)를 반환하고,
// 그 외의 모든 경우(여러 줄, 다른 텍스트와 섞임, 리치 HTML, 이미지/동영상
// URL로 보이는 경우)는 반드시 false를 반환해 paste_migrate·image·video 등
// 기존 파이프라인이 지금과 완전히 동일하게 동작하도록 양보한다. 설령 향후
// paste_migrate의 우선순위가 바뀌어 이 플러그인보다 먼저 실행되더라도,
// 최악의 경우는 "카드로 안 바뀌고 기존처럼 일반 링크로 남는 것"뿐이므로
// 데이터 손실이나 충돌은 발생하지 않는다.

// ────────────────────────────────────────────────────────────────────────
// [INLINE-STYLE] 그누보드5/라이믹스 등 외부 게시판에 최종 저장·노출될 때는
// plugin/linkcard/linkcard.css 는 물론 paste_migrate.css 조차 함께 실려가지
// 않는다(에디터 안에서만 유효한 스타일시트이므로). 그 결과 클래스만으로는
// 카드가 그냥 스타일 없는 텍스트 뭉치로 무너진다.
//
// 그래서 카드를 "만드는 시점"에 레이아웃/색상 값을 style 속성으로도 함께
// 박아 넣는다 — CSS가 실려가지 않는 목적지에서도 카드 모양이 그대로
// 유지되도록 하기 위함. (외부 게시판 필터가 <style> 태그나 class 기반 CSS는
// 걷어내도 인라인 style 속성은 대개 통과시키는 점을 이용한 방어적 선택.)
//
// 에디터 안에서는 linkcard.css 가 여전히 함께 로드되어 hover 효과·로딩
// 펄스 애니메이션·다크테마·반응형(@media)처럼 인라인으로 표현할 수 없는
// 것들을 계속 담당한다. 다크테마 오버라이드는 인라인 스타일보다 우선해야
// 하므로 linkcard.css 쪽에 !important 를 붙여둔다(자세한 설명은
// linkcard.css 상단 주석 참고).
// ────────────────────────────────────────────────────────────────────────
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

    // ────────────────────────────────────────────────────────────────────
    // paste 진입점
    // ────────────────────────────────────────────────────────────────────
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

    // ────────────────────────────────────────────────────────────────────
    // 링크(그대로 유지) + 카드 삽입 + 비동기 메타데이터 fetch
    //
    // [변경] 예전에는 붙여넣은 URL 텍스트 자체를 없애고 그 자리를 카드로
    // "대체"했다. 지금은 붙여넣은 URL을 평범한 하이퍼링크 문단으로 그대로
    // 남겨두고, 그 바로 아래에 카드를 "추가"하는 방식으로 바뀌었다 — 카드
    // 미리보기가 어떤 이유로 실패/차단되어도 최소한 원래 링크는 항상
    // 남아있도록 하기 위함이기도 하다.
    // ────────────────────────────────────────────────────────────────────
    _insertPendingCardAndFetch(url) {
        const selection = window.getSelection();
        const savedRange = (selection && selection.rangeCount) ? selection.getRangeAt(0).cloneRange() : null;

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

    /**
     * 카드 DOM을 직접 생성한다(innerHTML 문자열 조립을 쓰지 않음).
     * URL·제목·설명 등 신뢰할 수 없는 문자열은 전부 textContent/속성 API로만
     * 다루므로, 서버가 돌려준 OG 텍스트(공격자가 자신의 웹페이지 meta 태그에
     * 임의 문자열을 넣을 수 있음)에 마크업이 섞여 있어도 DOM에는 절대
     * 태그로 해석되지 않는다.
     */
    _createCardElement(url, status) {
        const blockId = this._generateBlockId();

        const block = document.createElement('div');
        block.className = 't2-media-block t2-linkcard-block t2-linkcard-' + status;
        block.setAttribute('contenteditable', 'false');
        block.setAttribute('data-block-id', blockId);
        block.style.cssText = T2LC_INLINE_STYLE.block;
        // [CMS-FILTER-FIX] url만이라도 우선 기록해 둔다. 실제 메타데이터는
        // fetch 완료 시 _applyCardData()가 마저 채운다(아래 주석 참고).
        block.dataset.lcUrl = url;

        const link = document.createElement('a');
        link.className = 't2-linkcard-link';
        link.href = (window.T2Utils && window.T2Utils.sanitizeURL) ? window.T2Utils.sanitizeURL(url, 'href') : url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer nofollow ugc';
        link.style.cssText = T2LC_INLINE_STYLE.link;
        // [CMS-FILTER-FIX] 정제기가 "의미 없어 보이는" 바깥 <div>(block)를
        // 통째로 벗겨내고 자식만 남기는 경우, block에만 있던 data-lc-url이
        // 함께 사라진다. <a>는 실제 링크 기능 때문에 거의 모든 정제기가
        // 그대로 남기므로, 같은 값을 <a>에도 중복 기록해 최후의 복구
        // 지점으로 삼는다(hooks.js onRestore가 이 값도 조회함).
        link.dataset.lcUrl = url;

        // [CMS-FILTER-FIX] <a> 의 자손은 전부 인라인 요소(span/img)로만 구성한다.
        // 일부 게시판의 HTML 정제기(특히 HTML4 기준으로 동작하는 것들)는
        // "a는 인라인 콘텐츠만 담을 수 있다"고 간주해, <a> 안에 <div> 같은
        // block 요소가 있으면 그 지점에서 <a>를 강제로 닫았다가 다시 열어
        // 카드가 여러 조각의 링크로 쪼개지는(그리고 클릭 영역이 깨지는)
        // 문제가 있었다. span은 어떤 정제기에서도 a의 자손으로 허용되며,
        // 레이아웃은 이미 인라인 style(display:flex 등)로 지정하므로 태그를
        // div→span으로 바꿔도 화면에는 변화가 없다.
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

        // [CMS-FILTER-FIX] span 대신 <strong>을 쓴다 — class/style이 모두
        // 걷어내져도 <strong>은 브라우저 기본 스타일(굵게)만으로 카드 제목이
        // 나머지 텍스트와 시각적으로 구분되도록 해 준다(image가 <img> 자체의
        // 기본 렌더링에 기대는 것과 같은 원리). 클래스명은 그대로 유지해
        // linkcard.css 셀렉터(.t2-linkcard-title)에는 영향이 없다.
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
        // [CMS-FILTER-FIX] display:flex(body)가 style과 함께 걷어내지면
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

    /** 도메인 앞의 기본(범용) 아이콘 — 파비콘을 아직 모르거나 전부 실패했을 때.
     *  [CMS-FILTER-FIX] 예전에는 material-icons 아이콘 폰트(class="material-icons",
     *  textContent="public")에 의존했는데, 그 폰트/CSS는 에디터 안에서만
     *  로드된다. 그누보드5/라이믹스 게시물 보기 화면처럼 그 CSS가 실려가지
     *  않는 곳에서는 아이콘 대신 "public" 이라는 글자가 그대로 노출되는
     *  문제가 있었다. 외부 폰트/CSS 의존이 전혀 없는 유니코드 글리프로
     *  대체해, 어디서 렌더링되든 항상 같은 모양으로 보이게 한다. */
    _createGenericDomainIcon() {
        const icon = document.createElement('span');
        icon.className = 't2-linkcard-domain-icon';
        icon.style.cssText = T2LC_INLINE_STYLE.domainIcon;
        icon.textContent = '\u{1F310}'; // 🌐
        return icon;
    }

    /**
     * 도메인 앞에 파비콘 <img> 를 붙인다. 사이트마다 파비콘 유무·형식이
     * 제각각이므로 다단계 폴백을 둔다:
     *   1) 서버(linkcard_fetch.php)가 페이지의 <link rel="icon"> 류를 파싱해
     *      돌려준 favicon
     *   2) 그것이 없거나 로드 실패하면, 구글 파비콘 서비스(대상 사이트에
     *      아이콘이 있는 한 거의 항상 뭔가를 돌려줌)
     *   3) 그마저 실패하면 범용 material 아이콘으로 되돌아간다.
     * 각 단계는 <img>의 error 이벤트로 연쇄되며, 이미 최종 실패 상태이면
     * 무한 루프 방지를 위해 더 이상 재시도하지 않는다.
     */
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
                    // [CMS-FILTER-FIX] style 속성 전체가 걷어내지는 정제기 대비:
                    // width/height는 style이 아니라 <img> 고유의 표준 HTML
                    // 속성이라 대부분의 필터가 style·class와 별개로 취급해
                    // 남겨 둔다. 이게 없으면 원본 OG 이미지(보통 1200x630 등)가
                    // 자연폭 그대로 렌더링되어 카드는 물론 게시물 레이아웃
                    // 전체가 무너진다(image 플러그인의 OVERFLOW-FIX와 동일한
                    // 문제의 linkcard 버전).
                    img.setAttribute('width', '144');
                    img.setAttribute('height', '96');
                    img.alt = '';
                    img.loading = 'lazy';
                    img.referrerPolicy = 'no-referrer';
                    // [SEC] 이미지 로드 실패 시(깨진 링크, 차단 등) 자리표시자로 되돌아간다.
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

        // [CMS-FILTER-FIX] 지금까지 화면에 채운 값을 block 자체의 data-lc-*
        // 속성으로도 그대로 남겨 둔다. <a>/<img>/텍스트 등 내부 마크업은
        // 게시판 HTML 정제기가 재배치·삭제할 수 있어도, 평범한 <div> 의
        // data-* 속성은 거의 항상 살아남는다(video 플러그인이 data-video-url
        // 등으로 같은 문제를 해결한 것과 동일한 접근). 게시물 보기 화면
        // 자체는 이제 별도 스크립트 없이 css/content.css(editor.lib.php가
        // t2-media-block 클래스를 감지해 게시 시 <link>로 자동 첨부, image·
        // code·table·drawing 블록과 동일한 방식)로 렌더링되고, 이 data-lc-*
        // 속성은 hooks.js의 onRestore(에디터 재진입)가 카드 내부 마크업이
        // 무너졌을 때 처음부터 다시 그려 복구하는 용도로 쓰인다.
        cardBlock.dataset.lcUrl   = safeHref || data.url || cardBlock.dataset.lcUrl || '';
        cardBlock.dataset.lcTitle = data.title || '';
        if (data.description) cardBlock.dataset.lcDesc = data.description;
        else delete cardBlock.dataset.lcDesc;
        if (safeImage) cardBlock.dataset.lcImage = safeImage;
        else delete cardBlock.dataset.lcImage;
        cardBlock.dataset.lcSite = siteName;
        if (data.favicon) cardBlock.dataset.lcFavicon = data.favicon;
        else delete cardBlock.dataset.lcFavicon;

        // [CMS-FILTER-FIX] 위 block(바깥 <div>) 뿐 아니라 <a>(link)에도 동일한
        // 값을 복사해 둔다 — 정제기가 "의미 없는" 바깥 div를 벗겨내고 자식만
        // 남기는 경우에도 hooks.js onRestore가 <a>의 data-lc-*로 카드를 되살릴
        // 수 있도록 하기 위함(link.dataset.lcUrl은 _createCardElement에서
        // 이미 채워짐).
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

    // ────────────────────────────────────────────────────────────────────
    // 링크 문단 + 카드 삽입 유틸 — plugin/video/video.js
    // _insertBlockAtSavedRange() / cleanupEmptyLines() 와 동일한 패턴을
    // 바탕으로 하되, "카드로 대체" 대신 "링크 문단 뒤에 카드 추가"로 확장한
    // 버전이다.
    // ────────────────────────────────────────────────────────────────────
    _insertLinkAndCardAtSavedRange(savedRange, url, cardBlock) {
        if (!cardBlock) return false;

        const selection = window.getSelection();
        if (selection && savedRange) {
            try {
                selection.removeAllRanges();
                selection.addRange(savedRange);
            } catch (_) { /* selection 복구 실패 시 fallback 삽입으로 진행 */ }
        }

        const currentBlock = savedRange ? this.editor.getClosestBlock(savedRange.startContainer) : null;
        const linkAnchor = this._createPlainLinkAnchor(url);

        if (currentBlock && currentBlock !== this.editor.editor && currentBlock.parentNode) {
            const isEmptyBlock = !currentBlock.textContent.trim() && !currentBlock.querySelector('img, iframe, video');

            let linkHost;
            if (isEmptyBlock) {
                // 사용자가 빈 문단에 URL만 붙여넣은 흔한 경우: 그 문단을 그대로
                // 링크 문단으로 재사용한다(불필요한 빈 문단을 새로 만들지 않음).
                currentBlock.innerHTML = '';
                currentBlock.appendChild(linkAnchor);
                linkHost = currentBlock;
            } else {
                // 커서 위치에 이미 다른 내용이 있는 경우: 원래 문단은 그대로 두고
                // 바로 뒤에 링크 전용 문단을 새로 추가한다.
                linkHost = document.createElement('p');
                linkHost.appendChild(linkAnchor);
                currentBlock.parentNode.insertBefore(linkHost, currentBlock.nextSibling);
            }

            linkHost.parentNode.insertBefore(cardBlock, linkHost.nextSibling);

            const bottomBreak = document.createElement('p');
            bottomBreak.textContent = '\u200B';
            cardBlock.parentNode.insertBefore(bottomBreak, cardBlock.nextSibling);

            this._cleanupEmptyLines(cardBlock);

            if (selection) {
                const newRange = document.createRange();
                newRange.setStartAfter(bottomBreak);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
            }

            return true;
        }

        // 빈 에디터 또는 selection 이 에디터 루트인 경우.
        const linkHost = document.createElement('p');
        linkHost.appendChild(linkAnchor);

        const bottomBreak = document.createElement('p');
        bottomBreak.textContent = '\u200B';

        this.editor.editor.appendChild(linkHost);
        this.editor.editor.appendChild(cardBlock);
        this.editor.editor.appendChild(bottomBreak);

        if (selection) {
            const newRange = document.createRange();
            newRange.setStart(bottomBreak, 0);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }

        return true;
    }

    _cleanupEmptyLines(cardBlock) {
        let prev = cardBlock.previousElementSibling;
        let emptyCount = 0;
        const toRemove = [];

        while (prev && prev.tagName === 'P' &&
               !prev.textContent.trim() &&
               (prev.innerHTML === '<br>' || prev.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) toRemove.push(prev);
            prev = prev.previousElementSibling;
        }

        let next = cardBlock.nextElementSibling;
        emptyCount = 0;

        while (next && next.tagName === 'P' &&
               !next.textContent.trim() &&
               (next.innerHTML === '<br>' || next.querySelector('br'))) {
            emptyCount++;
            if (emptyCount > 1) toRemove.push(next);
            next = next.nextElementSibling;
        }

        toRemove.forEach(el => el.remove());
    }

    _generateBlockId() {
        return `linkcard_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // ────────────────────────────────────────────────────────────────────
    // [MODERNIZATION] "initialize<Something>Blocks" 명명 규칙을 따르는
    // 메서드다 — core.js의 _reinitializePluginBlocks()가 undo/redo·자동저장
    // 복원 후 이 메서드를 자동으로 찾아 호출해준다(core.js를 전혀 수정할
    // 필요가 없다). 저장된 HTML에서 로드된 카드에는 삭제 버튼 이벤트가
    // 없으므로 여기서 재부착한다.
    //
    // "이미 초기화된 블록"을 데이터 속성 플래그로 기억해두는 방식은 그 플래그가
    // DB에 그대로 저장되면 새로고침 후 재연결이 막히는 문제가 있었다
    // (code.js 참고: data-events-setup가 DB에 남아 이벤트 재연결 차단).
    // 그래서 여기서는 플래그 대신 삭제 버튼을 매번 cloneNode로 교체해
    // 리스너를 안전하게 새로 붙인다(중복 바인딩·스테일 플래그 둘 다 방지).
    // ────────────────────────────────────────────────────────────────────
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

            // [CMS-FILTER-FIX] 저장된 글을 다시 "수정"하러 들어왔을 때, CMS
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