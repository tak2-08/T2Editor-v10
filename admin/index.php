<?php
/**
 * T2Editor Admin Panel
 * Path: t2editor/admin/index.php
 *
 * 관리자 패널 메인 UI. 세션 기반 인증.
 */

@session_start();
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');

define('T2ADMIN_UI', true);
$_ROOT = dirname(__DIR__);
require_once $_ROOT . '/config/t2_config.php';

$KEY_FILE    = __DIR__ . '/t2admin.key';
$KEY_TXT     = __DIR__ . '/t2admin.key.txt';
$AUTH_FILE   = T2EDITOR_DATA_PATH . '/admin_auth.json';
$EDITOR_URL  = T2EDITOR_URL;

$key_active  = file_exists($KEY_FILE);
$key_txt     = file_exists($KEY_TXT);
$auth_exists = (function() use ($AUTH_FILE) {
    if (!file_exists($AUTH_FILE)) return false;
    $d = @json_decode(@file_get_contents($AUTH_FILE), true);
    return !empty($d['setup_complete']);
})();
$logged_in   = !empty($_SESSION['t2admin_logged_in']);
$data_writable = is_writable(T2EDITOR_DATA_PATH);

// CSRF 토큰
if (empty($_SESSION['t2admin_csrf'])) {
    $_SESSION['t2admin_csrf'] = bin2hex(random_bytes(32));
}
$csrf = $_SESSION['t2admin_csrf'];

// 페이지 상태 결정
$page_state = 'normal';
if (!$key_active) $page_state = 'no_key';
elseif (!$auth_exists) $page_state = 'setup';
elseif (!$logged_in) $page_state = 'login';
?>
<!DOCTYPE html>
<html lang="ko" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>T2Editor 관리자</title>
<style>
/* ── CSS 변수 & 리셋 ─────────────────────────────────────────────────────── */
/* 브랜드 컬러는 T2Editor 본체(css/core.css)의 실제 액센트(#0187fe)·로고 오렌지(#ff6600)를 그대로 계승 */
:root {
  --md-primary: #0187fe;
  --md-primary-l: #2e9bff;
  --md-primary-d: #006fd6;
  --md-primary-rgb: 1,135,254;
  --md-secondary: #0097A7;
  --md-accent: #00BCD4;
  --t2-orange: #ff6600;
  --md-surface: #FFFFFF;
  --md-surface-2: #F8FAFD;
  --md-bg: #EEF2F7;
  --md-on-primary: #FFFFFF;
  --md-on-surface: #1A1A2E;
  --md-on-muted: #546E7A;
  --md-border: #CFD8DC;
  --md-border-l: #ECEFF1;
  --md-error: #C62828;
  --md-error-bg: #FFEBEE;
  --md-success: #1B5E20;
  --md-success-bg: #E8F5E9;
  --md-warn: #E65100;
  --md-warn-bg: #FFF3E0;
  --md-info: #01579B;
  --md-info-bg: #E1F5FE;
  --md-el1: 0 1px 3px rgba(0,0,0,.10), 0 1px 2px rgba(0,0,0,.08);
  --md-el2: 0 3px 8px rgba(0,0,0,.12), 0 2px 4px rgba(0,0,0,.08);
  --md-el4: 0 8px 24px rgba(0,0,0,.14), 0 4px 8px rgba(0,0,0,.08);
  --sidebar-w: 260px;
  --header-h: 60px;
  --radius: 12px;
  --radius-s: 8px;
  --transition: 200ms cubic-bezier(.4,0,.2,1);
}
[data-theme="dark"] {
  --md-primary: #0187fe;
  --md-primary-l: #3d9bff;
  --md-primary-d: #006fd6;
  --md-secondary: #00BCD4;
  --t2-orange: #ff7a1f;
  --md-surface: #1E2332;
  --md-surface-2: #252B3B;
  --md-bg: #141824;
  --md-on-surface: #E8EAF6;
  --md-on-muted: #90A4AE;
  --md-border: #2E3650;
  --md-border-l: #252B3B;
  --md-el1: 0 1px 3px rgba(0,0,0,.3);
  --md-el2: 0 3px 8px rgba(0,0,0,.4);
  --md-el4: 0 8px 24px rgba(0,0,0,.5);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px;-webkit-text-size-adjust:100%}
body{
  font-family:-apple-system,"Noto Sans KR","Apple SD Gothic Neo",BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  background:var(--md-bg);color:var(--md-on-surface);
  line-height:1.6;min-height:100vh;transition:background var(--transition),color var(--transition);
}
a{color:var(--md-primary);text-decoration:none}
button{font-family:inherit;cursor:pointer;border:none;background:none}
input,select,textarea{font-family:inherit}
img,svg{max-width:100%;vertical-align:middle}

/* ── 재사용 컴포넌트 ──────────────────────────────────────────────────────── */
.card{background:var(--md-surface);border-radius:var(--radius);box-shadow:var(--md-el1);border:1px solid var(--md-border-l);overflow:hidden;transition:box-shadow var(--transition)}
.card:hover{box-shadow:var(--md-el2)}
.card-header{padding:18px 20px 14px;border-bottom:1px solid var(--md-border-l);display:flex;align-items:center;gap:10px}
.card-header .mi{color:var(--md-primary);font-size:20px}
.card-title{font-size:15px;font-weight:600;letter-spacing:.02em}
.card-body{padding:20px}

.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border-radius:var(--radius-s);font-size:14px;font-weight:500;cursor:pointer;border:none;transition:all var(--transition);white-space:nowrap;letter-spacing:.02em}
.btn:focus-visible{outline:3px solid var(--md-primary);outline-offset:2px}
.btn-primary{background:var(--md-primary);color:#fff}
.btn-primary:hover{background:var(--md-primary-l)}
.btn-primary:active{background:var(--md-primary-d)}
.btn-outline{background:transparent;border:1.5px solid var(--md-border);color:var(--md-on-surface)}
.btn-outline:hover{background:var(--md-surface-2);border-color:var(--md-primary);color:var(--md-primary)}
.btn-danger{background:#C62828;color:#fff}
.btn-danger:hover{background:#B71C1C}
.btn-sm{padding:5px 12px;font-size:13px}
.btn-icon{padding:8px;border-radius:50%;width:36px;height:36px;justify-content:center}

.form-group{margin-bottom:18px}
.form-label{display:block;font-size:13px;font-weight:500;color:var(--md-on-muted);margin-bottom:6px;letter-spacing:.03em}
.form-control{width:100%;padding:9px 12px;background:var(--md-surface-2);border:1.5px solid var(--md-border);border-radius:var(--radius-s);color:var(--md-on-surface);font-size:14px;transition:border-color var(--transition)}
.form-control:focus{outline:none;border-color:var(--md-primary);box-shadow:0 0 0 3px rgba(var(--md-primary-rgb),.12)}
.form-hint{font-size:12px;color:var(--md-on-muted);margin-top:5px}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:600px){.form-row{grid-template-columns:1fr}}

.toggle-wrap{display:flex;align-items:center;gap:12px;padding:12px 0}
.toggle-wrap .toggle-info{flex:1}
.toggle-wrap .toggle-title{font-size:14px;font-weight:500}
.toggle-wrap .toggle-desc{font-size:12px;color:var(--md-on-muted);margin-top:2px}
.toggle{position:relative;width:44px;height:24px;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0;position:absolute}
.toggle-track{position:absolute;inset:0;background:var(--md-border);border-radius:12px;cursor:pointer;transition:background var(--transition)}
.toggle input:checked + .toggle-track{background:var(--md-primary)}
.toggle input:focus-visible + .toggle-track{outline:3px solid var(--md-primary);outline-offset:2px}
.toggle-thumb{position:absolute;top:2px;left:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:transform var(--transition);pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,.3)}
.toggle input:checked ~ .toggle-thumb{transform:translateX(20px)}

.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:.04em}
.badge-primary{background:rgba(var(--md-primary-rgb),.12);color:var(--md-primary)}
.badge-success{background:#E8F5E9;color:#2E7D32}
.badge-warn{background:#FFF3E0;color:#E65100}
.badge-error{background:#FFEBEE;color:#C62828}
.badge-muted{background:var(--md-border-l);color:var(--md-on-muted)}

.alert{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-radius:var(--radius-s);font-size:13px;line-height:1.5;margin-bottom:16px}
.alert .mi{font-size:20px;flex-shrink:0;margin-top:1px}
.alert-error{background:var(--md-error-bg);color:var(--md-error)}
.alert-warn{background:var(--md-warn-bg);color:var(--md-warn)}
.alert-success{background:var(--md-success-bg);color:var(--md-success)}
.alert-info{background:var(--md-info-bg);color:var(--md-info)}

/* ── 레이아웃 ──────────────────────────────────────────────────────────── */
.admin-wrap{display:flex;min-height:100vh}

/* ── 사이드바 ──────────────────────────────────────────────────────────── */
.sidebar{
  width:var(--sidebar-w);flex-shrink:0;background:var(--md-surface);
  box-shadow:var(--md-el2);display:flex;flex-direction:column;
  position:fixed;top:0;left:0;height:100vh;z-index:200;
  transition:transform var(--transition);overflow-y:auto;
}
.sidebar-logo{padding:0 18px;height:var(--header-h);display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--md-border-l);flex-shrink:0}
.logo-text{font-size:17px;font-weight:700;letter-spacing:-.02em}
.logo-admin{font-size:11px;font-weight:500;color:var(--md-on-muted);background:var(--md-border-l);padding:2px 7px;border-radius:10px;margin-left:2px}
.nav-section{padding:8px 10px 4px}
.nav-section-label{font-size:11px;font-weight:600;color:var(--md-on-muted);letter-spacing:.08em;text-transform:uppercase;padding:4px 8px}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:var(--radius-s);cursor:pointer;transition:all var(--transition);color:var(--md-on-surface);font-size:14px;font-weight:400;margin:1px 0;border:none;width:100%;text-align:left;background:transparent}
.nav-item .mi{font-size:20px;color:var(--md-on-muted);transition:color var(--transition);flex-shrink:0}
.nav-item:hover{background:var(--md-bg);color:var(--md-primary)}
.nav-item:hover .mi{color:var(--md-primary)}
.nav-item.active{background:rgba(var(--md-primary-rgb),.1);color:var(--md-primary);font-weight:600}
.nav-item.active .mi{color:var(--md-primary)}
.nav-item:focus-visible{outline:2px solid var(--md-primary);outline-offset:-2px}
.sidebar-footer{margin-top:auto;padding:12px;border-top:1px solid var(--md-border-l)}

/* ── 모바일 오버레이 ─────────────────────────────────────────────────── */
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:199}
@media(max-width:860px){
  .sidebar{transform:translateX(-100%)}
  .sidebar.open{transform:translateX(0)}
  .sidebar-overlay.open{display:block}
}

/* ── 메인 콘텐츠 ─────────────────────────────────────────────────────── */
.main-wrap{flex:1;margin-left:var(--sidebar-w);display:flex;flex-direction:column;min-height:100vh}
@media(max-width:860px){.main-wrap{margin-left:0}}

.topbar{
  position:sticky;top:0;z-index:100;height:var(--header-h);
  background:var(--md-surface);border-bottom:1px solid var(--md-border-l);
  display:flex;align-items:center;padding:0 20px;gap:12px;box-shadow:var(--md-el1);
}
.topbar-menu-btn{display:none}
@media(max-width:860px){.topbar-menu-btn{display:flex}}
.topbar-title{font-size:16px;font-weight:600;flex:1}
.topbar-actions{display:flex;align-items:center;gap:8px}

.content-area{padding:24px 20px;max-width:900px;width:100%}
@media(max-width:600px){.content-area{padding:16px}}

/* ── 섹션 패널 ─────────────────────────────────────────────────────── */
.section-panel{display:none}
.section-panel.active{display:block}
.section-header{margin-bottom:20px}
.section-header h2{font-size:20px;font-weight:700}
.section-header p{font-size:13px;color:var(--md-on-muted);margin-top:4px}

/* ── 대시보드 스탯 ─────────────────────────────────────────────────── */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:20px}
.stat-card{background:var(--md-surface);border-radius:var(--radius);padding:16px;box-shadow:var(--md-el1);border:1px solid var(--md-border-l);display:flex;align-items:center;gap:12px}
.stat-icon{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.stat-icon .mi{font-size:22px;color:#fff}
.stat-icon.blue{background:var(--md-primary)}
.stat-icon.teal{background:#00897B}
.stat-icon.purple{background:#6A1B9A}
.stat-icon.orange{background:#EF6C00}
.stat-value{font-size:20px;font-weight:700}
.stat-label{font-size:12px;color:var(--md-on-muted);font-weight:500}

/* ── Extend 현황 ──────────────────────────────────────────────────── */
.file-list{list-style:none}
.file-item{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:var(--radius-s);transition:background var(--transition);margin-bottom:4px}
.file-item:hover{background:var(--md-bg)}
.file-item .mi{font-size:18px;color:var(--md-on-muted)}
.file-item.admin-file .mi{color:var(--md-primary)}
.file-meta{flex:1;min-width:0}
.file-name{font-size:13px;font-weight:500;font-family:monospace;color:var(--md-on-surface)}
.file-info{font-size:12px;color:var(--md-on-muted)}

/* ── 플러그인 매니저 ────────────────────────────────────────────────── */
.plugin-list{list-style:none;display:flex;flex-direction:column;gap:4px}
.plugin-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--radius-s);background:var(--md-surface-2);border:1px solid var(--md-border-l);transition:all var(--transition);cursor:grab}
.plugin-item:active{cursor:grabbing;opacity:.85;box-shadow:var(--md-el4)}
.plugin-item.dragging{opacity:.4}
.plugin-drag{color:var(--md-on-muted);font-size:20px;flex-shrink:0;touch-action:none}
.plugin-icon{width:30px;height:30px;border-radius:7px;background:rgba(var(--md-primary-rgb),.1);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.plugin-icon .mi{font-size:16px;color:var(--md-primary)}
.plugin-info{flex:1;min-width:0}
.plugin-name{font-size:13px;font-weight:600}
.plugin-cmd{font-size:11px;font-family:monospace;color:var(--md-on-muted)}
.plugin-order-input{width:56px;padding:4px 8px;border-radius:6px;border:1.5px solid var(--md-border);background:var(--md-surface);color:var(--md-on-surface);font-size:13px;text-align:center}
.plugin-order-input:focus{outline:none;border-color:var(--md-primary)}

/* ── 도메인 태그 인풋 ───────────────────────────────────────────────── */
.tag-input-wrap{border:1.5px solid var(--md-border);border-radius:var(--radius-s);padding:6px 10px;background:var(--md-surface-2);min-height:48px;display:flex;flex-wrap:wrap;gap:6px;cursor:text;transition:border-color var(--transition)}
.tag-input-wrap:focus-within{border-color:var(--md-primary);box-shadow:0 0 0 3px rgba(var(--md-primary-rgb),.12)}
.tag{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(var(--md-primary-rgb),.12);color:var(--md-primary);border-radius:20px;font-size:12px;font-weight:500}
.tag-del{cursor:pointer;line-height:1;color:var(--md-primary);opacity:.7;font-size:14px;padding:0 2px}
.tag-del:hover{opacity:1}
.tag-input{border:none;outline:none;background:transparent;color:var(--md-on-surface);font-size:13px;min-width:140px;padding:2px 0}

/* ── iframe 플랫폼 체크리스트 ───────────────────────────────────────── */
.platform-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.platform-check{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--radius-s);border:1.5px solid var(--md-border-l);background:var(--md-surface-2);cursor:pointer;transition:all var(--transition)}
.platform-check:hover{border-color:var(--md-primary);background:rgba(var(--md-primary-rgb),.05)}
.platform-check input{accent-color:var(--md-primary);width:14px;height:14px}
.platform-check-label{font-size:12px;font-weight:500}

/* ── 업로드 확장자 ──────────────────────────────────────────────────── */
.ext-section{margin-bottom:20px}
.ext-title{font-size:13px;font-weight:600;color:var(--md-on-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
.ext-chips{display:flex;flex-wrap:wrap;gap:6px}
.ext-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;background:rgba(var(--md-primary-rgb),.1);color:var(--md-primary);cursor:pointer;transition:all var(--transition);border:1.5px solid transparent;-webkit-user-select:none;user-select:none}
.ext-chip.active{background:var(--md-primary);color:#fff}
.ext-chip:hover{border-color:var(--md-primary)}
.ext-add-wrap{display:flex;gap:8px;margin-top:8px}
.ext-add-input{flex:1;padding:6px 10px;border:1.5px solid var(--md-border);border-radius:var(--radius-s);background:var(--md-surface-2);color:var(--md-on-surface);font-size:13px}
.ext-add-input:focus{outline:none;border-color:var(--md-primary)}

/* ── 토스트 ─────────────────────────────────────────────────────────── */
.toast-container{position:fixed;bottom:24px;right:24px;z-index:1000;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.toast{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:var(--radius-s);background:var(--md-on-surface);color:var(--md-surface);font-size:13px;font-weight:500;box-shadow:var(--md-el4);animation:slideUp .25s ease;pointer-events:auto;max-width:340px}
.toast.success{background:#2E7D32}
.toast.error{background:#C62828}
.toast.warn{background:#E65100}
.toast .mi{font-size:18px;flex-shrink:0}
@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes slideDown{to{opacity:0;transform:translateY(10px)}}
.toast.removing{animation:slideDown .2s ease forwards}

/* ── 로그인 / 셋업 화면 ─────────────────────────────────────────────── */
.auth-screen{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--md-bg)}
.auth-card{width:100%;max-width:400px;background:var(--md-surface);border-radius:var(--radius);box-shadow:var(--md-el4);padding:36px 32px}
.auth-logo{display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:28px}
.auth-logo .t2-logo-prefix,.auth-logo .t2-logo-suffix{font-size:20px;padding:6px 8px}
.auth-title{text-align:center;font-size:20px;font-weight:700;margin-bottom:6px}
.auth-desc{text-align:center;font-size:13px;color:var(--md-on-muted);margin-bottom:24px}
.auth-card .btn{width:100%;justify-content:center;padding:11px}

/* ── 키 활성화 안내 ──────────────────────────────────────────────────── */
.key-screen{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--md-bg)}
.key-card{width:100%;max-width:480px;background:var(--md-surface);border-radius:var(--radius);box-shadow:var(--md-el4);padding:36px 32px;text-align:center}
.key-icon{width:72px;height:72px;border-radius:50%;background:var(--md-warn-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
.key-icon .mi{font-size:36px;color:var(--md-warn)}
.key-title{font-size:20px;font-weight:700;margin-bottom:10px}
.key-desc{font-size:14px;color:var(--md-on-muted);line-height:1.7;margin-bottom:24px}
.key-code{font-family:monospace;background:var(--md-bg);border:1.5px solid var(--md-border);border-radius:var(--radius-s);padding:14px 18px;font-size:14px;color:var(--md-primary);text-align:left;margin-bottom:20px;word-break:break-all}
.key-code .arrow{display:block;color:var(--md-on-muted);font-size:12px;margin-top:6px}

/* ── 경고 오버레이 (미설정 시 에디터 접근 경고) ──────────────────────── */
.warning-banner{background:var(--md-warn-bg);border-bottom:2px solid var(--md-warn);padding:12px 20px;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:500;color:var(--md-warn)}
.warning-banner .mi{font-size:20px;flex-shrink:0}

/* ── Material Icons 로컬 폰트 ────────────────────────────────────────── */
@font-face {
  font-family: "Material Icons";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("<?= htmlspecialchars($EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.woff2") format("woff2"),
       url("<?= htmlspecialchars($EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.woff") format("woff");
}
@font-face {
  font-family: "Material Icons Outlined";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("<?= htmlspecialchars($EDITOR_URL) ?>/fonts/material-icons/MaterialIconsOutlined-Regular.woff2") format("woff2");
}
.mi { font-family:"Material Icons";font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;-webkit-font-feature-settings:"liga";font-feature-settings:"liga";-webkit-font-smoothing:antialiased }
.material-icons { font-family:"Material Icons";font-weight:normal;font-style:normal;font-size:22px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;-webkit-font-feature-settings:"liga";font-feature-settings:"liga";-webkit-font-smoothing:antialiased }
.material-icons-outlined { font-family:"Material Icons Outlined";font-weight:normal;font-style:normal;font-size:22px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;-webkit-font-feature-settings:"liga";font-feature-settings:"liga";-webkit-font-smoothing:antialiased }

/* ── T2Editor 실 로고 lockup (에디터 본체 css/core.css 의 .t2-logo 와 동일 마크업/색상) ── */
.t2-logo{display:flex;align-items:center;border:none;border-radius:4px;text-decoration:none;flex-shrink:0}
.t2-logo-prefix{background:var(--t2-orange);color:#fff;padding:4px;font-weight:600;border:1px solid var(--t2-orange);border-radius:4px 0 0 4px;font-size:13px;line-height:1}
.t2-logo-suffix{padding:4px;font-weight:600;border:1px solid var(--md-border);border-left:none;border-radius:0 4px 4px 0;font-size:13px;line-height:1;color:var(--md-on-surface)}
/* 에디터 하단 상태바의 "ⓘ T2Editor Ver x.x.x" 라인과 동일한 어휘·톤으로 버전 표기 — 같은 제품군임을 은은히 전달 */
.t2-version-line{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:500;color:var(--md-on-muted)}
.t2-version-line .material-icons-outlined{font-size:13px}

/* ── 반응형 ──────────────────────────────────────────────────────────── */
@media(max-width:480px){.auth-card,.key-card{padding:24px 18px}.stat-grid{grid-template-columns:1fr 1fr}}

/* ── 프린트 숨김 ─────────────────────────────────────────────────────── */
@media print{.sidebar,.topbar,.toast-container{display:none}.main-wrap{margin:0}}

/* ── 스크롤바 ─────────────────────────────────────────────────────────── */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--md-border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--md-on-muted)}

/* ── 저장 버튼 고정바 ──────────────────────────────────────────────── */
.save-bar{position:sticky;bottom:0;background:var(--md-surface);border-top:1px solid var(--md-border-l);padding:12px 0;margin-top:24px;display:flex;gap:10px;align-items:center;z-index:10}
.save-bar .save-hint{font-size:12px;color:var(--md-on-muted);flex:1}

/* ── 로딩 스피너 ────────────────────────────────────────────────────── */
.spinner{width:20px;height:20px;border:2.5px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── 섹션 전환 애니메이션 ───────────────────────────────────────────── */
.section-panel{animation:fadeInSection .18s ease}
@keyframes fadeInSection{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}

/* ── 구분선 ──────────────────────────────────────────────────────────── */
.divider{border:none;border-top:1px solid var(--md-border-l);margin:20px 0}

/* ── 라이선스 패널 ──────────────────────────────────────────────────── */
.license-badge{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:var(--radius-s);font-size:14px;font-weight:600}
.license-badge.valid{background:var(--md-success-bg);color:var(--md-success)}
.license-badge.invalid{background:var(--md-error-bg);color:var(--md-error)}
.license-badge .mi{font-size:22px}
.license-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--md-border-l);font-size:13px}
.license-row:last-child{border-bottom:none}
.license-row .l-label{color:var(--md-on-muted)}
.license-row .l-value{font-weight:600;font-family:monospace}

/* ── 아이콘 매니저 ──────────────────────────────────────────────────── */
.icon-search{margin-bottom:14px}
.icon-row{display:flex;align-items:center;gap:12px;padding:12px;border-radius:var(--radius-s);background:var(--md-surface-2);border:1px solid var(--md-border-l);margin-bottom:8px;flex-wrap:wrap}
.icon-preview{width:44px;height:44px;border-radius:10px;background:var(--md-surface);border:1.5px solid var(--md-border);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color var(--transition)}
.icon-preview .material-icons,.icon-preview .material-icons-outlined{font-size:22px;color:var(--md-primary)}
.icon-meta{flex:0 0 auto;min-width:130px}
.icon-cmd{font-size:12px;font-weight:600;font-family:monospace}
.icon-label{font-size:11px;color:var(--md-on-muted)}
.icon-source-badge{font-size:10px}
.icon-controls{display:flex;gap:6px;flex:1;min-width:240px;flex-wrap:wrap}
.icon-controls select{padding:6px 8px;font-size:12px;border-radius:6px;border:1.5px solid var(--md-border);background:var(--md-surface);color:var(--md-on-surface)}
.icon-controls input{padding:6px 8px;font-size:12px;border-radius:6px;border:1.5px solid var(--md-border);background:var(--md-surface);color:var(--md-on-surface);min-width:110px;flex:1}
.icon-controls select:focus,.icon-controls input:focus{outline:none;border-color:var(--md-primary)}
.icon-reset-btn{flex-shrink:0;color:var(--md-on-muted)}
.icon-reset-btn:hover{color:var(--md-error)}
.icon-row.overridden{border-color:var(--md-primary);background:rgba(var(--md-primary-rgb),.05)}

/* ── 반응형 툴바 그룹 에디터 ───────────────────────────────────────── */
.bp-card{border:1.5px solid var(--md-border-l);border-radius:var(--radius);margin-bottom:16px;overflow:hidden}
.bp-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--md-surface-2);border-bottom:1px solid var(--md-border-l)}
.bp-head .mi{color:var(--md-primary)}
.bp-range{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600}
.bp-range input{width:64px;padding:4px 6px;border-radius:6px;border:1.5px solid var(--md-border);background:var(--md-surface);text-align:center;font-size:13px}
.bp-body{padding:14px}
.group-card{border:1px solid var(--md-border-l);border-radius:var(--radius-s);padding:12px;margin-bottom:10px;background:var(--md-surface-2)}
.group-card-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.group-icon-preview{width:34px;height:34px;border-radius:8px;background:var(--md-surface);border:1.5px solid var(--md-border);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.group-icon-preview .material-icons{font-size:18px;color:var(--md-primary)}
.group-card-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
@media(max-width:560px){.group-card-fields{grid-template-columns:1fr}}
.group-card-fields input{padding:6px 8px;border-radius:6px;border:1.5px solid var(--md-border);background:var(--md-surface);font-size:12px;color:var(--md-on-surface)}
.btn-chip-picker{display:flex;flex-wrap:wrap;gap:5px;padding:8px;background:var(--md-surface);border:1.5px solid var(--md-border-l);border-radius:8px;max-height:120px;overflow-y:auto}
.btn-chip{display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:14px;font-size:11px;font-weight:500;background:var(--md-border-l);color:var(--md-on-muted);cursor:pointer;border:1px solid transparent;transition:all var(--transition)}
.btn-chip.sel{background:rgba(var(--md-primary-rgb),.12);color:var(--md-primary);border-color:var(--md-primary)}
.btn-chip .material-icons{font-size:13px}
.bp-add-row{display:flex;gap:8px;margin-top:6px}
.empty-hint{text-align:center;padding:24px;color:var(--md-on-muted);font-size:13px}
</style>
</head>
<body>
<?php // ── 키 미활성화 화면 ───────────────────────────────────────────── ?>
<?php if ($page_state === 'no_key'): ?>
<div class="key-screen" role="main">
  <div class="key-card">
    <div class="key-icon" aria-hidden="true"><span class="mi">key_off</span></div>
    <h1 class="key-title">관리자 패널 비활성화</h1>
    <p class="key-desc">
      T2Editor 관리자 패널을 사용하려면<br>아래 파일의 이름을 변경해야 합니다.
    </p>
    <div class="key-code" aria-label="파일명 변경 방법">
      📄 <strong>t2admin.key.txt</strong>
      <span class="arrow">↓ 파일명 변경 (FTP/파일매니저)</span>
      🗝️ <strong>t2admin.key</strong>
    </div>
    <?php if (!$key_txt): ?>
    <div class="alert alert-warn"><span class="mi" aria-hidden="true">warning</span><span>key.txt 파일도 없습니다. 두 파일 모두 삭제된 것 같습니다. 재설치가 필요할 수 있습니다.</span></div>
    <?php endif; ?>
    <p style="font-size:12px;color:var(--md-on-muted)">변경 후 이 페이지를 새로고침 하세요.</p>
    <button class="btn btn-outline btn-sm" style="margin-top:14px" onclick="location.reload()">
      <span class="mi" style="font-size:17px" aria-hidden="true">refresh</span> 새로고침
    </button>
  </div>
</div>
<?php // ── 초기 설정 화면 ────────────────────────────────────────────── ?>
<?php elseif ($page_state === 'setup'): ?>
<div class="auth-screen" role="main">
  <div class="auth-card">
    <div class="auth-logo" aria-label="T2Editor 관리자">
      <span class="t2-logo"><span class="t2-logo-prefix">T2</span><span class="t2-logo-suffix">Editor</span></span>
      <span class="logo-admin">Admin</span>
    </div>
    <?php if (!$data_writable): ?>
    <div class="alert alert-error"><span class="mi" aria-hidden="true">folder_off</span><span>data 디렉토리에 쓰기 권한이 없습니다. 서버에서 <code>chmod 755 <?= htmlspecialchars(T2EDITOR_DATA_PATH) ?></code> 를 실행하세요.</span></div>
    <?php else: ?>
    <h1 class="auth-title">관리자 비밀번호 설정</h1>
    <p class="auth-desc">처음 사용 시 관리자 비밀번호를 설정합니다.</p>
    <div id="setup-error" class="alert alert-error" style="display:none" role="alert"></div>
    <div class="form-group">
      <label class="form-label" for="setup-pw">비밀번호</label>
      <input type="password" id="setup-pw" class="form-control" placeholder="8자 이상 입력" autocomplete="new-password" minlength="8" aria-required="true">
    </div>
    <div class="form-group">
      <label class="form-label" for="setup-pw2">비밀번호 확인</label>
      <input type="password" id="setup-pw2" class="form-control" placeholder="동일하게 입력" autocomplete="new-password" aria-required="true">
    </div>
    <button id="setup-btn" class="btn btn-primary" onclick="doSetup()">
      <span class="mi" style="font-size:18px" aria-hidden="true">lock</span> 관리자 설정 완료
    </button>
    <?php endif; ?>
  </div>
</div>
<?php // ── 로그인 화면 ───────────────────────────────────────────────── ?>
<?php elseif ($page_state === 'login'): ?>
<div class="auth-screen" role="main">
  <div class="auth-card">
    <div class="auth-logo" aria-label="T2Editor 관리자">
      <span class="t2-logo"><span class="t2-logo-prefix">T2</span><span class="t2-logo-suffix">Editor</span></span>
      <span class="logo-admin">Admin</span>
    </div>
    <h1 class="auth-title">관리자 로그인</h1>
    <p class="auth-desc">비밀번호를 입력하세요.</p>
    <div id="login-error" class="alert alert-error" style="display:none" role="alert"></div>
    <div class="form-group">
      <label class="form-label" for="login-pw">비밀번호</label>
      <input type="password" id="login-pw" class="form-control" placeholder="비밀번호 입력" autocomplete="current-password" aria-required="true">
    </div>
    <button id="login-btn" class="btn btn-primary" onclick="doLogin()">
      <span class="mi" style="font-size:18px" aria-hidden="true">login</span> 로그인
    </button>
  </div>
</div>
<?php // ── 관리자 메인 대시보드 ─────────────────────────────────────── ?>
<?php else: ?>

<?php if (!$data_writable): ?>
<div class="warning-banner" role="alert">
  <span class="mi" aria-hidden="true">warning</span>
  data 디렉토리에 쓰기 권한이 없습니다. 설정 저장이 불가능합니다.
  <code style="font-size:12px;margin-left:8px;background:rgba(0,0,0,.1);padding:2px 6px;border-radius:4px">chmod 755 <?= htmlspecialchars(T2EDITOR_DATA_PATH) ?></code>
</div>
<?php endif; ?>

<div class="admin-wrap">
  <!-- 사이드바 오버레이 -->
  <div class="sidebar-overlay" id="sidebar-overlay" onclick="closeSidebar()" role="presentation"></div>

  <!-- 사이드바 -->
  <nav class="sidebar" id="sidebar" role="navigation" aria-label="관리자 메뉴">
    <div class="sidebar-logo">
      <a class="t2-logo" href="<?= htmlspecialchars($EDITOR_URL) ?>" target="_blank" rel="noopener" aria-label="T2Editor 사이트로 이동">
        <span class="t2-logo-prefix">T2</span><span class="t2-logo-suffix">Editor</span>
      </a>
      <span class="logo-admin">Admin</span>
    </div>

    <div class="nav-section">
      <div class="nav-section-label" aria-hidden="true">메인</div>
      <button class="nav-item active" onclick="showSection('dashboard')" aria-current="page" data-section="dashboard">
        <span class="mi" aria-hidden="true">dashboard</span> 대시보드
      </button>
      <button class="nav-item" onclick="showSection('license')" data-section="license">
        <span class="mi" aria-hidden="true">verified</span> 라이선스
      </button>
      <button class="nav-item" onclick="showSection('extend')" data-section="extend">
        <span class="mi" aria-hidden="true">extension</span> Extend 현황
      </button>
    </div>

    <div class="nav-section">
      <div class="nav-section-label" aria-hidden="true">에디터 설정</div>
      <button class="nav-item" onclick="showSection('editor')" data-section="editor">
        <span class="mi" aria-hidden="true">tune</span> 기본 설정
      </button>
      <button class="nav-item" onclick="showSection('nsfw')" data-section="nsfw">
        <span class="mi" aria-hidden="true">no_adult_content</span> NSFW 필터
      </button>
      <button class="nav-item" onclick="showSection('plugins')" data-section="plugins">
        <span class="mi" aria-hidden="true">widgets</span> 플러그인 관리
      </button>
      <button class="nav-item" onclick="showSection('icons')" data-section="icons">
        <span class="mi" aria-hidden="true">palette</span> 아이콘 관리
      </button>
      <button class="nav-item" onclick="showSection('toolbar')" data-section="toolbar">
        <span class="mi" aria-hidden="true">view_carousel</span> 반응형 툴바
      </button>
    </div>

    <div class="nav-section">
      <div class="nav-section-label" aria-hidden="true">서버 설정</div>
      <button class="nav-item" onclick="showSection('domains')" data-section="domains">
        <span class="mi" aria-hidden="true">language</span> 도메인 설정
      </button>
      <button class="nav-item" onclick="showSection('upload')" data-section="upload">
        <span class="mi" aria-hidden="true">cloud_upload</span> 업로드 설정
      </button>
    </div>

    <div class="nav-section">
      <div class="nav-section-label" aria-hidden="true">계정</div>
      <button class="nav-item" onclick="showSection('security')" data-section="security">
        <span class="mi" aria-hidden="true">lock</span> 보안
      </button>
    </div>

    <div class="sidebar-footer">
      <button class="btn btn-outline btn-sm" onclick="doLogout()" style="width:100%;justify-content:center">
        <span class="mi" style="font-size:16px" aria-hidden="true">logout</span> 로그아웃
      </button>
      <div class="t2-version-line" style="justify-content:center;margin-top:10px" id="sidebar-version-line">
        <span class="material-icons-outlined" aria-hidden="true">info</span>
        <span id="sidebar-version-text">T2Editor Admin</span>
      </div>
    </div>
  </nav>

  <!-- 메인 영역 -->
  <div class="main-wrap">
    <header class="topbar">
      <button class="btn btn-icon topbar-menu-btn" onclick="openSidebar()" aria-label="메뉴 열기" aria-expanded="false" id="menu-btn">
        <span class="mi" aria-hidden="true">menu</span>
      </button>
      <div class="topbar-title" id="topbar-title">대시보드</div>
      <div class="topbar-actions">
        <button class="btn btn-icon" onclick="toggleTheme()" aria-label="다크모드 전환" title="다크/라이트 전환">
          <span class="mi" aria-hidden="true" id="theme-icon">dark_mode</span>
        </button>
        <button class="btn btn-primary btn-sm" id="save-btn" onclick="saveCurrentSection()" style="display:none" aria-label="설정 저장">
          <span class="mi" style="font-size:16px" aria-hidden="true">save</span> 저장
        </button>
      </div>
    </header>

    <main style="flex:1;overflow-y:auto">
      <div class="content-area">

        <!-- ══ 대시보드 ══════════════════════════════════════════════════ -->
        <div class="section-panel active" id="section-dashboard">
          <div class="section-header">
            <h2>대시보드</h2>
            <p>T2Editor 관리자 현황 개요</p>
          </div>
          <div class="stat-grid" id="dash-stats">
            <div class="stat-card" style="cursor:pointer" onclick="showSection('license')" role="button" tabindex="0" aria-label="라이선스 섹션으로 이동" onkeydown="if(event.key==='Enter')showSection('license')"><div class="stat-icon" id="stat-license-icon"><span class="mi">verified</span></div><div><div class="stat-value" id="stat-license">-</div><div class="stat-label">라이선스</div></div></div>
            <div class="stat-card"><div class="stat-icon blue"><span class="mi">extension</span></div><div><div class="stat-value" id="stat-plugins">-</div><div class="stat-label">활성 플러그인</div></div></div>
            <div class="stat-card"><div class="stat-icon teal"><span class="mi">cloud_upload</span></div><div><div class="stat-value" id="stat-upload">-</div><div class="stat-label">최대 업로드</div></div></div>
            <div class="stat-card"><div class="stat-icon purple"><span class="mi">no_adult_content</span></div><div><div class="stat-value" id="stat-nsfw">-</div><div class="stat-label">NSFW 필터</div></div></div>
            <div class="stat-card"><div class="stat-icon orange"><span class="mi">swap_horiz</span></div><div><div class="stat-value" id="stat-migrate">-</div><div class="stat-label">마이그레이션</div></div></div>
          </div>

          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><span class="mi" aria-hidden="true">info</span><span class="card-title">시스템 정보</span></div>
            <div class="card-body" id="sys-info">
              <div style="color:var(--md-on-muted);font-size:13px">로딩 중...</div>
            </div>
          </div>

          <div class="card">
            <div class="card-header"><span class="mi" aria-hidden="true">security</span><span class="card-title">보안 상태</span></div>
            <div class="card-body">
              <div style="display:flex;flex-direction:column;gap:10px">
                <div style="display:flex;align-items:center;justify-content:space-between">
                  <span style="font-size:13px">키 파일 활성화</span>
                  <span class="badge badge-success">✓ 활성화됨</span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between">
                  <span style="font-size:13px">비밀번호 보호</span>
                  <span class="badge badge-success">✓ 설정됨</span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between">
                  <span style="font-size:13px">data 폴더 쓰기</span>
                  <span class="badge <?= $data_writable ? 'badge-success' : 'badge-error' ?>"><?= $data_writable ? '✓ 가능' : '✗ 불가' ?></span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ══ 라이선스 ══════════════════════════════════════════════════ -->
        <div class="section-panel" id="section-license">
          <div class="section-header">
            <h2>라이선스</h2>
            <p>T2Editor 본체의 라이선스 검증 상태를 확인합니다</p>
          </div>
          <div class="card">
            <div class="card-body" id="license-body">
              <div style="color:var(--md-on-muted);font-size:13px">확인 중...</div>
            </div>
          </div>
        </div>

        <!-- ══ Extend 현황 ═══════════════════════════════════════════════ -->
        <div class="section-panel" id="section-extend">
          <div class="section-header">
            <h2>Extend 현황</h2>
            <p>extend/php, extend/js 에 로드되는 파일 목록</p>
          </div>
          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><span class="mi" aria-hidden="true">php</span><span class="card-title">extend/php — PHP 자동 로드</span></div>
            <div class="card-body" id="extend-php-list"><div style="color:var(--md-on-muted);font-size:13px">로딩 중...</div></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="mi" aria-hidden="true">javascript</span><span class="card-title">extend/js — JS 자동 로드</span></div>
            <div class="card-body" id="extend-js-list"><div style="color:var(--md-on-muted);font-size:13px">로딩 중...</div></div>
          </div>
        </div>

        <!-- ══ 에디터 기본 설정 ══════════════════════════════════════════ -->
        <div class="section-panel" id="section-editor">
          <div class="section-header">
            <h2>에디터 기본 설정</h2>
            <p>editor.lib.php의 핵심 상수를 관리합니다</p>
          </div>
          <div class="card">
            <div class="card-header"><span class="mi" aria-hidden="true">speed</span><span class="card-title">최적화</span></div>
            <div class="card-body">
              <div class="toggle-wrap">
                <div class="toggle-info"><div class="toggle-title">CSS 압축 (T2_CSS_MIN)</div><div class="toggle-desc">CSS 파일을 압축하여 전송. 서버 부하가 낮을 때 권장.</div></div>
                <label class="toggle" aria-label="CSS 압축"><input type="checkbox" id="cfg-css-min"><div class="toggle-track"></div><div class="toggle-thumb"></div></label>
              </div>
              <div class="toggle-wrap">
                <div class="toggle-info"><div class="toggle-title">JS 압축 (T2_JS_MIN)</div><div class="toggle-desc">JS 파일을 압축하여 전송. 사양이 낮은 서버는 과부하 위험.</div></div>
                <label class="toggle" aria-label="JS 압축"><input type="checkbox" id="cfg-js-min"><div class="toggle-track"></div><div class="toggle-thumb"></div></label>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:14px">
            <div class="card-header"><span class="mi" aria-hidden="true">dark_mode</span><span class="card-title">다크모드 설정</span></div>
            <div class="card-body">
              <div class="toggle-wrap">
                <div class="toggle-info"><div class="toggle-title">다크모드 버튼 표시</div><div class="toggle-desc">에디터 하단에 다크/라이트 전환 버튼을 표시합니다.</div></div>
                <label class="toggle" aria-label="다크모드 버튼"><input type="checkbox" id="cfg-darkmode-btn"><div class="toggle-track"></div><div class="toggle-thumb"></div></label>
              </div>
              <div class="form-group" style="margin-top:8px">
                <label class="form-label" for="cfg-darkmode-theme">테마 강제 설정</label>
                <select class="form-control" id="cfg-darkmode-theme">
                  <option value="null">사용자/시스템 설정 따름 (기본)</option>
                  <option value="dark">다크모드 고정</option>
                  <option value="light">라이트모드 고정</option>
                </select>
                <div class="form-hint">강제 설정 시 다크모드 버튼은 숨겨야 의미있습니다.</div>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:14px">
            <div class="card-header"><span class="mi" aria-hidden="true">swap_horiz</span><span class="card-title">마이그레이션 설정</span></div>
            <div class="card-body">
              <div class="form-group">
                <label class="form-label" for="cfg-migration">마이그레이션 모드 (T2_MIGRATION_MODE)</label>
                <select class="form-control" id="cfg-migration">
                  <option value="false">비활성화 (기본)</option>
                  <option value="prompt">감지 시 팝업 표시</option>
                  <option value="auto">자동 변환</option>
                </select>
                <div class="form-hint">타 에디터(그누보드 기본 에디터 등) 콘텐츠를 T2Editor 형식으로 변환하는 방식.</div>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:14px">
            <div class="card-header"><span class="mi" aria-hidden="true">smart_display</span><span class="card-title">비디오 플레이어</span></div>
            <div class="card-body">
              <div class="toggle-wrap">
                <div class="toggle-info"><div class="toggle-title">전용 iframe 플레이어 사용 (T2_VIDEO_PLAYER_ENABLED)</div><div class="toggle-desc">true: video_player.php 전용 플레이어 / false: native video 태그</div></div>
                <label class="toggle" aria-label="전용 플레이어"><input type="checkbox" id="cfg-video-player"><div class="toggle-track"></div><div class="toggle-thumb"></div></label>
              </div>
            </div>
          </div>

          <div class="save-bar">
            <span class="save-hint">변경 후 저장하면 즉시 적용됩니다 (페이지 캐시 제외)</span>
            <button class="btn btn-primary" onclick="saveCurrentSection()"><span class="mi" style="font-size:16px" aria-hidden="true">save</span> 저장</button>
          </div>
        </div>

        <!-- ══ NSFW 필터 ═════════════════════════════════════════════════ -->
        <div class="section-panel" id="section-nsfw">
          <div class="section-header">
            <h2>NSFW 필터</h2>
            <p>이미지 업로드 시 성인 콘텐츠를 자동 감지합니다</p>
          </div>
          <div class="card">
            <div class="card-header"><span class="mi" aria-hidden="true">no_adult_content</span><span class="card-title">기본 설정</span></div>
            <div class="card-body">
              <div class="toggle-wrap">
                <div class="toggle-info"><div class="toggle-title">NSFW 필터 활성화 (T2_NSFW_ENABLED)</div><div class="toggle-desc">이미지 업로드 시 AI로 성인 콘텐츠 여부를 검사합니다.</div></div>
                <label class="toggle" aria-label="NSFW 활성화"><input type="checkbox" id="cfg-nsfw-on"><div class="toggle-track"></div><div class="toggle-thumb"></div></label>
              </div>
              <div class="toggle-wrap">
                <div class="toggle-info"><div class="toggle-title">의심 이미지 허용 (T2_NSFW_ALLOW_SUSPICIOUS)</div><div class="toggle-desc">true: 경고 후 업로드 허용 / false: 업로드 차단</div></div>
                <label class="toggle" aria-label="의심 허용"><input type="checkbox" id="cfg-nsfw-allow"><div class="toggle-track"></div><div class="toggle-thumb"></div></label>
              </div>
            </div>
          </div>
          <div class="card" style="margin-top:14px">
            <div class="card-header"><span class="mi" aria-hidden="true">memory</span><span class="card-title">브라우저 추론 설정</span></div>
            <div class="card-body">
              <div class="form-group">
                <label class="form-label" for="cfg-nsfw-mode">추론 방식 (T2_NSFW_MODE)</label>
                <select class="form-control" id="cfg-nsfw-mode">
                  <option value="browser">브라우저 추론 (클라이언트 GPU)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="cfg-nsfw-backend">백엔드 우선순위 (T2_NSFW_BROWSER_BACKEND_PRIORITY)</label>
                <input type="text" id="cfg-nsfw-backend" class="form-control" placeholder="webgpu,webgl,wasm,cpu">
                <div class="form-hint">쉼표로 구분. 지원되는 값: webgpu, webgl, wasm, cpu</div>
              </div>
            </div>
          </div>
          <div class="save-bar">
            <span class="save-hint"></span>
            <button class="btn btn-primary" onclick="saveCurrentSection()"><span class="mi" style="font-size:16px" aria-hidden="true">save</span> 저장</button>
          </div>
        </div>

        <!-- ══ 플러그인 관리 ═════════════════════════════════════════════ -->
        <div class="section-panel" id="section-plugins">
          <div class="section-header">
            <h2>플러그인 관리</h2>
            <p>플러그인 활성화·비활성화 및 로딩 우선순위를 설정합니다</p>
          </div>
          <div class="alert alert-info"><span class="mi" aria-hidden="true">info</span><span>드래그 앤 드롭으로 플러그인 순서를 변경하세요. 우선순위 숫자가 낮을수록 먼저 로드됩니다.</span></div>
          <div class="card">
            <div class="card-header"><span class="mi" aria-hidden="true">widgets</span><span class="card-title">플러그인 목록</span><span id="plugin-scan-badge" class="badge badge-muted" style="margin-left:auto">동적 스캔</span></div>
            <div class="card-body" style="padding:12px">
              <ul class="plugin-list" id="plugin-list" role="list" aria-label="플러그인 목록">
                <li style="text-align:center;color:var(--md-on-muted);font-size:13px;padding:20px">로딩 중...</li>
              </ul>
            </div>
          </div>
          <div class="card" style="margin-top:14px">
            <div class="card-header"><span class="mi" aria-hidden="true">view_column</span><span class="card-title">버튼 순서 Override</span></div>
            <div class="card-body">
              <div class="form-group">
                <label class="form-label" for="cfg-btn-order">버튼 순서 (비워두면 우선순위 자동 정렬)</label>
                <input type="text" id="cfg-btn-order" class="form-control" placeholder="createLink,insertImage,insertYouTube,...">
                <div class="form-hint">command 문자열을 쉼표로 구분. 예: <code>createLink,insertImage,insertYouTube</code></div>
              </div>
            </div>
          </div>
          <div class="save-bar">
            <span class="save-hint">플러그인 변경은 페이지 새로고침 후 반영됩니다</span>
            <button class="btn btn-primary" onclick="saveCurrentSection()"><span class="mi" style="font-size:16px" aria-hidden="true">save</span> 저장</button>
          </div>
        </div>

        <!-- ══ 아이콘 관리 ═══════════════════════════════════════════════ -->
        <div class="section-panel" id="section-icons">
          <div class="section-header">
            <h2>아이콘 관리</h2>
            <p>플러그인별 툴바 버튼 아이콘을 자유롭게 바꿉니다</p>
          </div>
          <div class="alert alert-info">
            <span class="mi" aria-hidden="true">info</span>
            <span>아이콘 이름은 <a href="https://fonts.google.com/icons" target="_blank" rel="noopener">Google Material Symbols/Icons</a> 사이트에서 원하는 아이콘을 찾아 영문 이름(예: <code>auto_awesome</code>)을 그대로 입력하면 됩니다.</span>
          </div>
          <div class="form-group icon-search">
            <input type="text" id="icon-search-input" class="form-control" placeholder="command 또는 라벨로 검색…" oninput="renderIconManager()" aria-label="아이콘 검색">
          </div>
          <div id="icon-manager-list">
            <div class="empty-hint">로딩 중...</div>
          </div>
          <div class="save-bar">
            <span class="save-hint">저장하면 새로고침 즉시 반영됩니다</span>
            <button class="btn btn-primary" onclick="saveCurrentSection()"><span class="mi" style="font-size:16px" aria-hidden="true">save</span> 저장</button>
          </div>
        </div>

        <!-- ══ 반응형 툴바 ═══════════════════════════════════════════════ -->
        <div class="section-panel" id="section-toolbar">
          <div class="section-header">
            <h2>반응형 툴바</h2>
            <p>화면 너비별로 일부 버튼을 그룹(서브 메뉴)으로 묶어 출력합니다</p>
          </div>
          <div class="toggle-wrap" style="background:var(--md-surface);border:1px solid var(--md-border-l);border-radius:var(--radius-s);padding:12px 16px;margin-bottom:16px">
            <div class="toggle-info"><div class="toggle-title">커스텀 반응형 설정 사용</div><div class="toggle-desc">끄면 toolbar.js 내장 기본값(2단계 브레이크포인트)을 사용합니다.</div></div>
            <label class="toggle" aria-label="커스텀 반응형 설정 사용"><input type="checkbox" id="tg-enabled" onchange="onToolbarGroupsEnabledChange()"><div class="toggle-track"></div><div class="toggle-thumb"></div></label>
          </div>
          <div id="tg-editor"></div>
          <div class="bp-add-row" id="tg-add-row" style="display:none">
            <button class="btn btn-outline btn-sm" onclick="addBreakpoint()"><span class="mi" style="font-size:16px" aria-hidden="true">add</span> 브레이크포인트 추가</button>
          </div>
          <div class="save-bar">
            <span class="save-hint">화면 너비(px) 구간별로 버튼을 그룹화합니다. 한 화면 너비는 하나의 구간에만 속해야 합니다</span>
            <button class="btn btn-primary" onclick="saveCurrentSection()"><span class="mi" style="font-size:16px" aria-hidden="true">save</span> 저장</button>
          </div>
        </div>

        <!-- ══ 도메인 설정 ═══════════════════════════════════════════════ -->
        <div class="section-panel" id="section-domains">
          <div class="section-header">
            <h2>도메인 설정</h2>
            <p>허용 URL 도메인 및 iframe 임베드 플랫폼을 관리합니다</p>
          </div>
          <div class="card" style="margin-bottom:14px">
            <div class="card-header"><span class="mi" aria-hidden="true">link</span><span class="card-title">추가 허용 URL 도메인</span></div>
            <div class="card-body">
              <p style="font-size:13px;color:var(--md-on-muted);margin-bottom:12px">현재 서버 도메인은 자동 포함됩니다. CDN, 서브도메인 등 추가 허용 도메인을 입력하세요.</p>
              <div class="tag-input-wrap" id="url-domains-wrap" role="group" aria-label="허용 URL 도메인" onclick="this.querySelector('.tag-input')?.focus()">
                <input class="tag-input" id="url-domain-input" type="text" placeholder="예: cdn.example.com (Enter 추가)" aria-label="도메인 입력" onkeydown="addTag(event,'url-domains-wrap','url-domains-data')">
              </div>
              <input type="hidden" id="url-domains-data">
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="mi" aria-hidden="true">smart_display</span><span class="card-title">iframe 허용 플랫폼</span></div>
            <div class="card-body">
              <p style="font-size:13px;color:var(--md-on-muted);margin-bottom:12px">동영상 임베드를 허용할 플랫폼을 선택하세요. 체크 해제 시 해당 플랫폼 iframe이 차단됩니다.</p>
              <div class="platform-grid" id="iframe-platforms"></div>
              <hr class="divider">
              <label class="form-label" style="margin-bottom:8px">커스텀 추가 도메인</label>
              <div class="tag-input-wrap" id="custom-iframe-wrap" role="group" aria-label="커스텀 iframe 도메인" onclick="this.querySelector('.tag-input')?.focus()">
                <input class="tag-input" type="text" placeholder="예: player.mysite.com (Enter 추가)" aria-label="커스텀 도메인" onkeydown="addTag(event,'custom-iframe-wrap','custom-iframe-data')">
              </div>
              <input type="hidden" id="custom-iframe-data">
              <div class="form-hint" style="margin-top:8px">커스텀 도메인은 위 플랫폼 선택과 무관하게 항상 추가됩니다.</div>
            </div>
          </div>
          <div class="save-bar">
            <span class="save-hint"></span>
            <button class="btn btn-primary" onclick="saveCurrentSection()"><span class="mi" style="font-size:16px" aria-hidden="true">save</span> 저장</button>
          </div>
        </div>

        <!-- ══ 업로드 설정 ════════════════════════════════════════════════ -->
        <div class="section-panel" id="section-upload">
          <div class="section-header">
            <h2>업로드 설정</h2>
            <p>파일 업로드 크기, 형식, 보안 옵션을 설정합니다</p>
          </div>
          <div class="card" style="margin-bottom:14px">
            <div class="card-header"><span class="mi" aria-hidden="true">storage</span><span class="card-title">기본 설정</span></div>
            <div class="card-body">
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="cfg-max-size">최대 업로드 크기 (MB)</label>
                  <input type="number" id="cfg-max-size" class="form-control" min="1" max="2000" step="1">
                </div>
                <div class="form-group">
                  <label class="form-label" for="cfg-max-pixels">최대 이미지 픽셀</label>
                  <input type="number" id="cfg-max-pixels" class="form-control" min="1000000">
                  <div class="form-hint">50000000 = 50MP</div>
                </div>
              </div>
              <div class="toggle-wrap">
                <div class="toggle-info"><div class="toggle-title">WebP 변환 엄격 모드</div><div class="toggle-desc">변환 실패 시 거부(true·권장) vs. 원본 허용(false·구형 서버)</div></div>
                <label class="toggle" aria-label="WebP 엄격"><input type="checkbox" id="cfg-strict-webp"><div class="toggle-track"></div><div class="toggle-thumb"></div></label>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="mi" aria-hidden="true">file_present</span><span class="card-title">허용 확장자</span></div>
            <div class="card-body">
              <p style="font-size:13px;color:var(--md-on-muted);margin-bottom:16px">클릭으로 확장자를 활성화/비활성화합니다.</p>
              <div id="ext-manager"></div>
            </div>
          </div>
          <div class="save-bar">
            <span class="save-hint">⚠️ 서버의 php.ini upload_max_filesize, post_max_size 설정도 함께 확인하세요</span>
            <button class="btn btn-primary" onclick="saveCurrentSection()"><span class="mi" style="font-size:16px" aria-hidden="true">save</span> 저장</button>
          </div>
        </div>

        <!-- ══ 보안 ══════════════════════════════════════════════════════ -->
        <div class="section-panel" id="section-security">
          <div class="section-header">
            <h2>보안</h2>
            <p>관리자 비밀번호 변경 및 설정 초기화</p>
          </div>
          <div class="card" style="margin-bottom:14px">
            <div class="card-header"><span class="mi" aria-hidden="true">password</span><span class="card-title">비밀번호 변경</span></div>
            <div class="card-body">
              <div id="pw-change-result"></div>
              <div class="form-group">
                <label class="form-label" for="pw-current">현재 비밀번호</label>
                <input type="password" id="pw-current" class="form-control" autocomplete="current-password" aria-required="true">
              </div>
              <div class="form-group">
                <label class="form-label" for="pw-new">새 비밀번호 (8자 이상)</label>
                <input type="password" id="pw-new" class="form-control" autocomplete="new-password" minlength="8" aria-required="true">
              </div>
              <div class="form-group">
                <label class="form-label" for="pw-new2">새 비밀번호 확인</label>
                <input type="password" id="pw-new2" class="form-control" autocomplete="new-password" aria-required="true">
              </div>
              <button class="btn btn-primary" onclick="changePassword()">
                <span class="mi" style="font-size:16px" aria-hidden="true">lock_reset</span> 비밀번호 변경
              </button>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="mi" aria-hidden="true">restore</span><span class="card-title">설정 초기화</span></div>
            <div class="card-body">
              <p style="font-size:13px;color:var(--md-on-muted);margin-bottom:14px">모든 관리자 설정을 기본값으로 초기화합니다. 비밀번호는 유지됩니다.</p>
              <button class="btn btn-danger" onclick="resetSettings()">
                <span class="mi" style="font-size:16px" aria-hidden="true">restart_alt</span> 설정 초기화
              </button>
            </div>
          </div>
        </div>

      </div><!-- /content-area -->
    </main>
  </div><!-- /main-wrap -->
</div><!-- /admin-wrap -->
<?php endif; ?>

<!-- 토스트 컨테이너 -->
<div class="toast-container" id="toast-container" role="status" aria-live="polite" aria-atomic="false"></div>

<script>
// ── 전역 상태 ─────────────────────────────────────────────────────────────
const CSRF   = <?= json_encode($csrf, JSON_HEX_TAG) ?>;
const API    = 'api.php';
let   settings     = {};
let   allPlugins   = {};
let   allButtons   = [];
let   currentSection = 'dashboard';

// ── API 헬퍼 ─────────────────────────────────────────────────────────────
async function api(action, method='GET', body=null) {
  const opts = {
    method,
    headers: {'Content-Type':'application/json','X-T2Admin-CSRF': CSRF}
  };
  if (body && method==='POST') opts.body = JSON.stringify(body);
  try {
    const r = await fetch(API + '?action=' + action, opts);
    return await r.json();
  } catch(e) {
    return {ok:false, msg: '네트워크 오류: ' + e.message};
  }
}

// ── 토스트 ───────────────────────────────────────────────────────────────
function toast(msg, type='') {
  const icons = {success:'check_circle', error:'error', warn:'warning', '':'info'};
  const el = document.createElement('div');
  el.className = 'toast' + (type?' '+type:'');
  el.setAttribute('role','status');
  el.innerHTML = '<span class="mi" aria-hidden="true">'+icons[type||'']+'</span><span>'+msg+'</span>';
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 250);
  }, 3000);
}

// ── 섹션 전환 ─────────────────────────────────────────────────────────────
const sectionTitles = {
  dashboard:'대시보드', license:'라이선스', extend:'Extend 현황',
  editor:'기본 설정', nsfw:'NSFW 필터',
  plugins:'플러그인 관리', icons:'아이콘 관리', toolbar:'반응형 툴바',
  domains:'도메인 설정',
  upload:'업로드 설정', security:'보안'
};
function showSection(name) {
  document.querySelectorAll('.section-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b=>{
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });
  document.getElementById('section-'+name)?.classList.add('active');
  const navBtn = document.querySelector('[data-section="'+name+'"]');
  if (navBtn) { navBtn.classList.add('active'); navBtn.setAttribute('aria-current','page'); }
  document.getElementById('topbar-title').textContent = sectionTitles[name]||name;
  currentSection = name;
  // 저장 버튼 표시 여부
  const hasSave = ['editor','nsfw','plugins','icons','toolbar','domains','upload'].includes(name);
  document.getElementById('save-btn').style.display = hasSave ? '' : 'none';
  // 섹션별 초기 로드
  if (name==='license') loadLicense();
  if (name==='extend') loadExtend();
  if (name==='plugins') loadPlugins();
  if (name==='icons') loadIconManager();
  if (name==='toolbar') loadToolbarGroups();
  closeSidebar();
}

// ── 사이드바 ─────────────────────────────────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('open');
  document.getElementById('menu-btn').setAttribute('aria-expanded','true');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
  document.getElementById('menu-btn')?.setAttribute('aria-expanded','false');
}

// ── 테마 ──────────────────────────────────────────────────────────────────
function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.getElementById('theme-icon').textContent = next==='dark' ? 'light_mode' : 'dark_mode';
  localStorage.setItem('t2admin-theme', next);
}
(function(){
  const saved = localStorage.getItem('t2admin-theme')
    || (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
  document.documentElement.setAttribute('data-theme', saved);
  if (document.getElementById('theme-icon'))
    document.getElementById('theme-icon').textContent = saved==='dark'?'light_mode':'dark_mode';
})();

// ── 설정 로드 ──────────────────────────────────────────────────────────────
async function loadSettings() {
  const r = await api('get_settings');
  if (!r.ok) { toast('설정 로드 실패: '+r.msg,'error'); return; }
  settings = r.data;
  applySettingsToUI();
  loadDashboard();
  loadSidebarVersion();
  fetchAllButtons();
}

async function loadSidebarVersion() {
  const r = await api('get_license');
  const el = document.getElementById('sidebar-version-text');
  if (!el) return;
  if (r.ok && r.data.version) {
    el.textContent = 'T2Editor Ver ' + r.data.version;
  } else {
    el.textContent = 'T2Editor Admin';
  }
}

async function fetchAllButtons() {
  const r = await api('get_all_buttons');
  if (r.ok) allButtons = r.data;
}

function applySettingsToUI() {
  const e = settings.editor||{}, n = settings.nsfw||{}, p = settings.plugins||{}, u = settings.upload||{};
  // 에디터
  setCheck('cfg-css-min', e.css_min!==false);
  setCheck('cfg-js-min', !!e.js_min);
  setCheck('cfg-darkmode-btn', e.darkmode_button_enabled!==false);
  setSelect('cfg-darkmode-theme', e.darkmode_forced_theme===null?'null':e.darkmode_forced_theme||'null');
  setSelect('cfg-migration', String(e.migration_mode==='auto'?'auto':e.migration_mode==='prompt'?'prompt':'false'));
  setCheck('cfg-video-player', e.video_player_enabled!==false);
  // NSFW
  setCheck('cfg-nsfw-on', !!n.enabled);
  setCheck('cfg-nsfw-allow', n.allow_suspicious!==false);
  setSelect('cfg-nsfw-mode', n.mode||'browser');
  setVal('cfg-nsfw-backend', n.browser_backend_priority||'webgpu,webgl,wasm,cpu');
  // 플러그인 버튼 순서
  setVal('cfg-btn-order', (p.button_order||[]).join(','));
  // 업로드
  setVal('cfg-max-size', u.max_size_mb||50);
  setVal('cfg-max-pixels', u.max_image_pixels||50000000);
  setCheck('cfg-strict-webp', u.strict_webp!==false);
  // 확장자
  renderExtManager(u.extensions||{});
  // 도메인
  renderUrlDomains((settings.domains||{}).extra_url_domains||[]);
  renderIframePlatforms(settings._builtin_iframe_domains||[], (settings.domains||{}).iframe_domains, (settings.domains||{}).custom_iframe_domains||[]);
}

function setCheck(id, v) { const el=document.getElementById(id); if(el) el.checked=!!v; }
function setSelect(id, v) { const el=document.getElementById(id); if(el) el.value=String(v); }
function setVal(id, v) { const el=document.getElementById(id); if(el) el.value=v; }

// ── 대시보드 ─────────────────────────────────────────────────────────────
// ── 라이선스 ──────────────────────────────────────────────────────────────
async function loadLicense() {
  const el = document.getElementById('license-body');
  const r = await api('get_license');
  if (!r.ok) { el.innerHTML = '<div class="alert alert-error"><span class="mi">error</span>'+r.msg+'</div>'; return; }
  const d = r.data;
  el.innerHTML = `
    <div class="license-badge ${d.valid?'valid':'invalid'}" role="status">
      <span class="mi" aria-hidden="true">${d.valid?'verified':'gpp_bad'}</span>
      ${d.valid?'라이선스 정상':'라이선스 검증 실패'}
    </div>
    <div style="margin-top:18px">
      <div class="license-row"><span class="l-label">에디터 버전</span><span class="l-value">${escHtml(d.version||'-')}</span></div>
      <div class="license-row"><span class="l-label">검증 상태</span><span class="l-value">${d.valid?'PASS':'FAIL'}</span></div>
      ${!d.valid?`<div class="license-row"><span class="l-label">사유</span><span class="l-value" style="color:var(--md-error)">${escHtml(d.msg||'')}</span></div>`:''}
    </div>
    ${!d.valid?'<div class="alert alert-warn" style="margin-top:14px"><span class="mi">warning</span><span>readme.txt 라이선스 표기가 손상되었거나 누락되었습니다. 원본 배포 파일의 readme.txt를 그대로 유지해야 합니다.</span></div>':''}
  `;
}

async function loadDashboard() {
  const s = settings;
  const p = s.plugins||{};
  document.getElementById('stat-plugins').textContent = (p.active||[]).length;
  document.getElementById('stat-upload').textContent = (s.upload?.max_size_mb||50)+'MB';
  document.getElementById('stat-nsfw').textContent = s.nsfw?.enabled ? '활성' : '비활성';
  const mm = s.editor?.migration_mode;
  document.getElementById('stat-migrate').textContent = mm===false||mm==='false'?'OFF':mm;

  const lic = await api('get_license');
  const licEl = document.getElementById('stat-license');
  const licIcon = document.getElementById('stat-license-icon');
  if (lic.ok) {
    licEl.textContent = lic.data.valid ? '정상' : '오류';
    licIcon.className = 'stat-icon ' + (lic.data.valid ? 'teal' : '');
    if (!lic.data.valid) licIcon.style.background = 'var(--md-error)';
  }

  const r = await api('get_system_info');
  if (!r.ok) return;
  const d = r.data;
  document.getElementById('sys-info').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;font-size:13px">
      <div><span style="color:var(--md-on-muted)">PHP 버전</span><br><strong>${d.php_version}</strong></div>
      <div><span style="color:var(--md-on-muted)">에디터 URL</span><br><strong style="word-break:break-all">${d.editor_url}</strong></div>
      <div><span style="color:var(--md-on-muted)">설정 파일</span><br><strong>${d.settings_file}</strong></div>
      <div><span style="color:var(--md-on-muted)">data 쓰기</span><br><span class="badge ${d.data_writable?'badge-success':'badge-error'}">${d.data_writable?'가능':'불가'}</span></div>
      <div><span style="color:var(--md-on-muted)">런타임 JS</span><br><span class="badge ${d.runtime_js_present?'badge-success':'badge-error'}">${d.runtime_js_present?'정상':'누락'}</span></div>
    </div>`;
}

// ── Extend 현황 ────────────────────────────────────────────────────────────
async function loadExtend() {
  const r = await api('get_extend');
  if (!r.ok) { toast('Extend 로드 실패','error'); return; }
  renderExtendList('extend-php-list', r.data.php||[], 'php');
  renderExtendList('extend-js-list', r.data.js||[], 'js');
}
function renderExtendList(elId, files, type) {
  const el = document.getElementById(elId);
  if (!files.length) { el.innerHTML='<p style="color:var(--md-on-muted);font-size:13px">파일 없음</p>'; return; }
  el.innerHTML = '<ul class="file-list">' + files.map(f=>`
    <li class="file-item ${f.is_admin?'admin-file':''}">
      <span class="mi" aria-hidden="true">${type==='php'?'php':'javascript'}</span>
      <div class="file-meta">
        <div class="file-name">${f.file}</div>
        <div class="file-info">${formatSize(f.size)} · ${formatDate(f.mtime)}</div>
      </div>
      ${f.is_admin?'<span class="badge badge-primary">T2Admin</span>':''}
    </li>`).join('') + '</ul>';
}

// ── 플러그인 관리 ────────────────────────────────────────────────────────
let dragSrc = null;
async function loadPlugins() {
  const r = await api('get_plugins');
  if (!r.ok) { toast('플러그인 스캔 실패','error'); return; }
  allPlugins = r.data;
  renderPluginList();
}

function renderPluginList() {
  const list = document.getElementById('plugin-list');
  if (!Object.keys(allPlugins).length) { list.innerHTML='<li style="text-align:center;color:var(--md-on-muted);font-size:13px;padding:20px">플러그인 없음</li>'; return; }
  const active = settings.plugins?.active || Object.keys(allPlugins);
  const priority = settings.plugins?.priority || {};
  // 순서: 우선순위 정렬 후 나머지 추가
  const ordered = [...active];
  Object.keys(allPlugins).forEach(n=>{ if(!ordered.includes(n)) ordered.push(n); });
  list.innerHTML = '';
  ordered.forEach(name => {
    const info = allPlugins[name]||{name,label:name,icon:null};
    const isActive = active.includes(name);
    const pri = priority[name]??999;
    const li = document.createElement('li');
    li.className = 'plugin-item';
    li.setAttribute('draggable','true');
    li.dataset.plugin = name;
    li.setAttribute('role','listitem');
    const iconType = info.icon_type||'material-icons';
    const iconName = info.icon||'extension';
    const btnStyle = info.btn_style?`style="${info.btn_style}"`:'';
    li.innerHTML = `
      <span class="plugin-drag mi" aria-hidden="true" title="드래그하여 순서 변경">drag_indicator</span>
      <div class="plugin-icon"><span class="${iconType}" aria-hidden="true" ${btnStyle}>${iconName}</span></div>
      <div class="plugin-info">
        <div class="plugin-name">${name}</div>
        <div class="plugin-cmd">${(info.commands||[]).join(', ')||'command 없음'}</div>
      </div>
      <input type="number" class="plugin-order-input" value="${pri}" min="0" max="99" title="우선순위" aria-label="${name} 우선순위" onchange="updatePluginPriority('${name}',this.value)">
      <label class="toggle" aria-label="${name} 활성화" style="flex-shrink:0">
        <input type="checkbox" ${isActive?'checked':''} onchange="togglePlugin('${name}',this.checked)">
        <div class="toggle-track"></div><div class="toggle-thumb"></div>
      </label>`;
    // 드래그 이벤트
    li.addEventListener('dragstart',e=>{dragSrc=li;li.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
    li.addEventListener('dragend',()=>{li.classList.remove('dragging');dragSrc=null;});
    li.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';});
    li.addEventListener('drop',e=>{
      e.preventDefault();
      if(dragSrc&&dragSrc!==li){list.insertBefore(dragSrc,li);}
      syncPluginOrder();
    });
    // 터치 드래그 (모바일)
    addTouchDrag(li, list);
    list.appendChild(li);
  });
}

function addTouchDrag(el, container) {
  let startY=0, clone=null, origIdx=0;
  el.querySelector('.plugin-drag').addEventListener('touchstart',e=>{
    e.preventDefault();
    startY=e.touches[0].clientY;
    const items=[...container.querySelectorAll('.plugin-item')];
    origIdx=items.indexOf(el);
    clone=el.cloneNode(true);
    clone.style.cssText='position:fixed;left:0;right:0;z-index:1000;opacity:.85;pointer-events:none;background:var(--md-surface);box-shadow:var(--md-el4)';
    clone.style.top=el.getBoundingClientRect().top+'px';
    document.body.appendChild(clone);
    el.style.opacity='0.3';
  },{passive:false});
  el.querySelector('.plugin-drag').addEventListener('touchmove',e=>{
    if(!clone) return;
    e.preventDefault();
    const dy=e.touches[0].clientY-startY;
    clone.style.top=(parseFloat(clone.style.top)+dy)+'px';
    startY=e.touches[0].clientY;
    // 찾아서 이동
    const items=[...container.querySelectorAll('.plugin-item')].filter(i=>i!==el);
    const cloneRect=clone.getBoundingClientRect();
    const target=items.find(i=>{ const r=i.getBoundingClientRect(); return cloneRect.top+20>r.top&&cloneRect.top+20<r.bottom; });
    if(target) container.insertBefore(el, target.nextSibling===el?target:target);
  },{passive:false});
  el.querySelector('.plugin-drag').addEventListener('touchend',()=>{
    if(clone){clone.remove();clone=null;}
    el.style.opacity='';
    syncPluginOrder();
  });
}

function togglePlugin(name, active) {
  if (!settings.plugins) settings.plugins = {};
  const list = [...(settings.plugins.active||[])];
  const idx = list.indexOf(name);
  if (active && idx===-1) list.push(name);
  if (!active && idx!==-1) list.splice(idx,1);
  settings.plugins.active = list;
}
function updatePluginPriority(name, val) {
  if (!settings.plugins) settings.plugins = {};
  if (!settings.plugins.priority) settings.plugins.priority = {};
  settings.plugins.priority[name] = parseInt(val)||0;
}
function syncPluginOrder() {
  const items = document.querySelectorAll('#plugin-list .plugin-item');
  const ordered = [...items].map(el=>el.dataset.plugin);
  // 우선순위 업데이트 (순서 기반 자동 재계산)
  if (!settings.plugins) settings.plugins={};
  if (!settings.plugins.priority) settings.plugins.priority={};
  ordered.forEach((name,i)=>{ settings.plugins.priority[name]=i; });
  // 입력값도 업데이트
  items.forEach((el,i)=>{ const inp=el.querySelector('.plugin-order-input'); if(inp) inp.value=i; });
}

// ── 아이콘 관리 ──────────────────────────────────────────────────────────
async function loadIconManager() {
  if (!allButtons.length) await fetchAllButtons();
  renderIconManager();
}

function renderIconManager() {
  const list = document.getElementById('icon-manager-list');
  if (!list) return;
  const q = (document.getElementById('icon-search-input')?.value||'').trim().toLowerCase();
  const overrides = settings.icons || {};
  const filtered = allButtons.filter(b => !q || b.command.toLowerCase().includes(q) || (b.label||'').toLowerCase().includes(q));

  if (!filtered.length) { list.innerHTML = '<div class="empty-hint">표시할 버튼이 없습니다</div>'; return; }

  list.innerHTML = filtered.map(b => {
    const ov = overrides[b.command];
    const curType = ov?.type || b.icon_type || 'material-icons';
    const curName = ov?.name || b.icon || '';
    const curStyle = ov?.style || '';
    const sourceLabel = b.source === 'core' ? '코어' : (b.plugin || '플러그인');
    return `
    <div class="icon-row ${ov?'overridden':''}" data-command="${escHtml(b.command)}">
      <div class="icon-preview" id="icon-preview-${escHtml(b.command)}">
        <span class="${curType}" style="${escHtml(curStyle)}">${escHtml(curName)}</span>
      </div>
      <div class="icon-meta">
        <div class="icon-cmd">${escHtml(b.command)}</div>
        <div class="icon-label">${escHtml(b.label||'')} <span class="badge badge-muted icon-source-badge">${escHtml(sourceLabel)}</span></div>
      </div>
      <div class="icon-controls">
        <select aria-label="${escHtml(b.command)} 아이콘 종류" onchange="updateIconOverride('${escHtml(b.command)}')">
          <option value="material-icons" ${curType==='material-icons'?'selected':''}>Filled</option>
          <option value="material-icons-outlined" ${curType==='material-icons-outlined'?'selected':''}>Outlined</option>
        </select>
        <input type="text" placeholder="아이콘 이름 (예: auto_awesome)" value="${escHtml(curName)}" aria-label="${escHtml(b.command)} 아이콘 이름" oninput="updateIconOverride('${escHtml(b.command)}')">
        <input type="text" placeholder="style (선택, 예: color:#ff6600)" value="${escHtml(curStyle)}" aria-label="${escHtml(b.command)} 스타일" oninput="updateIconOverride('${escHtml(b.command)}')">
        <button class="btn btn-icon icon-reset-btn" title="기본값으로 되돌리기" aria-label="${escHtml(b.command)} 기본값 복원" onclick="resetIconOverride('${escHtml(b.command)}')"><span class="mi" style="font-size:18px" aria-hidden="true">restart_alt</span></button>
      </div>
    </div>`;
  }).join('');
}

function updateIconOverride(command) {
  const row = document.querySelector(`.icon-row[data-command="${cssEsc(command)}"]`);
  if (!row) return;
  const type = row.querySelector('select').value;
  const name = row.querySelectorAll('input')[0].value.trim();
  const style = row.querySelectorAll('input')[1].value.trim();

  if (!settings.icons) settings.icons = {};
  if (!name) {
    delete settings.icons[command];
    row.classList.remove('overridden');
  } else {
    settings.icons[command] = { type, name, style };
    row.classList.add('overridden');
  }
  const preview = document.getElementById('icon-preview-'+cssEscId(command));
  if (preview) {
    preview.innerHTML = `<span class="${type}" style="${escHtml(style)}">${escHtml(name)}</span>`;
  }
}

function resetIconOverride(command) {
  if (settings.icons) delete settings.icons[command];
  renderIconManager();
}

function cssEsc(s) { return String(s).replace(/(["\\])/g, '\\$1'); }
function cssEscId(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }

// ── 반응형 툴바 (toolbar.js window.T2_TOOLBAR_GROUPS) ───────────────────────
let tgState = null; // {"min-max": [{groupIcon,groupLabel,buttons[],position}]} | null

async function loadToolbarGroups() {
  if (!allButtons.length) await fetchAllButtons();
  tgState = settings.toolbar_groups ? JSON.parse(JSON.stringify(settings.toolbar_groups)) : null;
  document.getElementById('tg-enabled').checked = !!tgState;
  document.getElementById('tg-add-row').style.display = tgState ? '' : 'none';
  renderToolbarGroups();
}

function onToolbarGroupsEnabledChange() {
  const on = document.getElementById('tg-enabled').checked;
  if (on && !tgState) {
    // 기본 2단계 브레이크포인트로 초기화 (toolbar.js 기본값과 동일한 시작점 제공)
    tgState = {
      '0-599': [{ groupIcon:'more_horiz', groupLabel:'기타 기능', buttons:[], position: 10 }],
    };
  }
  if (!on) tgState = null;
  document.getElementById('tg-add-row').style.display = on ? '' : 'none';
  renderToolbarGroups();
}

function renderToolbarGroups() {
  const el = document.getElementById('tg-editor');
  if (!el) return;
  if (!tgState) {
    el.innerHTML = '<div class="empty-hint">커스텀 설정이 꺼져 있습니다 — toolbar.js 내장 기본값을 사용합니다.</div>';
    return;
  }
  const breakpoints = Object.keys(tgState);
  if (!breakpoints.length) {
    el.innerHTML = '<div class="empty-hint">브레이크포인트가 없습니다. 아래에서 추가하세요.</div>';
    return;
  }
  el.innerHTML = breakpoints.map(bp => {
    const [min, max] = bp.split('-');
    const groups = tgState[bp] || [];
    return `
    <div class="bp-card" data-bp="${escHtml(bp)}">
      <div class="bp-head">
        <span class="mi" aria-hidden="true">straighten</span>
        <div class="bp-range">
          <input type="number" value="${escHtml(min)}" min="0" aria-label="최소 너비" onchange="updateBreakpointRange('${escHtml(bp)}',this.value,null)"> px ~
          <input type="number" value="${escHtml(max)}" min="0" aria-label="최대 너비" onchange="updateBreakpointRange('${escHtml(bp)}',null,this.value)"> px
        </div>
        <span style="flex:1"></span>
        <button class="btn btn-icon btn-sm" title="브레이크포인트 삭제" aria-label="${escHtml(bp)} 브레이크포인트 삭제" onclick="removeBreakpoint('${escHtml(bp)}')"><span class="mi" style="font-size:18px" aria-hidden="true">delete</span></button>
      </div>
      <div class="bp-body">
        ${groups.map((g, gi) => renderGroupCard(bp, g, gi)).join('')}
        <button class="btn btn-outline btn-sm" onclick="addGroup('${escHtml(bp)}')"><span class="mi" style="font-size:16px" aria-hidden="true">add</span> 그룹 추가</button>
      </div>
    </div>`;
  }).join('');
}

function renderGroupCard(bp, g, gi) {
  const selected = new Set(g.buttons||[]);
  const chips = allButtons.map(b => `
    <span class="btn-chip ${selected.has(b.command)?'sel':''}" role="button" tabindex="0"
      onclick="toggleGroupButton('${escHtml(bp)}',${gi},'${escHtml(b.command)}')"
      onkeydown="if(event.key==='Enter')toggleGroupButton('${escHtml(bp)}',${gi},'${escHtml(b.command)}')">
      <span class="${b.icon_type||'material-icons'}">${escHtml(b.icon||'')}</span>${escHtml(b.command)}
    </span>`).join('');
  return `
  <div class="group-card" data-gi="${gi}">
    <div class="group-card-head">
      <div class="group-icon-preview"><span class="material-icons">${escHtml(g.groupIcon||'apps')}</span></div>
      <input type="text" value="${escHtml(g.groupIcon||'')}" placeholder="groupIcon (예: more_horiz)" style="width:130px;padding:5px 8px;border-radius:6px;border:1.5px solid var(--md-border);background:var(--md-surface);font-size:12px" aria-label="그룹 아이콘" oninput="updateGroupField('${escHtml(bp)}',${gi},'groupIcon',this.value)">
      <input type="text" value="${escHtml(g.groupLabel||'')}" placeholder="그룹 라벨" style="flex:1;padding:5px 8px;border-radius:6px;border:1.5px solid var(--md-border);background:var(--md-surface);font-size:12px" aria-label="그룹 라벨" oninput="updateGroupField('${escHtml(bp)}',${gi},'groupLabel',this.value)">
      <input type="number" value="${g.position??0}" title="position (DOM 삽입 위치)" style="width:56px;padding:5px 8px;border-radius:6px;border:1.5px solid var(--md-border);background:var(--md-surface);font-size:12px;text-align:center" aria-label="그룹 위치" oninput="updateGroupField('${escHtml(bp)}',${gi},'position',parseInt(this.value)||0)">
      <button class="btn btn-icon btn-sm" title="그룹 삭제" aria-label="그룹 삭제" onclick="removeGroup('${escHtml(bp)}',${gi})"><span class="mi" style="font-size:16px" aria-hidden="true">close</span></button>
    </div>
    <div class="form-hint" style="margin-bottom:6px">이 그룹에 포함할 버튼 선택 (클릭하여 토글)</div>
    <div class="btn-chip-picker">${chips}</div>
  </div>`;
}

function updateBreakpointRange(oldBp, newMin, newMax) {
  const [min, max] = oldBp.split('-');
  const finalMin = newMin !== null ? newMin : min;
  const finalMax = newMax !== null ? newMax : max;
  const newBp = `${finalMin}-${finalMax}`;
  if (newBp === oldBp) return;
  const ordered = {};
  Object.keys(tgState).forEach(k => { ordered[k===oldBp?newBp:k] = tgState[k]; });
  tgState = ordered;
  renderToolbarGroups();
}

function removeBreakpoint(bp) {
  if (!confirm(`"${bp}" 브레이크포인트를 삭제할까요?`)) return;
  delete tgState[bp];
  renderToolbarGroups();
}

function addBreakpoint() {
  const existing = Object.keys(tgState).map(k=>k.split('-').map(Number)).flat();
  const start = existing.length ? Math.max(...existing) + 1 : 600;
  const key = `${start}-${start+423}`;
  tgState[key] = [{ groupIcon:'more_horiz', groupLabel:'기타 기능', buttons:[], position: 10 }];
  renderToolbarGroups();
}

function addGroup(bp) {
  tgState[bp].push({ groupIcon:'apps', groupLabel:'새 그룹', buttons:[], position: 10 });
  renderToolbarGroups();
}

function removeGroup(bp, gi) {
  tgState[bp].splice(gi, 1);
  renderToolbarGroups();
}

function updateGroupField(bp, gi, field, value) {
  tgState[bp][gi][field] = value;
  if (field === 'groupIcon') renderToolbarGroups();
}

function toggleGroupButton(bp, gi, command) {
  const g = tgState[bp][gi];
  if (!g.buttons) g.buttons = [];
  const idx = g.buttons.indexOf(command);
  if (idx === -1) g.buttons.push(command); else g.buttons.splice(idx, 1);
  renderToolbarGroups();
}

// ── 도메인 태그 ──────────────────────────────────────────────────────────
function renderUrlDomains(domains) {
  const wrap = document.getElementById('url-domains-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('.tag').forEach(t=>t.remove());
  const input = wrap.querySelector('.tag-input');
  domains.forEach(d=>{ wrap.insertBefore(createTag(d,'url-domains-wrap','url-domains-data'),input); });
  updateTagData('url-domains-wrap','url-domains-data');
}
function createTag(text, wrapId, dataId) {
  const span = document.createElement('span');
  span.className = 'tag';
  span.innerHTML = `${escHtml(text)}<span class="tag-del" role="button" tabindex="0" aria-label="${escHtml(text)} 삭제" onclick="removeTag(this,'${wrapId}','${dataId}')" onkeydown="if(event.key==='Enter')removeTag(this,'${wrapId}','${dataId}')">×</span>`;
  return span;
}
function addTag(e, wrapId, dataId) {
  if (e.key!=='Enter'&&e.key!==',') return;
  e.preventDefault();
  const inp = e.target;
  const val = inp.value.trim().replace(/,$/,'');
  if (!val) return;
  const wrap = document.getElementById(wrapId);
  wrap.insertBefore(createTag(val,wrapId,dataId), inp);
  inp.value='';
  updateTagData(wrapId, dataId);
}
function removeTag(el, wrapId, dataId) {
  el.closest('.tag')?.remove();
  updateTagData(wrapId, dataId);
}
function updateTagData(wrapId, dataId) {
  const tags = [...document.querySelectorAll('#'+wrapId+' .tag')].map(t=>t.textContent.slice(0,-1));
  const data = document.getElementById(dataId);
  if (data) data.value = JSON.stringify(tags);
}

// ── iframe 플랫폼 ─────────────────────────────────────────────────────────
const PLATFORM_LABELS = {
  'youtube.com':'YouTube','vimeo.com':'Vimeo','dailymotion.com':'Dailymotion',
  'twitch.tv':'Twitch','tiktok.com':'TikTok','tv.kakao.com':'카카오TV',
  'tv.naver.com':'네이버TV','streamable.com':'Streamable','w.soundcloud.com':'SoundCloud',
  'open.spotify.com':'Spotify','player.bilibili.com':'Bilibili','rumble.com':'Rumble',
  'www.loom.com':'Loom','embed.vidyard.com':'Vidyard','gfycat.com':'Gfycat','coub.com':'Coub'
};
// 대표 도메인 → 관련 서브도메인 매핑
const PLATFORM_SUBS = {
  'youtube.com':['youtube.com','www.youtube.com','m.youtube.com','youtu.be','youtube-nocookie.com','www.youtube-nocookie.com'],
  'vimeo.com':['vimeo.com','www.vimeo.com','player.vimeo.com'],
  'dailymotion.com':['dailymotion.com','www.dailymotion.com','geo.dailymotion.com'],
  'twitch.tv':['twitch.tv','www.twitch.tv','player.twitch.tv','clips.twitch.tv'],
  'tiktok.com':['tiktok.com','www.tiktok.com'],
  'tv.kakao.com':['tv.kakao.com','play.kakao.com'],
  'tv.naver.com':['tv.naver.com'],
  'streamable.com':['streamable.com','embed.streamable.com'],
  'w.soundcloud.com':['w.soundcloud.com','wistia.com','fast.wistia.com','wistia.net','fast.wistia.net'],
  'open.spotify.com':['open.spotify.com'],
  'player.bilibili.com':['player.bilibili.com'],
  'rumble.com':['rumble.com','www.rumble.com'],
  'www.loom.com':['www.loom.com'],
  'embed.vidyard.com':['embed.vidyard.com','play.vidyard.com'],
  'gfycat.com':['gfycat.com','www.gfycat.com'],
  'coub.com':['coub.com','www.coub.com'],
};

function renderIframePlatforms(builtin, override, custom) {
  const grid = document.getElementById('iframe-platforms');
  if (!grid) return;
  const active = override ? override : builtin;
  grid.innerHTML = '';
  Object.entries(PLATFORM_LABELS).forEach(([rep, label]) => {
    const subs = PLATFORM_SUBS[rep]||[rep];
    const checked = subs.some(d=>active.includes(d));
    const div = document.createElement('label');
    div.className = 'platform-check';
    div.innerHTML = `<input type="checkbox" ${checked?'checked':''} data-platform="${escHtml(rep)}" aria-label="${escHtml(label)} 허용">
      <span class="platform-check-label">${escHtml(label)}</span>`;
    grid.appendChild(div);
  });
  // 커스텀 도메인
  renderCustomIframeTags(custom);
}
function renderCustomIframeTags(domains) {
  const wrap = document.getElementById('custom-iframe-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('.tag').forEach(t=>t.remove());
  const input = wrap.querySelector('.tag-input');
  (domains||[]).forEach(d=>wrap.insertBefore(createTag(d,'custom-iframe-wrap','custom-iframe-data'),input));
  updateTagData('custom-iframe-wrap','custom-iframe-data');
}
function getSelectedIframeDomains() {
  const checked = [...document.querySelectorAll('#iframe-platforms input:checked')];
  const domains = [];
  checked.forEach(inp=>{
    const rep = inp.dataset.platform;
    (PLATFORM_SUBS[rep]||[rep]).forEach(d=>{ if(!domains.includes(d)) domains.push(d); });
  });
  return domains;
}

// ── 확장자 매니저 ────────────────────────────────────────────────────────
const EXT_DEFAULTS = {
  document:['pdf','txt','doc','docx','xls','xlsx','ppt','pptx','hwp','odt','ods','odp','rtf'],
  image:['jpg','jpeg','png','gif','webp','bmp'],
  video:['mp4','webm','ogg','mov','avi','mkv','wmv','flv','m4v'],
  other:['zip','rar','7z','tar','gz','bz2','mp3','m4a','wav','flac','aac','wma','json','xml','csv']
};
const EXT_LABELS = {document:'📄 문서',image:'🖼️ 이미지',video:'🎬 동영상',other:'📦 기타'};

function renderExtManager(exts) {
  const el = document.getElementById('ext-manager');
  if (!el) return;
  el.innerHTML = '';
  Object.entries(EXT_LABELS).forEach(([cat, label]) => {
    const active = exts[cat] || EXT_DEFAULTS[cat];
    const all = [...new Set([...EXT_DEFAULTS[cat], ...active])];
    const sec = document.createElement('div');
    sec.className = 'ext-section';
    sec.dataset.cat = cat;
    sec.innerHTML = `<div class="ext-title">${label}</div>
      <div class="ext-chips">${all.map(e=>`<span class="ext-chip ${active.includes(e)?'active':''}" data-ext="${escHtml(e)}" onclick="toggleExt(this,'${cat}')" role="button" tabindex="0" aria-pressed="${active.includes(e)}" onkeydown="if(event.key==='Enter')toggleExt(this,'${cat}')">.${escHtml(e)}</span>`).join('')}</div>
      <div class="ext-add-wrap"><input class="ext-add-input" placeholder="추가: 예) heic" aria-label="${label} 확장자 추가" onkeydown="addExt(event,'${cat}')"><button class="btn btn-outline btn-sm" onclick="addExt({key:'Enter',target:this.previousElementSibling},'${cat}')">추가</button></div>`;
    el.appendChild(sec);
  });
}
function toggleExt(chip, cat) {
  chip.classList.toggle('active');
  chip.setAttribute('aria-pressed', chip.classList.contains('active'));
}
function addExt(e, cat) {
  if (e.key!=='Enter') return;
  const inp = e.target;
  const val = inp.value.trim().toLowerCase().replace(/^\.+/,'');
  if (!val || !/^[a-z0-9]+$/.test(val)) { toast('유효한 확장자를 입력하세요','warn'); return; }
  const chips = document.querySelector(`[data-cat="${cat}"] .ext-chips`);
  if (chips.querySelector(`[data-ext="${val}"]`)) { toast('이미 존재하는 확장자','warn'); return; }
  const chip = document.createElement('span');
  chip.className='ext-chip active'; chip.dataset.ext=val;
  chip.setAttribute('role','button'); chip.setAttribute('tabindex','0'); chip.setAttribute('aria-pressed','true');
  chip.textContent='.'+val;
  chip.onclick=()=>toggleExt(chip,cat);
  chip.onkeydown=(ev)=>{if(ev.key==='Enter')toggleExt(chip,cat)};
  chips.appendChild(chip); inp.value='';
}
function getExtensions() {
  const result = {};
  document.querySelectorAll('.ext-section').forEach(sec=>{
    const cat = sec.dataset.cat;
    result[cat] = [...sec.querySelectorAll('.ext-chip.active')].map(c=>c.dataset.ext);
  });
  return result;
}

// ── 설정 저장 ─────────────────────────────────────────────────────────────
async function saveCurrentSection() {
  const btn = document.getElementById('save-btn');
  const payload = buildPayload(currentSection);
  if (!payload) return;
  if (btn) { btn.innerHTML='<div class="spinner"></div>'; btn.disabled=true; }
  const r = await api('save_settings','POST', payload);
  if (btn) { btn.innerHTML='<span class="mi" style="font-size:16px" aria-hidden="true">save</span> 저장'; btn.disabled=false; }
  if (r.ok) {
    toast(r.msg||'저장되었습니다','success');
    // 로컬 settings 업데이트
    settings = {...settings, ...payload};
  } else {
    toast('저장 실패: '+r.msg,'error');
  }
}

function buildPayload(section) {
  switch(section) {
    case 'editor': return {
      editor: {
        css_min: document.getElementById('cfg-css-min')?.checked,
        js_min: document.getElementById('cfg-js-min')?.checked,
        darkmode_button_enabled: document.getElementById('cfg-darkmode-btn')?.checked,
        darkmode_forced_theme: (v=>v==='null'?null:v)(document.getElementById('cfg-darkmode-theme')?.value),
        migration_mode: (v=>v==='false'?false:v)(document.getElementById('cfg-migration')?.value||'false'),
        video_player_enabled: document.getElementById('cfg-video-player')?.checked,
      }
    };
    case 'nsfw': return {
      nsfw: {
        enabled: document.getElementById('cfg-nsfw-on')?.checked,
        mode: document.getElementById('cfg-nsfw-mode')?.value||'browser',
        allow_suspicious: document.getElementById('cfg-nsfw-allow')?.checked,
        browser_backend_priority: document.getElementById('cfg-nsfw-backend')?.value||'webgpu,webgl,wasm,cpu',
      }
    };
    case 'plugins': {
      syncPluginOrder();
      const items = [...document.querySelectorAll('#plugin-list .plugin-item')];
      const active = items.filter(el=>el.querySelector('input[type=checkbox]')?.checked).map(el=>el.dataset.plugin);
      const priority = {};
      items.forEach(el=>{
        const name = el.dataset.plugin;
        const v = el.querySelector('.plugin-order-input')?.value;
        priority[name]=parseInt(v)||0;
      });
      const btnOrder = document.getElementById('cfg-btn-order')?.value.split(',').map(s=>s.trim()).filter(Boolean)||[];
      return { plugins:{ active, priority, button_order: btnOrder } };
    }
    case 'domains': {
      const urlDomains = (() => {
        const d = document.getElementById('url-domains-data')?.value;
        try { return JSON.parse(d)||[]; } catch{return [];}
      })();
      const customIframe = (() => {
        const d = document.getElementById('custom-iframe-data')?.value;
        try { return JSON.parse(d)||[]; } catch{return [];}
      })();
      const iframeDomains = getSelectedIframeDomains();
      return { domains: { extra_url_domains: urlDomains, iframe_domains: iframeDomains, custom_iframe_domains: customIframe } };
    }
    case 'upload': return {
      upload: {
        max_size_mb: parseInt(document.getElementById('cfg-max-size')?.value)||50,
        strict_webp: document.getElementById('cfg-strict-webp')?.checked,
        max_image_pixels: parseInt(document.getElementById('cfg-max-pixels')?.value)||50000000,
        extensions: getExtensions(),
      }
    };
    case 'icons': return { icons: settings.icons || {} };
    case 'toolbar': return { toolbar_groups: tgState };
    default: return {};
  }
}

// ── 보안 ─────────────────────────────────────────────────────────────────
async function changePassword() {
  const cur = document.getElementById('pw-current')?.value;
  const nw  = document.getElementById('pw-new')?.value;
  const nw2 = document.getElementById('pw-new2')?.value;
  const res = document.getElementById('pw-change-result');
  if (nw !== nw2) { if(res) res.innerHTML='<div class="alert alert-error"><span class="mi">error</span>새 비밀번호가 일치하지 않습니다.</div>'; return; }
  if (nw.length < 8) { if(res) res.innerHTML='<div class="alert alert-error"><span class="mi">error</span>8자 이상 입력하세요.</div>'; return; }
  const r = await api('change_password','POST',{current_password:cur,new_password:nw});
  if(res) res.innerHTML = r.ok
    ? '<div class="alert alert-success"><span class="mi">check_circle</span>'+r.msg+'</div>'
    : '<div class="alert alert-error"><span class="mi">error</span>'+r.msg+'</div>';
  if(r.ok){document.getElementById('pw-current').value='';document.getElementById('pw-new').value='';document.getElementById('pw-new2').value='';}
}
async function resetSettings() {
  if (!confirm('⚠️ 모든 관리자 설정을 초기화합니다. 계속할까요?')) return;
  const r = await api('reset_settings','POST',{});
  if (r.ok) { toast('설정 초기화 완료','success'); await loadSettings(); }
  else toast('초기화 실패: '+r.msg,'error');
}

// ── 인증 ─────────────────────────────────────────────────────────────────
async function doLogout() {
  await api('logout','POST',{});
  location.reload();
}

// ── 유틸 ─────────────────────────────────────────────────────────────────
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatSize(b){ return b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'KB':(b/1048576).toFixed(1)+'MB'; }
function formatDate(ts){ return new Date(ts*1000).toLocaleString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }

// ── 키보드 접근성 ──────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSidebar();
});

// ── 초기화 ────────────────────────────────────────────────────────────────
<?php if ($page_state === 'normal'): ?>
loadSettings();
<?php endif; ?>
</script>

<?php if ($page_state === 'setup'): ?>
<script>
async function doSetup() {
  const pw = document.getElementById('setup-pw').value;
  const pw2= document.getElementById('setup-pw2').value;
  const errEl = document.getElementById('setup-error');
  errEl.style.display='none';
  if (pw.length < 8) { errEl.textContent='비밀번호는 8자 이상이어야 합니다.'; errEl.style.display='flex'; return; }
  if (pw !== pw2)    { errEl.textContent='비밀번호가 일치하지 않습니다.'; errEl.style.display='flex'; return; }
  const btn = document.getElementById('setup-btn');
  btn.disabled=true; btn.innerHTML='<div class="spinner" style="border-top-color:#fff"></div>';
  try {
    const r = await fetch('api.php?action=setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
    const d = await r.json();
    if (d.ok) location.reload();
    else { errEl.textContent=d.msg; errEl.style.display='flex'; btn.disabled=false; btn.innerHTML='<span class="mi" style="font-size:18px">lock</span> 관리자 설정 완료'; }
  } catch(e){ errEl.textContent='오류: '+e.message; errEl.style.display='flex'; btn.disabled=false; btn.innerHTML='<span class="mi" style="font-size:18px">lock</span> 관리자 설정 완료'; }
}
document.getElementById('setup-pw2')?.addEventListener('keydown',e=>{if(e.key==='Enter')doSetup();});
</script>
<?php elseif ($page_state === 'login'): ?>
<script>
async function doLogin() {
  const pw = document.getElementById('login-pw').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display='none';
  const btn = document.getElementById('login-btn');
  btn.disabled=true; btn.innerHTML='<div class="spinner" style="border-top-color:#fff"></div>';
  try {
    const r = await fetch('api.php?action=login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
    const d = await r.json();
    if (d.ok) location.reload();
    else { errEl.textContent=d.msg; errEl.style.display='flex'; btn.disabled=false; btn.innerHTML='<span class="mi" style="font-size:18px">login</span> 로그인'; }
  } catch(e){ errEl.textContent='오류: '+e.message; errEl.style.display='flex'; btn.disabled=false; btn.innerHTML='<span class="mi" style="font-size:18px">login</span> 로그인';}
}
document.getElementById('login-pw')?.addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
</script>
<?php endif; ?>
</body>
</html>
