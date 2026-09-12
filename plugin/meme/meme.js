// Path: T2Editor/plugin/meme/meme.js
// Developer note: 플러그인 ID "meme"과 command/button ID는 등록 설정·button.json·locale 키와 함께 변경한다.
//
// 밈 플러그인 리팩터링
// 과거: API URL 을 <img src="..."> 로 직접 삽입 (외부 호스팅 의존, 만료 시 깨짐)
// 신규: API URL 의 이미지를 다운로드하여 File 객체로 변환 후,
//       image 플러그인의 공개 API uploadImageFile(file) 을 호출하여
//       NSFW 검사 · base64 미리보기 · 서버 업로드 를 모두 image 플러그인 흐름에 위임.
// 제약: image 플러그인은 수정하지 않음 (공개 API 만 호출).

class T2MemePlugin extends T2ImagePlugin {
    constructor(editor) {
        super(editor);
        this.commands = ['insertMeme'];
        this.directMemeApiUrl = 'https://dsclub.kr/api/meme/index.php';
        const editorBase = this._getEditorBaseUrl();
        this.memeApiUrl = editorBase ? `${editorBase}/plugin/meme/meme_api_proxy.php` : this.directMemeApiUrl;
        this.usingSameOriginProxy = Boolean(editorBase);
        this._ms = {          // meme state
            page: 1,
            limit: 24,
            loading: false,
            hasMore: true,
            query: '',
            modal: null,
            timer: null,
            scrollObserver: null,
            lazyObserver: null,
            fallbackScrollHandler: null,
            modalEscHandler: null,
            previousFocus: null,
            // 진행 중인 다운로드/업로드 추적 — 중복 클릭 방지
            pendingInserts: new Set(),
        };
        this._savedRange = null; // 선택 영역(커서 위치) 저장을 위한 변수 추가
    }

    // T2ImagePlugin.handleCommand 완전 오버라이드
    handleCommand(command) {
        if (command === 'insertMeme') {
            this._saveSelection(); // 모달이 포커스를 빼앗기 전 현재 커서 위치 저장
            this._openModal();
            return true; // 기본 동작 방지
        }
    }

    _getEditorBaseUrl() {
        const base = (typeof t2editor_url !== 'undefined' && t2editor_url)
            ? t2editor_url
            : ((typeof window !== 'undefined' && window.T2EDITOR_URL) || '');
        return String(base || '').replace(/\/+$/, '');
    }

    async _fetchApiWithFallback(queryString) {
        const proxyUrl = `${this.memeApiUrl}?${queryString}`;
        if (this.usingSameOriginProxy) {
            try {
                const response = await fetch(proxyUrl, {
                    headers: { Accept: 'application/json' },
                    credentials: 'same-origin'
                });
                if (response.ok || (response.status !== 404 && response.status !== 405)) {
                    return response;
                }
            } catch (error) {
                console.warn('[T2MemePlugin] same-origin API proxy unavailable, trying direct API:', error);
            }
        }
        return fetch(`${this.directMemeApiUrl}?${queryString}`, {
            headers: { Accept: 'application/json' },
            referrerPolicy: 'no-referrer'
        });
    }

    // Selection 관리
    _saveSelection() {
        if (this.editor && typeof this.editor.captureSelectionBookmark === 'function') {
            this._savedRange = this.editor.captureSelectionBookmark() || this.editor._lastEditorBookmark || null;
            return;
        }
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (this.editor.editor.contains(range.startContainer)) this._savedRange = range.cloneRange();
        }
    }

    _restoreSelection() {
        if (this.editor && typeof this.editor.restoreSelectionBookmark === 'function') {
            return this.editor.restoreSelectionBookmark(this._savedRange || this.editor._lastEditorBookmark, {
                focus: true,
                preventScroll: true
            });
        }
        if (!this._savedRange) return false;
        try {
            this.editor.editor.focus();
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(this._savedRange);
            return true;
        } catch (_) {
            return false;
        }
    }

    // Modal
    _openModal() {
        const s = this._ms;
        Object.assign(s, { page: 1, hasMore: true, query: '', loading: false });
        s.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this._destroyObservers();

        // DOM 객체 대신 HTML 문자열로 생성합니다.
        const modalHtml = `
            <div class="t2-meme-modal" role="dialog" aria-modal="true" aria-label="T2Meme">
                <div class="t2-meme-header">
                    <div class="t2-meme-header-top">
                        <div class="t2-meme-title-wrap">
                            <span class="t2-meme-title">
                                <span class="t2-meme-title-icon material-icons">sentiment_very_satisfied</span>
                                <span>T2Meme</span>
                            </span>
                            <p class="t2-meme-desc" data-i18n="meme.description">${T2Utils.t('meme.description')}</p>
                            <a href="https://dsclub.kr/service/meme" target="_blank" rel="noopener noreferrer" class="t2-meme-powered">
                                <span class="material-icons">info</span>
                                <span>${T2Utils.t('meme.powered_by')} <b>T2Meme</b></span>
                            </a>
                        </div>
                        <button type="button" class="t2-meme-icon-close" data-i18n-aria-label="common.close" aria-label="${T2Utils.t('common.close')}">
                            <span class="material-icons">close</span>
                        </button>
                    </div>
                    <div class="t2-meme-search-wrap">
                        <span class="material-icons t2-meme-search-icon">search</span>
                        <input type="text" class="t2-meme-search" data-i18n-placeholder="meme.search_placeholder" placeholder="${T2Utils.t('meme.search_placeholder')}" autocomplete="off" spellcheck="false">
                    </div>
                </div>
                <div class="t2-meme-body">
                    <div class="t2-meme-grid"></div>
                    <div class="t2-meme-loader">
                        <span class="material-icons t2-meme-spin">sync</span>
                    </div>
                    <div class="t2-meme-empty">
                        <span class="material-icons">search_off</span>
                        <p data-i18n="meme.no_results">${T2Utils.t('meme.no_results')}</p>
                    </div>
                    <div class="t2-meme-sentinel"></div>
                </div>
                <div class="t2-meme-footer">
                    <a href="https://dsclub.kr/service/meme/" target="_blank" rel="noopener" class="t2-meme-reg-btn">
                        <span class="material-icons">add_photo_alternate</span>
                        <span data-i18n="meme.register_meme">${T2Utils.t('meme.register_meme')}</span>
                    </a>
                    <button type="button" class="t2-meme-close-btn" data-i18n="common.close">${T2Utils.t('common.close')}</button>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.className = 't2-modal-overlay t2-meme-overlay';

        // 모달은 body에 붙기 때문에, 에디터 컨테이너/HTML 테마 상속이 끊기는 환경을 보정한다.
        const rootTheme = document.documentElement.getAttribute('data-t2editor-theme');
        const editorTheme = this.editor?.container?.closest?.('[data-t2editor-theme]')?.getAttribute('data-t2editor-theme');
        const systemDarkMode = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        const isDarkTheme = rootTheme === 'dark' || editorTheme === 'dark' || (!rootTheme && systemDarkMode);
        modal.classList.toggle('t2-meme-dark', isDarkTheme);
        modal.classList.toggle('t2-meme-light', !isDarkTheme);

        modal.innerHTML = modalHtml;
        const dialog = modal.querySelector('.t2-meme-modal');
        if (dialog) dialog.setAttribute('tabindex', '-1');

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this._closeModal();
            }
        });

        s.modalEscHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this._closeModal();
                return;
            }
            if (e.key !== 'Tab' || !dialog) return;
            const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
                .filter(el => el.offsetParent !== null);
            if (!focusable.length) {
                e.preventDefault();
                dialog.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', s.modalEscHandler);

        document.body.appendChild(modal);
        s.modal = modal;

        const search   = modal.querySelector('.t2-meme-search');
        const grid     = modal.querySelector('.t2-meme-grid');
        const loader   = modal.querySelector('.t2-meme-loader');
        const emptyEl  = modal.querySelector('.t2-meme-empty');
        const sentinel = modal.querySelector('.t2-meme-sentinel');
        const body      = modal.querySelector('.t2-meme-body');

        loader.style.display  = 'none';
        emptyEl.style.display = 'none';

        // 닫기
        modal.querySelectorAll('.t2-meme-close-btn, .t2-meme-icon-close').forEach(btn => {
            btn.addEventListener('click', () => this._closeModal());
        });

        // 검색 (X 버튼 제거됨 - 자동으로만 지워짐)
        search.addEventListener('input', e => {
            clearTimeout(s.timer);
            const v = e.target.value.trim();
            s.timer = setTimeout(() => {
                s.query = v;
                s.page  = 1;
                s.hasMore = true;
                grid.innerHTML = '';
                emptyEl.style.display = 'none';
                const body = modal.querySelector('.t2-meme-body');
                if (body) body.scrollTop = 0;
                this._fetch(grid, loader, emptyEl);
            }, 380);
        });

        // IntersectionObserver 미지원 브라우저에서도 검색과 이미지 표시가 중단되지 않게 폴백한다.
        if (typeof IntersectionObserver === 'function') {
            s.scrollObserver = new IntersectionObserver(entries => {
                if (entries[0].isIntersecting && !s.loading && s.hasMore) {
                    this._fetch(grid, loader, emptyEl);
                }
            }, { threshold: 0 });
            s.scrollObserver.observe(sentinel);

            s.lazyObserver = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            img.removeAttribute('data-src');
                            s.lazyObserver.unobserve(img);
                        }
                    }
                });
            }, { rootMargin: '300px 0px' });
        } else {
            s.fallbackScrollHandler = () => {
                if (!body || s.loading || !s.hasMore) return;
                if (body.scrollTop + body.clientHeight >= body.scrollHeight - 240) {
                    this._fetch(grid, loader, emptyEl);
                }
            };
            if (body) body.addEventListener('scroll', s.fallbackScrollHandler);
            s.lazyObserver = {
                observe(img) {
                    if (img && img.dataset && img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                    }
                },
                unobserve() {},
                disconnect() {}
            };
        }

        this._fetch(grid, loader, emptyEl);
        setTimeout(() => (search || dialog)?.focus(), 100);
    }

    _closeModal() {
        this._destroyObservers();
        const s = this._ms;

        if (s.timer) {
            clearTimeout(s.timer);
            s.timer = null;
        }

        if (s.modalEscHandler) {
            document.removeEventListener('keydown', s.modalEscHandler);
            s.modalEscHandler = null;
        }

        if (s.modal) {
            s.modal.remove();
            s.modal = null;
        }
        if (s.previousFocus && document.contains(s.previousFocus)) {
            try { s.previousFocus.focus({ preventScroll: true }); }
            catch (error) { s.previousFocus.focus(); }
        }
        s.previousFocus = null;
    }

    _destroyObservers() {
        const s = this._ms;
        if (s.scrollObserver) { s.scrollObserver.disconnect(); s.scrollObserver = null; }
        if (s.lazyObserver)   { s.lazyObserver.disconnect();  s.lazyObserver = null; }
        if (s.fallbackScrollHandler && s.modal) {
            const body = s.modal.querySelector('.t2-meme-body');
            if (body) body.removeEventListener('scroll', s.fallbackScrollHandler);
        }
        s.fallbackScrollHandler = null;
    }

    // API fetch
    async _fetch(grid, loader, emptyEl) {
        const s = this._ms;
        if (s.loading || !s.hasMore) return;
        s.loading = true;
        loader.style.display = 'flex';

        try {
            const qs = new URLSearchParams({
                q:     s.query,
                page:  s.page,
                limit: s.limit
            });
            const res = await this._fetchApiWithFallback(qs.toString());
            if (!res.ok) throw new Error('HTTP ' + res.status);

            const json = await res.json();
            if (!json.success) throw new Error(json.message || T2Utils.tf('meme.api_error', {}, 'API error'));

            const items = json.data || [];

            if (items.length === 0 && s.page === 1) {
                emptyEl.style.display = 'flex';
            } else {
                emptyEl.style.display = 'none';
                const frag = document.createDocumentFragment();
                items.forEach(m => frag.appendChild(this._createTile(m)));
                grid.appendChild(frag);
                s.page++;
                s.hasMore = items.length >= s.limit;
            }
        } catch (err) {
            console.error('[T2MemePlugin] fetch error:', err);
            if (s.page === 1) emptyEl.style.display = 'flex';
        } finally {
            s.loading = false;
            loader.style.display = 'none';
        }
    }

    // Tile
    _createTile(meme) {
        const s = this._ms;
        const tile = document.createElement('div');
        tile.className = 't2-meme-tile';
        tile.setAttribute('role', 'button');
        tile.setAttribute('tabindex', '0');
        tile.title = Array.isArray(meme.tags) ? meme.tags.map(t => '#' + t).join(' ') : '';

        // 이미지 (lazy)
        const imgWrap = document.createElement('div');
        imgWrap.className = 't2-meme-img-wrap';

        const img = document.createElement('img');
        img.dataset.src = meme.url;
        // 1×1 투명 SVG placeholder (네트워크 요청 없음)
        img.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/%3E";
        img.alt  = tile.title;
        img.decoding = 'async';
        img.addEventListener('error', () => { img.closest('.t2-meme-tile')?.classList.add('t2-meme-tile-err'); });
        if (s.lazyObserver) s.lazyObserver.observe(img);

        imgWrap.appendChild(img);

        // 메타 정보 (태그 출력 제거됨)
        const meta = document.createElement('div');
        meta.className = 't2-meme-meta';

        meta.innerHTML = `
            ${meme.poster ? `<div class="t2-meme-poster">${this._esc(meme.poster)}</div>` : ''}
        `;

        tile.appendChild(imgWrap);
        tile.appendChild(meta);

        // 클릭 / 키보드 — [v10.0.0-beta2.4.0] 비동기 다운로드+업로드 흐름
        const onActivate = () => this._insertBlock(meme);
        tile.addEventListener('click', (e) => {
            e.preventDefault();
            onActivate();
        });
        tile.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivate();
            }
        });

        return tile;
    }

    _esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // 이미지 다운로드 → image 플러그인 업로드 연계
    //
    // 과거 _insertBlock(url) 은 URL 을 그대로 <img src> 로 삽입하여 외부 호스팅 의존.
    // 신규 _insertBlock(meme) 은:
    //   1. 모달 닫기 + selection 복원
    //   2. _downloadImageAsFile(url) 로 fetch → blob → File 객체 생성
    //   3. image 플러그인 공개 API uploadImageFile(file) 호출
    //      → NSFW 검사 · base64 미리보기 · 큐 업로드 · 서버 업로드 모두 image 플러그인이 처리
    //
    // image 플러그인은 수정하지 않으며, 공개 API 만 호출하여 연계.

    async _insertBlock(meme) {
        const s = this._ms;
        const url = meme && meme.url;
        if (!url || typeof url !== 'string') {
            console.warn(T2Utils.tf('meme.console_invalid_object', {}, '[T2MemePlugin] Invalid meme object:'), meme);
            return;
        }

        // 중복 클릭 방지 — 동일 URL 의 다운로드/업로드가 진행 중이면 무시
        if (s.pendingInserts.has(url)) {
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification(T2Utils.t('meme.inserting_wait'), 'info');
            }
            return;
        }
        s.pendingInserts.add(url);

        // 모달 닫기 + selection 복원 (image 플러그인 uploadImageFile 이 _saveEditorRange 를
        // 다시 호출하지만, 모달이 닫히기 전에 미리 에디터 selection 을 복원해 두어야 함)
        this._closeModal();
        this._restoreSelection();

        // image 플러그인이 selection 을 잃지 않도록 _savedEditorRange 도 동기화
        // (부모 클래스 T2ImagePlugin 의 _saveEditorRange 호출)
        try {
            this._saveEditorRange();
        } catch (_) { /* 무시 */ }

        try {
            // 1. URL → File 객체 변환
            const file = await this._downloadImageAsFile(url, meme.id);

            // 2. image 플러그인 공개 API 로 업로드 흐름 위임
            //    uploadImageFile(file) → handleMultipleImageInsert([file])
            //      → processImageFile (FileReader + dataURL + Image.onload)
            //      → applyNSFWFilter (활성 시)
            //      → insertImageBlocks (createImageBlock, DOM 삽입)
            //      → queueUpload (서버 업로드, updateImageBlock)
            if (typeof super.uploadImageFile === 'function') {
                await super.uploadImageFile(file);
            } else if (typeof this.uploadImageFile === 'function') {
                await this.uploadImageFile(file);
            } else {
                throw new Error(T2Utils.tf('meme.image_api_missing', {}, 'Cannot find uploadImageFile API of image plugin.'));
            }
        } catch (err) {
            console.error(T2Utils.tf('meme.console_image_add_failed', {}, '[T2MemePlugin] Failed to add image:'), err);
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification(
                    T2Utils.t('meme.insert_failed', { error: (err && err.message ? err.message : T2Utils.t('meme.error_unknown')) }),
                    'error'
                );
            } else {
                alert(T2Utils.t('meme.insert_failed_short'));
            }
        } finally {
            // 진행 중 추적 해제
            s.pendingInserts.delete(url);
        }
    }

    // URL 의 이미지를 다운로드하여 File 객체로 반환.
    //
    // [v10.3.0 - BUG FIX] 밈 이미지 다운로드 실패 수정.
    //   T2Meme API 의 이미지 서버는 CORS 헤더(Access-Control-Allow-Origin)를
    //   보내지 않으므로, 사용자 사이트(다른 오리진)에서는 fetch 도
    //   canvas(crossOrigin='anonymous') 도 항상 실패했다:
    //     "이미지 다운로드 실패 (fetch: Failed to fetch,
    //      canvas: Image 로드 실패 (CORS 또는 네트워크))"
    //   → 같은 오리진의 서버측 프록시(plugin/meme/meme_proxy.php)를 1차로
    //     사용한다. 서버에는 CORS 제약이 없고, 프록시 응답은 same-origin
    //     이므로 브라우저에서 항상 읽을 수 있다.
    //
    // 시도 순서:
    //   1차: 서버측 프록시 (same-origin — CORS 무관, 권장 경로)
    //   2차: fetch(url) 직접 (원격 서버가 CORS 를 허용하는 경우)
    //   3차: Image() + canvas.toBlob (렌더링만 허용되는 극히 드문 경우)
    //
    // - mime → 확장자 매핑: image/jpeg→.jpg, image/png→.png, image/gif→.gif,
    //   image/webp→.webp, image/bmp→.bmp. 알 수 없는 mime 은 .jpg 기본값.
    // - 파일명: `meme_{id 또는 timestamp}.{ext}` — image 플러그인 validateImageFile 이
    //   확장자로 검사하므로 반드시 올바른 확장자 포함.
    async _downloadImageAsFile(url, idHint) {
        // URL 검증 — http(s) 만 허용 (data:, blob:, javascript: 등 차단)
        const safeUrl = this._sanitizeImageSrc(url);
        if (!safeUrl) {
            throw new Error(T2Utils.tf('meme.invalid_image_url', {}, 'Disallowed image URL.'));
        }

        // 1차 시도: 서버측 프록시 (same-origin)
        let proxyErr = null;
        try {
            return await this._downloadViaProxy(safeUrl, idHint);
        } catch (err) {
            proxyErr = err;
            console.warn('[T2MemePlugin] proxy 1차 실패, direct fetch 시도:', err.message);
        }

        // 2차 시도: fetch + blob (원격 서버가 CORS 허용 시에만 성공)
        try {
            const response = await fetch(safeUrl, {
                mode: 'cors',
                credentials: 'omit',
                redirect: 'follow',
                referrerPolicy: 'no-referrer',
            });
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            const blob = await response.blob();
            // blob.type 이 image/* 인지 검증
            const mime = (blob.type || '').toLowerCase();
            if (!mime.startsWith('image/')) {
                throw new Error('이미지가 아닌 콘텐츠 (mime: ' + (mime || 'unknown') + ')');
            }
            const ext = this._mimeToExt(mime);
            const filename = this._makeFilename(idHint, ext);
            return new File([blob], filename, { type: mime });
        } catch (primaryErr) {
            // 3차 fallback: Image + canvas.toBlob
            console.warn('[T2MemePlugin] fetch 2차 실패, canvas fallback 시도:', primaryErr.message);
            try {
                const file = await this._downloadViaCanvas(safeUrl, idHint);
                return file;
            } catch (fallbackErr) {
                // 전부 실패 — 각 단계의 에러를 합쳐서 throw
                const merged = new Error(
                    '이미지 다운로드 실패 (proxy: ' + (proxyErr ? proxyErr.message : '-') +
                    ', fetch: ' + primaryErr.message +
                    ', canvas: ' + fallbackErr.message + ')'
                );
                merged.cause = { proxy: proxyErr, primary: primaryErr, fallback: fallbackErr };
                throw merged;
            }
        }
    }

    // 서버측 프록시(plugin/meme/meme_proxy.php)를 통한 다운로드.
    // same-origin 요청이므로 CORS 제약이 없으며, 프록시가 호스트 allowlist·
    // 크기 제한·이미지 매직바이트 검증을 서버측에서 수행한다.
    async _downloadViaProxy(url, idHint) {
        // 프록시 엔드포인트 URL 계산 — image 플러그인의 image_upload.php 와
        // 동일하게 전역 t2editor_url(T2EDITOR_URL) 기준으로 해석한다.
        const base = (typeof t2editor_url !== 'undefined' && t2editor_url)
            ? t2editor_url
            : (typeof window !== 'undefined' && window.T2EDITOR_URL) || '';
        if (!base) {
            throw new Error(T2Utils.tf('meme.proxy_url_missing', {}, 'Cannot resolve editor base URL for meme proxy.'));
        }

        const proxyUrl = base.replace(/\/+$/, '') +
            '/plugin/meme/meme_proxy.php?url=' + encodeURIComponent(url);

        // 타임아웃 가드 (25초) — 프록시측 타임아웃(20초)보다 약간 길게
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 25000) : null;

        let response;
        try {
            response = await fetch(proxyUrl, {
                credentials: 'same-origin',
                signal: controller ? controller.signal : undefined,
            });
        } finally {
            if (timer) clearTimeout(timer);
        }

        if (!response.ok) {
            // 프록시는 실패 시 JSON {success:false, message} 를 반환
            let detail = 'HTTP ' + response.status;
            try {
                const json = await response.json();
                if (json && json.message) detail += ' — ' + json.message;
            } catch (_) { /* JSON 이 아니면 상태코드만 사용 */ }
            throw new Error(detail);
        }

        const blob = await response.blob();
        const mime = (blob.type || '').toLowerCase();
        if (!mime.startsWith('image/')) {
            throw new Error('이미지가 아닌 콘텐츠 (mime: ' + (mime || 'unknown') + ')');
        }
        const ext = this._mimeToExt(mime);
        const filename = this._makeFilename(idHint, ext);
        return new File([blob], filename, { type: mime });
    }

    // Canvas fallback: Image 로 로드 후 canvas.toBlob → File
    // 주의: crossOrigin 이미지는 canvas 를 taint 시켜 toBlob 이 SecurityError throw.
    //       이 경우 최종 실패로 처리.
    //
    // [v10.0.0-beta2.4.0 - QC1/QC2 패치]
    //   - 타임아웃/에러 시 img.src='' 로 백그라운드 로딩 중단 (네트워크/메모리 정리)
    //   - settled 플래그로 resolve/reject 중복 호출 방지
    //   - onload/onerror 핸들러를 깔끔하게 정리 (IIFE 래퍼 제거, 가독성 개선)
    _downloadViaCanvas(url, idHint) {
        return new Promise((resolve, reject) => {
            let settled = false;
            let timer = null;
            const img = new Image();
            // crossOrigin='anonymous' 설정 — 서버가 CORS 허용하지 않으면 onerror 또는 toBlob SecurityError
            img.crossOrigin = 'anonymous';
            img.decoding = 'async';

            const cleanup = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                // img.src 를 빈 문자열로 설정하여 백그라운드 로딩 중단
                // (브라우저가 네트워크 요청 취소 + 메모리 해제)
                try { img.src = ''; } catch (_) { /* noop */ }
                // 핸들러 해제 (재호출 방지)
                img.onload = null;
                img.onerror = null;
            };

            const fail = (err) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(err);
            };

            const succeed = (file) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(file);
            };

            // 타임아웃 가드 (30초) — 무한 대기 방지
            timer = setTimeout(() => {
                fail(new Error(T2Utils.tf('meme.image_load_timeout', {}, 'Image load timeout (30s)')));
            }, 30000);

            img.onload = () => {
                try {
                    // 원본 naturalWidth/Height 사용 (이미지 품질 보존)
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;
                    if (!w || !h) {
                        fail(new Error(T2Utils.tf('meme.image_dim_unknown', {}, 'Cannot determine image dimensions.')));
                        return;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        fail(new Error(T2Utils.tf('meme.canvas_context_failed', {}, 'Failed to create canvas 2d context')));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, w, h);

                    // PNG 로 내보내는 것이 손실 없는 안전한 기본값.
                    // (원본이 JPEG 이더라도 PNG 변환은 시각적 손실 없음 — 용량 증가만 발생)
                    canvas.toBlob((blob) => {
                        if (!blob) {
                            fail(new Error(T2Utils.tf('meme.canvas_toblob_null', {}, 'canvas.toBlob returned null')));
                            return;
                        }
                        const mime = blob.type || 'image/png';
                        const ext = this._mimeToExt(mime);
                        const filename = this._makeFilename(idHint, ext);
                        succeed(new File([blob], filename, { type: mime }));
                    }, 'image/png', 0.92);
                } catch (e) {
                    // SecurityError (tainted canvas) 또는 기타 예외
                    fail(e);
                }
            };
            img.onerror = () => {
                fail(new Error(T2Utils.tf('meme.image_load_failed_cors', {}, 'Image load failed (CORS or network)')));
            };

            img.src = url;
        });
    }

    // mime 타입 → 파일 확장자 매핑
    _mimeToExt(mime) {
        const m = String(mime || '').toLowerCase();
        if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
        if (m === 'image/png')  return 'png';
        if (m === 'image/gif')  return 'gif';
        if (m === 'image/webp') return 'webp';
        if (m === 'image/bmp' || m === 'image/x-ms-bmp') return 'bmp';
        // 알 수 없는 경우 jpg 를 안전한 기본값으로 사용
        return 'jpg';
    }

    // 파일명 생성: `meme_{id 또는 timestamp}.{ext}`
    _makeFilename(idHint, ext) {
        let base = idHint;
        if (typeof base !== 'string' && typeof base !== 'number') base = '';
        base = String(base).trim();
        // 안전한 문자만 유지 (파일명에 위험한 문자 제거)
        base = base.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
        if (!base) base = String(Date.now());
        const safeExt = String(ext || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 5);
        return `meme_${base}.${safeExt || 'jpg'}`;
    }
}

window.T2MemePlugin = T2MemePlugin;

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
