// T2Editor/plugin/meme/meme.js
//
// [v10.0.0-beta2.4.0] 밈 플러그인 리팩터링
// 과거: API URL 을 <img src="..."> 로 직접 삽입 (외부 호스팅 의존, 만료 시 깨짐)
// 신규: API URL 의 이미지를 다운로드하여 File 객체로 변환 후,
//       image 플러그인의 공개 API uploadImageFile(file) 을 호출하여
//       NSFW 검사 · base64 미리보기 · 서버 업로드 를 모두 image 플러그인 흐름에 위임.
// 제약: image 플러그인은 수정하지 않음 (공개 API 만 호출).

class T2MemePlugin extends T2ImagePlugin {
    constructor(editor) {
        super(editor);
        this.commands = ['insertMeme'];
        this.memeApiUrl = 'https://dsclub.kr/api/meme/index.php';
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
            modalEscHandler: null,
            // [v10.0.0-beta2.4.0] 진행 중인 다운로드/업로드 추적 — 중복 클릭 방지
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

    // ─── Selection 관리 ───────────────────────────────────────────────────────

    _saveSelection() {
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            // 에디터 내부의 선택 영역인지 확인
            if (this.editor.editor.contains(range.startContainer)) {
                this._savedRange = range.cloneRange();
                return;
            }
        }
        this._savedRange = null;
    }

    _restoreSelection() {
        this.editor.editor.focus();
        const sel = window.getSelection();

        if (this._savedRange) {
            sel.removeAllRanges();
            sel.addRange(this._savedRange);
        } else {
            // 저장된 영역이 없거나 에디터가 비어있을 경우 안전하게 맨 끝에 블록 생성 후 포커스
            let targetNode = this.editor.editor.lastElementChild;
            if (!targetNode || targetNode.tagName !== 'P') {
                const p = document.createElement('p');
                p.innerHTML = '<br>';
                this.editor.editor.appendChild(p);
                targetNode = p;
            }
            const range = document.createRange();
            range.selectNodeContents(targetNode);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }

    // ─── Modal ────────────────────────────────────────────────────────────────

    _openModal() {
        const s = this._ms;
        Object.assign(s, { page: 1, hasMore: true, query: '', loading: false });
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
                            <p class="t2-meme-desc">밈 이미지를 검색하고 현재 커서 위치에 바로 삽입합니다.</p>
                            <a href="https://dsclub.kr/service/meme" target="_blank" rel="noopener noreferrer" class="t2-meme-powered">
                                <span class="material-icons">info</span>
                                <span>powered by <b>T2Meme</b></span>
                            </a>
                        </div>
                        <button type="button" class="t2-meme-icon-close" aria-label="닫기">
                            <span class="material-icons">close</span>
                        </button>
                    </div>
                    <div class="t2-meme-search-wrap">
                        <span class="material-icons t2-meme-search-icon">search</span>
                        <input type="text" class="t2-meme-search" placeholder="태그 또는 키워드 검색..." autocomplete="off" spellcheck="false">
                    </div>
                </div>
                <div class="t2-meme-body">
                    <div class="t2-meme-grid"></div>
                    <div class="t2-meme-loader">
                        <span class="material-icons t2-meme-spin">sync</span>
                    </div>
                    <div class="t2-meme-empty">
                        <span class="material-icons">search_off</span>
                        <p>검색 결과가 없습니다</p>
                    </div>
                    <div class="t2-meme-sentinel"></div>
                </div>
                <div class="t2-meme-footer">
                    <a href="https://dsclub.kr/service/meme/" target="_blank" rel="noopener" class="t2-meme-reg-btn">
                        <span class="material-icons">add_photo_alternate</span>
                        <span>짤 등록</span>
                    </a>
                    <button type="button" class="t2-meme-close-btn">닫기</button>
                </div>
            </div>
        `;

        const modal = document.createElement('div');
        modal.className = 't2-modal-overlay t2-meme-overlay';

        // 모달은 body에 붙기 때문에, 에디터 컨테이너/HTML 테마 상속이 끊기는 환경을 보정한다.
        const rootTheme = document.documentElement.getAttribute('data-t2editor-theme');
        const editorTheme = this.editor?.container?.closest?.('[data-t2editor-theme]')?.getAttribute('data-t2editor-theme');
        const storedDarkMode = localStorage.getItem('t2editor-dark-mode') === 'true';
        const isDarkTheme = rootTheme === 'dark' || editorTheme === 'dark' || (!rootTheme && storedDarkMode);
        modal.classList.toggle('t2-meme-dark', isDarkTheme);
        modal.classList.toggle('t2-meme-light', !isDarkTheme);

        modal.innerHTML = modalHtml;

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this._closeModal();
            }
        });

        s.modalEscHandler = (e) => {
            if (e.key === 'Escape') {
                this._closeModal();
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

        // 무한 스크롤 sentinel
        s.scrollObserver = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && !s.loading && s.hasMore) {
                this._fetch(grid, loader, emptyEl);
            }
        }, { threshold: 0 });
        s.scrollObserver.observe(sentinel);

        // 공유 lazy observer (단일 인스턴스로 메모리 절약)
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

        this._fetch(grid, loader, emptyEl);
        setTimeout(() => search.focus(), 100);
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
    }

    _destroyObservers() {
        const s = this._ms;
        if (s.scrollObserver) { s.scrollObserver.disconnect(); s.scrollObserver = null; }
        if (s.lazyObserver)   { s.lazyObserver.disconnect();  s.lazyObserver = null; }
    }

    // ─── API fetch ────────────────────────────────────────────────────────────

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
            const res = await fetch(`${this.memeApiUrl}?${qs}`, {
                headers: { Accept: 'application/json' },
                // [v10.0.0-beta2.4.0 - QC2 privacy 강화] referrerPolicy 추가
                referrerPolicy: 'no-referrer',
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);

            const json = await res.json();
            if (!json.success) throw new Error(json.message || 'API 오류');

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

    // ─── Tile ─────────────────────────────────────────────────────────────────

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

    // ─── [v10.0.0-beta2.4.0] 이미지 다운로드 → image 플러그인 업로드 연계 ───
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
            console.warn('[T2MemePlugin] 잘못된 meme 객체:', meme);
            return;
        }

        // 중복 클릭 방지 — 동일 URL 의 다운로드/업로드가 진행 중이면 무시
        if (s.pendingInserts.has(url)) {
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification('이미지 추가 중입니다. 잠시만 기다려주세요.', 'info');
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
                throw new Error('image 플러그인의 uploadImageFile API 를 찾을 수 없습니다.');
            }
        } catch (err) {
            console.error('[T2MemePlugin] 이미지 추가 실패:', err);
            if (typeof T2Utils !== 'undefined' && T2Utils.showNotification) {
                T2Utils.showNotification(
                    '밈 이미지를 추가하지 못했습니다. (' + (err && err.message ? err.message : '오류') + ')',
                    'error'
                );
            } else {
                alert('밈 이미지를 추가하지 못했습니다.');
            }
        } finally {
            // 진행 중 추적 해제
            s.pendingInserts.delete(url);
        }
    }

    // URL 의 이미지를 다운로드하여 File 객체로 반환.
    // - 1차 시도: fetch(url) → blob → File (CORS 허용 시)
    // - 2차 fallback: Image() + canvas.toBlob → File (CORS 차단 시, 단순 렌더링만 허용되는 경우)
    //   * 단, canvas 도 taint 되어 toBlob 이 SecurityError 로 실패할 수 있음 —
    //     이 경우 최종 에러 throw.
    // - mime → 확장자 매핑: image/jpeg→.jpg, image/png→.png, image/gif→.gif,
    //   image/webp→.webp, image/bmp→.bmp. 알 수 없는 mime 은 .jpg 기본값.
    // - 파일명: `meme_{id 또는 timestamp}.{ext}` — image 플러그인 validateImageFile 이
    //   확장자로 검사하므로 반드시 올바른 확장자 포함.
    async _downloadImageAsFile(url, idHint) {
        // URL 검증 — http(s) 만 허용 (data:, blob:, javascript: 등 차단)
        const safeUrl = this._sanitizeImageSrc(url);
        if (!safeUrl) {
            throw new Error('허용되지 않는 이미지 URL 입니다.');
        }

        // 1차 시도: fetch + blob
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
            // 2차 fallback: Image + canvas.toBlob
            // (CORS 가 허용되지 않았거나 네트워크 오류인 경우에만 시도)
            console.warn('[T2MemePlugin] fetch 1차 실패, canvas fallback 시도:', primaryErr.message);
            try {
                const file = await this._downloadViaCanvas(safeUrl, idHint);
                return file;
            } catch (fallbackErr) {
                // 둘 다 실패 — 원본 에러와 fallback 에러를 합쳐서 throw
                const merged = new Error(
                    '이미지 다운로드 실패 (fetch: ' + primaryErr.message +
                    ', canvas: ' + fallbackErr.message + ')'
                );
                merged.cause = { primary: primaryErr, fallback: fallbackErr };
                throw merged;
            }
        }
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
                fail(new Error('Image 로드 타임아웃 (30s)'));
            }, 30000);

            img.onload = () => {
                try {
                    // 원본 naturalWidth/Height 사용 (이미지 품질 보존)
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;
                    if (!w || !h) {
                        fail(new Error('이미지 치수를 확인할 수 없습니다.'));
                        return;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        fail(new Error('canvas 2d context 생성 실패'));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, w, h);

                    // PNG 로 내보내는 것이 손실 없는 안전한 기본값.
                    // (원본이 JPEG 이더라도 PNG 변환은 시각적 손실 없음 — 용량 증가만 발생)
                    canvas.toBlob((blob) => {
                        if (!blob) {
                            fail(new Error('canvas.toBlob 이 null 반환'));
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
                fail(new Error('Image 로드 실패 (CORS 또는 네트워크)'));
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
