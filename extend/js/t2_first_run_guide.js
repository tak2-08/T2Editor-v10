// T2Editor first-run guide Extend.
(function () {
    'use strict';

    const BOOT_KEY = 'T2EDITOR_FIRST_RUN_BOOTSTRAP';
    const ROOT_ID = 't2-first-run-guide-root';
    const lockedEditors = new Map();
    let currentStatus = null;
    let busy = false;
    let reachedEnd = false;

    const KO = Object.freeze({
        title: 'T2Editor 최초 설치 안내',
        subtitle: '최초 설정을 완료하기 전에는 에디터를 사용할 수 없습니다.',
        required_title: '반드시 완료해야 하는 최초 설정',
        required_body: '관리자 기능을 활성화하고 T2Editor 공용 데이터 디렉터리 권한을 707로 설정한 뒤, 이 안내를 끝까지 읽어야 합니다.',
        step_key: 'admin/t2admin.key.txt 파일의 이름을 admin/t2admin.key로 변경합니다.',
        step_admin: 'T2Editor 관리자 페이지에서 관리자 비밀번호를 설정합니다.',
        step_data: '아래에 표시된 공용 데이터 디렉터리의 권한을 707로 설정합니다.',
        step_read: '설치 경로, 핵심 사용법, 업데이트·백업·캐시 관리 안내를 끝까지 읽습니다.',
        admin_title: '관리자 설정 상태',
        key_active: '관리자 키 활성화됨',
        key_inactive: '관리자 키 이름 변경 필요',
        password_ready: '관리자 비밀번호 설정됨',
        password_pending: '관리자 비밀번호 미설정',
        data_ready: '공용 데이터 권한 707 확인됨',
        data_pending: '공용 데이터 권한 707 필요',
        open_admin: '관리자 페이지 열기',
        refresh_status: '설정 상태 다시 확인',
        command_title: '현재 서버와 설치 경로에 맞춘 설정 명령',
        command_body: '아래 명령은 현재 서버가 감지한 실제 T2Editor 설치 경로와 공용 데이터 경로로 생성되었습니다. 공용 데이터 루트만 707로 설정하고, T2Editor 코드 폴더 전체에 707 또는 777을 주지 마세요.',
        shell_command: 'Linux/Unix 셸 명령',
        powershell_command: 'Windows PowerShell 안내',
        ftp_title: 'FTP/SFTP로 관리자 키 활성화',
        ftp_perm_note: '파일질라(FileZilla) 등 FTP/SFTP 클라이언트에서도 공용 데이터 디렉터리를 마우스 오른쪽 버튼으로 클릭한 뒤 "파일 권한" 메뉴로 707 값을 입력하면 위 명령과 동일하게 권한을 설정할 수 있습니다.',
        copy: '복사',
        copied: '복사됨',
        support_title: '현재 서버 점검 결과',
        paths_title: '감지된 설치 정보',
        usage_title: 'T2Editor 핵심 사용법',
        management_title: '업데이트·백업·서드파티·캐시 관리',
        security_title: '운영 및 보안 관리 원칙',
        finish_title: '마지막 확인',
        finish_body: '이 지점까지 읽으면 아래 확인 체크박스가 활성화됩니다. 체크 후 닫기 버튼을 누르면 확인 기록이 t2editor_db/에 저장되고, 이후부터 에디터를 사용할 수 있습니다.',
        consent: '이 내용을 확인했습니다.',
        close: '닫기',
        need_key: 'admin/t2admin.key 파일을 활성화하세요.',
        need_admin: '관리자 페이지에서 관리자 비밀번호를 설정하세요.',
        need_data: '공용 데이터 디렉터리 권한을 707로 설정하세요.',
        need_storage: '공용 데이터 경로 아래에 t2editor_db 및 비공개 디렉터리를 생성할 수 있는지 확인하세요.',
        need_scroll: '안내의 맨 마지막까지 스크롤하세요.',
        need_consent: '“이 내용을 확인했습니다.”를 체크하세요.',
        ready: '최초 설정 완료 기록을 저장할 준비가 되었습니다.',
        saving: '최초 설정 완료 기록을 저장하는 중...',
        loading: '설치 상태를 확인하는 중...',
        load_failed: '설치 안내를 불러오지 못했습니다.',
        retry: '다시 시도',
        saved: '최초 설치 안내 확인을 완료했습니다.',
        read_progress: '읽기 진행',
        enabled: '사용',
        disabled: '사용 안 함',
        dup_key_notice: 'admin/t2admin.key.txt와 admin/t2admin.key가 동시에 존재합니다. 보안을 위해 admin/t2admin.key.txt 파일을 삭제하세요.',
        dup_key_dismiss: '확인'
    });

    function cfg() { return window[BOOT_KEY] || null; }
    function locale() {
        const value = String((cfg() && cfg().locale) || 'ko').toLowerCase();
        return /^[a-z0-9-]+$/.test(value) ? value : 'ko';
    }
    function t(key) {
        let value = KO[key] || key;
        try {
            if (window.T2I18N && typeof window.T2I18N.t === 'function') {
                const translated = window.T2I18N.t('t2firstrun.' + key, {}, locale());
                if (translated && translated !== 't2firstrun.' + key) value = translated;
            }
        } catch (_) {}
        return String(value);
    }
    function el(tag, className, text) {
        const item = document.createElement(tag);
        if (className) item.className = className;
        if (text !== undefined) item.textContent = String(text);
        return item;
    }
    function addTextList(parent, items) {
        const list = el('ul', 't2fr-list');
        items.forEach((text) => list.appendChild(el('li', '', text)));
        parent.appendChild(list);
        return list;
    }
    function section(title, icon) {
        const item = el('section', 't2fr-section');
        const heading = el('h3');
        heading.append(el('span', 't2fr-section-icon', icon), document.createTextNode(title));
        item.appendChild(heading);
        return item;
    }
    function codeBlock(label, value) {
        const wrap = el('div', 't2fr-code-wrap');
        const top = el('div', 't2fr-code-top');
        top.appendChild(el('strong', '', label));
        const copy = el('button', 't2fr-copy', t('copy'));
        copy.type = 'button';
        copy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(String(value || ''));
                copy.textContent = t('copied');
                setTimeout(() => { copy.textContent = t('copy'); }, 1200);
            } catch (_) {
                const area = el('textarea');
                area.value = String(value || '');
                area.style.position = 'fixed'; area.style.opacity = '0';
                document.body.appendChild(area); area.select();
                try { document.execCommand('copy'); copy.textContent = t('copied'); } catch (ignore) {}
                area.remove();
                setTimeout(() => { copy.textContent = t('copy'); }, 1200);
            }
        });
        top.appendChild(copy);
        const pre = el('pre', 't2fr-code');
        pre.textContent = String(value || '');
        wrap.append(top, pre);
        return wrap;
    }
    function pathRow(label, value) {
        const row = el('div', 't2fr-path-row');
        row.append(el('span', 't2fr-path-label', label), el('code', 't2fr-path', value || '-'));
        return row;
    }
    function chip(text, ok) {
        const node = el('span', 't2fr-chip ' + (ok ? 'ok' : 'bad'));
        node.append(el('span', 't2fr-chip-dot', ok ? '✓' : '!'), document.createTextNode(text));
        return node;
    }

    function injectStyles() {
        if (document.getElementById('t2-first-run-guide-style')) return;
        const style = document.createElement('style');
        style.id = 't2-first-run-guide-style';
        style.textContent = `
          html.t2-first-run-locked,body.t2-first-run-locked{overflow:hidden!important}
          html.t2-first-run-pending .t2-editor-container,html.t2-first-run-locked .t2-editor-container{pointer-events:none!important;user-select:none!important}
          .t2fr-backdrop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(8,12,20,.78);backdrop-filter:blur(8px)}
          .t2fr-dialog{display:flex;flex-direction:column;width:min(900px,100%);max-height:94vh;overflow:hidden;border:1px solid rgba(127,127,127,.28);border-radius:22px;background:var(--t2-bg-primary,#fff);color:var(--t2-text-primary,#202124);box-shadow:0 28px 100px rgba(0,0,0,.48)}
          .t2fr-head{flex:0 0 auto;padding:20px 26px 16px;text-align:center;border-bottom:1px solid rgba(127,127,127,.18);background:linear-gradient(180deg,rgba(255,102,0,.10),transparent)}
          .t2fr-brand{display:flex;justify-content:center;align-items:center;min-height:46px;margin-bottom:13px}.t2fr-logo{transform:scale(1.55);transform-origin:center;pointer-events:none}
          .t2fr-head h2{margin:0 0 7px;font-size:25px}.t2fr-head p{margin:0;color:var(--t2-text-secondary,#5f6368);line-height:1.55}.t2fr-blocked{display:inline-flex;margin-top:11px;padding:6px 10px;border-radius:999px;background:rgba(234,67,53,.12);color:#c5221f;font-size:12px;font-weight:800}
          .t2fr-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;padding:20px 26px 28px;scrollbar-gutter:stable}.t2fr-section{padding:18px;margin-bottom:14px;border:1px solid rgba(127,127,127,.19);border-radius:16px;background:rgba(127,127,127,.035)}
          .t2fr-section h3{display:flex;gap:8px;align-items:center;margin:0 0 10px;font-size:17px}.t2fr-section-icon{font-size:19px}.t2fr-section p{margin:0 0 10px;line-height:1.68;color:var(--t2-text-secondary,#5f6368)}.t2fr-section p:last-child{margin-bottom:0}
          .t2fr-list{margin:10px 0 0;padding-left:23px;color:var(--t2-text-secondary,#5f6368);line-height:1.7}.t2fr-list li+li{margin-top:5px}
          .t2fr-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:13px}.t2fr-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;font-size:12px;font-weight:800}.t2fr-chip.ok{background:rgba(52,168,83,.14);color:#188038}.t2fr-chip.bad{background:rgba(234,67,53,.13);color:#c5221f}.t2fr-chip-dot{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:currentColor;color:#fff;font-size:10px}
          .t2fr-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}.t2fr-btn{border:1px solid rgba(127,127,127,.35);border-radius:10px;background:transparent;color:inherit;padding:10px 14px;font-weight:800;cursor:pointer;text-decoration:none}.t2fr-btn.primary{border-color:#1a73e8;background:#1a73e8;color:#fff}.t2fr-btn:disabled{opacity:.42;cursor:not-allowed}.t2fr-btn:focus-visible,.t2fr-copy:focus-visible,.t2fr-consent input:focus-visible{outline:3px solid rgba(26,115,232,.34);outline-offset:2px}
          .t2fr-code-wrap{margin-top:12px;border:1px solid rgba(127,127,127,.22);border-radius:12px;overflow:hidden}.t2fr-code-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 11px;background:rgba(127,127,127,.08);font-size:12px}.t2fr-copy{border:0;border-radius:7px;background:rgba(26,115,232,.12);color:#1a73e8;padding:6px 9px;font-weight:800;cursor:pointer}.t2fr-code{margin:0;padding:13px;overflow:auto;background:rgba(17,24,39,.96);color:#e5e7eb;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
          .t2fr-path-grid{display:grid;gap:9px}.t2fr-path-row{display:grid;grid-template-columns:160px minmax(0,1fr);gap:12px;align-items:start}.t2fr-path-label{padding-top:8px;font-size:12px;font-weight:800;color:var(--t2-text-secondary,#5f6368)}.t2fr-path{display:block;padding:8px 10px;border-radius:9px;background:rgba(127,127,127,.10);font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
          .t2fr-subtitle{margin:16px 0 9px;font-size:14px;font-weight:800;color:var(--t2-text-primary,#202124)}
          .t2fr-ftp-note{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:rgba(26,115,232,.07);font-size:12.5px;line-height:1.6;color:var(--t2-text-secondary,#5f6368)}
          .t2fr-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.t2fr-check{display:flex;align-items:flex-start;gap:9px;padding:10px 11px;border-radius:11px;background:rgba(127,127,127,.07)}.t2fr-check-icon{flex:0 0 auto;display:grid;place-items:center;width:21px;height:21px;border-radius:50%;font-size:12px;font-weight:900}.t2fr-check.ok .t2fr-check-icon{background:rgba(52,168,83,.16);color:#188038}.t2fr-check.bad .t2fr-check-icon{background:rgba(234,67,53,.14);color:#c5221f}.t2fr-check strong{display:block;font-size:13px}.t2fr-check small{display:block;margin-top:3px;color:var(--t2-text-secondary,#5f6368);overflow-wrap:anywhere}
          .t2fr-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:16px}.t2fr-kv-item{padding:11px;border-radius:11px;background:rgba(127,127,127,.07)}.t2fr-kv-item strong{display:block;margin-bottom:4px;font-size:12px;color:var(--t2-text-secondary,#5f6368)}.t2fr-kv-item span{font-size:13px;overflow-wrap:anywhere}
          .t2fr-final-marker{margin-top:14px;padding:13px;border:1px dashed rgba(26,115,232,.48);border-radius:12px;text-align:center;color:#1a73e8;font-weight:800;background:rgba(26,115,232,.06)}
          .t2fr-foot{flex:0 0 auto;padding:14px 26px 18px;border-top:1px solid rgba(127,127,127,.18);background:var(--t2-bg-primary,#fff)}.t2fr-progress{height:5px;margin:-14px -26px 13px;background:rgba(127,127,127,.14)}.t2fr-progress>span{display:block;height:100%;width:0;background:#1a73e8;transition:width .12s linear}.t2fr-foot-main{display:flex;align-items:center;justify-content:space-between;gap:18px}.t2fr-consent{display:flex;align-items:center;gap:9px;font-weight:800}.t2fr-consent.disabled{opacity:.5}.t2fr-consent input{width:18px;height:18px;margin:0}.t2fr-foot-actions{display:flex;align-items:center;gap:12px}.t2fr-status{max-width:360px;font-size:12px;line-height:1.45;color:var(--t2-text-secondary,#5f6368);text-align:right}.t2fr-status.error{color:#c5221f}.t2fr-loading{padding:54px 24px;text-align:center}.t2fr-spinner{display:inline-block;width:28px;height:28px;border:3px solid rgba(127,127,127,.25);border-top-color:#ff6600;border-radius:50%;animation:t2fr-spin .8s linear infinite}@keyframes t2fr-spin{to{transform:rotate(360deg)}}
          @media(max-width:700px){.t2fr-backdrop{padding:8px}.t2fr-dialog{max-height:98vh;border-radius:16px}.t2fr-head,.t2fr-scroll,.t2fr-foot{padding-left:16px;padding-right:16px}.t2fr-progress{margin-left:-16px;margin-right:-16px}.t2fr-checks,.t2fr-kv{grid-template-columns:1fr}.t2fr-path-row{grid-template-columns:1fr;gap:3px}.t2fr-path-label{padding-top:0}.t2fr-foot-main{align-items:stretch;flex-direction:column}.t2fr-foot-actions{align-items:stretch;flex-direction:column}.t2fr-status{text-align:left;max-width:none}.t2fr-btn{width:100%;text-align:center}}
          html[data-t2editor-theme="dark"] .t2fr-backdrop{background:rgba(0,0,0,.82)}
          html[data-t2editor-theme="dark"] .t2fr-dialog{--t2-bg-primary:#1e1e1e;--t2-text-primary:#e8e8e8;--t2-text-secondary:#a8a8a8;border-color:rgba(255,255,255,.14);box-shadow:0 28px 100px rgba(0,0,0,.65)}
          html[data-t2editor-theme="dark"] .t2fr-head{border-bottom-color:rgba(255,255,255,.12);background:linear-gradient(180deg,rgba(255,102,0,.16),transparent)}
          html[data-t2editor-theme="dark"] .t2fr-section{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.035)}
          html[data-t2editor-theme="dark"] .t2fr-check,html[data-t2editor-theme="dark"] .t2fr-kv-item,html[data-t2editor-theme="dark"] .t2fr-path,html[data-t2editor-theme="dark"] .t2fr-code-top{background:rgba(255,255,255,.06)}
          html[data-t2editor-theme="dark"] .t2fr-code{background:#0b0f17}
          html[data-t2editor-theme="dark"] .t2fr-foot{border-top-color:rgba(255,255,255,.12)}
          html[data-t2editor-theme="dark"] .t2fr-progress{background:rgba(255,255,255,.14)}
          html[data-t2editor-theme="dark"] .t2fr-btn{border-color:rgba(255,255,255,.28)}
          html[data-t2editor-theme="dark"] .t2fr-chip.ok{background:rgba(52,168,83,.22)}
          html[data-t2editor-theme="dark"] .t2fr-chip.bad{background:rgba(234,67,53,.22)}
        `;
        document.head.appendChild(style);
    }

    function lockEditor() {
        document.documentElement.classList.remove('t2-first-run-pending');
        document.documentElement.classList.add('t2-first-run-locked');
        document.body.classList.add('t2-first-run-locked');
        document.querySelectorAll('.t2-editor-container').forEach((node) => {
            if (!lockedEditors.has(node)) {
                lockedEditors.set(node, { inert: !!node.inert, ariaHidden: node.getAttribute('aria-hidden') });
            }
            try { node.inert = true; } catch (_) {}
            node.setAttribute('aria-hidden', 'true');
        });
    }

    function unlockEditor() {
        document.documentElement.classList.remove('t2-first-run-pending', 't2-first-run-locked');
        document.body.classList.remove('t2-first-run-locked');
        lockedEditors.forEach((state, node) => {
            try { node.inert = state.inert; } catch (_) {}
            if (state.ariaHidden === null) node.removeAttribute('aria-hidden');
            else node.setAttribute('aria-hidden', state.ariaHidden);
        });
        lockedEditors.clear();
    }

    function checkName(id) {
        const names = {
            php: 'PHP 실행 환경', data_permission: '공용 데이터 권한', db_write: 't2editor_db 쓰기',
            private_write: '비공개 디렉터리 쓰기', upload_limit: 'PHP 업로드 한도', curl: 'cURL 확장',
            openssl: 'OpenSSL 확장', zip: 'ZIP 지원', image: '이미지 검사', admin_key: '관리자 키',
            admin_auth: '관리자 인증 설정'
        };
        return names[id] || id;
    }

    function statusMessage(status, consentChecked) {
        if (!status || !status.admin || !status.admin.key_active) return t('need_key');
        if (!status.permissions || !status.permissions.data_mode_ok) return t('need_data');
        if (!status.admin.auth_ready) return t('need_admin');
        if (!status.permissions.db_writable || !status.permissions.private_writable) return t('need_storage');
        if (!reachedEnd) return t('need_scroll');
        if (!consentChecked) return t('need_consent');
        return t('ready');
    }

    function updateConfirmState() {
        const root = document.getElementById(ROOT_ID);
        if (!root) return;
        const consent = root.querySelector('[data-role="consent"]');
        const button = root.querySelector('[data-action="confirm"]');
        const message = root.querySelector('[data-role="status"]');
        const consentLabel = root.querySelector('[data-role="consent-label"]');
        if (consent) consent.disabled = !reachedEnd || busy;
        if (consentLabel) consentLabel.classList.toggle('disabled', !reachedEnd);
        const ready = !!(currentStatus && currentStatus.can_confirm && reachedEnd && consent && consent.checked && !busy);
        if (button) button.disabled = !ready;
        if (message) {
            message.textContent = busy ? t('saving') : statusMessage(currentStatus, !!(consent && consent.checked));
            message.classList.toggle('error', !busy && !ready);
        }
    }

    function updateReadProgress(scroller) {
        const root = document.getElementById(ROOT_ID);
        if (!root || !scroller) return;
        const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
        const percent = Math.max(0, Math.min(100, Math.round((scroller.scrollTop / max) * 100)));
        const bar = root.querySelector('[data-role="progress-bar"]');
        const label = root.querySelector('[data-role="progress-label"]');
        if (bar) bar.style.width = percent + '%';
        if (label && !reachedEnd) label.textContent = t('read_progress') + ' ' + percent + '%';
        if (!reachedEnd && (scroller.scrollHeight <= scroller.clientHeight + 4 || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8)) {
            reachedEnd = true;
            if (bar) bar.style.width = '100%';
            updateConfirmState();
        }
    }

    function render(status) {
        currentStatus = status;
        reachedEnd = false;
        injectStyles();
        lockEditor();
        let root = document.getElementById(ROOT_ID);
        if (!root) { root = el('div', 't2fr-backdrop'); root.id = ROOT_ID; document.body.appendChild(root); }
        root.replaceChildren();

        const dialog = el('div', 't2fr-dialog');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 't2fr-title');
        dialog.tabIndex = -1;

        const head = el('header', 't2fr-head');
        const brand = el('div', 't2fr-brand');
        const editorLogo = document.querySelector('.t2-editor-container .t2-logo');
        const logo = editorLogo ? editorLogo.cloneNode(true) : el('div', 't2-logo');
        if (!editorLogo) logo.append(el('span', 't2-logo-prefix', 'T2'), el('span', 't2-logo-suffix', 'Editor'));
        logo.removeAttribute('id');
        logo.classList.add('t2fr-logo');
        logo.setAttribute('aria-label', 'T2Editor logo');
        logo.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
        brand.appendChild(logo);
        const title = el('h2', '', t('title')); title.id = 't2fr-title';
        head.append(brand, title, el('p', '', t('subtitle')), el('span', 't2fr-blocked', '설정 완료 전 편집 기능 잠김'));
        dialog.appendChild(head);

        const body = el('main', 't2fr-scroll');
        body.dataset.role = 'scroll';
        body.addEventListener('scroll', () => updateReadProgress(body), { passive: true });

        const admin = section(t('admin_title'), '①');
        const chips = el('div', 't2fr-chips');
        chips.append(
            chip(status.admin.key_active ? t('key_active') : t('key_inactive'), !!status.admin.key_active),
            chip(status.permissions.data_mode_ok ? t('data_ready') : t('data_pending'), !!status.permissions.data_mode_ok),
            chip(status.admin.auth_ready ? t('password_ready') : t('password_pending'), !!status.admin.auth_ready)
        );
        admin.appendChild(chips);
        const actions = el('div', 't2fr-actions');
        const openAdmin = el('a', 't2fr-btn primary', t('open_admin'));
        openAdmin.href = status.admin.admin_url; openAdmin.target = '_blank'; openAdmin.rel = 'noopener noreferrer';
        const refresh = el('button', 't2fr-btn', t('refresh_status'));
        refresh.type = 'button'; refresh.addEventListener('click', refreshStatus);
        actions.append(openAdmin, refresh); admin.appendChild(actions);
        body.appendChild(admin);

        const required = section(t('required_title'), '②');
        required.appendChild(el('p', '', t('required_body')));
        addTextList(required, [t('step_key'), t('step_admin'), t('step_data'), t('step_read')]);
        body.appendChild(required);

        const commands = section(t('command_title'), '③');
        commands.appendChild(el('p', '', t('command_body')));
        const commandPathGrid = el('div', 't2fr-path-grid');
        commandPathGrid.append(
            pathRow('공용 데이터 경로', status.server.data_path),
            pathRow('현재 권한 / 필요 권한', (status.permissions.data_mode || '확인 불가') + ' / ' + status.permissions.data_mode_required)
        );
        commands.appendChild(commandPathGrid);
        commands.appendChild(codeBlock(t('shell_command'), status.commands.shell));
        commands.appendChild(codeBlock(t('powershell_command'), status.commands.powershell));
        commands.appendChild(el('h4', 't2fr-subtitle', t('ftp_title')));
        const ftpGrid = el('div', 't2fr-path-grid');
        ftpGrid.append(pathRow('변경 전', status.commands.ftp_from), pathRow('변경 후', status.commands.ftp_to));
        commands.appendChild(ftpGrid);
        commands.appendChild(el('p', 't2fr-ftp-note', t('ftp_perm_note')));
        body.appendChild(commands);

        const support = section(t('support_title'), '④');
        const checkGrid = el('div', 't2fr-checks');
        (status.checks || []).forEach((check) => {
            const row = el('div', 't2fr-check ' + (check.ok ? 'ok' : 'bad'));
            row.appendChild(el('span', 't2fr-check-icon', check.ok ? '✓' : '!'));
            const text = el('div');
            text.append(el('strong', '', checkName(check.id)), el('small', '', check.value || '-'));
            row.appendChild(text); checkGrid.appendChild(row);
        });
        support.appendChild(checkGrid);
        body.appendChild(support);

        const paths = section(t('paths_title'), '⑤');
        const pathGrid = el('div', 't2fr-path-grid');
        pathGrid.append(
            pathRow('플랫폼', status.platform),
            pathRow('운영체제 / SAPI', status.server.os + ' / ' + status.server.sapi),
            pathRow('PHP / T2Editor', status.server.php + ' / ' + status.version),
            pathRow('에디터 URL', status.server.editor_url),
            pathRow('에디터 설치 경로', status.server.editor_path),
            pathRow('공용 데이터 경로', status.server.data_path),
            pathRow('T2Editor DB 경로', status.server.db_path),
            pathRow('비공개 관리 경로', status.server.private_path),
            pathRow('최초 확인 저장 파일', status.server.state_file)
        );
        paths.appendChild(pathGrid);
        body.appendChild(paths);

        const usage = section(t('usage_title'), '⑥');
        addTextList(usage, [
            '본문은 툴바의 서식·링크·이미지·영상·파일·표·코드 등 활성 플러그인을 이용해 작성합니다.',
            '자동 저장은 브라우저 로컬 저장소를 사용하므로, 공용 PC에서는 작성 후 자동 저장 초안을 확인하거나 정리하세요.',
            '이미지·영상·첨부 파일은 공용 데이터 디렉터리에 저장됩니다. 서버 PHP 업로드 한도보다 큰 파일은 업로드되지 않습니다.',
            '다른 에디터의 HTML을 붙여넣을 때 마이그레이션 모드 설정에 따라 자동 변환·확인·비활성 동작이 달라집니다.',
            'NSFW 필터, 기본 작성 높이, 영상 플레이어, 업로드 확장자와 용량은 관리자 설정에서 관리합니다.',
            '문서 제출 전에는 실제 저장되는 HTML과 첨부 파일 표시 상태를 한 번 확인하세요.'
        ]);
        const upload = status.upload || {};
        const extensions = upload.extensions || {};
        const usageKv = el('div', 't2fr-kv');
        const values = [
            ['T2Editor 업로드 한도', String(upload.maxSizeMB || '-') + ' MB'],
            ['기본 작성 높이', String(status.core.content_height || '-') + ' px'],
            ['마이그레이션 모드', status.core.migration_mode === false ? t('disabled') : String(status.core.migration_mode)],
            ['전용 영상 플레이어', status.core.video_player ? t('enabled') : t('disabled')],
            ['NSFW 이미지 필터', status.core.nsfw_enabled ? t('enabled') : t('disabled')],
            ['활성 플러그인', (status.core.plugins || []).join(', ') || '-'],
            ['이미지 확장자', (extensions.image || []).join(', ') || '-'],
            ['영상 확장자', (extensions.video || []).join(', ') || '-']
        ];
        values.forEach(([name, value]) => {
            const item = el('div', 't2fr-kv-item'); item.append(el('strong', '', name), el('span', '', value)); usageKv.appendChild(item);
        });
        usage.appendChild(usageKv);
        body.appendChild(usage);

        const management = section(t('management_title'), '⑦');
        addTextList(management, [
            '업데이트 전에는 관리자에서 직접 설치 백업을 만들거나 서버 파일과 t2editor_db를 별도로 백업하세요.',
            '업데이트·현재 버전 재설치·직접 ZIP 설치는 관리자 기능을 이용하고, 활성 런타임 폴더를 수동으로 덮어쓰지 마세요.',
            '직접 설치 백업 복구 목록은 복구 가능 여부를 확인한 뒤 개별 삭제 또는 전체 삭제할 수 있습니다.',
            '서드파티 패키지는 출처와 권한을 확인한 뒤 설치하고, 사용하지 않는 패키지는 관리자에서 제거하세요.',
            '캐시 관리에서는 런타임 인덱스와 번역 캐시의 상태를 확인하고 삭제·재생성할 수 있습니다.',
            '업데이트나 플러그인 변경 후 이상이 있으면 캐시를 재생성하고, 계속되면 직전 백업으로 복구하세요.'
        ]);
        body.appendChild(management);

        const security = section(t('security_title'), '⑧');
        addTextList(security, [
            '707 권한은 감지된 T2Editor 공용 데이터 루트에만 적용합니다. T2Editor 원본 코드, plugin, extend, locales 전체에 707 또는 777을 주지 마세요.',
            't2editor_db/t2admin-private는 T2Editor가 자동으로 생성하고 700으로 보호합니다. 이 폴더를 웹에 직접 공개하지 마세요.',
            'admin/t2admin.key와 관리자 비밀번호는 업데이트·설치·복구 권한을 보호하므로 외부에 공유하지 마세요.',
            '서버 이전 또는 복구를 위해 T2Editor 코드와 공용 데이터 디렉터리, 특히 t2editor_db를 함께 백업하세요.',
            '장애 점검 시 관리자 환경 정보와 정확한 오류 경로를 먼저 확인하고, 무작정 전체 폴더 권한을 777로 변경하지 마세요.'
        ]);
        body.appendChild(security);

        const finish = section(t('finish_title'), '⑨');
        finish.appendChild(el('p', '', t('finish_body')));
        finish.appendChild(el('div', 't2fr-final-marker', '여기가 안내의 마지막입니다.'));
        body.appendChild(finish);
        dialog.appendChild(body);

        const foot = el('footer', 't2fr-foot');
        const progress = el('div', 't2fr-progress');
        const progressBar = el('span'); progressBar.dataset.role = 'progress-bar'; progress.appendChild(progressBar);
        const main = el('div', 't2fr-foot-main');
        const consentLabel = el('label', 't2fr-consent disabled'); consentLabel.dataset.role = 'consent-label';
        const consent = el('input'); consent.type = 'checkbox'; consent.dataset.role = 'consent'; consent.disabled = true;
        consent.addEventListener('change', updateConfirmState);
        consentLabel.append(consent, el('span', '', t('consent')));
        const actionWrap = el('div', 't2fr-foot-actions');
        const statusText = el('div', 't2fr-status'); statusText.dataset.role = 'status';
        const close = el('button', 't2fr-btn primary', t('close')); close.type = 'button'; close.dataset.action = 'confirm'; close.disabled = true; close.addEventListener('click', confirmGuide);
        actionWrap.append(statusText, close); main.append(consentLabel, actionWrap); foot.append(progress, main); dialog.appendChild(foot);
        root.appendChild(dialog);

        requestAnimationFrame(() => {
            body.scrollTop = 0;
            updateReadProgress(body);
            dialog.focus();
        });
        updateConfirmState();
    }

    function renderLoading(message) {
        injectStyles(); lockEditor();
        let root = document.getElementById(ROOT_ID);
        if (!root) { root = el('div', 't2fr-backdrop'); root.id = ROOT_ID; document.body.appendChild(root); }
        root.replaceChildren();
        const box = el('div', 't2fr-dialog'); const loading = el('div', 't2fr-loading');
        loading.append(el('span', 't2fr-spinner'), el('p', '', message || t('loading'))); box.appendChild(loading); root.appendChild(box);
    }

    function renderError(error) {
        injectStyles(); lockEditor();
        let root = document.getElementById(ROOT_ID);
        if (!root) { root = el('div', 't2fr-backdrop'); root.id = ROOT_ID; document.body.appendChild(root); }
        root.replaceChildren();
        const box = el('div', 't2fr-dialog'); const content = el('div', 't2fr-loading');
        content.append(el('h2', '', t('load_failed')), el('p', '', error && error.message ? error.message : String(error || 'Error')));
        const retry = el('button', 't2fr-btn primary', t('retry')); retry.type = 'button'; retry.addEventListener('click', loadStatus);
        content.appendChild(retry); box.appendChild(content); root.appendChild(box); retry.focus();
    }

    async function fetchStatus() {
        const boot = cfg();
        if (!boot || !boot.endpoint || !boot.token) throw new Error('서명된 최초 설치 인증 정보가 없습니다.');
        const response = await fetch(boot.endpoint, {
            method: 'GET', credentials: 'same-origin', cache: 'no-store',
            headers: { 'X-T2-First-Run-Token': boot.token }
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || !payload.ok) throw new Error((payload && payload.message) || ('HTTP ' + response.status));
        return payload.data;
    }

    async function loadStatus() {
        renderLoading();
        try {
            const status = await fetchStatus();
            if (!status.required) closeGuide(); else render(status);
        } catch (error) {
            console.error('[T2Editor first-run]', error); renderError(error);
        }
    }

    async function refreshStatus() {
        if (busy) return;
        busy = true; updateConfirmState();
        try { render(await fetchStatus()); }
        catch (error) {
            const msg = document.querySelector('#' + ROOT_ID + ' [data-role="status"]');
            if (msg) { msg.textContent = error.message || String(error); msg.classList.add('error'); }
        } finally { busy = false; updateConfirmState(); }
    }

    async function confirmGuide() {
        const root = document.getElementById(ROOT_ID);
        const consent = root && root.querySelector('[data-role="consent"]');
        if (busy || !currentStatus || !currentStatus.can_confirm || !reachedEnd || !consent || !consent.checked) {
            updateConfirmState(); return;
        }
        const boot = cfg();
        busy = true; updateConfirmState();
        try {
            const response = await fetch(boot.endpoint, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-T2-First-Run-Token': boot.token },
                body: JSON.stringify({ action: 'confirm', token: boot.token, read_complete: true, acknowledged: true })
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload || !payload.ok) {
                if (payload && payload.data) currentStatus = payload.data;
                throw new Error((payload && payload.message) || ('HTTP ' + response.status));
            }
            boot.required = false;
            closeGuide();
            if (window.T2Utils && typeof window.T2Utils.showNotification === 'function') {
                window.T2Utils.showNotification(t('saved'), 'success');
            }
        } catch (error) {
            console.error('[T2Editor first-run confirm]', error);
            const message = document.querySelector('#' + ROOT_ID + ' [data-role="status"]');
            if (message) { message.textContent = error.message || String(error); message.classList.add('error'); }
        } finally { busy = false; updateConfirmState(); }
    }

    function closeGuide() {
        const root = document.getElementById(ROOT_ID);
        if (root) root.remove();
        unlockEditor();
    }

    const TOAST_ID = 't2-first-run-dup-key-toast';

    function renderDuplicateKeyToast(message) {
        if (document.getElementById(TOAST_ID)) return;
        if (!document.getElementById('t2-first-run-toast-style')) {
            const style = document.createElement('style');
            style.id = 't2-first-run-toast-style';
            style.textContent = `
              .t2fr-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:14px;max-width:min(560px,92vw);padding:13px 16px;border-radius:12px;background:var(--t2-bg-primary,#fff);color:var(--t2-text-primary,#202124);border:1px solid rgba(127,127,127,.28);box-shadow:0 16px 46px rgba(0,0,0,.28);font-size:13px;line-height:1.55}
              .t2fr-toast strong{color:#c5221f}
              .t2fr-toast button{flex:0 0 auto;border:0;border-radius:8px;background:rgba(26,115,232,.12);color:#1a73e8;padding:7px 12px;font-weight:800;cursor:pointer}
              html[data-t2editor-theme="dark"] .t2fr-toast{--t2-bg-primary:#1e1e1e;--t2-text-primary:#e8e8e8;border-color:rgba(255,255,255,.16);box-shadow:0 16px 46px rgba(0,0,0,.5)}
            `;
            document.head.appendChild(style);
        }
        const toast = el('div', 't2fr-toast');
        toast.id = TOAST_ID;
        toast.setAttribute('role', 'alert');
        toast.appendChild(el('strong', '', '!'));
        toast.appendChild(el('span', '', message));
        const dismiss = el('button', '', t('dup_key_dismiss'));
        dismiss.type = 'button';
        dismiss.addEventListener('click', () => toast.remove());
        toast.appendChild(dismiss);
        document.body.appendChild(toast);
        setTimeout(() => { if (toast.isConnected) toast.remove(); }, 12000);
    }

    async function notifyDuplicateKey() {
        const boot = cfg();
        if (!boot || !boot.duplicate_key_notice) return;
        const message = t('dup_key_notice');
        if (window.T2Utils && typeof window.T2Utils.showNotification === 'function') {
            window.T2Utils.showNotification(message, 'warning');
        } else {
            renderDuplicateKeyToast(message);
        }
        if (!boot.endpoint || !boot.token) return;
        try {
            await fetch(boot.endpoint, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-T2-First-Run-Token': boot.token },
                body: JSON.stringify({ action: 'dismiss_duplicate_key_notice', token: boot.token })
            });
        } catch (error) {
            console.error('[T2Editor first-run dup-key notice]', error);
        }
    }

    document.addEventListener('keydown', (event) => {
        const root = document.getElementById(ROOT_ID);
        if (!root) return;
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopImmediatePropagation(); return;
        }
        if (event.key !== 'Tab') return;
        const focusable = Array.from(root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'))
            .filter((node) => node.offsetParent !== null);
        if (!focusable.length) { event.preventDefault(); return; }
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }, true);

    function start() {
        const boot = cfg();
        if (!boot) return;
        if (boot.required === true) {
            if (window.__T2_FIRST_RUN_GUIDE_STARTED__) return;
            window.__T2_FIRST_RUN_GUIDE_STARTED__ = true;
            loadStatus();
            return;
        }
        if (boot.duplicate_key_notice === true && !window.__T2_FIRST_RUN_DUP_NOTICE_SHOWN__) {
            window.__T2_FIRST_RUN_DUP_NOTICE_SHOWN__ = true;
            notifyDuplicateKey();
        }
    }

    window.addEventListener('t2editor:first-run-bootstrap', start);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
