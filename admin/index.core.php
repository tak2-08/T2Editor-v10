<?php
// Path: T2Editor/admin/index.core.php
// Developer note: 관리자 action·필드명 변경 시 프런트 요청과 CSRF/권한 검사를 함께 맞춘다.
/**
 * T2Editor Admin Panel
 *
 * 관리자 패널 메인 UI. 세션 기반 인증.
 */

require_once dirname(__DIR__) . '/config/t2_cms_auth.php';
t2editor_admin_auth_bootstrap();
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');

define('T2ADMIN_UI', true);
$_ROOT = dirname(__DIR__);
require_once $_ROOT . '/editor.lib.php';


$KEY_FILE    = T2EDITOR_BASE_PATH . '/admin/t2admin.key';
$KEY_TXT     = T2EDITOR_BASE_PATH . '/admin/t2admin.key.txt';
$AUTH_FILE   = T2EDITOR_PRIVATE_PATH . '/admin_auth.php';
$EDITOR_URL  = T2EDITOR_URL;
$ICON_CATALOG_FILE = __DIR__ . '/material_icon_catalog.json';
$ICON_CATALOG = json_decode((string)@file_get_contents($ICON_CATALOG_FILE), true);
if (!is_array($ICON_CATALOG)) $ICON_CATALOG = [];

$local_auth_required = t2editor_admin_requires_local_credentials();
$auth_mode = t2editor_admin_auth_mode();
$key_active  = !$local_auth_required || file_exists($KEY_FILE);
$key_txt     = $local_auth_required && file_exists($KEY_TXT);
$auth_exists = !$local_auth_required || (function() use ($AUTH_FILE) {
    if (!file_exists($AUTH_FILE)) return false;
    $d = t2_private_store_read($AUTH_FILE, array());
    return !empty($d['setup_complete']);
})();
$logged_in   = t2editor_admin_is_authorized();
$data_writable = is_writable(T2EDITOR_PRIVATE_PATH);

// CSRF 토큰
if (empty($_SESSION['t2admin_csrf'])) {
    $_SESSION['t2admin_csrf'] = bin2hex(random_bytes(32));
}
$csrf = $_SESSION['t2admin_csrf'];

// 페이지 상태 결정
$page_state = 'normal';
if (!$key_active) $page_state = 'no_key';
elseif (!$auth_exists) $page_state = 'setup';
elseif (!$logged_in) $page_state = $local_auth_required ? 'login' : 'cms_login';

t2editor_admin_session_unlock();
?>
<!DOCTYPE html>
<html lang="ko" data-theme="light">
<head>
<script>
// 영구 저장된 과거 테마가 현재 브라우저/OS 상태를 가리지 않도록 페이지 실행 시 동기화한다.
(function() {
  var root=document.documentElement;
  var media=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
  var manualTheme=null;
  function systemTheme(){return media&&media.matches?'dark':'light';}
  function updateIcon(theme){
    var icon=document.getElementById('theme-icon');
    if(icon)icon.textContent=theme==='dark'?'light_mode':'dark_mode';
  }
  function applyTheme(theme){
    theme=theme==='dark'?'dark':'light';
    root.setAttribute('data-theme',theme);
    root.style.colorScheme=theme;
    updateIcon(theme);
    return theme;
  }
  function syncTheme(){return applyTheme(manualTheme||systemTheme());}
  function onSystemThemeChange(){manualTheme=null;syncTheme();}
  try{localStorage.removeItem('t2admin-theme');}catch(e){}
  if(media){
    if(typeof media.addEventListener==='function')media.addEventListener('change',onSystemThemeChange);
    else if(typeof media.addListener==='function')media.addListener(onSystemThemeChange);
  }
  window.addEventListener('pageshow',function(event){if(event.persisted)manualTheme=null;syncTheme();});
  window.T2AdminTheme={
    sync:syncTheme,
    toggle:function(){
      manualTheme=root.getAttribute('data-theme')==='dark'?'light':'dark';
      return applyTheme(manualTheme);
    }
  };
  applyTheme(systemTheme());
  document.addEventListener('DOMContentLoaded',syncTheme);
})();
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>T2Editor 관리자</title>
<style>
/* CSS 변수 & 리셋 */
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
html{font-size:16px;-webkit-text-size-adjust:100%;height:100%}
body{
  font-family:-apple-system,"Noto Sans KR","Apple SD Gothic Neo",BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  background:var(--md-bg);color:var(--md-on-surface);
  line-height:1.6;height:100%;overflow:hidden;transition:background var(--transition),color var(--transition);
}
a{color:var(--md-primary);text-decoration:none}
button{font-family:inherit;cursor:pointer;border:none;background:none}
input,select,textarea{font-family:inherit}
img,svg{max-width:100%;vertical-align:middle}

/* 재사용 컴포넌트 */
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

/* 레이아웃 */
.admin-wrap{display:flex;height:100vh;height:100dvh}

/* 사이드바 */
.sidebar{
  width:var(--sidebar-w);flex-shrink:0;background:var(--md-surface);
  box-shadow:var(--md-el2);display:flex;flex-direction:column;
  position:fixed;top:0;left:0;height:100vh;height:100dvh;z-index:200;
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

/* 모바일 오버레이 */
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:199}
@media(max-width:860px){
  .sidebar{transform:translateX(-100%)}
  .sidebar.open{transform:translateX(0)}
  .sidebar-overlay.open{display:block}
}

/* 메인 콘텐츠 */
.main-wrap{flex:1;margin-left:var(--sidebar-w);display:flex;flex-direction:column;height:100vh;height:100dvh}
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

/* 섹션 패널 */
.section-panel{display:none}
.section-panel.active{display:block}
.section-header{margin-bottom:20px}
.section-header h2{font-size:20px;font-weight:700}
.section-header p{font-size:13px;color:var(--md-on-muted);margin-top:4px}

/* 대시보드 스탯 */
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

/* Extend 현황 */
.file-list{list-style:none}
.file-item{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:var(--radius-s);transition:background var(--transition);margin-bottom:4px}
.file-item:hover{background:var(--md-bg)}
.file-item .mi{font-size:18px;color:var(--md-on-muted)}
.file-item.admin-file .mi{color:var(--md-primary)}
.file-meta{flex:1;min-width:0}
.file-name{font-size:13px;font-weight:500;font-family:monospace;color:var(--md-on-surface)}
.file-info{font-size:12px;color:var(--md-on-muted)}

/* 플러그인 매니저 */
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

/* 도메인 태그 인풋 */
.tag-input-wrap{border:1.5px solid var(--md-border);border-radius:var(--radius-s);padding:6px 10px;background:var(--md-surface-2);min-height:48px;display:flex;flex-wrap:wrap;gap:6px;cursor:text;transition:border-color var(--transition)}
.tag-input-wrap:focus-within{border-color:var(--md-primary);box-shadow:0 0 0 3px rgba(var(--md-primary-rgb),.12)}
.tag{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(var(--md-primary-rgb),.12);color:var(--md-primary);border-radius:20px;font-size:12px;font-weight:500}
.tag-del{cursor:pointer;line-height:1;color:var(--md-primary);opacity:.7;font-size:14px;padding:0 2px}
.tag-del:hover{opacity:1}
.tag-input{border:none;outline:none;background:transparent;color:var(--md-on-surface);font-size:13px;min-width:140px;padding:2px 0}

/* iframe 플랫폼 체크리스트 */
.platform-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.platform-check{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:var(--radius-s);border:1.5px solid var(--md-border-l);background:var(--md-surface-2);cursor:pointer;transition:all var(--transition)}
.platform-check:hover{border-color:var(--md-primary);background:rgba(var(--md-primary-rgb),.05)}
.platform-check input{accent-color:var(--md-primary);width:14px;height:14px}
.platform-check-label{font-size:12px;font-weight:500}

/* 업로드 확장자 */
.ext-section{margin-bottom:20px}
.ext-title{font-size:13px;font-weight:600;color:var(--md-on-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
.ext-chips{display:flex;flex-wrap:wrap;gap:6px}
.ext-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;background:rgba(var(--md-primary-rgb),.1);color:var(--md-primary);cursor:pointer;transition:all var(--transition);border:1.5px solid transparent;-webkit-user-select:none;user-select:none}
.ext-chip.active{background:var(--md-primary);color:#fff}
.ext-chip:hover{border-color:var(--md-primary)}
.ext-add-wrap{display:flex;gap:8px;margin-top:8px}
.ext-add-input{flex:1;padding:6px 10px;border:1.5px solid var(--md-border);border-radius:var(--radius-s);background:var(--md-surface-2);color:var(--md-on-surface);font-size:13px}
.ext-add-input:focus{outline:none;border-color:var(--md-primary)}

/* 토스트 */
.toast-container{position:fixed;bottom:24px;right:24px;z-index:1000;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.toast{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:var(--radius-s);background:var(--md-on-surface);color:var(--md-surface);font-size:13px;font-weight:500;box-shadow:var(--md-el4);animation:slideUp .25s ease;pointer-events:auto;max-width:340px}
.toast.success{background:#2E7D32}
.toast.error{background:#C62828}
.toast.warn{background:#E65100}
.toast .mi{font-size:18px;flex-shrink:0}
@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes slideDown{to{opacity:0;transform:translateY(10px)}}
.toast.removing{animation:slideDown .2s ease forwards}

/* 로그인 / 셋업 화면 */
.auth-screen{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--md-bg)}
.auth-card{width:100%;max-width:400px;background:var(--md-surface);border-radius:var(--radius);box-shadow:var(--md-el4);padding:36px 32px}
.auth-logo{display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:28px}
.auth-logo .t2-logo-prefix,.auth-logo .t2-logo-suffix{font-size:20px;padding:6px 8px}
.auth-title{text-align:center;font-size:20px;font-weight:700;margin-bottom:6px}
.auth-desc{text-align:center;font-size:13px;color:var(--md-on-muted);margin-bottom:24px}
.auth-card .btn{width:100%;justify-content:center;padding:11px}

/* 키 활성화 안내 */
.key-screen{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:var(--md-bg)}
.key-card{width:100%;max-width:480px;background:var(--md-surface);border-radius:var(--radius);box-shadow:var(--md-el4);padding:36px 32px;text-align:center}
.key-icon{width:72px;height:72px;border-radius:50%;background:var(--md-warn-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
.key-icon .mi{font-size:36px;color:var(--md-warn)}
.key-title{font-size:20px;font-weight:700;margin-bottom:10px}
.key-desc{font-size:14px;color:var(--md-on-muted);line-height:1.7;margin-bottom:24px}
.key-code{font-family:monospace;background:var(--md-bg);border:1.5px solid var(--md-border);border-radius:var(--radius-s);padding:14px 18px;font-size:14px;color:var(--md-primary);text-align:left;margin-bottom:20px;word-break:break-all}
.key-code .arrow{display:block;color:var(--md-on-muted);font-size:12px;margin-top:6px}

/* 경고 오버레이 (미설정 시 에디터 접근 경고) */
.warning-banner{background:var(--md-warn-bg);border-bottom:2px solid var(--md-warn);padding:12px 20px;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:500;color:var(--md-warn)}
.warning-banner .mi{font-size:20px;flex-shrink:0}

/* Material Icons 로컬 폰트 */
@font-face {
  font-family: "Material Icons";
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url("<?= htmlspecialchars($EDITOR_URL) ?>/fonts/material-icons/MaterialIcons-Regular.woff2?v=0.14.15") format("woff2");
}
@font-face {
  font-family: "Material Icons Outlined";
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url("<?= htmlspecialchars($EDITOR_URL) ?>/fonts/material-icons/MaterialIconsOutlined-Regular.woff2?v=0.14.15") format("woff2");
}
.mi { font-family:"Material Icons";font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;-webkit-font-feature-settings:"liga";font-feature-settings:"liga";-webkit-font-smoothing:antialiased }
.material-icons { font-family:"Material Icons";font-weight:normal;font-style:normal;font-size:22px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;-webkit-font-feature-settings:"liga";font-feature-settings:"liga";-webkit-font-smoothing:antialiased }
.material-icons-outlined { font-family:"Material Icons Outlined";font-weight:normal;font-style:normal;font-size:22px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;direction:ltr;-webkit-font-feature-settings:"liga";font-feature-settings:"liga";-webkit-font-smoothing:antialiased }

/* T2Editor 실 로고 lockup (에디터 본체 css/core.css 의 .t2-logo 와 동일 마크업/색상) */
.t2-logo{display:flex;align-items:center;border:none;border-radius:4px;text-decoration:none;flex-shrink:0}
.t2-logo-prefix{background:var(--t2-orange);color:#fff;padding:4px;font-weight:600;border:1px solid var(--t2-orange);border-radius:4px 0 0 4px;font-size:13px;line-height:1}
.t2-logo-suffix{padding:4px;font-weight:600;border:1px solid var(--md-border);border-left:none;border-radius:0 4px 4px 0;font-size:13px;line-height:1;color:var(--md-on-surface)}
/* 에디터 하단 상태바의 "ⓘ T2Editor Ver x.x.x" 라인과 동일한 어휘·톤으로 버전 표기 — 같은 제품군임을 은은히 전달 */
.t2-version-line{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:500;color:var(--md-on-muted)}
.t2-version-line .material-icons-outlined{font-size:13px}

/* 반응형 */
@media(max-width:480px){.auth-card,.key-card{padding:24px 18px}.stat-grid{grid-template-columns:1fr 1fr}}

/* 프린트 숨김 */
@media print{.sidebar,.topbar,.toast-container{display:none}.main-wrap{margin:0}}

/* 스크롤바 */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--md-border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--md-on-muted)}

/* 저장 버튼 고정바 */
.save-bar{position:sticky;bottom:12px;width:100%;min-width:0;box-sizing:border-box;background:var(--md-surface);border:1px solid var(--md-border-l);border-radius:var(--radius-s);box-shadow:var(--md-el2);padding:14px 18px;margin-top:24px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;z-index:10}
.save-bar .save-hint{display:block;font-size:12px;line-height:1.55;color:var(--md-on-muted);min-width:0;max-width:100%;white-space:normal;word-break:keep-all;overflow-wrap:anywhere}
.save-bar .save-hint-title{display:block;font-weight:700;color:var(--md-on-surface);margin-bottom:2px}
.save-bar .save-hint-detail{display:block}
.save-bar .btn{justify-self:end;max-width:100%;white-space:normal;text-align:center}

/* 로딩 스피너 */
.spinner{width:20px;height:20px;border:2.5px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}

/* 섹션 전환 애니메이션 */
.section-panel{animation:fadeInSection .18s ease}
@keyframes fadeInSection{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}

/* 구분선 */
.divider{border:none;border-top:1px solid var(--md-border-l);margin:20px 0}

/* 라이선스 패널 */
.license-badge{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:var(--radius-s);font-size:14px;font-weight:600}
.license-badge.valid{background:var(--md-success-bg);color:var(--md-success)}
.license-badge.invalid{background:var(--md-error-bg);color:var(--md-error)}
.license-badge .mi{font-size:22px}
.license-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--md-border-l);font-size:13px}
.license-row:last-child{border-bottom:none}
.license-row .l-label{color:var(--md-on-muted)}
.license-row .l-value{font-weight:600;font-family:monospace}

/* 아이콘 매니저 */
.icon-search{margin-bottom:14px}
.icon-row{display:flex;align-items:center;gap:12px;padding:12px;border-radius:var(--radius-s);background:var(--md-surface-2);border:1px solid var(--md-border-l);margin-bottom:8px;flex-wrap:wrap}
.icon-preview{width:44px;height:44px;border-radius:10px;background:var(--md-surface);border:1.5px solid var(--md-border);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color var(--transition)}
.icon-preview .material-icons,.icon-preview .material-icons-outlined{font-size:22px;color:var(--md-primary)}
.icon-meta{flex:0 0 auto;min-width:130px}
.icon-cmd{font-size:12px;font-weight:600;font-family:monospace}
.icon-label{font-size:11px;color:var(--md-on-muted)}
.icon-source-badge{font-size:10px}
.icon-controls{display:flex;align-items:center;gap:8px;flex:1;min-width:240px;flex-wrap:wrap}
.icon-controls select{padding:6px 8px;font-size:12px;border-radius:6px;border:1.5px solid var(--md-border);background:var(--md-surface);color:var(--md-on-surface)}
.icon-controls input{padding:6px 8px;font-size:12px;border-radius:6px;border:1.5px solid var(--md-border);background:var(--md-surface);color:var(--md-on-surface);min-width:110px;flex:1}
.icon-controls select:focus,.icon-controls input:focus{outline:none;border-color:var(--md-primary)}
.icon-choose-btn{min-width:132px;justify-content:center}
.icon-current-name{max-width:190px;padding:5px 8px;border-radius:6px;background:var(--md-surface);color:var(--md-on-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.icon-reset-btn{flex-shrink:0;color:var(--md-on-muted)}
.icon-reset-btn:hover{color:var(--md-error)}
.icon-row.overridden{border-color:var(--md-primary);background:rgba(var(--md-primary-rgb),.05)}
.icon-advanced{flex:1 1 100%;margin-top:2px}
.icon-advanced summary{width:max-content;max-width:100%;cursor:pointer;color:var(--md-on-muted);font-size:11px;user-select:none}
.icon-advanced-fields{display:grid;grid-template-columns:150px minmax(160px,1fr) minmax(200px,1.3fr);gap:7px;margin-top:8px}
.icon-validation{display:none;flex:1 1 100%;color:var(--md-error);font-size:11px}
.icon-row.icon-invalid{border-color:var(--md-error)}
.icon-row.icon-invalid .icon-validation{display:block}
.icon-manager-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.icon-catalog-count{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:999px;background:rgba(var(--md-primary-rgb),.1);color:var(--md-primary);font-size:11px;font-weight:700}
.icon-picker-backdrop[hidden]{display:none}
.icon-picker-backdrop{position:fixed;inset:0;z-index:700;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.62);backdrop-filter:blur(4px)}
.icon-picker-modal{display:flex;flex-direction:column;width:min(920px,100%);max-height:min(88vh,820px);overflow:hidden;border:1px solid var(--md-border-l);border-radius:18px;background:var(--md-surface);box-shadow:var(--md-el4)}
.icon-picker-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:18px 20px 14px;border-bottom:1px solid var(--md-border-l)}
.icon-picker-head h3{font-size:18px;line-height:1.35}.icon-picker-head p{margin-top:3px;color:var(--md-on-muted);font-size:12px}
.icon-picker-close{flex:0 0 auto}
.icon-picker-body{display:flex;flex-direction:column;min-height:0;padding:16px 20px 20px}
.icon-picker-target{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:11px;color:var(--md-on-muted);font-size:12px}
.icon-picker-target strong{color:var(--md-on-surface)}
.icon-picker-tools{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:8px}
.icon-picker-tools .form-control{min-width:0}
.icon-picker-categories{display:flex;gap:6px;padding:11px 0 10px;overflow-x:auto;scrollbar-width:thin}
.icon-category-chip{flex:0 0 auto;padding:6px 10px;border:1px solid var(--md-border);border-radius:999px;background:var(--md-surface-2);color:var(--md-on-muted);font:600 11px/1.2 inherit;cursor:pointer}
.icon-category-chip:hover,.icon-category-chip.active{border-color:var(--md-primary);background:rgba(var(--md-primary-rgb),.1);color:var(--md-primary)}
.icon-picker-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;color:var(--md-on-muted);font-size:11px}
.icon-picker-results{min-height:220px;overflow:auto;padding:2px 4px 8px 2px;overscroll-behavior:contain}
.icon-picker-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}
.icon-picker-item{display:flex;min-width:0;min-height:88px;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:9px 5px;border:1px solid var(--md-border-l);border-radius:11px;background:var(--md-surface-2);color:var(--md-on-surface);cursor:pointer;transition:border-color var(--transition),background var(--transition),transform var(--transition)}
.icon-picker-item:hover,.icon-picker-item:focus-visible{outline:none;border-color:var(--md-primary);background:rgba(var(--md-primary-rgb),.08);transform:translateY(-1px)}
.icon-picker-item.selected{border-color:var(--md-primary);box-shadow:0 0 0 2px rgba(var(--md-primary-rgb),.12)}
.icon-picker-item .material-icons,.icon-picker-item .material-icons-outlined{font-size:27px;color:var(--md-primary)}
.icon-picker-item small{display:block;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;color:var(--md-on-muted);font:10px/1.25 ui-monospace,SFMono-Regular,Menlo,monospace}
.icon-picker-empty{display:grid;place-items:center;min-height:220px;padding:24px;color:var(--md-on-muted);font-size:13px;text-align:center}
.icon-picker-more{display:flex;justify-content:center;padding-top:12px}
body.icon-picker-open{overflow:hidden}
@media(max-width:680px){
  .icon-advanced-fields{grid-template-columns:1fr}.icon-picker-backdrop{align-items:flex-end;padding:0}.icon-picker-modal{width:100%;max-height:92vh;border-radius:18px 18px 0 0}.icon-picker-head{padding:16px}.icon-picker-body{padding:13px 14px max(16px,env(safe-area-inset-bottom))}.icon-picker-tools{grid-template-columns:1fr}.icon-picker-grid{grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:6px}.icon-picker-item{min-height:80px}.icon-current-name{max-width:135px}
}

/* 반응형 툴바 그룹 에디터 */
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


/* T2Editor 마켓 */
.market-hero{display:grid;grid-template-columns:auto minmax(0,1fr);gap:16px;align-items:center;margin-bottom:16px;padding:20px;border:1px solid rgba(var(--md-primary-rgb),.2);border-radius:16px;background:linear-gradient(135deg,rgba(var(--md-primary-rgb),.13),rgba(var(--md-primary-rgb),.025) 68%,var(--md-surface));overflow:hidden}
.market-hero-icon{width:54px;height:54px;display:flex;align-items:center;justify-content:center;border-radius:15px;color:#fff;background:linear-gradient(145deg,var(--md-primary),#1d63ed);box-shadow:0 8px 22px rgba(var(--md-primary-rgb),.24)}
.market-hero-icon .mi{font-size:29px}.market-hero-copy{min-width:0}.market-hero-eyebrow{display:block;margin-bottom:3px;color:var(--md-primary);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.market-hero h3{font-size:18px;line-height:1.35;margin:0 0 5px}.market-hero p{font-size:13px;line-height:1.6;color:var(--md-on-muted);margin:0}.market-hero-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.market-hero-meta span{padding:4px 8px;border:1px solid rgba(var(--md-primary-rgb),.16);border-radius:999px;background:var(--md-surface);font-size:11px;color:var(--md-on-muted)}
.tp-toolbar{display:grid;grid-template-columns:minmax(170px,.85fr) minmax(210px,1.35fr) minmax(145px,.65fr) auto;gap:8px;align-items:center;margin-bottom:12px}.tp-toolbar .form-control{width:100%;min-width:0}
.tp-provider-context{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px;padding:11px 12px;border:1px solid var(--md-border-l);border-radius:11px;background:var(--md-surface-2)}.tp-provider-context-note{font-size:11px;color:var(--md-on-muted)}
.provider-identity{min-width:0}.provider-name-line{display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}.provider-name-line strong{font-size:13px;overflow-wrap:anywhere}.provider-domain-line{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:3px;color:var(--md-on-muted);font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.provider-endpoint{margin-top:4px;color:var(--md-on-muted);font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.certified-provider-badge{display:inline-flex;align-items:center;gap:3px;color:#1d63ed;font-family:system-ui,-apple-system,sans-serif;font-size:10px;font-weight:800;line-height:1;white-space:nowrap}.certified-provider-badge .mi{font-size:18px}.official-provider-badge,.unverified-provider-badge{display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;font-size:10px;font-weight:800;line-height:1.2;white-space:nowrap}.official-provider-badge{color:#0b57d0;background:rgba(29,99,237,.11)}.unverified-provider-badge{color:var(--md-warn);background:var(--md-warn-bg)}
.tp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
.tp-card{min-width:0;border:1px solid var(--md-border-l);border-radius:14px;padding:15px;background:var(--md-surface);box-shadow:var(--md-el1);display:flex;flex-direction:column;gap:12px;transition:border-color var(--transition),box-shadow var(--transition),transform var(--transition)}.tp-card:hover{border-color:rgba(var(--md-primary-rgb),.38);box-shadow:var(--md-el2);transform:translateY(-1px)}.tp-card-head{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;align-items:start}.tp-thumb,.tp-thumb-fallback{width:72px;height:72px;object-fit:cover;border-radius:15px;background:var(--md-surface-2);border:1px solid var(--md-border-l)}.tp-thumb-fallback{display:flex;align-items:center;justify-content:center;color:var(--md-primary);background:linear-gradient(145deg,rgba(var(--md-primary-rgb),.12),var(--md-surface-2))}.tp-thumb-fallback .mi{font-size:30px}.tp-card-main{min-width:0}.tp-card-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:7px}.tp-card h3{min-width:0;font-size:15px;line-height:1.4;overflow-wrap:anywhere}.tp-dev-link{display:inline-block;margin-top:5px;font-size:12px;font-weight:700;color:var(--md-primary);text-decoration:none}.tp-detail-frame{width:100%;min-height:180px;max-height:380px;border:1px solid var(--md-border-l);border-radius:10px;background:#fff;margin:10px 0}
.tp-meta{font-size:12px;color:var(--md-on-muted);display:flex;gap:5px 9px;flex-wrap:wrap}.tp-meta-primary{margin-top:5px}.tp-summary{font-size:13px;line-height:1.58;color:var(--md-on-muted);min-height:41px}.tp-compat{display:flex;gap:6px;flex-wrap:wrap}.tp-compat span{padding:4px 7px;border-radius:7px;background:var(--md-surface-2);border:1px solid var(--md-border-l);font-size:10px;color:var(--md-on-muted)}.tp-card-footer{margin-top:auto;padding-top:10px;border-top:1px solid var(--md-border-l)}.tp-metrics{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;font-size:11px;color:var(--md-on-muted)}.tp-actions{display:flex;gap:7px;align-items:center}.tp-actions .btn{justify-content:center}.tp-card .tp-install-btn{flex:1 1 auto}.tp-rating{color:#b26700;font-weight:700}.tp-empty{padding:28px;text-align:center;color:var(--md-on-muted);font-size:13px;border:1px dashed var(--md-border);border-radius:10px}.tp-market-row{display:grid;grid-template-columns:minmax(130px,.7fr) minmax(260px,2fr) auto auto;gap:8px;align-items:center;margin-bottom:8px}.tp-installed-row{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:12px 0;border-bottom:1px solid var(--md-border-l)}.tp-installed-row:last-child{border-bottom:0}
.tp-installed-list{display:grid;gap:10px}
.tp-installed-card{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:14px;align-items:center;padding:13px 14px;border:1px solid var(--md-border-l);border-radius:12px;background:var(--md-surface);transition:border-color var(--transition),box-shadow var(--transition)}
.tp-installed-card:hover{border-color:rgba(var(--md-primary-rgb),.32);box-shadow:var(--md-el1)}
.tp-installed-icon{width:44px;height:44px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,rgba(var(--md-primary-rgb),.14),var(--md-surface-2));color:var(--md-primary);flex-shrink:0}
.tp-installed-icon .mi{font-size:22px}
.tp-installed-body{min-width:0}
.tp-installed-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}
.tp-installed-title-row strong{font-size:14px;overflow-wrap:anywhere}
.tp-installed-body .tp-meta{gap:4px 12px}
.tp-installed-body .tp-meta span{display:inline-flex;align-items:center;gap:3px}
.tp-installed-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.tp-status-badge{gap:4px}
.tp-status-badge .mi{margin-right:1px}
@media(max-width:640px){.tp-installed-card{grid-template-columns:36px 1fr;row-gap:10px}.tp-installed-icon{width:36px;height:36px}.tp-installed-icon .mi{font-size:18px}.tp-installed-actions{grid-column:1/-1;justify-content:space-between}}.tp-spec{white-space:pre-wrap;word-break:break-word;background:#101827;color:#dbeafe;border-radius:10px;padding:16px;font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;overflow:auto;max-height:520px}.tp-modal{position:fixed;inset:0;z-index:500;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(15,23,42,.58);backdrop-filter:blur(3px)}.tp-modal.open{display:flex}.tp-modal-box{width:min(460px,100%);background:var(--md-surface);border-radius:16px;box-shadow:var(--md-el4);padding:22px}.tp-modal-box h3{font-size:18px;margin-bottom:8px}.tp-modal-box p{font-size:13px;color:var(--md-on-muted);margin-bottom:16px}.tp-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.tp-loading{display:inline-flex;align-items:center;gap:7px;color:var(--md-on-muted);font-size:13px}.tp-release-list{display:grid;gap:9px;max-height:430px;overflow:auto;margin-top:14px}.tp-release-item{border:1px solid var(--md-border-l);border-radius:10px;padding:12px;background:var(--md-surface-2)}.tp-release-head{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}.tp-release-notes{font-size:12px;color:var(--md-on-muted);white-space:pre-wrap;line-height:1.55;margin:7px 0}.tp-release-modal-box{width:min(680px,100%)}
.up-store-row{display:grid;grid-template-columns:minmax(130px,.7fr) minmax(280px,2fr) auto auto;gap:8px;align-items:center;margin-bottom:8px}.up-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.up-summary>div{background:var(--md-surface-2);border:1px solid var(--md-border-l);border-radius:10px;padding:12px}.up-summary>div.browser-archive{background:var(--md-error-bg);border-color:var(--md-error);color:var(--md-error)}.up-summary>div.browser-archive small{color:var(--md-error)}.up-summary small{display:block;color:var(--md-on-muted);margin-bottom:3px}.up-plan-list{display:grid;gap:9px}.up-file{border:1px solid var(--md-border-l);border-radius:10px;padding:12px;background:var(--md-surface-2)}.up-file-head{display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap}.up-path{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}.up-diff{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.up-diff pre{max-height:230px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#101827;color:#dbeafe;border-radius:8px;padding:10px;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}.up-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.up-backup-toolbar{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:4px}.up-backup-actions{display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.up-backup-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--md-border-l)}.up-backup-row:last-child{border-bottom:0}@media(max-width:700px){.up-store-row{grid-template-columns:1fr}.up-diff{grid-template-columns:1fr}}
.store-group{margin-bottom:18px}.store-group:last-child{margin-bottom:0}.store-group-title{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;letter-spacing:.02em;color:var(--md-on-muted);text-transform:uppercase;margin-bottom:8px}.store-group-title .mi{font-size:15px}
.cert-row,.official-row{border:1px solid var(--md-border-l);border-radius:11px;padding:12px;margin-bottom:8px;background:var(--md-surface-2);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}.cert-row{border-color:rgba(29,99,237,.25)}
.official-row.api-off{border-color:rgba(230,81,0,.4);background:var(--md-warn-bg)}.api-provider-block{min-width:0}.api-control-note{margin-top:5px;color:var(--md-on-muted);font-size:11px;line-height:1.45}.official-row.api-off .api-control-note{color:var(--md-warn);font-weight:600}
@media(max-width:840px){.tp-toolbar{grid-template-columns:1fr 1fr}.tp-toolbar .btn{width:100%;justify-content:center}}
@media(max-width:700px){.tp-market-row,.tp-installed-row{grid-template-columns:1fr}.cert-row,.official-row{grid-template-columns:minmax(0,1fr) auto}.tp-grid{grid-template-columns:1fr}.market-hero{align-items:start}.tp-actions{flex-wrap:wrap}}
@media(max-width:460px){.market-hero{grid-template-columns:1fr;padding:16px}.market-hero-icon{width:46px;height:46px}.tp-toolbar{grid-template-columns:1fr}.tp-provider-context{align-items:flex-start}.tp-card-head{grid-template-columns:58px minmax(0,1fr)}.tp-thumb,.tp-thumb-fallback{width:58px;height:58px;border-radius:12px}.tp-card .tp-actions{display:grid;grid-template-columns:1fr}.tp-card .tp-install-btn{width:100%}}
.card-title-wrap{white-space:normal;word-break:keep-all;line-height:1.35;flex:1 1 auto;min-width:0}
.up-advanced-panel{margin-top:12px;padding-top:12px;border-top:1px dashed var(--md-border-l)}
.up-advanced-toggle{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--md-on-muted);cursor:pointer;margin-top:10px}


/* 업데이트·서드파티 서버 환경 진단 */
.env-status-panel{margin-bottom:20px;border:1px solid var(--md-border-l);border-radius:14px;background:var(--md-surface);box-shadow:var(--md-el1);overflow:hidden}
.env-status-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px 18px;border-bottom:1px solid var(--md-border-l);background:linear-gradient(135deg,rgba(var(--md-primary-rgb),.08),transparent 72%)}
.env-status-title{display:flex;align-items:flex-start;gap:10px;min-width:0}.env-status-title>.mi{color:var(--md-primary);font-size:23px;margin-top:1px}.env-status-title strong{display:block;font-size:15px}.env-status-title p{font-size:12px;color:var(--md-on-muted);margin-top:2px}
.env-feature-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:14px}
.env-feature-card{border:1px solid var(--md-border);border-radius:12px;padding:14px;background:var(--md-surface-2);min-width:0}
.env-feature-card.available{border-color:rgba(46,125,50,.35)}.env-feature-card.limited{border-color:rgba(230,81,0,.45)}.env-feature-card.unavailable{border-color:rgba(198,40,40,.45)}
.env-feature-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.env-feature-name{display:flex;align-items:center;gap:7px;font-weight:700;font-size:14px}.env-feature-name .mi{font-size:19px;color:var(--md-primary)}
.env-feature-summary{font-size:12px;color:var(--md-on-muted);margin:8px 0 10px;overflow-wrap:anywhere}.env-feature-summary strong{color:var(--md-on-surface)}
.env-check-count{display:flex;gap:7px;flex-wrap:wrap;font-size:11px;color:var(--md-on-muted)}
.env-guide{margin-top:11px;border-top:1px dashed var(--md-border);padding-top:9px}.env-guide>summary{cursor:pointer;color:var(--md-primary);font-size:12px;font-weight:700;display:flex;align-items:center;gap:5px}.env-guide>summary::-webkit-details-marker{display:none}
.env-issue{margin-top:9px;border-radius:9px;padding:10px;background:var(--md-surface);border:1px solid var(--md-border-l);font-size:12px}.env-issue.error{border-left:4px solid var(--md-error)}.env-issue.warning{border-left:4px solid var(--md-warn)}.env-issue.success{border-left:4px solid var(--md-success)}.env-issue.browser-fallback{background:var(--md-error-bg);border-color:var(--md-error);color:var(--md-error)}.env-issue.browser-fallback p{color:var(--md-error)}
.env-issue-title{display:flex;align-items:center;gap:6px;font-weight:700}.env-issue-title .mi{font-size:16px}.env-issue p{color:var(--md-on-muted);margin-top:4px;overflow-wrap:anywhere}.env-fix-list{margin:7px 0 0 18px;color:var(--md-on-surface)}.env-fix-list li{margin:4px 0;overflow-wrap:anywhere}.env-general-guide{margin:0 14px 14px;padding:12px 14px;border-radius:10px;background:var(--md-info-bg);color:var(--md-info);font-size:12px}.env-general-guide details>summary{cursor:pointer;font-weight:700}.env-general-guide ul{margin:8px 0 0 18px}.env-general-guide li{margin:4px 0}
.env-loading{grid-column:1/-1;display:flex;align-items:center;gap:9px;justify-content:center;padding:24px;color:var(--md-on-muted);font-size:13px}.env-loading .spinner{border-color:rgba(var(--md-primary-rgb),.22);border-top-color:var(--md-primary)}
@media(max-width:700px){.env-feature-grid{grid-template-columns:1fr}.env-status-head{align-items:stretch;flex-direction:column}.env-status-head .btn{width:100%;justify-content:center}}
.env-section-notice{margin-bottom:16px}
.env-section-notice>span{min-width:0;overflow-wrap:anywhere}
.env-dashboard-link{display:inline;padding:0;border:0;background:none;color:inherit;font:inherit;font-weight:700;text-decoration:underline;text-underline-offset:2px;white-space:normal;cursor:pointer}
.env-dashboard-link:focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:3px}
[hidden]{display:none!important}

/* 에디터 업데이트 메타데이터·코드 diff·반응형 보강 */
.up-release-card{border:1px solid var(--md-border-l);border-radius:12px;background:var(--md-surface-2);padding:16px;margin-top:12px;min-width:0}
.up-release-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
.up-release-title{font-size:17px;font-weight:700;overflow-wrap:anywhere}
.up-release-subtitle{font-size:12px;color:var(--md-on-muted);margin-top:2px;overflow-wrap:anywhere}
.up-release-meta{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:8px;margin-top:13px}
.up-release-meta>div{border:1px solid var(--md-border-l);border-radius:9px;background:var(--md-surface);padding:10px;min-width:0}
.up-release-meta small{display:block;color:var(--md-on-muted);font-size:11px;margin-bottom:2px}
.up-release-meta strong{display:block;font-size:13px;overflow-wrap:anywhere}
.up-release-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.up-choice-wrap{min-width:0;max-width:100%}
.up-bulk{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px;padding:11px;border:1px solid var(--md-border-l);border-radius:10px;background:var(--md-surface-2)}
.up-bulk label{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;margin-right:auto}.up-conflict-check{width:18px;height:18px;accent-color:var(--md-primary);flex:0 0 auto}.up-file-select{display:inline-flex;align-items:center;gap:8px;min-width:0}
.up-three-way-note{margin-bottom:12px}.up-three-way-note strong{display:block;margin-bottom:3px}
.up-release-notes{margin-top:12px;border-top:1px dashed var(--md-border);padding-top:10px}
.up-release-notes>summary{cursor:pointer;color:var(--md-primary);font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:5px}
.up-release-notes>summary::-webkit-details-marker{display:none}
.up-release-notes .when-open{display:none}.up-release-notes[open] .when-closed{display:none}.up-release-notes[open] .when-open{display:inline}
.up-release-notes-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.65;color:var(--md-on-muted);padding-top:10px}
.up-version-list{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;margin-top:12px;min-width:0}
.up-plan-list{grid-template-columns:minmax(0,1fr);min-width:0}.up-file,.up-file-head{min-width:0;max-width:100%}
.up-version-list .up-release-card{margin-top:0}
.up-version-group{display:grid;gap:12px;min-width:0}.up-version-group+.up-version-group{margin-top:8px;padding-top:20px;border-top:1px solid var(--md-border-l)}.up-version-group-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--md-border-l);border-radius:11px;background:var(--md-surface)}.up-version-group-head>div{display:grid;gap:3px}.up-version-group-head strong{font-size:14px}.up-version-group-head span:not(.badge){font-size:12px;color:var(--md-on-muted)}.up-version-group-major>.up-version-group-head{border-color:rgba(230,81,0,.35);background:var(--md-warn-bg)}.up-major-upgrade-notice .env-dashboard-link{margin-top:4px;color:var(--md-primary)}
.up-status-banner{margin-bottom:12px}
.up-code-diff-wrap{margin-top:10px}
.up-code-diff-wrap>summary{cursor:pointer;color:var(--md-primary);font-size:12px;font-weight:600}
.up-code-diff{margin-top:8px;border:1px solid var(--md-border);border-radius:9px;overflow:auto;background:var(--md-surface);max-height:520px}
.up-diff-row{display:grid;grid-template-columns:48px 48px 24px minmax(max-content,1fr);min-width:620px;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border-bottom:1px solid rgba(127,127,127,.12)}
.up-diff-row:last-child{border-bottom:0}
.up-diff-row>span{padding:2px 7px;white-space:pre}
.up-diff-old,.up-diff-new{text-align:right;color:var(--md-on-muted);user-select:none;border-right:1px solid rgba(127,127,127,.14)}
.up-diff-sign{text-align:center;user-select:none;font-weight:700}
.up-diff-code{white-space:pre;tab-size:4}
.up-diff-row.add{background:rgba(46,160,67,.16)}.up-diff-row.add .up-diff-sign{color:#1b7f37}
.up-diff-row.delete{background:rgba(248,81,73,.17)}.up-diff-row.delete .up-diff-sign{color:#cf222e}
.up-diff-row.skip{background:var(--md-surface-2);color:var(--md-on-muted);font-style:italic}
.up-security-notices{margin-top:16px}
.up-security-notices .alert:last-child{margin-bottom:0}
.main-wrap,.content-area,.section-panel,.card-body{min-width:0}
.topbar-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.topbar-actions{flex-shrink:0}
.btn-icon .mi{width:1em;max-width:1em;overflow:hidden}
html,body{max-width:100%;overflow-x:clip}
.save-bar{flex-wrap:wrap;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px))}
.save-bar .btn{flex-shrink:0}
.tp-modal-box{max-height:calc(100dvh - 36px);overflow:auto;overscroll-behavior:contain}.browser-zip-warning-box{width:min(560px,100%)}.browser-zip-warning-list{margin:12px 0 0 20px;font-size:13px;line-height:1.65}.browser-zip-warning-list li{margin:5px 0}.system-extension-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin-top:14px}.system-extension-card{border:1px solid var(--md-border-l);border-radius:10px;padding:11px;background:var(--md-surface-2)}.system-extension-card span{display:block;color:var(--md-on-muted);font-size:12px;margin-bottom:4px}.system-extension-card.browser{background:var(--md-error-bg);border-color:var(--md-error);color:var(--md-error)}.system-extension-card.browser span{color:var(--md-error)}
@media(max-width:1024px){
  .save-bar{grid-template-columns:minmax(0,1fr);align-items:stretch}
  .save-bar .btn{width:100%;justify-self:stretch;justify-content:center}
}
@media(max-width:700px){
  .up-release-meta{grid-template-columns:1fr}
  .up-file-head{display:grid;grid-template-columns:minmax(0,1fr);align-items:flex-start}
  .up-file-head>div{min-width:0}
  .up-choice-wrap{width:100%;margin-top:8px}
  .up-choice-wrap .up-choice{display:block;width:100%!important;min-width:0;max-width:100%}
}
@media(max-width:600px){
  .topbar{padding:0 10px;gap:7px}
  .topbar-actions{gap:3px}
  #save-btn{width:auto;min-width:64px;height:36px;padding:8px 12px;justify-content:center}
  #save-btn .btn-label{display:inline}
  .card-header{padding:15px 14px 12px}.card-body{padding:16px 14px}
  .save-bar{padding-left:14px;padding-right:14px}
  .save-bar .save-hint{min-width:0;overflow-wrap:anywhere}
  .up-release-card{padding:13px}
  .up-release-actions{width:100%}
  .up-release-actions .btn{width:100%;justify-content:center;white-space:normal;text-align:center}
  .up-actions>.form-control,.up-actions>.btn{max-width:none!important;width:100%;justify-content:center;white-space:normal;text-align:center}
  .tp-modal{padding:10px;align-items:flex-start;overflow:auto}
  .tp-modal-box{padding:18px 14px;max-height:none;margin:auto 0}
  .tp-modal-actions{flex-wrap:wrap}
  .tp-modal-actions .btn{flex:1 1 120px;justify-content:center}
}
@media(max-width:380px){
  .topbar-title{font-size:14px}
  .topbar-menu-btn,.topbar-actions .btn-icon{width:34px;height:34px;padding:7px}
  #save-btn{min-width:62px;height:34px;padding:7px 10px}
  .content-area{padding:12px 10px}
}

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
    <div class="alert alert-error"><span class="mi" aria-hidden="true">folder_off</span><span>T2Editor 자체 <code>&lt;공용 데이터&gt;/t2editor_db/t2admin-private</code> 저장소를 PHP가 만들거나 기록하지 못했습니다. <code>&lt;공용 데이터&gt;/t2editor_db/</code> 폴더가 현재 PHP 실행 계정에서 쓰기 가능한지 확인하세요.</span></div>
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
<?php // ── CMS 관리자 로그인 안내 ───────────────────────────────────── ?>
<?php elseif ($page_state === 'cms_login'): ?>
<div class="auth-screen" role="main">
  <div class="auth-card">
    <div class="auth-logo" aria-label="T2Editor 관리자">
      <span class="t2-logo"><span class="t2-logo-prefix">T2</span><span class="t2-logo-suffix">Editor</span></span>
      <span class="logo-admin">Admin</span>
    </div>
    <h1 class="auth-title"><?= htmlspecialchars((string)$auth_mode['label'], ENT_QUOTES, 'UTF-8') ?> 관리자 로그인 필요</h1>
    <p class="auth-desc">T2Editor 자체 비밀번호 대신 현재 CMS의 관리자 로그인 상태를 확인합니다.</p>
    <div class="alert alert-info"><span class="mi" aria-hidden="true">admin_panel_settings</span><span><?= htmlspecialchars((string)$auth_mode['label'], ENT_QUOTES, 'UTF-8') ?>에 관리자로 로그인한 뒤 이 페이지를 다시 확인하세요.</span></div>
    <button class="btn btn-primary" onclick="location.reload()"><span class="mi" style="font-size:18px" aria-hidden="true">refresh</span> 로그인 상태 다시 확인</button>
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
  T2Editor 자체 <code>&lt;공용 데이터&gt;/t2editor_db/t2admin-private</code> 저장소에 기록할 수 없어 설정 저장이 불가능합니다. <code>&lt;공용 데이터&gt;/t2editor_db/</code> 폴더의 PHP 쓰기 권한을 확인하세요.
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
      <button class="nav-item" onclick="showSection('updater')" data-section="updater">
        <span class="mi" aria-hidden="true">system_update_alt</span> 에디터 업데이트
      </button>
      <button class="nav-item" onclick="showSection('thirdparty')" data-section="thirdparty">
        <span class="mi" aria-hidden="true">storefront</span> 마켓 및 설치
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
      <button class="nav-item" onclick="showSection('cache')" data-section="cache">
        <span class="mi" aria-hidden="true">cached</span> 캐시 관리
      </button>
    </div>

    <div class="nav-section">
      <div class="nav-section-label" aria-hidden="true">계정</div>
      <button class="nav-item" onclick="showSection('security')" data-section="security">
        <span class="mi" aria-hidden="true">lock</span> 보안
      </button>
    </div>

    <div class="sidebar-footer">
      <?php if ($local_auth_required): ?>
      <button class="btn btn-outline btn-sm" onclick="doLogout()" style="width:100%;justify-content:center">
        <span class="mi" style="font-size:16px" aria-hidden="true">logout</span> 로그아웃
      </button>
      <?php else: ?>
      <div class="btn btn-outline btn-sm" style="width:100%;justify-content:center;cursor:default" aria-label="CMS 관리자 인증 사용 중">
        <span class="mi" style="font-size:16px" aria-hidden="true">verified_user</span> <?= htmlspecialchars((string)$auth_mode['label'], ENT_QUOTES, 'UTF-8') ?> 인증
      </div>
      <?php endif; ?>
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
          <span class="mi" style="font-size:16px" aria-hidden="true">save</span><span class="btn-label">저장</span>
        </button>
      </div>
    </header>

    <main style="flex:1;min-height:0;overflow-y:auto">
      <div class="content-area">


        <!-- 대시보드 -->
        <div class="section-panel active" id="section-dashboard">
          <div class="section-header">
            <h2>대시보드</h2>
            <p>T2Editor 관리자 현황 개요</p>
          </div>


        <section class="env-status-panel" id="env-status-panel" aria-live="polite" aria-label="업데이트 및 서드파티 설치 서버 환경 상태">
          <div class="env-status-head">
            <div class="env-status-title"><span class="mi" aria-hidden="true">health_and_safety</span><div><strong>업데이트·설치 서버 환경</strong><p>에디터 업데이트와 서드파티 설치가 현재 서버에서 안전하게 동작할 수 있는지 자동 점검합니다.</p></div></div>
            <button class="btn btn-outline btn-sm" id="env-recheck-btn" onclick="loadEnvironmentStatus(true)"><span class="mi" style="font-size:16px" aria-hidden="true">refresh</span>환경 다시 검사</button>
          </div>
          <div class="env-feature-grid" id="env-feature-grid"><div class="env-loading"><div class="spinner"></div>서버의 PHP 확장과 파일 권한을 확인하고 있습니다.</div></div>
          <div class="env-general-guide" id="env-general-guide" style="display:none"></div>
        </section>
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

        <!-- 라이선스 -->
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

        <!-- Extend 현황 -->
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


        <!-- T2Editor 에디터 안전 업데이트 -->
        <div class="section-panel" id="section-updater">
          <div class="section-header"><h2>T2Editor 에디터 업데이트</h2><p>현재 메이저 버전의 권장 최신 릴리스를 자동으로 검사하고, 새 메이저 버전과 이전 버전은 고급 옵션에서 검토한 뒤 선택적으로 업데이트합니다.</p></div>
          <div id="up-env-notice" class="alert alert-error env-section-notice" style="display:none" role="status"></div>
          <div id="up-feature-content">
          <div id="up-capability-warnings" style="display:none"></div>

          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><span class="mi">folder_managed</span><span class="card-title">설치 방식</span></div>
            <div class="card-body">
              <div class="settings-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
                <div class="form-group"><label class="form-label" for="up-core-mode">코어 업데이트</label><select class="form-control" id="up-core-mode"><option value="data">공용 데이터 폴더에 설치 — 권장</option><option value="direct">T2Editor 실제 폴더에 직접 설치</option></select><div class="form-hint">데이터 방식은 원본 코어를 읽기 전용으로 유지하고 새 릴리스 슬롯을 활성화합니다.</div></div>
                <div class="form-group"><label class="form-label" for="up-third-party-mode">서드파티 설치</label><select class="form-control" id="up-third-party-mode"><option value="data">공용 데이터 폴더에 설치 — 권장</option><option value="direct">실제 plugin/extend/locales에 직접 설치</option></select><div class="form-hint">데이터 방식은 PHP를 비공개 경로, JS·CSS·이미지를 공개 assets 경로에 분리합니다.</div></div>
              </div>
              <div id="up-mode-status" class="form-hint" style="margin-top:10px"></div>
              <div class="up-actions" style="margin-top:12px"><button class="btn btn-primary btn-sm" onclick="openCoreUpdatePasswordModal('save_mode')"><span class="mi" style="font-size:16px">save</span> 설치 방식 저장</button></div>
            </div>
          </div>

          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><span class="mi">update</span><span class="card-title">에디터 업데이트 검사</span></div>
            <div class="card-body">
              <div id="up-current-summary" class="up-summary" style="margin-bottom:14px"><div><small>현재 버전</small><strong>확인 중...</strong></div></div>
              <div class="up-actions">
                <select class="form-control" id="up-store-select" style="max-width:360px" aria-label="업데이트 저장소"></select>
                <button class="btn btn-primary" id="up-check-btn" onclick="checkCoreUpdate()"><span class="mi" style="font-size:17px">refresh</span> 권장 최신버전 다시 검사</button>
              </div>
              <div id="up-latest" style="margin-top:14px"><div class="tp-loading"><div class="spinner"></div> 현재 메이저 버전의 권장 최신버전을 확인하고 있습니다.</div></div>

              <label class="up-advanced-toggle"><input type="checkbox" id="up-advanced-check" onchange="toggleCoreAdvanced()"><span>고급 옵션: 이전 버전 및 다른 메이저 버전 직접 선택</span></label>
              <div id="up-advanced-panel" class="up-advanced-panel" style="display:none">
                <div class="up-actions">
                  <button class="btn btn-outline btn-sm" id="up-version-refresh" onclick="loadCoreVersionList()"><span class="mi" style="font-size:16px">refresh</span> 버전 목록 새로고침</button>
                </div>
                <p class="form-hint" style="margin-top:8px">현재 메이저의 이전 릴리스와 메이저가 달라지는 새 릴리스는 이 고급 목록에서만 선택할 수 있습니다. 다른 메이저 버전은 호환성 경고를 확인한 뒤 진행합니다.</p>
                <div id="up-version-list" class="up-version-list" role="list" aria-live="polite"><div class="tp-empty">고급 옵션을 열면 버전 목록을 불러옵니다.</div></div>
              </div>
            </div>
          </div>

          <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="mi">fact_check</span><span class="card-title">에디터 업데이트 계획</span></div><div class="card-body"><div id="up-plan"><div class="tp-empty">업데이트 파일을 내려받아 검증한 뒤 파일별 변경 계획과 코드 diff가 여기에 표시됩니다.</div></div></div></div>

          <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="mi">cloud_sync</span><span class="card-title">공식·서드파티 에디터 저장소</span></div><div class="card-body"><p class="form-hint" style="margin-bottom:14px">HTTPS 공인 도메인의 <code>t2editor-store-api/1</code> 호환 API만 연결됩니다. 서드파티 저장소는 운영자를 신뢰할 수 있을 때만 사용하세요. 최대 20개까지 등록할 수 있습니다.</p>
            <div class="store-group"><div class="store-group-title"><span class="mi">verified</span>공식 에디터 저장소</div><div id="up-store-official"></div></div>
            <div class="store-group"><div class="store-group-title"><span class="mi">verified_user</span>인증된 서드파티 에디터 저장소</div><div id="up-store-certified"><div class="tp-empty">인증된 저장소 목록을 불러오는 중입니다.</div></div></div>
            <div class="store-group"><div class="store-group-title"><span class="mi">person_add</span>사용자 추가 저장소</div><div class="alert alert-warn" style="margin-bottom:10px"><span class="mi">warning</span><span>사용자가 직접 추가한 저장소는 DSc가 검증하지 않았습니다. 다운로드·업데이트 적용 전 운영자와 배포 파일 정보를 반드시 확인하세요.</span></div><div id="up-store-rows"></div></div>
            <div class="up-actions" style="margin-top:12px"><button class="btn btn-outline btn-sm" onclick="addCoreStoreRow()"><span class="mi" style="font-size:16px">add</span> 저장소 추가</button><button class="btn btn-primary btn-sm" onclick="saveCoreStores()"><span class="mi" style="font-size:16px">save</span> 저장소 저장</button></div>
          </div></div>

          <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="mi">restore</span><span class="card-title">데이터 릴리스 전환·롤백</span></div><div class="card-body"><div class="form-hint" style="margin-bottom:10px">공용 데이터 설치에서는 파일을 다시 복사하지 않고 활성 릴리스 포인터만 전환합니다.</div><div id="up-data-releases"><div class="tp-empty">설치된 데이터 릴리스를 확인 중입니다.</div></div></div></div>

          <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="mi">restore_page</span><span class="card-title">직접 설치 백업 복구</span></div><div class="card-body"><div class="form-hint" style="margin-bottom:10px">직접 설치 적용 직전에 저장된 원본 파일 묶음으로 되돌리거나, 더 이상 필요하지 않은 백업 내역을 삭제합니다.</div><div id="up-backups"><div class="tp-empty">복구 가능한 직접 설치 백업을 확인 중입니다.</div></div></div></div>

          <div class="card"><div class="card-header"><span class="mi">api</span><span class="card-title">서드파티 에디터 저장소 요구 스펙</span></div><div class="card-body"><p class="form-hint" style="margin-bottom:12px">제3자 저장소는 아래 읽기 전용 계약을 구현해야 합니다. 관리자 비밀번호나 사이트 인증정보를 요구해서는 안 됩니다.</p><pre class="tp-spec" id="up-store-spec">호환성: t2editor-store-api/1
필수 GET/HEAD: ?action=latest, list, check, download, spec 및 ?version=버전
3-way 업데이트: 현재 설치 버전과 대상 버전의 배포 ZIP을 모두 계속 제공해야 함
버전 객체 필수: version, files[]
권장 버전 정보: title, release_date, changes 또는 description
파일 객체 필수: name, size_bytes, sha256(64자리 소문자), available, download_url(절대 HTTPS)
ZIP 규칙: t2editor/ 폴더 또는 ZIP 최상위 배포 루트를 자동 감지, 경로 이동·절대 경로·심볼릭 링크·암호화 금지
권장 매니페스트: t2editor/update-manifest.json
  schema: t2editor-core-update-v1
  compatibility: t2editor-core-update/1
  product, version, requirements.php_min, files[path].sha256, files[path].size
다운로드는 HTML 페이지로 리다이렉트하지 않고 ZIP 바이트를 직접 반환해야 합니다.
클라이언트 최소 PHP: 7.4, PHP 8.2까지 호환 코드를 유지해야 합니다.</pre></div></div>

          <div class="up-security-notices" aria-label="에디터 업데이트 보안 및 개인정보 안내">
            <div class="alert alert-info"><span class="mi">shield</span><span>업데이트 ZIP은 SHA-256·파일 크기와 대조하고 위험한 경로·심볼릭 링크·암호화·압축 폭탄을 차단합니다. data와 관리자 키 파일은 자동 제외합니다. 데이터 설치는 불변 릴리스 슬롯과 즉시 롤백을 사용합니다.</span></div>
            <?php if ($local_auth_required): ?>
            <div class="alert alert-warn"><span class="mi">password</span><span>실제 적용과 백업 복구 시 관리자 비밀번호를 다시 입력합니다. 비밀번호는 <strong>현재 서버에서만</strong> 검증되며 공식·서드파티 저장소로 전송되지 않습니다.</span></div>
            <?php else: ?>
            <div class="alert alert-info"><span class="mi">verified_user</span><span>실제 적용과 백업 복구는 <?= htmlspecialchars((string)$auth_mode['label'], ENT_QUOTES, 'UTF-8') ?> 관리자 세션으로 승인합니다. T2Editor 자체 비밀번호는 사용하지 않습니다.</span></div>
            <?php endif; ?>
            <div class="alert alert-info"><span class="mi">analytics</span><span>DSc 에디터 업데이트 API 토글을 켠 상태에서 공식 저장소 ZIP을 내려받을 때에만 현재 T2Editor 버전, PHP 버전, 플랫폼과 가명 설치 식별자가 다운로드 통계로 전송됩니다. 토글을 끄면 DSc 업데이트·인증 저장소 API로 요청하지 않습니다.</span></div>
          </div>
          </div>
        </div>
        <div class="tp-modal" id="up-password-modal" role="dialog" aria-modal="true" aria-labelledby="up-password-title" onclick="if(event.target===this)closeCoreUpdatePasswordModal()"><div class="tp-modal-box"><h3 id="up-password-title">에디터 업데이트 승인</h3><p id="up-password-message">관리자 비밀번호는 이 서버 안에서만 확인되며 업데이트 저장소로 전송되지 않습니다.</p><input type="password" class="form-control" id="up-password" autocomplete="current-password" placeholder="관리자 비밀번호" onkeydown="if(event.key==='Enter')confirmCoreUpdatePassword()"><div id="up-password-error" class="form-hint" style="color:var(--md-error);min-height:20px;margin-top:8px"></div><div class="tp-modal-actions"><button class="btn btn-outline" onclick="closeCoreUpdatePasswordModal()">취소</button><button class="btn btn-primary" id="up-password-confirm" onclick="confirmCoreUpdatePassword()">확인</button></div></div></div>

        <!-- T2Editor 마켓 및 확장 설치 -->
        <div class="section-panel" id="section-thirdparty">
          <div class="section-header">
            <h2>T2Editor 마켓</h2>
            <p>Open T2Editor와 독립 T2Editor Provider Market에서 Plugin, Extend, Locales를 찾아 설치합니다.</p>
          </div>
          <div id="tp-env-notice" class="alert alert-error env-section-notice" style="display:none" role="status"></div>
          <div id="tp-feature-content">

          <div class="market-hero">
            <div class="market-hero-icon"><span class="mi" aria-hidden="true">widgets</span></div>
            <div class="market-hero-copy">
              <span class="market-hero-eyebrow">T2Editor Extension Marketplace</span>
              <h3>필요한 기능을 확인하고 바로 설치하세요</h3>
              <p><strong>Open T2Editor</strong>는 DSc가 운영하는 공식 마켓이며, 다른 운영자의 서비스는 <strong>T2Editor Provider Market</strong>으로 구분됩니다.</p>
              <div class="market-hero-meta"><span>Manifest v1 검증</span><span>SHA-256 확인</span><span>설치 전 관리자 재인증</span></div>
            </div>
          </div>

          <div class="alert alert-warn"><span class="mi">security</span><span><?= $local_auth_required ? '관리자 비밀번호는 현재 서버에서만 확인되며 마켓으로 전송되지 않습니다.' : htmlspecialchars((string)$auth_mode['label'], ENT_QUOTES, 'UTF-8') . ' 관리자 세션으로 설치를 승인하며 T2Editor 자체 비밀번호는 사용하지 않습니다.' ?> 설치기는 요구 버전, 허용 경로, ZIP 파일 수·용량, symlink와 Plugin <code>hooks.js</code>를 검사한 뒤 백업하고 원자적으로 교체합니다. <strong>Certified Provider</strong>는 도메인 소유와 프로토콜 연결을 확인한 상태이며, DSc 소유·공식 미러 또는 모든 패키지의 보안·품질 보증을 뜻하지 않습니다.</span></div>

          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><span class="mi">storefront</span><span class="card-title card-title-wrap" id="tp-catalog-title">확장 카탈로그</span></div>
            <div class="card-body">
              <div class="tp-toolbar">
                <select class="form-control" id="tp-market-select" aria-label="마켓 선택"></select>
                <input class="form-control" id="tp-search" placeholder="이름, 설명, 확장 ID 검색" onkeydown="if(event.key==='Enter')loadThirdPartyCatalog()">
                <select class="form-control" id="tp-type" aria-label="확장 유형">
                  <option value="">모든 유형</option><option value="plugin">Plugin</option><option value="extend-js">Extend JS</option><option value="extend-php">Extend PHP</option><option value="locales">Locales / 번역</option>
                </select>
                <button class="btn btn-primary" onclick="loadThirdPartyCatalog()"><span class="mi" style="font-size:17px">search</span> 검색</button>
              </div>
              <div class="tp-provider-context" id="tp-provider-context" aria-live="polite"></div>
              <div id="tp-catalog" class="tp-empty">마켓을 불러오는 중입니다.</div>
            </div>
          </div>

          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><span class="mi">inventory_2</span><span class="card-title">설치된 서드파티 프로그램</span></div>
            <div class="card-body" id="tp-installed"><div class="tp-loading"><div class="spinner"></div> 설치 기록을 불러오는 중...</div></div>
          </div>

          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><span class="mi">hub</span><span class="card-title">마켓 연결 관리</span></div>
            <div class="card-body">
              <p class="form-hint" style="margin-bottom:14px"><strong>Open T2Editor</strong> 연결은 아래 토글로 끌 수 있습니다. 끄고 저장하면 공식 마켓과 Certified Provider 레지스트리를 포함한 DSc API 요청이 서버에서 차단됩니다. 독립 Provider Market은 HTTPS 공인 도메인의 호환 API만 연결되며 최대 20개까지 직접 추가할 수 있습니다.</p>
              <div class="store-group"><div class="store-group-title"><span class="mi">verified</span>Open T2Editor · DSc 공식</div><div id="tp-market-official"></div></div>
              <div class="store-group"><div class="store-group-title"><span class="mi">verified_user</span>Certified Provider</div><div id="tp-market-certified"><div class="tp-empty">인증된 Provider Market 목록을 불러오는 중입니다.</div></div></div>
              <div class="store-group"><div class="store-group-title"><span class="mi">person_add</span>직접 추가한 Provider Market</div><div class="alert alert-warn" style="margin-bottom:10px"><span class="mi">warning</span><span>직접 추가한 도메인은 DSc의 인증 상태가 아닙니다. 설치 전에 운영 주체와 배포 파일 정보를 확인하세요.</span></div><div id="tp-market-rows"></div></div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
                <button class="btn btn-outline btn-sm" onclick="addThirdPartyMarketRow()"><span class="mi" style="font-size:16px">add</span> Provider Market 추가</button>
                <button class="btn btn-primary btn-sm" onclick="saveThirdPartyMarkets()"><span class="mi" style="font-size:16px">save</span> 연결 저장</button>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header"><span class="mi">api</span><span class="card-title">T2Editor Provider Market 개발 계약</span></div>
            <div class="card-body">
              <p class="form-hint" style="margin-bottom:12px">독립 운영자는 아래 읽기 전용 API와 동일한 manifest·패키지 계약을 구현할 수 있습니다. 자신의 서비스를 Open T2Editor로 표시해서는 안 됩니다.</p>
              <pre class="tp-spec" id="tp-api-spec">GET ?action=spec
GET ?action=catalog&amp;q=&amp;type=&amp;page=&amp;limit=
GET ?action=detail&amp;id=
GET ?action=reviews&amp;id=&amp;page=&amp;limit=
POST ?action=challenge  JSON: {"package_id":"...","release_id":"...(선택)","client_id":"..."}
POST ?action=download   JSON: {"package_id":"...","release_id":"...(선택)","client_id":"...","ticket":"..."}

공통 성공 응답:
{"api":"t2editor-third-party-market","api_version":"1.1.3","ok":true,"data":{...}}

manifest schema: t2editor-third-party-v1
필수: id, name, version, type, install.*, requires.*, license.id/name
ID: 소문자·숫자로 시작, 제한된 점·밑줄·하이픈만 허용 (Plugin ID는 점 금지)
detail.releases: 최신순 전체 릴리즈 히스토리
release.type: initial | patch | minor_update | minor_upgrade
release_id 생략 시 최신 릴리즈 설치
필수 메타데이터: PHP 최소/최대, T2Editor 최소, 라이선스
선택 메타데이터: 테스트 버전, 데모 링크
Plugin ZIP: manifest source 디렉터리와 source/hooks.js 필수
Extend JS/PHP ZIP: manifest가 선언한 단일 파일만 허용
Locales ZIP: 언어 코드 JSON과 선택적 README·LICENSE만 허용
신규 발행 유형은 /locales 사용 (/locale은 읽을 때만 /locales로 정규화)
관리자 비밀번호는 마켓으로 전송하거나 API 규격에 포함하면 안 됩니다.</pre>
            </div>
          </div>
          </div>
        </div>

        <div class="tp-modal" id="tp-password-modal" role="dialog" aria-modal="true" aria-labelledby="tp-password-title" onclick="if(event.target===this)closeThirdPartyPasswordModal()">
          <div class="tp-modal-box">
            <h3 id="tp-password-title">관리자 비밀번호 재확인</h3>
            <p id="tp-password-message">패키지를 다운로드하고 설치하려면 관리자 비밀번호를 다시 입력하세요.</p>
            <input type="password" class="form-control" id="tp-password" autocomplete="current-password" placeholder="관리자 비밀번호" onkeydown="if(event.key==='Enter')confirmThirdPartyPassword()">
            <div id="tp-password-error" class="form-hint" style="color:var(--md-error);min-height:20px;margin-top:8px"></div>
            <div class="tp-modal-actions"><button class="btn btn-outline" onclick="closeThirdPartyPasswordModal()">취소</button><button class="btn btn-primary" id="tp-password-confirm" onclick="confirmThirdPartyPassword()">확인</button></div>
          </div>
        </div>

        <div class="tp-modal" id="tp-release-modal" role="dialog" aria-modal="true" aria-labelledby="tp-release-title" onclick="if(event.target===this)closeThirdPartyReleaseModal()">
          <div class="tp-modal-box tp-release-modal-box">
            <div class="tp-release-head"><div><h3 id="tp-release-title">릴리즈 히스토리</h3><p id="tp-release-description">설치할 버전을 선택하세요.</p></div><button class="btn btn-outline btn-sm" onclick="closeThirdPartyReleaseModal()">닫기</button></div><iframe id="tp-description-frame" class="tp-detail-frame" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" title="배포 게시물 본문"></iframe>
            <div id="tp-release-content" class="tp-release-list"><div class="tp-loading"><div class="spinner"></div> 릴리즈를 불러오는 중...</div></div>
          </div>
        </div>

        <div class="tp-modal" id="browser-zip-warning-modal" role="dialog" aria-modal="true" aria-labelledby="browser-zip-warning-title" aria-describedby="browser-zip-warning-description">
          <div class="tp-modal-box browser-zip-warning-box">
            <h3 id="browser-zip-warning-title">브라우저 ZIP 처리를 사용합니다</h3>
            <div class="alert alert-error"><span class="mi">warning</span><span id="browser-zip-warning-description"><strong>서버에 PHP ZIP 해제 기능이 없어 관리자 브라우저가 압축 해제를 대신합니다.</strong></span></div>
            <ul class="browser-zip-warning-list">
              <li>작업이 끝날 때까지 이 관리자 페이지와 브라우저 탭을 닫거나 새로고침하지 마세요.</li>
              <li>다른 페이지로 이동하거나 브라우저가 절전 상태가 되면 전송이 중단될 수 있습니다.</li>
              <li>브라우저가 반환한 파일은 서버가 원본 ZIP의 경로, 크기와 CRC를 다시 검증합니다.</li>
            </ul>
            <p id="browser-zip-warning-package" style="margin-top:12px;margin-bottom:0"></p>
            <div class="tp-modal-actions"><button class="btn btn-outline" onclick="resolveBrowserZipWarning(false)">취소</button><button class="btn btn-danger" onclick="resolveBrowserZipWarning(true)">확인하고 계속</button></div>
          </div>
        </div>

        <!-- 에디터 기본 설정 -->
        <div class="section-panel" id="section-editor">
          <div class="section-header">
            <h2>에디터 기본 설정</h2>
            <p>활성 에디터 런타임의 기본 설정을 관리합니다</p>
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
            <div class="card-header"><span class="mi" aria-hidden="true">height</span><span class="card-title">작성 영역 높이</span></div>
            <div class="card-body">
              <div class="form-group">
                <label class="form-label" for="cfg-content-height">에디터 콘텐츠 영역 기본 높이 (px)</label>
                <input class="form-control" type="number" id="cfg-content-height" min="200" max="2000" step="50" inputmode="numeric">
                <div class="form-hint">200~2000px. PC에서는 작성 영역 오른쪽 아래를 마우스로 끌어 이 값보다 더 크게 조절할 수 있으며, 조절한 높이는 해당 브라우저에 저장됩니다. 모바일에서는 드래그 크기 조절이 비활성화됩니다.</div>
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

        <!-- NSFW 필터 -->
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

        <!-- 플러그인 관리 -->
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

        <!-- 아이콘 관리 -->
        <div class="section-panel" id="section-icons">
          <div class="section-header">
            <h2>아이콘 관리</h2>
            <p>플러그인별 툴바 버튼 아이콘을 자유롭게 바꿉니다</p>
          </div>
          <div class="alert alert-info">
            <span class="mi" aria-hidden="true">info</span>
            <span>이 설치본에 포함된 Material Icons를 여기에서 검색하고 클릭해 바로 적용할 수 있습니다. 아이콘 목록을 불러오기 위해 외부 사이트에 접속하지 않습니다.</span>
          </div>
          <div class="icon-manager-summary">
            <div class="form-group icon-search" style="margin:0;flex:1 1 280px">
              <label class="form-label" for="icon-search-input">적용 대상 버튼 검색</label>
              <input type="search" id="icon-search-input" class="form-control" placeholder="버튼 이름 또는 기능으로 검색…" oninput="renderIconManager()">
            </div>
            <span class="icon-catalog-count"><span class="mi" style="font-size:15px" aria-hidden="true">apps</span><?= number_format(count($ICON_CATALOG)) ?>개 내장 아이콘</span>
          </div>
          <div id="icon-manager-list">
            <div class="empty-hint">로딩 중...</div>
          </div>
          <div class="save-bar">
            <span class="save-hint">저장하면 새로고침 즉시 반영됩니다</span>
            <button class="btn btn-primary" onclick="saveCurrentSection()"><span class="mi" style="font-size:16px" aria-hidden="true">save</span> 저장</button>
          </div>

          <div class="icon-picker-backdrop" id="icon-picker-backdrop" hidden onclick="if(event.target===this)closeIconPicker()">
            <div class="icon-picker-modal" role="dialog" aria-modal="true" aria-labelledby="icon-picker-title" aria-describedby="icon-picker-description">
              <div class="icon-picker-head">
                <div>
                  <h3 id="icon-picker-title">아이콘 선택</h3>
                  <p id="icon-picker-description">검색 결과에서 하나를 클릭하면 버튼에 즉시 적용됩니다.</p>
                </div>
                <button type="button" class="btn btn-icon icon-picker-close" onclick="closeIconPicker()" aria-label="아이콘 선택 닫기"><span class="mi" aria-hidden="true">close</span></button>
              </div>
              <div class="icon-picker-body">
                <div class="icon-picker-target" id="icon-picker-target"></div>
                <div class="icon-picker-tools">
                  <input type="search" id="icon-picker-query" class="form-control" placeholder="예: 이미지, 저장, 화살표, upload…" autocomplete="off" oninput="onIconPickerSearch()" aria-label="내장 아이콘 검색">
                  <select id="icon-picker-type" class="form-control" onchange="onIconPickerTypeChange()" aria-label="아이콘 모양">
                    <option value="material-icons">Filled</option>
                    <option value="material-icons-outlined">Outlined</option>
                  </select>
                </div>
                <div class="icon-picker-categories" id="icon-picker-categories" aria-label="아이콘 분류"></div>
                <div class="icon-picker-meta"><span id="icon-picker-count"></span><span>클릭하여 적용</span></div>
                <div class="icon-picker-results" id="icon-picker-results"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 반응형 툴바 -->
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
            <span class="save-hint"><span class="save-hint-title">반응형 버튼 그룹</span><span class="save-hint-detail">화면 너비(px) 구간별로 버튼을 그룹화합니다.<br>각 화면 너비는 하나의 구간에만 속해야 합니다.</span></span>
            <button class="btn btn-primary" onclick="saveCurrentSection()"><span class="mi" style="font-size:16px" aria-hidden="true">save</span> 저장</button>
          </div>
        </div>

        <!-- 도메인 설정 -->
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

        <!-- 업로드 설정 -->
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

        <!-- 캐시 관리 -->
        <div class="section-panel" id="section-cache">
          <div class="section-header">
            <h2>캐시 관리</h2>
            <p>런타임 인덱스와 다국어 컴파일 캐시의 상태를 확인하고 삭제·재생성합니다</p>
          </div>
          <div class="alert alert-info" style="margin-bottom:14px">
            <span class="mi" aria-hidden="true">info</span>
            <span>기본 설치와 데이터 슬롯 모드 모두 런타임 인덱스와 번역 정적 캐시를 생성합니다. 기본 설치에서는 관련 원본 파일의 서명을 함께 기록하여 변경이 감지되면 오래된 인덱스를 자동으로 사용하지 않습니다.</span>
          </div>
          <div class="card" style="margin-bottom:14px">
            <div class="card-header"><span class="mi" aria-hidden="true">analytics</span><span class="card-title">캐시 상태</span><button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="loadCacheStatus(true)"><span class="mi" style="font-size:16px">refresh</span> 새로고침</button></div>
            <div class="card-body" id="cache-status-body">
              <div class="loading-inline"><div class="spinner"></div> 캐시 상태 확인 중...</div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><span class="mi" aria-hidden="true">build_circle</span><span class="card-title">캐시 작업</span></div>
            <div class="card-body">
              <div id="cache-action-result"></div>
              <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                <button class="btn btn-danger" id="cache-clear-btn" onclick="runCacheAction('clear')"><span class="mi" style="font-size:17px">delete_sweep</span> 캐시 삭제</button>
                <button class="btn btn-primary" id="cache-rebuild-btn" onclick="runCacheAction('rebuild')"><span class="mi" style="font-size:17px">cached</span> 캐시 재생성</button>
              </div>
              <div class="form-hint" style="margin-top:12px">삭제 대상: 런타임 인덱스, 컴파일 번역 맵, 비공개/공개 번역 세대 디렉터리. 관리자 설정과 업로드 파일은 삭제하지 않습니다.</div>
            </div>
          </div>
        </div>

        <!-- 보안 -->
        <div class="section-panel" id="section-security">
          <div class="section-header">
            <h2>보안</h2>
            <p><?= $local_auth_required ? '관리자 비밀번호 변경 및 설정 초기화' : htmlspecialchars((string)$auth_mode['label'], ENT_QUOTES, 'UTF-8') . ' 관리자 인증 및 설정 초기화' ?></p>
          </div>
          <?php if ($local_auth_required): ?>
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
          <?php else: ?>
          <div class="card" style="margin-bottom:14px">
            <div class="card-header"><span class="mi" aria-hidden="true">verified_user</span><span class="card-title">CMS 관리자 인증</span></div>
            <div class="card-body">
              <div class="alert alert-info"><span class="mi" aria-hidden="true">admin_panel_settings</span><span>T2Editor 자체 관리자 키와 비밀번호를 사용하지 않습니다. <?= htmlspecialchars((string)$auth_mode['label'], ENT_QUOTES, 'UTF-8') ?> 관리자 계정과 세션에서 권한을 관리하세요.</span></div>
            </div>
          </div>
          <?php endif; ?>
          <div class="card">
            <div class="card-header"><span class="mi" aria-hidden="true">restore</span><span class="card-title">설정 초기화</span></div>
            <div class="card-body">
              <p style="font-size:13px;color:var(--md-on-muted);margin-bottom:14px">모든 관리자 설정을 기본값으로 초기화합니다. <?= $local_auth_required ? '비밀번호는 유지됩니다.' : 'CMS 로그인 및 계정 정보에는 영향을 주지 않습니다.' ?></p>
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

<script src="../js/jszip.min.js"></script>
<script>
// 전역 상태
const CSRF   = <?= json_encode($csrf, JSON_HEX_TAG) ?>;
const API    = 'api.php';
let   settings     = {};
let   allPlugins   = {};
let   allButtons   = [];
let   currentSection = 'dashboard';
const MATERIAL_ICON_CATALOG = <?= json_encode(array_values($ICON_CATALOG), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE) ?>;
const MATERIAL_ICON_SET = new Set(MATERIAL_ICON_CATALOG);
const ICON_PICKER_FEATURED = ['search','home','menu','close','check','add','delete','edit','save','settings','image','photo_camera','upload','download','link','language','translate','code','format_bold','format_italic','format_underlined','format_align_left','format_list_bulleted','undo','redo','visibility','lock','star','favorite','play_arrow','pause','volume_up','fullscreen','more_vert','refresh','share','content_copy','folder','description','email','notifications','help','info'];
const ICON_PICKER_CATEGORIES = [
  {id:'featured', label:'추천', tokens:[]},
  {id:'action', label:'동작', tokens:['add','remove','delete','edit','save','search','settings','check','close','done','refresh','undo','redo','copy','share','download','upload','login','logout','lock','print']},
  {id:'text', label:'텍스트', tokens:['format_','text_','title','font','paragraph','subject','list','align','indent','quote','spellcheck']},
  {id:'media', label:'이미지·미디어', tokens:['image','photo','camera','video','movie','play','pause','audio','music','volume','mic','gallery','crop','filter']},
  {id:'navigation', label:'이동', tokens:['arrow','chevron','navigate','first_page','last_page','expand','unfold','menu','more_','fullscreen','open_in']},
  {id:'communication', label:'소통', tokens:['email','mail','chat','message','forum','call','phone','contact','notifications','send','share']},
  {id:'file', label:'파일', tokens:['file','folder','description','article','attachment','cloud','archive','inventory','content_']},
  {id:'status', label:'상태', tokens:['info','help','warning','error','verified','star','favorite','visibility','toggle','radio','check_box']},
  {id:'all', label:'전체', tokens:[]}
];
const ICON_KO_ALIASES = {
  search:'검색 찾기 돋보기', home:'홈 집 시작', menu:'메뉴 목록', close:'닫기 취소 엑스', check:'확인 체크 완료 선택', add:'추가 더하기 플러스', remove:'제거 빼기 마이너스',
  delete:'삭제 휴지통', edit:'편집 수정 연필', save:'저장 디스크', settings:'설정 톱니 관리', image:'이미지 사진 그림', photo:'사진 이미지', camera:'카메라 촬영', upload:'업로드 올리기', download:'다운로드 받기',
  link:'링크 연결 체인', language:'언어 지구 웹', translate:'번역 언어', code:'코드 개발 소스', format:'서식 글자 텍스트', align:'정렬 맞춤', list:'목록 리스트', undo:'실행취소 되돌리기', redo:'다시실행 앞으로',
  visibility:'보기 표시 눈', lock:'잠금 보안 자물쇠', star:'별 즐겨찾기', favorite:'좋아요 하트', play:'재생 시작', pause:'일시정지', volume:'음량 소리 스피커', fullscreen:'전체화면', refresh:'새로고침 갱신',
  share:'공유', copy:'복사', folder:'폴더 디렉터리', file:'파일 문서', description:'문서 설명', email:'이메일 메일', notifications:'알림 종', help:'도움말 질문', info:'정보 안내',
  arrow:'화살표 이동 방향', chevron:'화살표 이동 펼침', expand:'펼치기 확장', collapse:'접기 축소', more:'더보기 점', person:'사람 사용자 계정', account:'계정 사용자', group:'그룹 사람',
  calendar:'달력 일정 날짜', date:'날짜 달력', time:'시간 시계', schedule:'일정 시간', location:'위치 지도 핀', map:'지도 위치', phone:'전화 통화', chat:'채팅 대화', message:'메시지 대화', send:'보내기 전송',
  warning:'경고 주의', error:'오류 에러', verified:'인증 확인', cloud:'클라우드 구름', attachment:'첨부 클립', print:'인쇄 프린트', zoom:'확대 축소', crop:'자르기', color:'색상 컬러 팔레트'
};
const MATERIAL_ICON_SEARCH_INDEX = new Map(MATERIAL_ICON_CATALOG.map(name => {
  const ko = Object.entries(ICON_KO_ALIASES).filter(([token]) => name.includes(token)).map(([,words]) => words).join(' ');
  return [name, (name.replace(/_/g,' ')+' '+ko).toLowerCase()];
}));
let iconPickerState = {command:'', type:'material-icons', query:'', category:'featured', limit:180, returnFocus:null};

// API 헬퍼
async function requestJson(url, options={}, timeoutMs=12000, label='API 요청') {
  const controller=typeof AbortController==='function'?new AbortController():null;
  const opts={...options};
  if(controller)opts.signal=controller.signal;
  let timeoutId;
  const timeout=new Promise((_,reject)=>{
    timeoutId=setTimeout(()=>{
      if(controller)controller.abort();
      const error=new Error('timeout');
      error.name='TimeoutError';
      reject(error);
    },timeoutMs);
  });
  try {
    const r=await Promise.race([fetch(url,opts),timeout]);
    const text=await r.text();
    let data;
    try { data=JSON.parse(text); }
    catch(e) {
      return {ok:false,msg:`${label}: 서버가 올바른 JSON을 반환하지 않았습니다. (HTTP ${r.status})`,data:null};
    }
    if(!r.ok&&data.ok!==false)return{ok:false,msg:`${label}: HTTP ${r.status}`,data:null};
    return data;
  } catch(e) {
    const timedOut=e&&(e.name==='AbortError'||e.name==='TimeoutError');
    return {ok:false,msg:timedOut?`${label}: ${Math.ceil(timeoutMs/1000)}초 안에 응답하지 않았습니다.`:`${label}: ${e?.message||'연결 오류'}`,data:null};
  } finally {
    clearTimeout(timeoutId);
  }
}
async function api(action, method='GET', body=null) {
  const opts={method,headers:{'Content-Type':'application/json','X-T2Admin-CSRF':CSRF}};
  if(body&&method==='POST')opts.body=JSON.stringify(body);
  return requestJson(API+'?action='+encodeURIComponent(action),opts,12000,'관리자 API');
}

// 토스트
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

// 섹션 전환
const sectionTitles = {
  dashboard:'대시보드', license:'라이선스', extend:'Extend 현황', updater:'에디터 업데이트', thirdparty:'마켓 및 설치',
  editor:'기본 설정', nsfw:'NSFW 필터',
  plugins:'플러그인 관리', icons:'아이콘 관리', toolbar:'반응형 툴바',
  domains:'도메인 설정',
  upload:'업로드 설정', cache:'캐시 관리', security:'보안'
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
  if (name==='updater') loadCoreUpdater();
  if (name==='thirdparty') loadThirdParty();
  if (name==='plugins') loadPlugins();
  if (name==='icons') loadIconManager();
  if (name==='toolbar') loadToolbarGroups();
  if (name==='cache') loadCacheStatus(false);
  closeSidebar();
}

// 사이드바
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

// 테마
function toggleTheme() {
  if (window.T2AdminTheme && typeof window.T2AdminTheme.toggle === 'function') {
    return window.T2AdminTheme.toggle();
  }
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  document.documentElement.style.colorScheme = next;
  document.getElementById('theme-icon').textContent = next==='dark' ? 'light_mode' : 'dark_mode';
  return next;
}

// 설정 로드
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
  setVal('cfg-content-height', Math.max(200, Math.min(2000, parseInt(e.content_height, 10)||350)));
  // NSFW
  setCheck('cfg-nsfw-on', !!n.enabled);
  setCheck('cfg-nsfw-allow', n.allow_suspicious!==false);
  setSelect('cfg-nsfw-mode', n.mode||'browser');
  setVal('cfg-nsfw-backend', n.browser_backend_priority||'webgpu,webgl,wasm,cpu');
  // 플러그인 버튼 순서
  setVal('cfg-btn-order', (p.button_order||[]).join(','));
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

// 대시보드
// 라이선스
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
  } else {
    licEl.textContent = '확인 실패';
  }

  const r = await api('get_system_info');
  if (!r.ok) {
    document.getElementById('sys-info').innerHTML='<div class="alert alert-error"><span class="mi">error</span><span>'+escHtml(r.msg||'시스템 정보를 불러오지 못했습니다.')+'</span></div>';
    return;
  }
  const d = r.data, ext=d.extensions||{};
  const zipBackend=ext.ziparchive?'ZipArchive':(ext.zlib_deflate?'zlib':'Browser');
  const zipBrowser=zipBackend==='Browser';
  document.getElementById('sys-info').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;font-size:13px">
      <div><span style="color:var(--md-on-muted)">PHP 버전</span><br><strong>${escHtml(d.php_version||'-')}</strong></div>
      <div><span style="color:var(--md-on-muted)">에디터 URL</span><br><strong style="word-break:break-all">${escHtml(d.editor_url||'-')}</strong></div>
      <div><span style="color:var(--md-on-muted)">설정 파일</span><br><strong>${escHtml(d.settings_file||'-')}</strong></div>
      <div><span style="color:var(--md-on-muted)">data 쓰기</span><br><span class="badge ${d.data_writable?'badge-success':'badge-error'}">${d.data_writable?'가능':'불가'}</span></div>
      <div><span style="color:var(--md-on-muted)">런타임 JS</span><br><span class="badge ${d.runtime_js_present?'badge-success':'badge-error'}">${d.runtime_js_present?'정상':'누락'}</span></div>
    </div>
    <div class="system-extension-grid" aria-label="PHP 확장 라이브러리">
      <div class="system-extension-card"><span>cURL</span><strong>${ext.curl?'사용 가능':'없음'}</strong></div>
      <div class="system-extension-card"><span>GD</span><strong>${ext.gd?'사용 가능':'없음'}</strong></div>
      <div class="system-extension-card"><span>iconv</span><strong>${ext.iconv?'사용 가능':'없음'}</strong></div>
      <div class="system-extension-card ${zipBrowser?'browser':''}"><span>ZIP 처리</span><strong>${zipBackend}</strong>${zipBrowser?'<br><small>서버 확장 없음 · 관리자 브라우저 사용</small>':''}</div>
    </div>`;
}

// Extend 현황
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


// 업데이트·서드파티 서버 환경 진단
const T2ADMIN_AUTH_MODE = <?= json_encode($auth_mode, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?>;
const T2ADMIN_LOCAL_AUTH = T2ADMIN_AUTH_MODE.mode === 'local';
const ENVIRONMENT_API = 'environment_api.php';
let environmentState = {local:null, network:null};
async function environmentApi(action) {
  const timeout=action==='network'?18000:12000;
  return requestJson(ENVIRONMENT_API+'?action='+encodeURIComponent(action),{headers:{'Accept':'application/json'},cache:'no-store'},timeout,'환경 진단 API');
}
function environmentFeatureState(feature,network) {
  if(!feature||feature.available===false)return'unavailable';
  if((network&&network.checked&&!network.ok)||Number(feature.warning_count||0)>0)return'limited';
  return'available';
}
function environmentStatusBadge(state,network) {
  if(state==='available')return['badge-success','check_circle','사용 가능'];
  if(state==='limited')return['badge-warn','warning','사용 가능 · 확인 필요'];
  return['badge-error','cancel','사용 불가'];
}
function renderEnvironmentIssue(check) {
  const severity=check.ok?'success':(check.severity==='warning'?'warning':'error');
  const icon=check.ok?'check_circle':(severity==='warning'?'warning':'error');
  const browserFallback=check.id==='archive_reader'&&!check.ok;
  const fixes=(!check.ok&&Array.isArray(check.fixes)&&check.fixes.length)?`<ol class="env-fix-list">${check.fixes.map(f=>`<li>${escHtml(f)}</li>`).join('')}</ol>`:'';
  const backend=browserFallback?'<span class="badge badge-error" style="margin-left:auto">Browser</span>':'';
  return `<div class="env-issue ${severity}${browserFallback?' browser-fallback':''}"><div class="env-issue-title"><span class="mi">${icon}</span>${escHtml(check.label||'점검 항목')}${backend}</div><p>${escHtml(check.detail||'')}</p>${fixes}</div>`;
}
function renderEnvironmentFeature(key,feature,network) {
  const state=environmentFeatureState(feature,network),badge=environmentStatusBadge(state,network),icon=key==='updater'?'system_update_alt':'extension';
  const networkDisabled=!!(network&&network.disabled),networkCheck=feature.available!==false&&network&&network.checked?{label:'공식 서버 HTTPS 연결',ok:!!network.ok,severity:'error',detail:network.detail||'',fixes:network.fixes||[]}:null;
  const failures=(feature.checks||[]).filter(c=>!c.ok),passed=(feature.checks||[]).filter(c=>c.ok);
  const displayChecks=[...failures];
  if(networkCheck&&!networkCheck.ok)displayChecks.push(networkCheck);
  if(!displayChecks.length)displayChecks.push(...passed);
  let summary='필수 환경이 준비되어 있습니다.';
  if(state==='unavailable')summary=`<strong>${Number(feature.blocking_count||0)}개 필수 항목</strong>을 먼저 설정해야 합니다.`;
  else if(networkDisabled)summary='DSc 공식 API 연결이 꺼져 있어 공식 서버 점검 요청을 보내지 않았습니다. 활성화한 독립 저장소·마켓은 계속 사용할 수 있습니다.';
  else if(networkCheck&&!networkCheck.ok)summary='로컬 환경은 준비되었지만 공식 서버 연결에 실패했습니다. 커스텀 저장소·마켓은 별도로 연결될 수 있습니다.';
  else if(Number(feature.warning_count||0)>0)summary=`기능은 사용할 수 있으나 <strong>${Number(feature.warning_count||0)}개 권장 설정</strong>을 확인하세요.`;
  else if(networkCheck&&networkCheck.ok)summary='로컬 환경과 공식 서버 HTTPS 연결이 모두 정상입니다.';
  const open=state==='unavailable'?' open':'';
  return `<article class="env-feature-card ${state}" data-feature="${escHtml(key)}"><div class="env-feature-head"><div class="env-feature-name"><span class="mi">${icon}</span>${escHtml(feature.label||key)}</div><span class="badge ${badge[0]}"><span class="mi" style="font-size:13px;margin-right:3px">${badge[1]}</span>${badge[2]}</span></div><div class="env-feature-summary">${summary}</div><div class="env-check-count"><span>로컬 점검 ${Number(feature.passed||0)}/${Number(feature.total||0)}</span><span>·</span><span>공식 서버 ${feature.available===false?'로컬 설정 필요':(networkDisabled?'연결 꺼짐':(networkCheck?(networkCheck.ok?'연결됨':'연결 실패'):'확인 중'))}</span></div><details class="env-guide"${open}><summary><span class="mi" style="font-size:16px">settings</span>점검 결과와 서버 설정 방법</summary>${displayChecks.map(renderEnvironmentIssue).join('')}</details></article>`;
}
function renderEnvironmentStatus() {
  const el=document.getElementById('env-feature-grid'),guide=document.getElementById('env-general-guide');if(!el)return;
  const local=environmentState.local;
  if(!local||!local.features){el.innerHTML='<div class="env-loading"><span class="mi">error</span>서버 환경 정보를 표시할 수 없습니다.</div>';renderSectionEnvironmentNotices();return;}
  const network=environmentState.network||{};
  el.innerHTML=renderEnvironmentFeature('updater',local.features.updater,network.updater)+renderEnvironmentFeature('third_party',local.features.third_party,network.third_party);
  if(guide){const items=local.general_guidance||[],server=local.server||{},env=server.environment||{};guide.style.display=items.length?'block':'none';guide.innerHTML=items.length?`<details><summary>공통 서버 설정 주의사항</summary><div style="margin-top:8px;word-break:break-all"><strong>현재 환경</strong><br><code>${escHtml(env.label||env.id||'독립환경')}</code><br><strong>감지된 에디터 경로</strong><br><code>${escHtml(server.editor_path||'-')}</code><br><strong>공통 데이터 경로</strong><br><code>${escHtml(server.data_path||'-')}</code><br><strong>T2Editor 비공개 경로</strong><br><code>${escHtml(server.private_path||'-')}</code></div><ul>${items.map(x=>`<li>${escHtml(x)}</li>`).join('')}</ul></details>`:'';}
  renderSectionEnvironmentNotices();
}
async function loadEnvironmentStatus(forceNetwork=false) {
  const btn=document.getElementById('env-recheck-btn'),el=document.getElementById('env-feature-grid');
  if(btn)btn.disabled=true;
  if(forceNetwork&&el)el.innerHTML='<div class="env-loading"><div class="spinner"></div>서버 환경과 공식 서비스 연결을 다시 확인하고 있습니다.</div>';
  const local=await environmentApi('status');
  if(!local.ok){if(el)el.innerHTML='<div class="alert alert-error" style="grid-column:1/-1;margin:0"><span class="mi">error</span><span>'+escHtml(local.msg||'환경 진단에 실패했습니다.')+'</span></div>';if(btn)btn.disabled=false;return;}
  environmentState.local=local.data||{};environmentState.network=null;renderEnvironmentStatus();
  const network=await environmentApi('network');
  if(network.ok)environmentState.network=network.data||{};
  else environmentState.network={updater:{checked:true,ok:false,detail:network.msg||'공식 서버 연결 점검에 실패했습니다.',fixes:[]},third_party:{checked:true,ok:false,detail:network.msg||'공식 서버 연결 점검에 실패했습니다.',fixes:[]}};
  renderEnvironmentStatus();if(btn)btn.disabled=false;
}
function environmentFeatureAvailable(key){const f=environmentState.local?.features?.[key];return !f||f.available!==false;}
function renderSectionEnvironmentNotice(key) {
  const map={
    updater:{notice:'up-env-notice',content:'up-feature-content',label:'에디터 업데이트'},
    third_party:{notice:'tp-env-notice',content:'tp-feature-content',label:'마켓 설치'}
  };
  const cfg=map[key];if(!cfg)return true;
  const notice=document.getElementById(cfg.notice),content=document.getElementById(cfg.content),feature=environmentState.local?.features?.[key],network=environmentState.network?.[key];
  if(!notice||!content)return !feature||feature.available!==false;
  const state=feature?environmentFeatureState(feature,network):'available';
  const unavailable=state==='unavailable',limited=state==='limited';
  notice.className='alert '+(unavailable?'alert-error':'alert-warn')+' env-section-notice';
  notice.style.display=(unavailable||limited)?'flex':'none';
  notice.innerHTML=unavailable
    ?`<span class="mi" aria-hidden="true">block</span><span><strong>${escHtml(cfg.label)} 기능을 사용할 수 없습니다.</strong><br>필수 서버 설정이 완료되지 않았습니다. 자세한 점검 결과와 설정 방법은 <button type="button" class="env-dashboard-link" onclick="showSection('dashboard')">대시보드</button>에서 확인하세요.</span>`
    :(limited?`<span class="mi" aria-hidden="true">warning</span><span><strong>${escHtml(cfg.label)} 기능은 사용할 수 있지만 서버 환경 확인이 필요합니다.</strong><br>자세한 점검 결과와 설정 방법은 <button type="button" class="env-dashboard-link" onclick="showSection('dashboard')">대시보드</button>에서 확인하세요.</span>`:'');
  content.hidden=unavailable;
  return !unavailable;
}
function renderSectionEnvironmentNotices(){renderSectionEnvironmentNotice('updater');renderSectionEnvironmentNotice('third_party');}

let browserZipWarningResolver=null;
let browserZipActive=false;
function confirmBrowserZipFallback(fallback){
  const modal=document.getElementById('browser-zip-warning-modal'),info=document.getElementById('browser-zip-warning-package');
  if(!modal)return Promise.resolve(true);
  const packages=Array.isArray(fallback?.packages)?fallback.packages:[],files=packages.reduce((n,p)=>n+(Array.isArray(p.entries)?p.entries.length:0),0),bytes=packages.reduce((n,p)=>n+(Array.isArray(p.entries)?p.entries.reduce((sum,e)=>sum+Number(e.size||0),0):0),0);
  if(info)info.textContent=`처리 예정: ${packages.length}개 패키지 · ${files}개 파일 · ${formatCoreBytes(bytes)}`;
  modal.classList.add('open');
  return new Promise(resolve=>{browserZipWarningResolver=resolve;});
}
function resolveBrowserZipWarning(approved){
  document.getElementById('browser-zip-warning-modal')?.classList.remove('open');
  const resolve=browserZipWarningResolver;browserZipWarningResolver=null;if(resolve)resolve(!!approved);
}
window.addEventListener('beforeunload',event=>{if(!browserZipActive)return;event.preventDefault();event.returnValue='';});
function browserZipProgressText(done,total,path){
  const pct=total>0?Math.min(100,Math.round(done*100/total)):0;
  return `브라우저에서 ZIP 해제·검증 중... ${pct}%${path?' · '+path:''}`;
}
async function browserZipResponse(url,options,timeout,label,retries=0){
  let lastError;
  for(let attempt=0;attempt<=retries;attempt++){
    const controller=typeof AbortController==='function'?new AbortController():null;
    const opts={...options,credentials:'same-origin'};
    if(controller)opts.signal=controller.signal;
    let timer;
    const timeoutPromise=new Promise((_,reject)=>{
      timer=setTimeout(()=>{if(controller)controller.abort();const error=new Error(`${label} 시간이 초과되었습니다.`);error.name='TimeoutError';reject(error);},timeout);
    });
    try{
      const response=await Promise.race([fetch(url,opts),timeoutPromise]);
      if(!response.ok){const error=new Error(`${label} 실패 (HTTP ${response.status})`);error.httpStatus=response.status;throw error;}
      return response;
    }catch(error){
      lastError=error;
      const retryable=!error?.httpStatus||error.httpStatus>=500;
      if(attempt<retries&&retryable){await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));continue;}
      if(error&&(error.name==='AbortError'||error.name==='TimeoutError'))throw new Error(`${label} 시간이 초과되었습니다.`);
      throw error;
    }finally{clearTimeout(timer);}
  }
  throw lastError||new Error(`${label} 실패`);
}

async function runBrowserZipFallback(apiBase,fallback,onProgress){
  if(!await confirmBrowserZipFallback(fallback))throw new Error('브라우저 ZIP 처리를 취소했습니다.');
  browserZipActive=true;
  try{
    if(typeof JSZip==='undefined')throw new Error('브라우저 ZIP 처리 모듈을 불러오지 못했습니다.');
    const packages=Array.isArray(fallback?.packages)?fallback.packages:[];
    const total=packages.reduce((sum,p)=>sum+(Array.isArray(p.entries)?p.entries.reduce((n,e)=>n+Number(e.size||0),0):0),0);
    let done=0;
    for(const pkg of packages){
      onProgress?.(browserZipProgressText(done,total,'ZIP 다운로드'));
      const archiveResponse=await browserZipResponse(pkg.archive_url,{headers:{Accept:'application/zip'}},600000,'ZIP 다운로드',1);
      const buffer=await archiveResponse.arrayBuffer();
      if(Number(pkg.archive_bytes||0)>0&&buffer.byteLength!==Number(pkg.archive_bytes))throw new Error('브라우저가 받은 ZIP 크기가 서버 원본과 다릅니다.');
      const zip=await JSZip.loadAsync(buffer,{checkCRC32:false,createFolders:false});
      for(const entry of pkg.entries||[]){
        const zipEntry=zip.file(entry.zip_name);
        if(!zipEntry||zipEntry.dir)throw new Error(`ZIP에서 파일을 찾지 못했습니다: ${entry.path}`);
        onProgress?.(browserZipProgressText(done,total,entry.path));
        const bytes=await zipEntry.async('uint8array');
        if(bytes.byteLength!==Number(entry.size||0))throw new Error(`ZIP 해제 크기가 일치하지 않습니다: ${entry.path}`);
        const chunkSize=Math.min(524288,Math.max(262144,Number(fallback.chunk_bytes||524288)));
        if(bytes.byteLength===0){
          const qs=new URLSearchParams({action:'browser_upload',job_id:fallback.job_id,role:pkg.role,token:fallback.token,entry:String(entry.index),offset:'0'});
          const response=await browserZipResponse(apiBase+'?'+qs.toString(),{method:'POST',headers:{Accept:'application/json','Content-Type':'application/octet-stream','X-T2Admin-CSRF':CSRF},body:new Uint8Array(0)},180000,'빈 파일 전송',1);
          const result=await response.json();if(!result.ok)throw new Error(result.msg||'빈 파일 전송에 실패했습니다.');
        }else{
          for(let offset=0;offset<bytes.byteLength;offset+=chunkSize){
            const chunk=bytes.subarray(offset,Math.min(bytes.byteLength,offset+chunkSize));
            const qs=new URLSearchParams({action:'browser_upload',job_id:fallback.job_id,role:pkg.role,token:fallback.token,entry:String(entry.index),offset:String(offset)});
            const response=await browserZipResponse(apiBase+'?'+qs.toString(),{method:'POST',headers:{Accept:'application/json','Content-Type':'application/octet-stream','X-T2Admin-CSRF':CSRF},body:chunk},180000,'파일 전송',1);
            const result=await response.json();if(!result.ok)throw new Error(result.msg||'파일 전송에 실패했습니다.');
          }
        }
        done+=bytes.byteLength;
        onProgress?.(browserZipProgressText(done,total,entry.path));
      }
    }
    onProgress?.('서버에서 브라우저 압축 해제 결과를 최종 검증하는 중...');
    return requestJson(apiBase+'?action=browser_finalize',{method:'POST',headers:{'Content-Type':'application/json','X-T2Admin-CSRF':CSRF},body:JSON.stringify({job_id:fallback.job_id,token:fallback.token})},300000,'브라우저 ZIP 최종 검증');
  }finally{browserZipActive=false;}
}

// T2Editor 에디터 안전 업데이트
const UPDATE_API = 'update_api.php';
let upState = {stores:[], latest:null, versions:[], plan:null, pending:null, currentVersion:'', installMode:{core:'data',third_party:'data'}, capabilities:{}, dataReleases:[]};
async function updateApi(action, method='GET', body=null, query={}) { const qs=new URLSearchParams({action,...query});const opts={method,headers:{'Accept':'application/json'}};if(method==='POST'){opts.headers['Content-Type']='application/json';opts.headers['X-T2Admin-CSRF']=CSRF;opts.body=JSON.stringify(body||{});}return requestJson(UPDATE_API+'?'+qs.toString(),opts,method==='POST'?120000:20000,'업데이트 API'); }
function formatCoreBytes(value){const n=Number(value||0);if(!Number.isFinite(n)||n<=0)return '정보 없음';const units=['B','KB','MB','GB'];let v=n,i=0;while(v>=1024&&i<units.length-1){v/=1024;i++;}return (i===0?Math.round(v):v.toFixed(v>=100?0:v>=10?1:2))+' '+units[i];}
function t2VersionMajor(value){const m=String(value||'').trim().match(/^v?([0-9]+)(?:\.|$)/i);if(!m)return null;const major=Number(m[1]);return Number.isInteger(major)&&major>0?major:null;}
function t2MajorVersionMismatch(currentVersion,targetVersion){const currentMajor=t2VersionMajor(currentVersion),targetMajor=t2VersionMajor(targetVersion);return currentMajor!==null&&targetMajor!==null&&currentMajor!==targetMajor;}
function t2MajorVersionWarningText(currentVersion,targetVersion,subject='설치 대상'){return `현재 T2Editor ${currentVersion||'-'}와 ${subject} ${targetVersion||'-'}의 메이저 버전이 다릅니다. 메이저 버전 변경은 플러그인, CMS 연동 및 저장 데이터의 호환성에 영향을 줄 수 있습니다. 변경사항과 백업 가능 여부를 확인한 뒤 계속하세요.`;}
function coreRelationBadge(relation){const map={newer:['badge-success','업데이트 가능'],current:['badge-primary','현재 설치됨'],older:['badge-muted','이전 버전']};return map[relation]||['badge-muted','버전'];}
function coreCompareVersionDesc(a,b){return -tpCompareVersion(String(a?.version||''),String(b?.version||''));}
function coreVersionMajorGroup(version){const currentMajor=t2VersionMajor(upState.currentVersion),targetMajor=t2VersionMajor(version);if(currentMajor===null||targetMajor===null)return 'unknown';return currentMajor===targetMajor?'current':'other';}
function renderCoreReleaseInfo(v, options={}){
  const relation=options.relation||v.relation||'',defaultBadge=coreRelationBadge(relation),badge=options.badge||defaultBadge,changes=(v.changes||v.description||v.release_notes||v.title||'업데이트 내용이 제공되지 않았습니다.');
  const operation=relation==='current'?'reinstall':'update',buttonLabel=options.buttonLabel||(operation==='reinstall'?'현재 버전 재설치 계획 검토':relation==='older'?'이 버전으로 변경 계획 검토':'이 버전 업데이트 계획 검토'),title=v.title&&v.title!==v.version?v.title:'';
  const majorWarning=t2MajorVersionMismatch(upState.currentVersion,v.version)?`<div class="alert alert-warn" style="margin-top:12px"><span class="mi">warning</span><span><strong>메이저 버전이 다릅니다.</strong><br>${escHtml(t2MajorVersionWarningText(upState.currentVersion,v.version,'선택한 버전'))}</span></div>`:'';
  const recommendation=options.recommended?`<div class="alert alert-info" style="margin-top:12px"><span class="mi">recommend</span><span><strong>현재 메이저 버전의 권장 최신버전입니다.</strong><br>일반 업데이트에서는 이 버전까지만 자동으로 권장합니다.</span></div>`:'';
  return `<article class="up-release-card" role="listitem"><div class="up-release-head"><div><div class="up-release-title">${escHtml(v.version||'-')} <span class="badge ${badge[0]}">${escHtml(badge[1])}</span></div>${title?`<div class="up-release-subtitle">${escHtml(title)}</div>`:''}</div><div class="up-release-actions"><button class="btn btn-primary btn-sm" data-version="${escHtml(v.version||'')}" data-operation="${operation}" onclick="prepareCoreUpdatePlan(this.dataset.version,this.dataset.operation)"><span class="mi" style="font-size:16px">${operation==='reinstall'?'restart_alt':'fact_check'}</span>${escHtml(buttonLabel)}</button></div></div><div class="up-release-meta"><div><small>버전 명</small><strong>${escHtml(v.version||'-')}</strong></div><div><small>배포일</small><strong>${escHtml(v.release_date||'정보 없음')}</strong></div><div><small>용량</small><strong>${escHtml(formatCoreBytes(v.size_bytes))}</strong></div></div>${recommendation}${majorWarning}<details class="up-release-notes"><summary><span class="mi" style="font-size:16px">description</span><span class="when-closed">버전 내용 펼치기</span><span class="when-open">버전 내용 접기</span></summary><div class="up-release-notes-body">${escHtml(changes)}</div></details></article>`;
}
async function loadCoreUpdater(){
  const summary=document.getElementById('up-current-summary'),latest=document.getElementById('up-latest');if(!environmentState.local)await loadEnvironmentStatus(false);if(!renderSectionEnvironmentNotice('updater'))return;
  if(summary)summary.innerHTML='<div><small>현재 버전</small><strong>확인 중...</strong></div>';if(latest)latest.innerHTML='<div class="tp-loading"><div class="spinner"></div> 현재 메이저 버전의 권장 최신버전을 확인하고 있습니다.</div>';
  const r=await updateApi('status');if(!r.ok){if(summary)summary.innerHTML='<div class="alert alert-error"><span class="mi">error</span>'+escHtml(r.msg)+'</div>';if(latest)latest.innerHTML='<div class="alert alert-error"><span class="mi">error</span>업데이트 상태를 확인하지 못했습니다.</div>';return;}
  const d=r.data||{};upState.stores=d.stores||[];upState.currentVersion=d.current_version||'';upState.installMode=d.install_mode||{core:'data',third_party:'data'};upState.capabilities=d.capabilities||{};upState.dataReleases=d.data_releases||[];
  const coreMode=document.getElementById('up-core-mode'),thirdMode=document.getElementById('up-third-party-mode');if(coreMode)coreMode.value=upState.installMode.core||'data';if(thirdMode)thirdMode.value=upState.installMode.third_party||'data';renderCoreModeStatus();
  const archiveMode=d.capabilities?.archive?.selected||'',archiveLabel=archiveMode==='ziparchive'?'ZipArchive':(archiveMode==='pure_php_deflate'?'zlib':(archiveMode==='browser'?'Browser':'사용 불가'));
  if(summary)summary.innerHTML=`<div><small>현재 버전</small><strong>${escHtml(d.current_version||'-')}</strong></div><div><small>현재 설치 방식</small><strong>${upState.installMode.core==='data'?'공용 데이터 폴더':'직접 설치'}</strong></div><div><small>PHP</small><strong>${escHtml(d.php_version||'-')}</strong></div><div><small>전송 방식</small><strong>${escHtml(d.capabilities?.transport?.selected||'사용 불가')}</strong></div><div class="${archiveMode==='browser'?'browser-archive':''}"><small>ZIP 처리</small><strong>${archiveLabel}</strong>${archiveMode==='browser'?'<br><small>서버 확장 없음</small>':''}</div>`;
  renderCoreCapabilityWarnings(d.capabilities||{});renderCoreStores();renderCoreDataReleases(d.data_releases||[]);renderCoreBackups(d.backups||[]);await checkCoreUpdate(true);
}
function renderCoreModeStatus(){
  const el=document.getElementById('up-mode-status'),fs=upState.capabilities?.filesystem||{},core=upState.installMode?.core||'data';if(!el)return;
  el.innerHTML=`공용 데이터 설치: <strong>${fs.data_install_supported?'사용 가능':'사용 불가'}</strong> · 직접 설치: <strong>${fs.direct_install_supported?'사용 가능':'사용 불가'}</strong> · 선택됨: <strong>${core==='data'?'공용 데이터 폴더':'T2Editor 실제 폴더'}</strong>`;
}
function renderCoreCapabilityWarnings(cap){
  const el=document.getElementById('up-capability-warnings');if(!el)return;const warnings=[...(cap.warnings||[])],envNotice=document.getElementById('up-env-notice'),envVisible=envNotice&&envNotice.style.display!=='none';
  if(!warnings.length||envVisible){el.style.display='none';el.innerHTML='';return;}el.style.display='block';el.innerHTML=warnings.map(w=>`<div class="alert alert-warn"><span class="mi">warning</span><span><strong>${escHtml(w.title||'서버 환경 확인 필요')}</strong><br>${escHtml(w.message||'대시보드에서 설정 상태를 확인하세요.')}</span></div>`).join('');
}
function providerDomain(row){
  const declared=String((row&&row.domain)||'').trim().toLowerCase();
  if(declared&&/^[a-z0-9.-]+$/.test(declared))return declared;
  try{return new URL(String((row&&row.url)||'')).hostname.toLowerCase();}catch(e){return '';}
}
function certifiedProviderBadgeHtml(){
  return '<span class="certified-provider-badge" role="img" aria-label="인증된 제공자"><span class="mi" aria-hidden="true">verified</span><span>Certified Provider</span></span>';
}
function providerIdentityHtml(row,displayName,options={}){
  const domain=providerDomain(row)||'도메인 확인 불가',certified=options.certified===true,official=options.official===true;
  const trust=certified?certifiedProviderBadgeHtml():(official?'<span class="official-provider-badge">DSc 공식</span>':(options.unverified?'<span class="unverified-provider-badge">미인증 연결</span>':''));
  const endpoint=options.showEndpoint===false?'':`<div class="provider-endpoint">${escHtml((row&&row.url)||'')}</div>`;
  return `<div class="provider-identity"><div class="provider-name-line"><strong>${escHtml(displayName||domain)}</strong>${official?trust:''}</div><div class="provider-domain-line"><span>${escHtml(domain)}</span>${official?'':trust}</div>${endpoint}</div>`;
}
function renderCoreStores(){
  const officialEl=document.getElementById('up-store-official'),certEl=document.getElementById('up-store-certified'),rows=document.getElementById('up-store-rows'),select=document.getElementById('up-store-select');
  if(!officialEl||!certEl||!rows||!select)return;
  const stores=upState.stores||[],previous=select.value;
  const official=stores.filter(s=>s.group==='official');
  const certified=stores.filter(s=>s.group==='certified');
  const custom=stores.filter(s=>s.group!=='official'&&s.group!=='certified');
  officialEl.innerHTML=official.map(s=>`<div class="official-row ${s.enabled?'':'api-off'}"><div class="api-provider-block">${providerIdentityHtml(s,s.name||'DSc T2Editor Store',{official:true})}<div class="api-control-note">${s.enabled?'DSc 업데이트·인증 저장소 API 연결 허용':'DSc 업데이트·인증 저장소 API 요청 차단됨'}</div></div><label class="toggle" title="DSc 에디터 업데이트 API 사용"><input type="checkbox" class="up-official-enabled" ${s.enabled?'checked':''} aria-label="DSc 에디터 업데이트 API 사용"><span class="toggle-track"></span><span class="toggle-thumb"></span></label></div>`).join('');
  certEl.innerHTML=certified.length?certified.map(s=>`<div class="cert-row">${providerIdentityHtml(s,s.name||providerDomain(s),{certified:true})}<label class="toggle" title="활성화"><input type="checkbox" class="up-cert-enabled" data-id="${escHtml(s.id)}" ${s.enabled?'checked':''}><span class="toggle-track"></span><span class="toggle-thumb"></span></label></div>`).join(''):'<div class="tp-empty">현재 인증된 서드파티 저장소가 없습니다.</div>';
  rows.innerHTML=custom.map((s,i)=>`<div class="up-store-row"><input class="form-control up-store-name" value="${escHtml(s.name||'')}" aria-label="저장소 이름"><input class="form-control up-store-url" value="${escHtml(s.url||'')}" aria-label="저장소 API URL"><label class="toggle" title="활성화"><input type="checkbox" class="up-store-enabled" ${s.enabled?'checked':''}><span class="toggle-track"></span><span class="toggle-thumb"></span></label><button class="btn btn-outline btn-sm" onclick="testCoreStoreRow(this)">연결 확인</button></div>`).join('');
  select.innerHTML=stores.filter(s=>s.enabled).map(s=>`<option value="${escHtml(s.id)}">${escHtml(s.name||s.url)}${s.group==='official'?' (공식)':(s.group==='certified'?' (인증됨)':'')}</option>`).join('');
  if(previous&&[...select.options].some(o=>o.value===previous))select.value=previous;
  select.onchange=handleCoreStoreChange;
}
function handleCoreStoreChange(){upState.latest=null;upState.versions=[];const list=document.getElementById('up-version-list');if(list)list.innerHTML='<div class="tp-empty">저장소가 변경되었습니다. 고급 옵션에서 버전 목록을 다시 불러옵니다.</div>';checkCoreUpdate();if(document.getElementById('up-advanced-check')?.checked)loadCoreVersionList();}
function addCoreStoreRow(){upState.stores=upState.stores||[];upState.stores.push({id:'store-'+Date.now(),name:'새 저장소',url:'https://',enabled:true,official:false,certified:false,group:'custom'});renderCoreStores();}
function collectCoreStores(){const custom=(upState.stores||[]).filter(s=>s.group!=='official'&&s.group!=='certified');return [...document.querySelectorAll('#up-store-rows .up-store-row')].map((row,i)=>({id:(custom[i]&&custom[i].id)||('store-'+i),name:row.querySelector('.up-store-name').value.trim(),url:row.querySelector('.up-store-url').value.trim(),enabled:row.querySelector('.up-store-enabled').checked}));}
function collectCoreCertifiedDisabled(){return [...document.querySelectorAll('#up-store-certified .up-cert-enabled')].filter(cb=>!cb.checked).map(cb=>cb.dataset.id);}
function collectCoreOfficialEnabled(){return document.querySelector('#up-store-official .up-official-enabled')?.checked!==false;}
async function saveCoreStores(){const r=await updateApi('save_stores','POST',{stores:collectCoreStores(),certified_disabled:collectCoreCertifiedDisabled(),official_enabled:collectCoreOfficialEnabled()});if(!r.ok){toast(r.msg,'error');return;}upState.stores=r.data||[];renderCoreStores();toast(r.msg||'저장소를 저장했습니다.','success');await loadEnvironmentStatus(false);await checkCoreUpdate(true);}
async function testCoreStoreRow(btn){const row=btn.closest('.up-store-row'),url=row.querySelector('.up-store-url').value.trim();btn.disabled=true;const old=btn.textContent;btn.textContent='확인 중';const r=await updateApi('test_store','POST',{url});btn.disabled=false;btn.textContent=old;toast(r.ok?(r.msg||'호환 저장소입니다.'):(r.msg||'연결 실패'),r.ok?'success':'error');}
async function checkCoreUpdate(automatic=false){
  const store=document.getElementById('up-store-select')?.value||'',btn=document.getElementById('up-check-btn'),el=document.getElementById('up-latest');if(!el)return;if(!store){el.innerHTML='<div class="alert alert-error"><span class="mi">error</span>활성 업데이트 저장소가 없습니다.</div>';if(!automatic)toast('활성 저장소가 없습니다.','warn');return;}
  if(btn)btn.disabled=true;el.innerHTML='<div class="tp-loading"><div class="spinner"></div> 현재 메이저 버전의 권장 최신버전을 확인 중...</div>';const r=await updateApi('check','GET',null,{store_id:store});if(btn)btn.disabled=false;if(!r.ok){el.innerHTML='<div class="alert alert-error"><span class="mi">error</span>'+escHtml(r.msg)+'</div>';return;}
  upState.latest=r.data;const d=r.data||{},recommended=d.recommended_latest||null,repositoryLatest=d.repository_latest||d.latest||null;let cls='alert-success',icon='check_circle',message='현재 메이저 버전의 권장 최신버전을 사용 중입니다.';
  if(d.status==='update_available'){cls='alert-warn';icon='system_update_alt';message='현재 메이저 버전에서 권장 업데이트가 있습니다.';}else if(d.status==='ahead'){cls='alert-info';icon='info';message='현재 설치 버전이 현재 메이저의 권장 최신버전보다 높습니다.';}else if(d.status==='unavailable'||!recommended){cls='alert-info';icon='info';message='현재 메이저 버전에서 권장할 수 있는 릴리스를 찾지 못했습니다.';}
  const relation=d.status==='update_available'?'newer':d.status==='ahead'?'older':'current',reinstall=`<button class="btn btn-outline" onclick="prepareCoreUpdatePlan('${escHtml(d.current_version||'')}','reinstall')"><span class="mi" style="font-size:17px">restart_alt</span> 현재 버전 재설치</button>`;
  const recommendedVersion=recommended&&recommended.version?recommended.version:'없음';
  const statusBanner=`<div class="alert ${cls} up-status-banner"><span class="mi">${icon}</span><span><strong>${escHtml(message)}</strong><br>현재 ${escHtml(d.current_version||'-')} · 권장 최신 ${escHtml(recommendedVersion)}</span></div>`;
  const listWarning=d.version_list_warning?`<div class="alert alert-warn"><span class="mi">warning</span><span>${escHtml(d.version_list_warning)} 저장소의 전체 버전 목록을 다시 불러온 뒤 확인하세요.</span></div>`:'';
  const majorUpgrade=d.major_upgrade_available&&repositoryLatest&&t2MajorVersionMismatch(d.current_version,repositoryLatest.version)?`<div class="alert alert-info up-major-upgrade-notice"><span class="mi">upgrade</span><span><strong>새 메이저 버전 ${escHtml(repositoryLatest.version||'-')}도 배포되어 있습니다.</strong><br>새 메이저 버전은 자동 권장 대상에서 제외됩니다. 변경사항과 호환성을 검토하려면 고급 옵션의 ‘다른 메이저 버전’ 목록을 여세요.<br><button type="button" class="env-dashboard-link" onclick="openCoreAdvancedVersions()">고급 버전 목록 열기</button></span></div>`:'';
  const recommendedButtonLabel=d.status==='update_available'?'권장 최신버전 업데이트 계획 검토':(d.status==='ahead'?'권장 버전으로 변경 계획 검토':'권장 최신버전 재설치 계획 검토');
  const recommendedCard=recommended?renderCoreReleaseInfo(recommended,{relation,badge:['badge-success',d.status==='update_available'?'권장 업데이트':'권장 최신'],recommended:true,buttonLabel:recommendedButtonLabel}):'';
  el.innerHTML=statusBanner+listWarning+majorUpgrade+`<div class="up-actions" style="margin-bottom:12px">${reinstall}</div>`+recommendedCard;
}
function openCoreAdvancedVersions(){const c=document.getElementById('up-advanced-check'),p=document.getElementById('up-advanced-panel');if(c)c.checked=true;if(p){p.style.display='block';p.scrollIntoView({behavior:'smooth',block:'start'});}if(!upState.versions.length)loadCoreVersionList();}
function toggleCoreAdvanced(){const p=document.getElementById('up-advanced-panel'),c=document.getElementById('up-advanced-check');if(!p)return;p.style.display=(c&&c.checked)?'block':'none';if(c&&c.checked&&!upState.versions.length)loadCoreVersionList();}
function renderCoreVersionGroups(versions){
  const sorted=[...versions].sort(coreCompareVersionDesc),sameMajor=sorted.filter(v=>coreVersionMajorGroup(v.version)==='current'),otherMajor=sorted.filter(v=>coreVersionMajorGroup(v.version)==='other'),unknown=sorted.filter(v=>coreVersionMajorGroup(v.version)==='unknown');
  const currentMajor=t2VersionMajor(upState.currentVersion),sections=[];
  if(sameMajor.length)sections.push(`<section class="up-version-group"><div class="up-version-group-head"><div><strong>현재 메이저 버전 ${currentMajor!==null?escHtml(String(currentMajor))+'.x':'계열'}</strong><span>권장 최신버전과 이전 릴리스</span></div><span class="badge badge-success">기본 호환 계열</span></div>${sameMajor.map(v=>renderCoreReleaseInfo(v,{relation:v.relation})).join('')}</section>`);
  if(otherMajor.length)sections.push(`<section class="up-version-group up-version-group-major"><div class="up-version-group-head"><div><strong>다른 메이저 버전</strong><span>자동 권장하지 않는 메이저 업그레이드·다운그레이드</span></div><span class="badge badge-warn">고급 선택</span></div><div class="alert alert-warn"><span class="mi">warning</span><span><strong>메이저 버전 변경은 수동 선택 항목입니다.</strong><br>플러그인, CMS 연동, 저장 데이터의 호환성과 복구 방법을 확인한 뒤 선택하세요.</span></div>${otherMajor.map(v=>renderCoreReleaseInfo(v,{relation:v.relation})).join('')}</section>`);
  if(unknown.length)sections.push(`<section class="up-version-group"><div class="up-version-group-head"><div><strong>버전 계열 확인 필요</strong><span>메이저 버전을 판별하지 못한 릴리스</span></div><span class="badge badge-muted">확인 필요</span></div>${unknown.map(v=>renderCoreReleaseInfo(v,{relation:v.relation})).join('')}</section>`);
  return sections.join('');
}
async function loadCoreVersionList(){const store=document.getElementById('up-store-select')?.value||'',el=document.getElementById('up-version-list'),btn=document.getElementById('up-version-refresh');if(!el)return;if(!store){el.innerHTML='<div class="alert alert-error"><span class="mi">error</span>활성 저장소가 없습니다.</div>';return;}if(btn)btn.disabled=true;el.innerHTML='<div class="tp-loading"><div class="spinner"></div> 버전별 배포 정보를 불러오는 중...</div>';const r=await updateApi('list','GET',null,{store_id:store});if(btn)btn.disabled=false;if(!r.ok){el.innerHTML='<div class="alert alert-error"><span class="mi">error</span>'+escHtml(r.msg)+'</div>';return;}const versions=(r.data&&r.data.versions)||[];upState.versions=versions;if(!versions.length){el.innerHTML='<div class="tp-empty">사용 가능한 버전이 없습니다.</div>';return;}el.innerHTML=renderCoreVersionGroups(versions);}
async function prepareCoreUpdatePlan(version,operation='update'){
  const storeId=document.getElementById('up-store-select')?.value||(upState.latest&&upState.latest.store&&upState.latest.store.id)||'',ver=version||(upState.latest&&upState.latest.recommended_latest&&upState.latest.recommended_latest.version)||(upState.latest&&upState.latest.latest&&upState.latest.latest.version);if(!storeId||!ver){toast('버전을 먼저 확인하거나 선택하세요.','warn');return;}
  const majorVersionMismatch=t2MajorVersionMismatch(upState.currentVersion,ver);
  if(majorVersionMismatch&&!window.confirm(t2MajorVersionWarningText(upState.currentVersion,ver,'설치하려는 버전')+'\n\n계속해서 업데이트 계획을 검토하시겠습니까?'))return;
  const el=document.getElementById('up-plan'),mode=upState.installMode?.core||'data';el.innerHTML=`<div class="tp-loading"><div class="spinner"></div> 배포 ZIP 다운로드·검증 후 ${mode==='data'?'새 릴리스 슬롯':'3-way 직접 설치'} 계획을 만드는 중...</div>`;el.scrollIntoView({behavior:'smooth',block:'start'});
  try{
    let r=await updateApi('plan','POST',{store_id:storeId,version:ver,file_index:0,operation,major_version_warning_ack:majorVersionMismatch});
    if(r.ok&&r.data?.browser_fallback_required){
      r=await runBrowserZipFallback(UPDATE_API,r.data,text=>{el.innerHTML='<div class="tp-loading"><div class="spinner"></div> '+escHtml(text)+'</div>';});
    }
    if(!r.ok){el.innerHTML='<div class="alert alert-error"><span class="mi">error</span>'+escHtml(r.msg)+'</div>';return;}
    upState.plan=r.data;renderCorePlan();
  }catch(error){el.innerHTML='<div class="alert alert-error"><span class="mi">error</span>'+escHtml(error?.message||'브라우저 ZIP 처리에 실패했습니다.')+'</div>';}
}
function coreStatusBadge(status){const map={conflict:['badge-warn','3-way 충돌'],conflict_removed:['badge-warn','공식 삭제 충돌'],conflict_missing:['badge-warn','내 삭제와 충돌'],preserve:['badge-success','내 수정 자동 보존'],update:['badge-primary','공식 업데이트'],add:['badge-success','공식 추가'],delete:['badge-error','공식 삭제']};return map[status]||['badge-muted',status];}
function renderCoreDiff(diff,title='코드 변경사항 보기'){if(!diff||!Array.isArray(diff.lines)||!diff.lines.length)return '';const rows=diff.lines.map(line=>{const type=['add','delete','context','skip'].includes(line.type)?line.type:'context',sign=type==='add'?'+':type==='delete'?'-':type==='skip'?'…':' ',oldNo=line.old_line===null||line.old_line===undefined?'':String(line.old_line),newNo=line.new_line===null||line.new_line===undefined?'':String(line.new_line),text=line.text===''?' ':String(line.text||'');return `<div class="up-diff-row ${type}"><span class="up-diff-old">${escHtml(oldNo)}</span><span class="up-diff-new">${escHtml(newNo)}</span><span class="up-diff-sign">${escHtml(sign)}</span><span class="up-diff-code">${escHtml(text)}</span></div>`;}).join('');const trunc=diff.truncated?' · 일부만 표시':'';return `<details class="up-code-diff-wrap"><summary>${escHtml(title)} · <span style="color:#1b7f37">+${Number(diff.additions||0)}</span> <span style="color:#cf222e">-${Number(diff.deletions||0)}</span>${trunc}</summary><div class="up-code-diff" role="region" aria-label="${escHtml(title)}">${rows}</div></details>`;}
function renderCorePlan(){
  const p=upState.plan||{},el=document.getElementById('up-plan'),ops=p.operations||[],c=p.counts||{},majorWarning=t2MajorVersionMismatch(p.current_version,p.version)?`<div class="alert alert-warn"><span class="mi">warning</span><span><strong>메이저 버전 변경을 적용하려고 합니다.</strong><br>${escHtml(t2MajorVersionWarningText(p.current_version,p.version,'대상 버전'))}</span></div>`:'';
  if(p.install_mode==='data'){
    const verb=p.operation==='reinstall'?'재설치':'업데이트',warning=p.warning?`<div class="alert alert-warn"><span class="mi">warning</span><span>${escHtml(p.warning)}</span></div>`:'';
    el.innerHTML=`<div class="up-summary" style="margin-bottom:14px"><div><small>현재 버전</small><strong>${escHtml(p.current_version||'-')}</strong></div><div><small>대상 버전</small><strong>${escHtml(p.version||'-')}</strong></div><div><small>설치 방식</small><strong>공용 데이터 릴리스 슬롯</strong></div><div><small>예정 릴리스 ID</small><strong>${escHtml(p.release_id_preview||'-')}</strong></div><div><small>검증 파일</small><strong>${Number(c.total||0)}개</strong></div><div><small>작업</small><strong>${verb}</strong></div></div>${majorWarning}<div class="alert alert-info"><span class="mi">swap_horiz</span><span><strong>원본 코어 파일을 덮어쓰지 않습니다.</strong><br>전체 배포본을 새 불변 슬롯에 설치하고 정적 자산만 공개 데이터 경로에 투영한 뒤 활성 포인터를 전환합니다. data와 관리자 키 파일은 제외됩니다.</span></div>${warning}<div class="up-actions" style="margin-top:14px"><button class="btn btn-primary" onclick="openCoreUpdatePasswordModal('apply')"><span class="mi" style="font-size:17px">${p.operation==='reinstall'?'restart_alt':'system_update_alt'}</span> 데이터 슬롯 ${verb} 적용</button><span class="form-hint">문제가 생기면 이전 릴리스 포인터로 빠르게 되돌릴 수 있습니다.</span></div>`;return;
  }
  const conflictCount=Number(c.conflict||0),userModifiedCount=Number(c.user_modified||0),bulkEnabled=userModifiedCount>5&&conflictCount>0,staged=p.incremental_stage||{};
  const summary=`<div class="up-summary" style="margin-bottom:14px"><div><small>비교 기준 원본</small><strong>${escHtml(p.baseline_version||p.current_version||'-')}</strong></div><div><small>대상 버전</small><strong>${escHtml(p.version||'-')}</strong></div><div><small>설치 방식</small><strong>실제 폴더 직접 설치</strong></div><div><small>사용자 수정 감지</small><strong>${Number(c.user_modified||0)}</strong></div><div><small>공식 변경 감지</small><strong>${Number(c.official_changed||0)}</strong></div><div><small>겹치는 충돌</small><strong>${conflictCount}</strong></div><div><small>자동 보존</small><strong>${Number(c.preserve||0)}</strong></div><div><small>실제 적용 예정</small><strong id="up-incremental-count">계산 중</strong></div><div><small>증분 준비 파일</small><strong>${Number(staged.files||0)}개 · ${Number(staged.bytes||0)>0?formatCoreBytes(staged.bytes):'0 B'}</strong></div></div>`,threeWay=`<div class="alert alert-info up-three-way-note"><span class="mi">difference</span><span><strong>3-way 비교 + 직접 적용</strong>공식 원본과 현재 설치 파일을 비교한 뒤 실제 변경 파일만 T2Editor 폴더에 반영합니다. data와 관리자 키 파일은 제외합니다.</span></div>`,warning=p.warning?`<div class="alert alert-warn"><span class="mi">warning</span><span>${escHtml(p.warning)}</span></div>`:'';
  const bulk=bulkEnabled?`<div class="up-bulk"><label><input type="checkbox" id="up-conflict-all" onchange="toggleAllCoreConflictChecks(this.checked)"> 사용자 수정 5개 초과 · 충돌 파일 전체 선택 <span id="up-conflict-selected">0/${conflictCount}</span></label><button class="btn btn-outline btn-sm" onclick="applyCoreBulkChoice('keep')">선택 파일: 내 수정 유지</button><button class="btn btn-primary btn-sm" onclick="applyCoreBulkChoice('incoming')">선택 파일: 업데이트 버전 적용</button></div>`:'';
  const files=ops.length?`<div class="up-plan-list">${ops.map(op=>{const b=coreStatusBadge(op.status),conflict=['conflict','conflict_removed','conflict_missing'].includes(op.status),check=bulkEnabled&&conflict?`<input type="checkbox" class="up-conflict-check" data-path="${escHtml(op.path)}" aria-label="${escHtml(op.path)} 선택" onchange="updateCoreBulkSelectionCount()">`:'';let choices='';if(op.status==='conflict')choices=`<div class="up-choice-wrap"><select class="form-control up-choice" style="width:auto" data-path="${escHtml(op.path)}" data-incoming-action="replace" onchange="updateCoreIncrementalEstimate()"><option value="keep" selected>내 수정 유지</option><option value="replace">업데이트 버전으로 교체</option></select></div>`;else if(op.status==='conflict_removed')choices=`<div class="up-choice-wrap"><select class="form-control up-choice" style="width:auto" data-path="${escHtml(op.path)}" data-incoming-action="delete" onchange="updateCoreIncrementalEstimate()"><option value="keep" selected>내 수정 파일 유지</option><option value="delete">업데이트에 맞춰 삭제</option></select></div>`;else if(op.status==='conflict_missing')choices=`<div class="up-choice-wrap"><select class="form-control up-choice" style="width:auto" data-path="${escHtml(op.path)}" data-incoming-action="replace" onchange="updateCoreIncrementalEstimate()"><option value="keep" selected>내 삭제 상태 유지</option><option value="replace">업데이트 파일로 복원</option></select></div>`;else if(op.status==='preserve')choices='<span class="form-hint">공식 변경과 겹치지 않아 자동 보존</span>';else choices=`<span class="form-hint">${op.status==='delete'?'자동 삭제 예정':'자동 적용'}</span>`;const diffs=conflict?renderCoreDiff(op.user_diff,'내 수정')+renderCoreDiff(op.update_diff,'공식 변경'):op.status==='preserve'?renderCoreDiff(op.user_diff,'내 수정 내용'):renderCoreDiff(op.update_diff,'공식 버전 변경 내용');return `<div class="up-file" data-path-key="${escHtml(op.path)}"><div class="up-file-head"><div class="up-file-select">${check}<span><span class="badge ${b[0]}">${b[1]}</span> <span class="up-path">${escHtml(op.path)}</span></span></div>${choices}</div>${diffs}</div>`;}).join('')}</div>`:'<div class="tp-empty">적용할 공식 변경이나 확인할 사용자 수정 파일이 없습니다.</div>';
  const verb=p.operation==='reinstall'?'재설치':'업데이트',apply=(ops.some(op=>op.status!=='preserve')||p.operation==='reinstall'||String(p.version||'')!==String(p.current_version||''))?`<div class="up-actions" style="margin-top:14px"><button class="btn btn-primary" onclick="openCoreUpdatePasswordModal('apply')"><span class="mi" style="font-size:17px">system_update_alt</span> 직접 ${verb} 적용</button><span class="form-hint">적용 직전 해시를 다시 확인하고 기존 파일을 백업합니다.</span></div>`:'';
  el.innerHTML=summary+majorWarning+threeWay+warning+bulk+files+apply;updateCoreIncrementalEstimate();
}
function toggleAllCoreConflictChecks(checked){document.querySelectorAll('.up-conflict-check').forEach(x=>x.checked=!!checked);updateCoreBulkSelectionCount();}
function updateCoreBulkSelectionCount(){const all=[...document.querySelectorAll('.up-conflict-check')],selected=all.filter(x=>x.checked).length,el=document.getElementById('up-conflict-selected'),master=document.getElementById('up-conflict-all');if(el)el.textContent=`${selected}/${all.length}`;if(master){master.indeterminate=selected>0&&selected<all.length;master.checked=all.length>0&&selected===all.length;}}
function applyCoreBulkChoice(choice){const selected=[...document.querySelectorAll('.up-conflict-check:checked')];if(!selected.length){toast('일괄 적용할 충돌 파일을 체크하세요.','warn');return;}const selects=[...document.querySelectorAll('.up-choice')];selected.forEach(box=>{const select=selects.find(x=>x.dataset.path===box.dataset.path);if(select)select.value=choice==='keep'?'keep':(select.dataset.incomingAction||'replace');});updateCoreIncrementalEstimate();toast(`${selected.length}개 파일의 선택을 일괄 변경했습니다.`,'success');}
function updateCoreIncrementalEstimate(){const p=upState.plan||{},ops=p.operations||[];let count=0,bytes=0;ops.forEach(op=>{let action=op.default_action||'keep';const select=[...document.querySelectorAll('.up-choice')].find(x=>x.dataset.path===op.path);if(select)action=select.value;if(op.status==='preserve'||action==='keep')return;count++;if(action==='replace')bytes+=Number(op.incoming_size||0);});const el=document.getElementById('up-incremental-count');if(el)el.textContent=`${count}개 · ${count?formatCoreBytes(bytes):'파일 쓰기 없음'}`;}
function coreUpdateChoices(){const out={};document.querySelectorAll('.up-choice').forEach(x=>out[x.dataset.path]=x.value);return out;}

function renderCoreDataReleases(items){
  const el=document.getElementById('up-data-releases');if(!el)return;if(!items.length){el.innerHTML='<div class="tp-empty">아직 설치된 데이터 릴리스가 없습니다.</div>';return;}
  el.innerHTML=items.map(x=>`<div class="up-backup-row"><div><strong>${escHtml(x.version||'?')} <span class="badge ${x.active?'badge-success':'badge-primary'}">${x.active?'활성':'설치됨'}</span></strong><div class="tp-meta"><span>${escHtml(x.id||'')}</span><span>${Number(x.file_count||0)}개 파일</span><span>${escHtml(x.status||'installed')}</span></div></div><button class="btn btn-outline btn-sm" ${x.active?'disabled':''} onclick="openCoreUpdatePasswordModal('rollback_data','${escHtml(x.id)}')">이 릴리스로 전환</button></div>`).join('');
}
function renderCoreBackups(items){const el=document.getElementById('up-backups');if(!el)return;if(!items.length){el.innerHTML='<div class="tp-empty">아직 저장된 업데이트 전 원본이 없습니다.</div>';return;}const toolbar=`<div class="up-backup-toolbar"><span class="form-hint">총 ${items.length}개의 직접 설치 백업</span><button class="btn btn-danger btn-sm" onclick="openCoreUpdatePasswordModal('delete_backups')"><span class="mi" style="font-size:16px">delete_sweep</span> 전체 삭제</button></div>`;const rows=items.map(x=>`<div class="up-backup-row"><div><strong>${escHtml(x.from_version||'?')} → ${escHtml(x.to_version||'?')}</strong><div class="tp-meta"><span>${escHtml(x.created_at||'')}</span><span>${Number(x.file_count||0)}개 파일</span><span>${x.complete?'완료':'불완전'}</span></div></div><div class="up-backup-actions"><button class="btn btn-outline btn-sm" ${x.complete?'':'disabled'} onclick="openCoreUpdatePasswordModal('rollback','${escHtml(x.id)}')">업데이트 전 원본으로 복구</button><button class="btn btn-danger btn-sm" onclick="openCoreUpdatePasswordModal('delete_backup','${escHtml(x.id)}')"><span class="mi" style="font-size:15px">delete</span> 삭제</button></div></div>`).join('');el.innerHTML=toolbar+rows;}
function openCoreUpdatePasswordModal(action,targetId=''){
  upState.pending={action,targetId};const destructive=action==='delete_backup'||action==='delete_backups',titles={apply:'에디터 설치 최종 승인',rollback:'직접 설치 백업 복구 승인',delete_backup:'직접 설치 백업 삭제 승인',delete_backups:'직접 설치 백업 전체 삭제 승인',rollback_data:'데이터 릴리스 전환 승인',save_mode:'설치 방식 변경 승인'},messages={delete_backup:'선택한 직접 설치 백업 파일과 복구 내역을 영구 삭제합니다. 삭제 후에는 이 백업으로 복구할 수 없습니다.',delete_backups:'저장된 직접 설치 백업 파일과 복구 내역을 모두 영구 삭제합니다. 삭제 후에는 복구할 수 없습니다.'};if(action==='apply'&&t2MajorVersionMismatch(upState.plan?.current_version,upState.plan?.version))messages.apply=t2MajorVersionWarningText(upState.plan?.current_version,upState.plan?.version,'대상 버전')+' 이 승인은 실제 설치를 시작합니다.';const input=document.getElementById('up-password');document.getElementById('up-password-title').textContent=titles[action]||'관리자 승인';document.getElementById('up-password-message').textContent=messages[action]||(T2ADMIN_LOCAL_AUTH?'관리자 비밀번호는 현재 서버 안에서만 검증되며 저장소로 전송되지 않습니다.':T2ADMIN_AUTH_MODE.label+' 관리자 세션으로 승인합니다.');input.value='';input.style.display=T2ADMIN_LOCAL_AUTH?'block':'none';document.getElementById('up-password-error').textContent='';const confirmBtn=document.getElementById('up-password-confirm');confirmBtn.className=destructive?'btn btn-danger':'btn btn-primary';confirmBtn.textContent=destructive?'영구 삭제':'확인';document.getElementById('up-password-modal').classList.add('open');if(T2ADMIN_LOCAL_AUTH)setTimeout(()=>input.focus(),50);
}
function closeCoreUpdatePasswordModal(){document.getElementById('up-password-modal')?.classList.remove('open');const btn=document.getElementById('up-password-confirm');if(btn){btn.className='btn btn-primary';btn.textContent='확인';btn.disabled=false;}upState.pending=null;}
async function confirmCoreUpdatePassword(){
  if(!upState.pending)return;const pw=document.getElementById('up-password').value,err=document.getElementById('up-password-error'),btn=document.getElementById('up-password-confirm');if(T2ADMIN_LOCAL_AUTH&&!pw){err.textContent='관리자 비밀번호를 입력하세요.';return;}btn.disabled=true;const old=btn.textContent,action=upState.pending.action;btn.textContent=action==='apply'?'설치 중...':action==='save_mode'?'저장 중...':action==='delete_backup'||action==='delete_backups'?'삭제 중...':'전환 중...';let body={password:pw};if(action==='apply')body={plan_id:upState.plan?.id,password:pw,choices:coreUpdateChoices()};else if(action==='rollback'||action==='delete_backup')body={backup_id:upState.pending.targetId,password:pw};else if(action==='rollback_data')body={release_id:upState.pending.targetId,password:pw};else if(action==='save_mode')body={core:document.getElementById('up-core-mode')?.value||'data',third_party:document.getElementById('up-third-party-mode')?.value||'data',password:pw};const r=await updateApi(action,'POST',body);btn.disabled=false;btn.textContent=old;if(!r.ok){err.textContent=r.msg||'처리에 실패했습니다.';document.getElementById('up-password').value='';return;}closeCoreUpdatePasswordModal();toast(r.msg||'완료되었습니다.','success');setTimeout(()=>location.reload(),500);
}

// 서드파티 마켓/설치
const TP_API = 'third_party_api.php';
let tpState = {markets:[], installed:{}, editor_version:''};
let tpPendingAction = null;

async function tpApi(action, method='GET', body=null, query={}) {
  const qs=new URLSearchParams({action,...query});
  const opts={method,headers:{'Content-Type':'application/json','X-T2Admin-CSRF':CSRF}};
  if(body!==null&&method==='POST')opts.body=JSON.stringify(body);
  return requestJson(TP_API+'?'+qs.toString(),opts,method==='POST'?120000:20000,'서드파티 API');
}

async function loadThirdParty() {
  const cat = document.getElementById('tp-catalog');
  if (!environmentState.local) await loadEnvironmentStatus(false);
  if (!renderSectionEnvironmentNotice('third_party')) return;
  if (cat) cat.innerHTML='<div class="tp-loading"><div class="spinner"></div> 마켓 정보를 불러오는 중...</div>';
  const r = await tpApi('state');
  if (!r.ok) { if(cat) cat.innerHTML='<div class="alert alert-error"><span class="mi">error</span>'+escHtml(r.msg)+'</div>'; return; }
  tpState = r.data || {markets:[],installed:{},editor_version:''};
  renderThirdPartyMarkets();
  renderThirdPartyInstalled();
  loadThirdPartyCatalog();
}

function renderThirdPartyMarkets() {
  const select = document.getElementById('tp-market-select');
  const officialEl = document.getElementById('tp-market-official');
  const certEl = document.getElementById('tp-market-certified');
  const rows = document.getElementById('tp-market-rows');
  if (!select || !rows || !officialEl || !certEl) return;
  const markets = tpState.markets || [], previous=select.value;
  const official = markets.filter(m=>m.group==='official');
  const certified = markets.filter(m=>m.group==='certified');
  const custom = markets.filter(m=>m.group!=='official' && m.group!=='certified');

  const enabled = markets.filter(m=>m.enabled!==false);
  select.innerHTML = enabled.map(m=>`<option value="${escHtml(m.id)}">${escHtml(tpMarketDisplayName(m))}${m.group==='official'?' · 공식':(m.group==='certified'?' · Certified':' · 직접 추가')}</option>`).join('');
  if(previous&&[...select.options].some(option=>option.value===previous))select.value=previous;
  select.onchange=()=>{renderThirdPartyProviderContext();loadThirdPartyCatalog();};

  officialEl.innerHTML = official.map(m=>`<div class="official-row ${m.enabled!==false?'':'api-off'}">
    <div class="api-provider-block">${providerIdentityHtml(m,'Open T2Editor',{official:true})}<div class="api-control-note">${m.enabled!==false?'DSc 공식 마켓·Certified Provider 레지스트리 연결 허용':'DSc 공식 마켓·레지스트리 API 요청 차단됨'}</div></div>
    <label class="toggle" title="DSc Open T2Editor API 사용"><input type="checkbox" class="tp-official-enabled" ${m.enabled!==false?'checked':''} aria-label="DSc Open T2Editor API 사용"><span class="toggle-track"></span><span class="toggle-thumb"></span></label>
  </div>`).join('');

  certEl.innerHTML = certified.length ? certified.map(m=>`<div class="cert-row">
    ${providerIdentityHtml(m,tpMarketDisplayName(m),{certified:true})}
    <label class="toggle" title="활성화"><input type="checkbox" class="tp-cert-enabled" data-id="${escHtml(m.id)}" ${m.enabled!==false?'checked':''}><span class="toggle-track"></span><span class="toggle-thumb"></span></label>
  </div>`).join('') : '<div class="tp-empty">현재 연결 가능한 Certified Provider가 없습니다.</div>';

  rows.innerHTML = custom.map((m,i)=>thirdPartyMarketRowHtml(m,i)).join('');
  renderThirdPartyProviderContext();
}

function tpMarketDisplayName(m){
  if(m&&m.group==='official')return 'Open T2Editor';
  const operator=String((m&&(m.operator||m.name))||providerDomain(m)||'독립 제공자').trim();
  return /t2editor\s+provider\s+market$/i.test(operator)?operator:(operator+' T2Editor Provider Market');
}

function renderThirdPartyProviderContext(){
  const select=document.getElementById('tp-market-select'),context=document.getElementById('tp-provider-context'),title=document.getElementById('tp-catalog-title');
  if(!select||!context)return;
  const market=(tpState.markets||[]).find(m=>String(m.id)===String(select.value));
  if(!market){context.innerHTML='<span class="tp-provider-context-note">활성 마켓을 선택하세요.</span>';if(title)title.textContent='확장 카탈로그';return;}
  const display=tpMarketDisplayName(market),official=market.group==='official',certified=market.group==='certified'||market.certified===true;
  context.innerHTML=providerIdentityHtml(market,display,{official,certified,unverified:!official&&!certified,showEndpoint:false})+`<span class="tp-provider-context-note">${official?'DSc가 운영하는 공식 마켓':(certified?'도메인 소유와 프로토콜 연결 확인됨':'사용자가 직접 추가한 독립 마켓')}</span>`;
  if(title)title.textContent=display+' 카탈로그';
}

function thirdPartyMarketRowHtml(m,i) {
  return `<div class="tp-market-row" data-index="${i}">
    <input class="form-control tp-market-name" value="${escHtml(m.name||'')}" placeholder="운영 회사·단체명">
    <input class="form-control tp-market-url" value="${escHtml(m.url||'')}" placeholder="https://example.com/market/index.php">
    <label style="font-size:13px;display:flex;gap:6px;align-items:center"><input type="checkbox" class="tp-market-enabled" ${m.enabled!==false?'checked':''}> 사용</label>
    <button class="btn btn-outline btn-sm" onclick="testThirdPartyMarketRow(this)">연결 확인</button>
  </div>`;
}

function addThirdPartyMarketRow() {
  tpState.markets = tpState.markets || [];
  tpState.markets.push({id:'market-'+Date.now(),name:'새 제공자',url:'https://',enabled:true,official:false,certified:false,group:'custom'});
  renderThirdPartyMarkets();
}

function collectThirdPartyMarkets() {
  const custom = (tpState.markets||[]).filter(m=>m.group!=='official' && m.group!=='certified');
  return [...document.querySelectorAll('#tp-market-rows .tp-market-row')].map((row,i)=>({
    id:(custom[i]&&custom[i].id)||('market-'+i),
    name:row.querySelector('.tp-market-name').value.trim(),
    url:row.querySelector('.tp-market-url').value.trim(),
    enabled:row.querySelector('.tp-market-enabled').checked
  }));
}

function collectCertifiedMarketDisabled() {
  return [...document.querySelectorAll('#tp-market-certified .tp-cert-enabled')].filter(cb=>!cb.checked).map(cb=>cb.dataset.id);
}

function collectThirdPartyOfficialEnabled() {
  return document.querySelector('#tp-market-official .tp-official-enabled')?.checked !== false;
}

async function saveThirdPartyMarkets() {
  const r = await tpApi('save_markets','POST',{markets:collectThirdPartyMarkets(),certified_disabled:collectCertifiedMarketDisabled(),official_enabled:collectThirdPartyOfficialEnabled()});
  if (!r.ok) { toast(r.msg,'error'); return; }
  tpState.markets=r.data||[]; renderThirdPartyMarkets(); toast(r.msg||'마켓을 저장했습니다.','success'); await loadEnvironmentStatus(false); await loadThirdPartyCatalog();
}

async function testThirdPartyMarketRow(btn) {
  const row=btn.closest('.tp-market-row'); const url=row.querySelector('.tp-market-url').value.trim();
  btn.disabled=true; const old=btn.textContent; btn.textContent='확인 중';
  const r=await tpApi('test_market','POST',{url});
  btn.disabled=false; btn.textContent=old;
  toast(r.ok?(r.msg||'호환 API입니다.'):(r.msg||'연결 실패'),r.ok?'success':'error');
}

function tpSafeHttpUrl(value){try{const u=new URL(String(value||''),location.href);return u.protocol==='https:'?u.href:'';}catch(e){return '';}}
function tpSanitizeRichHtml(html){
  const allowed=new Set(['P','BR','DIV','SPAN','STRONG','B','EM','I','U','S','DEL','BLOCKQUOTE','UL','OL','LI','H1','H2','H3','H4','H5','H6','PRE','CODE','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','A','IMG','HR','SUP','SUB']);
  const doc=new DOMParser().parseFromString('<div id="root">'+String(html||'')+'</div>','text/html'),root=doc.getElementById('root');
  [...root.querySelectorAll('*')].forEach(el=>{if(!allowed.has(el.tagName)){if(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','TEXTAREA','SELECT','OPTION','SVG','MATH','META','LINK','BASE'].includes(el.tagName))el.remove();else el.replaceWith(...el.childNodes);return;}[...el.attributes].forEach(a=>{const n=a.name.toLowerCase();if(n.startsWith('on')||n==='style'||n==='class'||n==='id'||n==='srcdoc'||n==='formaction')el.removeAttribute(a.name);});if(el.tagName==='A'){const href=tpSafeHttpUrl(el.getAttribute('href'));if(href){el.setAttribute('href',href);el.setAttribute('target','_blank');el.setAttribute('rel','noopener noreferrer nofollow ugc');}else el.removeAttribute('href');}if(el.tagName==='IMG'){const src=tpSafeHttpUrl(el.getAttribute('src'));if(!src){el.remove();return;}el.setAttribute('src',src);el.setAttribute('loading','lazy');el.setAttribute('decoding','async');el.removeAttribute('srcset');}if(['TH','TD'].includes(el.tagName)){['colspan','rowspan'].forEach(n=>{const v=Number(el.getAttribute(n)||1);if(!Number.isInteger(v)||v<1||v>20)el.removeAttribute(n);});}});return root.innerHTML;
}
function tpRenderRichDescription(frame,html,fallback){if(!frame)return;const safe=tpSanitizeRichHtml(html||('<p>'+escHtml(fallback||'설명이 없습니다.')+'</p>'));const csp="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'";frame.srcdoc='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><meta name="referrer" content="no-referrer"><style>body{font:14px/1.7 system-ui,-apple-system,sans-serif;color:#172033;padding:14px;margin:0;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}td,th{border:1px solid #dfe5ee;padding:7px}pre{white-space:pre-wrap;background:#f4f6fa;padding:10px;border-radius:8px}a{color:#315cea}</style></head><body>'+safe+'</body></html>';}

function tpCompareVersion(a,b){
  const pa=String(a||'0').replace(/^v/i,'').split(/[.+-]/).map(n=>parseInt(n,10));
  const pb=String(b||'0').replace(/^v/i,'').split(/[.+-]/).map(n=>parseInt(n,10));
  const len=Math.max(pa.length,pb.length);
  for(let i=0;i<len;i++){
    const na=Number.isFinite(pa[i])?pa[i]:0, nb=Number.isFinite(pb[i])?pb[i]:0;
    if(na>nb)return 1; if(na<nb)return -1;
  }
  return 0;
}
function tpInstallRelation(catalogVersion,installedItem){
  if(!installedItem)return 'not_installed';
  const cmp=tpCompareVersion(catalogVersion,installedItem.version);
  if(cmp>0)return 'update_available';
  if(cmp<0)return 'ahead';
  return 'current';
}
function tpEditorVersion(){return String(tpState.editor_version||upState.currentVersion||'').trim();}
function tpMajorCompatibilityWarning(supportedVersion){const current=tpEditorVersion();if(!t2MajorVersionMismatch(current,supportedVersion))return '';return `<div class="alert alert-warn" style="margin-top:10px"><span class="mi">warning</span><span><strong>지원 기준 메이저 버전이 다릅니다.</strong><br>현재 T2Editor ${escHtml(current||'-')} · 서드파티 지원 기준 ${escHtml(supportedVersion||'-')} 이상. 설치 후 호환성 문제가 발생할 수 있으므로 배포자의 지원 범위를 확인하세요.</span></div>`;}
function requestThirdPartyInstall(payload,supportedVersion){
  const current=tpEditorVersion(),majorVersionMismatch=t2MajorVersionMismatch(current,supportedVersion);
  if(majorVersionMismatch&&!window.confirm(`현재 T2Editor ${current||'-'}와 이 서드파티가 제시한 지원 기준 T2Editor ${supportedVersion||'-'}의 메이저 버전이 다릅니다. 설치 후 플러그인 또는 에디터 기능이 정상 작동하지 않을 수 있습니다.\n\n배포자의 지원 범위를 확인했으며 계속 설치하시겠습니까?`))return;
  openThirdPartyPasswordModal('install',{...payload,major_version_warning_ack:majorVersionMismatch});
}
async function loadThirdPartyCatalog() {
  const market=document.getElementById('tp-market-select')?.value||'';
  const q=document.getElementById('tp-search')?.value||'';
  const type=document.getElementById('tp-type')?.value||'';
  const el=document.getElementById('tp-catalog'); if(!el)return;
  renderThirdPartyProviderContext();
  if(!market){el.innerHTML='<div class="tp-empty">활성 마켓이 없습니다.</div>';return;}
  el.innerHTML='<div class="tp-loading"><div class="spinner"></div> 카탈로그를 불러오는 중...</div>';
  const r=await tpApi('catalog','GET',null,{market_id:market,q,type,page:'1',limit:'30'});
  if(!r.ok){el.innerHTML='<div class="alert alert-error"><span class="mi">error</span>'+escHtml(r.msg)+'</div>';return;}
  const items=(r.data&&r.data.items)||[];
  if(!items.length){el.innerHTML='<div class="tp-empty">검색 결과가 없습니다.</div>';return;}
  el.innerHTML='<div class="tp-grid">'+items.map(item=>{
    const installed=tpState.installed&&tpState.installed[item.slug];
    const relation=tpInstallRelation(item.version,installed);
    const thumb=tpSafeHttpUrl(item.thumbnail_url||''),dev=item.developer||{},profile=tpSafeHttpUrl(dev.profile_url||''),req=item.requires||{},license=item.license||{},supportedEditorVersion=req.t2editor_min||'';
    const itemName=item.name||item.slug||'이름 없는 확장',typeLabel=tpTypeLabel(item.type),rating=Number(item.rating||0),reviews=Math.max(0,Number(item.review_count||0)),downloads=Math.max(0,Number(item.download_count||0)),releaseCount=Math.max(1,Math.floor(Number(item.release_count||1))||1),fileSize=Math.max(0,Number(item.file_size||0)||0);
    const installBtnLabel=relation==='not_installed'?'설치':relation==='update_available'?'업데이트':'재설치';
    const statusBadge=relation==='update_available'?`<span class="badge badge-warn tp-status-badge"><span class="mi" style="font-size:13px">system_update_alt</span>업데이트 가능 (v${escHtml(installed.version||'')} → v${escHtml(item.version||'')})</span>`:relation==='current'?`<span class="badge badge-success tp-status-badge"><span class="mi" style="font-size:13px">check_circle</span>설치됨 · 최신</span>`:relation==='ahead'?`<span class="badge badge-muted tp-status-badge"><span class="mi" style="font-size:13px">info</span>설치됨 · v${escHtml(installed.version||'')} (카탈로그보다 최신)</span>`:'';
    return `<article class="tp-card">
      <div class="tp-card-head">
        ${thumb?`<img class="tp-thumb" src="${escHtml(thumb)}" alt="${escHtml(itemName)} 아이콘" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:`<div class="tp-thumb-fallback" aria-hidden="true"><span class="mi">extension</span></div>`}
        <div class="tp-card-main"><div class="tp-card-title-row"><h3>${escHtml(itemName)}</h3><span class="badge badge-primary">${escHtml(typeLabel)}</span></div>
          <div class="tp-meta tp-meta-primary"><span>${escHtml(item.slug||'')}</span><span>v${escHtml(item.version||'-')}</span><span>${formatSize(fileSize)}</span></div>
          ${profile?`<a class="tp-dev-link" href="${escHtml(profile)}" target="_blank" rel="noopener noreferrer">${escHtml(dev.nickname||dev.user_id||'개발자')}의 배포</a>`:`<span class="tp-dev-link">${escHtml(dev.nickname||dev.user_id||'개발자 정보 없음')}</span>`}
          ${statusBadge?`<div style="margin-top:6px">${statusBadge}</div>`:''}
        </div>
      </div>
      <div class="tp-summary">${escHtml(item.summary||'설명이 없습니다.')}</div>
      <div class="tp-compat"><span>PHP ${escHtml(req.php_min||'-')}–${escHtml(req.php_max||'-')}</span><span>T2Editor ${escHtml(req.t2editor_min||'-')}+</span><span>${escHtml(license.name||license.id||'라이선스 미표시')}</span></div>${tpMajorCompatibilityWarning(supportedEditorVersion)}
      <div class="tp-card-footer"><div class="tp-metrics"><span class="tp-rating">★ ${Number.isFinite(rating)?rating.toFixed(1):'0.0'}</span><span>리뷰 ${Number.isFinite(reviews)?reviews:0}</span><span>다운로드 ${Number.isFinite(downloads)?downloads:0}</span><span>릴리즈 ${releaseCount}</span></div>
      <div class="tp-actions"><button class="btn btn-primary btn-sm tp-install-btn" data-package="${escHtml(item.id)}" data-release="${escHtml(item.current_release_id||'')}" data-market="${escHtml(market)}" data-supported-editor="${escHtml(supportedEditorVersion)}"><span class="mi" style="font-size:16px" aria-hidden="true">download</span>${installBtnLabel}</button><button class="btn btn-outline btn-sm tp-detail-btn" data-package="${escHtml(item.id)}" data-market="${escHtml(market)}">상세·버전</button></div></div>
    </article>`;
  }).join('')+'</div>';
  el.querySelectorAll('.tp-install-btn').forEach(btn=>btn.addEventListener('click',()=>requestThirdPartyInstall({package_id:btn.dataset.package,release_id:btn.dataset.release||'',market_id:btn.dataset.market},btn.dataset.supportedEditor||'')));
  el.querySelectorAll('.tp-detail-btn').forEach(btn=>btn.addEventListener('click',()=>showThirdPartyDetail(btn.dataset.package,btn.dataset.market)));
}

function tpTypeLabel(type){return {'plugin':'Plugin','extend-js':'Extend JS','extend-php':'Extend PHP','locales':'Locales'}[String(type||'')]||String(type||'확장');}

async function showThirdPartyDetail(id,market) {
  const modal=document.getElementById('tp-release-modal'),content=document.getElementById('tp-release-content');
  modal?.classList.add('open'); if(content)content.innerHTML='<div class="tp-loading"><div class="spinner"></div> 릴리즈를 불러오는 중...</div>';
  const r=await tpApi('detail','GET',null,{market_id:market,id});
  if(!r.ok){if(content)content.innerHTML='<div class="alert alert-error"><span class="mi">error</span>'+escHtml(r.msg)+'</div>';return;}
  const d=r.data||{}, releases=Array.isArray(d.releases)?d.releases:[];
  document.getElementById('tp-release-title').textContent=(d.name||d.slug||'프로그램')+' 릴리즈';
  document.getElementById('tp-release-description').textContent='최신 v'+(d.version||'-')+' · '+(d.developer&&d.developer.nickname?'개발자 '+d.developer.nickname:'');tpRenderRichDescription(document.getElementById('tp-description-frame'),d.description_html,d.description||d.summary||'');
  if(!releases.length){content.innerHTML='<div class="tp-empty">릴리즈 히스토리가 없습니다.</div>';return;}
  content.innerHTML=releases.map(rel=>{
    const req=rel.requires||{},lic=rel.license||{},current=String(rel.id||'')===String(d.current_release_id||''),installed=tpState.installed&&tpState.installed[d.slug]&&String(tpState.installed[d.slug].release_id||'')===String(rel.id||'');
    return `<article class="tp-release-item"><div class="tp-release-head"><div><strong>v${escHtml(rel.version||'')}</strong> <span class="badge ${current?'badge-success':'badge-primary'}">${escHtml(current?'최신':(rel.release_type_label||rel.release_type||'릴리즈'))}</span>${installed?' <span class="badge badge-success">설치됨</span>':''}</div><span>${escHtml(rel.published_at||'')}</span></div><div class="tp-release-notes">${escHtml(rel.release_notes||'변경 내역 없음')}</div><div class="tp-meta"><span>PHP ${escHtml(req.php_min||'-')}~${escHtml(req.php_max||'-')}</span><span>T2Editor ${escHtml(req.t2editor_min||'-')}+</span><span>${escHtml(lic.name||lic.id||'라이선스 미표시')}</span><span>${formatSize(rel.file_size||0)}</span><span>다운로드 ${Number(rel.download_count||0)}</span></div>${tpMajorCompatibilityWarning(req.t2editor_min||'')}<div class="tp-actions"><button class="btn btn-primary btn-sm tp-release-install" data-package="${escHtml(d.id)}" data-release="${escHtml(rel.id)}" data-market="${escHtml(market)}" data-supported-editor="${escHtml(req.t2editor_min||'')}">${installed?'재설치':'이 버전 설치'}</button>${rel.demo_url?`<a class="btn btn-outline btn-sm" target="_blank" rel="noopener noreferrer" href="${escHtml(rel.demo_url)}">데모</a>`:''}</div></article>`;
  }).join('');
  content.querySelectorAll('.tp-release-install').forEach(btn=>btn.addEventListener('click',()=>{closeThirdPartyReleaseModal();requestThirdPartyInstall({package_id:btn.dataset.package,release_id:btn.dataset.release,market_id:btn.dataset.market},btn.dataset.supportedEditor||'');}));
}
function closeThirdPartyReleaseModal(){document.getElementById('tp-release-modal')?.classList.remove('open');}

function tpInstalledTypeIcon(type){return {'plugin':'extension','extend-js':'javascript','extend-php':'php','locales':'translate'}[String(type||'')]||'inventory_2';}
function tpFormatInstalledDate(value){
  if(!value)return '';
  const d=new Date(value);
  if(isNaN(d.getTime()))return escHtml(value);
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function renderThirdPartyInstalled() {
  const el=document.getElementById('tp-installed'); if(!el)return;
  const entries=Object.values(tpState.installed||{});
  if(!entries.length){el.innerHTML='<div class="tp-empty"><span class="mi" style="font-size:22px;display:block;margin-bottom:6px;opacity:.55">inventory_2</span>설치된 서드파티 프로그램이 없습니다.</div>';return;}
  entries.sort((a,b)=>String(b.installed_at||'').localeCompare(String(a.installed_at||'')));
  el.innerHTML='<div class="tp-installed-list">'+entries.map(item=>{
    const storage=item.storage_mode==='data'?'데이터 설치':'직접 설치';
    const marketName=(item.market&&item.market.name)||'알 수 없음';
    return `<div class="tp-installed-card">
      <div class="tp-installed-icon"><span class="mi" aria-hidden="true">${tpInstalledTypeIcon(item.type)}</span></div>
      <div class="tp-installed-body">
        <div class="tp-installed-title-row"><strong>${escHtml(item.name||item.id)}</strong><span class="badge badge-success">v${escHtml(item.version||'')}</span></div>
        <div class="tp-meta">
          <span><span class="mi" style="font-size:13px">tag</span>${escHtml(item.id)}</span>
          <span><span class="mi" style="font-size:13px">category</span>${escHtml(tpTypeLabel(item.type))}</span>
          <span><span class="mi" style="font-size:13px">storefront</span>${escHtml(marketName)}</span>
          <span><span class="mi" style="font-size:13px">schedule</span>${tpFormatInstalledDate(item.installed_at)}</span>
        </div>
      </div>
      <div class="tp-installed-actions">
        <span class="badge badge-primary">${storage}</span>
        <button class="btn btn-danger btn-sm tp-uninstall-btn" data-id="${escHtml(item.id)}"><span class="mi" style="font-size:15px" aria-hidden="true">delete</span>제거</button>
      </div>
    </div>`;
  }).join('')+'</div>';
  el.querySelectorAll('.tp-uninstall-btn').forEach(btn=>btn.addEventListener('click',()=>openThirdPartyPasswordModal('uninstall',{id:btn.dataset.id})));
}

function openThirdPartyPasswordModal(action,payload) {
  tpPendingAction={action,payload};
  const modal=document.getElementById('tp-password-modal');
  const title=document.getElementById('tp-password-title');
  const msg=document.getElementById('tp-password-message');
  title.textContent=action==='install'?'다운로드·설치 승인':'서드파티 프로그램 제거 승인';
  msg.textContent=T2ADMIN_LOCAL_AUTH?(action==='install'?'다운로드할 때마다 관리자 비밀번호를 다시 입력해야 합니다. 비밀번호는 마켓으로 전송되지 않습니다.':'제거할 프로그램과 설치 기록을 확인한 뒤 관리자 비밀번호를 입력하세요.'):(T2ADMIN_AUTH_MODE.label+' 관리자 세션으로 승인합니다.');
  const input=document.getElementById('tp-password');input.value='';input.style.display=T2ADMIN_LOCAL_AUTH?'block':'none';document.getElementById('tp-password-error').textContent='';
  modal.classList.add('open'); if(T2ADMIN_LOCAL_AUTH)setTimeout(()=>input.focus(),50);
}
function closeThirdPartyPasswordModal(){document.getElementById('tp-password-modal')?.classList.remove('open');tpPendingAction=null;}
async function confirmThirdPartyPassword(){
  if(!tpPendingAction)return;
  const pw=document.getElementById('tp-password').value; const err=document.getElementById('tp-password-error'); const btn=document.getElementById('tp-password-confirm');
  if(T2ADMIN_LOCAL_AUTH&&!pw){err.textContent='관리자 비밀번호를 입력하세요.';return;}
  btn.disabled=true; const old=btn.textContent; btn.textContent=tpPendingAction.action==='install'?'다운로드·설치 중...':'제거 중...';
  const body={...tpPendingAction.payload,password:pw}; const action=tpPendingAction.action;
  let r;
  try{
    r=await tpApi(action,'POST',body);
    if(r.ok&&r.data?.browser_fallback_required){
      r=await runBrowserZipFallback(TP_API,r.data,text=>{btn.textContent=text;});
    }
  }catch(error){r={ok:false,msg:error?.message||'브라우저 ZIP 처리에 실패했습니다.'};}
  btn.disabled=false; btn.textContent=old;
  if(!r.ok){err.textContent=r.msg||'처리에 실패했습니다.';document.getElementById('tp-password').value='';document.getElementById('tp-password').focus();return;}
  closeThirdPartyPasswordModal(); toast(r.msg||'완료되었습니다.','success');
  const state=await tpApi('state'); if(state.ok){tpState=state.data;renderThirdPartyInstalled();renderThirdPartyMarkets();await loadThirdPartyCatalog();}
  if(action==='install'){await loadPlugins();await loadExtend();}
}

// 플러그인 관리
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

// 아이콘 관리
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
    const requestedType = ov?.type || b.icon_type || 'material-icons';
    const curType = requestedType === 'material-icons-outlined' ? requestedType : 'material-icons';
    const curName = ov?.name || b.icon || '';
    const curStyle = ov?.style || '';
    const sourceLabel = b.source === 'core' ? '코어' : (b.plugin || '플러그인');
    return `
    <div class="icon-row ${ov?'overridden':''}" data-command="${escHtml(b.command)}">
      <div class="icon-preview">
        <span class="${curType}" style="${escHtml(curStyle)}">${escHtml(curName)}</span>
      </div>
      <div class="icon-meta">
        <div class="icon-cmd">${escHtml(b.command)}</div>
        <div class="icon-label">${escHtml(b.label||'')} <span class="badge badge-muted icon-source-badge">${escHtml(sourceLabel)}</span></div>
      </div>
      <div class="icon-controls">
        <button type="button" class="btn btn-outline btn-sm icon-choose-btn" onclick="openIconPicker(this.closest('.icon-row').dataset.command,this)"><span class="mi" style="font-size:17px" aria-hidden="true">apps</span> 아이콘 선택</button>
        <code class="icon-current-name" title="${escHtml(curName)}">${escHtml(curName||'아이콘 없음')}</code>
        <button type="button" class="btn btn-icon icon-reset-btn" title="기본값으로 되돌리기" aria-label="${escHtml(b.command)} 기본값 복원" onclick="resetIconOverride(this.closest('.icon-row').dataset.command)"><span class="mi" style="font-size:18px" aria-hidden="true">restart_alt</span></button>
        <details class="icon-advanced">
          <summary>고급 직접 입력</summary>
          <div class="icon-advanced-fields">
            <select class="icon-type-select" aria-label="${escHtml(b.command)} 아이콘 종류" onchange="updateIconOverride(this.closest('.icon-row').dataset.command)">
              <option value="material-icons" ${curType==='material-icons'?'selected':''}>Filled</option>
              <option value="material-icons-outlined" ${curType==='material-icons-outlined'?'selected':''}>Outlined</option>
            </select>
            <input class="icon-name-input" type="text" placeholder="아이콘 이름" value="${escHtml(curName)}" aria-label="${escHtml(b.command)} 아이콘 이름" oninput="updateIconOverride(this.closest('.icon-row').dataset.command)">
            <input class="icon-style-input" type="text" placeholder="style (선택, 예: color:#ff6600)" value="${escHtml(curStyle)}" aria-label="${escHtml(b.command)} 스타일" oninput="updateIconOverride(this.closest('.icon-row').dataset.command)">
          </div>
        </details>
        <div class="icon-validation" role="alert">이 설치본의 아이콘 글꼴에서 지원하지 않는 이름입니다. ‘아이콘 선택’을 이용해 주세요.</div>
      </div>
    </div>`;
  }).join('');
}

function updateIconOverride(command) {
  const row = [...document.querySelectorAll('#icon-manager-list .icon-row')].find(item => item.dataset.command === command);
  if (!row) return;
  const type = row.querySelector('.icon-type-select')?.value || 'material-icons';
  const name = row.querySelector('.icon-name-input')?.value.trim() || '';
  const style = row.querySelector('.icon-style-input')?.value.trim() || '';

  if (!settings.icons) settings.icons = {};
  if (!name) {
    delete settings.icons[command];
    row.classList.remove('overridden');
    row.classList.remove('icon-invalid');
  } else if (!MATERIAL_ICON_SET.has(name)) {
    row.classList.add('icon-invalid');
    return;
  } else {
    settings.icons[command] = { type, name, style };
    row.classList.add('overridden');
    row.classList.remove('icon-invalid');
  }
  const preview = row.querySelector('.icon-preview');
  if (preview) {
    preview.innerHTML = `<span class="${type}" style="${escHtml(style)}">${escHtml(name)}</span>`;
  }
  const current = row.querySelector('.icon-current-name');
  if (current) { current.textContent = name || '아이콘 없음'; current.title = name; }
}

function resetIconOverride(command) {
  if (settings.icons) delete settings.icons[command];
  renderIconManager();
}

function iconPickerButton(command) {
  return allButtons.find(b => b.command === command) || null;
}

function openIconPicker(command, trigger) {
  const button = iconPickerButton(command);
  if (!button) return;
  const override = settings.icons?.[command] || {};
  iconPickerState = {
    command,
    type: override.type || button.icon_type || 'material-icons',
    query: '',
    category: 'featured',
    limit: 180,
    returnFocus: trigger || document.activeElement
  };
  if (!['material-icons','material-icons-outlined'].includes(iconPickerState.type)) iconPickerState.type = 'material-icons';
  const query = document.getElementById('icon-picker-query');
  const type = document.getElementById('icon-picker-type');
  if (query) query.value = '';
  if (type) type.value = iconPickerState.type;
  const backdrop = document.getElementById('icon-picker-backdrop');
  if (!backdrop) return;
  backdrop.hidden = false;
  document.body.classList.add('icon-picker-open');
  renderIconPicker();
  setTimeout(() => query?.focus(), 0);
}

function closeIconPicker() {
  const backdrop = document.getElementById('icon-picker-backdrop');
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('icon-picker-open');
  const focus = iconPickerState.returnFocus;
  iconPickerState.command = '';
  if (focus && document.contains(focus)) focus.focus();
}

function onIconPickerSearch() {
  iconPickerState.query = (document.getElementById('icon-picker-query')?.value || '').trim().toLowerCase();
  iconPickerState.category = iconPickerState.query ? 'all' : 'featured';
  iconPickerState.limit = 180;
  renderIconPicker();
}

function onIconPickerTypeChange() {
  const type = document.getElementById('icon-picker-type')?.value;
  iconPickerState.type = type === 'material-icons-outlined' ? type : 'material-icons';
  renderIconPicker();
}

function setIconPickerCategory(category) {
  if (!ICON_PICKER_CATEGORIES.some(item => item.id === category)) return;
  iconPickerState.category = category;
  iconPickerState.limit = 180;
  renderIconPicker();
}

function iconPickerResults() {
  const category = ICON_PICKER_CATEGORIES.find(item => item.id === iconPickerState.category) || ICON_PICKER_CATEGORIES[0];
  const terms = iconPickerState.query.split(/\s+/).filter(Boolean);
  let source = category.id === 'featured'
    ? ICON_PICKER_FEATURED.filter(name => MATERIAL_ICON_SET.has(name))
    : MATERIAL_ICON_CATALOG;
  return source.filter(name => {
    const haystack = MATERIAL_ICON_SEARCH_INDEX.get(name) || name;
    if (terms.length && !terms.every(term => haystack.includes(term))) return false;
    return !category.tokens.length || category.tokens.some(token => name.includes(token));
  });
}

function renderIconPicker() {
  const button = iconPickerButton(iconPickerState.command);
  const target = document.getElementById('icon-picker-target');
  const categories = document.getElementById('icon-picker-categories');
  const count = document.getElementById('icon-picker-count');
  const results = document.getElementById('icon-picker-results');
  if (!button || !target || !categories || !count || !results) return;
  const selected = settings.icons?.[button.command]?.name || button.icon || '';
  target.innerHTML = `<span>적용 대상</span><strong>${escHtml(button.label || button.command)}</strong><code>${escHtml(button.command)}</code>`;
  categories.innerHTML = ICON_PICKER_CATEGORIES.map(item => `<button type="button" class="icon-category-chip ${item.id===iconPickerState.category?'active':''}" aria-pressed="${item.id===iconPickerState.category}" onclick="setIconPickerCategory('${item.id}')">${item.label}</button>`).join('');
  const found = iconPickerResults();
  count.textContent = `${found.length.toLocaleString('ko-KR')}개 결과`;
  if (!found.length) {
    results.innerHTML = '<div class="icon-picker-empty"><div><span class="mi" style="font-size:32px" aria-hidden="true">search_off</span><br>검색 결과가 없습니다.<br>다른 기능명이나 영문 아이콘 이름으로 검색해 보세요.</div></div>';
    return;
  }
  const visible = found.slice(0, iconPickerState.limit);
  results.innerHTML = `<div class="icon-picker-grid">${visible.map(name => `<button type="button" class="icon-picker-item ${name===selected?'selected':''}" data-icon="${name}" title="${name}" aria-label="${name} 아이콘 적용" onclick="chooseIconFromPicker(this.dataset.icon)"><span class="${iconPickerState.type}" aria-hidden="true">${name}</span><small>${name}</small></button>`).join('')}</div>${visible.length < found.length ? `<div class="icon-picker-more"><button type="button" class="btn btn-outline btn-sm" onclick="showMoreIcons()">더 보기 (${(found.length-visible.length).toLocaleString('ko-KR')}개)</button></div>` : ''}`;
}

function showMoreIcons() {
  iconPickerState.limit += 180;
  renderIconPicker();
}

function chooseIconFromPicker(name) {
  if (!iconPickerState.command || !MATERIAL_ICON_SET.has(name)) return;
  const command = iconPickerState.command;
  const button = iconPickerButton(command);
  const existing = settings.icons?.[command] || {};
  if (!settings.icons) settings.icons = {};
  settings.icons[command] = {type:iconPickerState.type, name, style:existing.style || ''};
  closeIconPicker();
  renderIconManager();
  toast(`${button?.label || command} 아이콘을 ${name}(으)로 선택했습니다.`, 'success');
}

function validateIconOverrides() {
  let valid = true;
  document.querySelectorAll('#icon-manager-list .icon-row').forEach(row => {
    const name = row.querySelector('.icon-name-input')?.value.trim() || '';
    const invalid = !!name && !MATERIAL_ICON_SET.has(name);
    row.classList.toggle('icon-invalid', invalid);
    if (invalid) valid = false;
  });
  if (!valid) toast('지원하지 않는 아이콘 이름을 먼저 수정해 주세요.', 'warn');
  return valid;
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.getElementById('icon-picker-backdrop')?.hidden) closeIconPicker();
});

// 반응형 툴바 (toolbar.js window.T2_TOOLBAR_GROUPS)
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

// 도메인 태그
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

// iframe 플랫폼
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

// 확장자 매니저
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

// 설정 저장
async function saveCurrentSection() {
  const btn = document.getElementById('save-btn');
  const payload = buildPayload(currentSection);
  if (!payload) return;
  if (btn) { btn.innerHTML='<div class="spinner"></div>'; btn.disabled=true; }
  const r = await api('save_settings','POST', payload);
  if (btn) { btn.innerHTML='<span class="mi" style="font-size:16px" aria-hidden="true">save</span><span class="btn-label">저장</span>'; btn.disabled=false; }
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
        content_height: Math.max(200, Math.min(2000, parseInt(document.getElementById('cfg-content-height')?.value, 10)||350)),
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
    case 'icons': return validateIconOverrides() ? { icons: settings.icons || {} } : null;
    case 'toolbar': return { toolbar_groups: tgState };
    default: return {};
  }
}

// 캐시 관리
function cacheItemLabel(key) {
  return {runtime_index:'런타임 인덱스',compiled_locales:'번역 컴파일 맵',private_locale_root:'비공개 번역 캐시',public_locale_root:'공개 번역 캐시'}[key] || key;
}
function cacheTime(ts) {
  return Number(ts) > 0 ? new Date(Number(ts)*1000).toLocaleString('ko-KR') : '-';
}
async function loadCacheStatus(showToast=false) {
  const body=document.getElementById('cache-status-body');
  if(body) body.innerHTML='<div class="loading-inline"><div class="spinner"></div> 캐시 상태 확인 중...</div>';
  const r=await api('get_cache_status');
  if(!r.ok){
    if(body) body.innerHTML='<div class="alert alert-error"><span class="mi">error</span><span>'+escHtml(r.msg||'상태 확인 실패')+'</span></div>';
    return;
  }
  const d=r.data||{}, items=d.items||{};
  const mode=d.mode==='slot'?'데이터 슬롯':'기본 설치';
  const modeBadge=d.mode==='slot'?'badge-success':'badge-muted';
  const rows=Object.entries(items).map(([key,item])=>`<div class="license-row"><span class="l-label">${cacheItemLabel(key)}</span><span class="l-value">${item.exists?'<span class="badge badge-success">존재</span>':'<span class="badge badge-muted">없음</span>'} · ${formatSize(Number(item.size||0))} · ${cacheTime(item.mtime)}</span></div>`).join('');
  if(body) body.innerHTML=`
    <div class="up-summary" style="margin-bottom:14px">
      <div><small>실행 모드</small><strong><span class="badge ${modeBadge}">${mode}</span></strong></div>
      <div><small>릴리스 ID</small><strong style="word-break:break-all">${escHtml(d.release_id||'base')}</strong></div>
      <div><small>인덱스 유효성</small><strong><span class="badge ${d.runtime_index_valid?'badge-success':'badge-muted'}">${d.runtime_index_valid?'유효':'미생성/무효'}</span></strong></div>
      <div><small>전체 캐시 크기</small><strong>${formatSize(Number(d.total_size||0))}</strong></div>
    </div>
    ${rows}
    <div class="form-hint" style="margin-top:12px;word-break:break-all">캐시 경로: ${escHtml(d.cache_root||'-')}</div>
    ${d.generated_at?'<div class="form-hint">마지막 생성: '+escHtml(d.generated_at)+(d.runtime_generation?' / '+escHtml(d.runtime_generation):'')+'</div>':''}
  `;
  if(showToast) toast('캐시 상태를 새로고침했습니다.','success');
}
async function runCacheAction(kind) {
  const isRebuild=kind==='rebuild';
  const message=isRebuild?'기존 캐시를 삭제한 뒤 다시 생성합니다. 계속할까요?':'런타임/번역 캐시를 삭제합니다. 계속할까요?';
  if(!confirm(message)) return;
  const clearBtn=document.getElementById('cache-clear-btn'), rebuildBtn=document.getElementById('cache-rebuild-btn'), result=document.getElementById('cache-action-result');
  if(clearBtn) clearBtn.disabled=true;
  if(rebuildBtn) rebuildBtn.disabled=true;
  if(result) result.innerHTML='<div class="alert alert-info"><span class="mi">hourglass_top</span><span>'+(isRebuild?'캐시 재생성 중...':'캐시 삭제 중...')+'</span></div>';
  const r=await api(isRebuild?'rebuild_cache':'clear_cache','POST',{});
  if(result) result.innerHTML=`<div class="alert ${r.ok?'alert-success':'alert-error'}"><span class="mi">${r.ok?'check_circle':'error'}</span><span>${escHtml(r.msg||'')}</span></div>`;
  if(clearBtn) clearBtn.disabled=false;
  if(rebuildBtn) rebuildBtn.disabled=false;
  await loadCacheStatus(false);
  toast(r.msg|| (r.ok?'완료':'실패'), r.ok?'success':'error');
}

// 보안
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
  if (r.ok) { toast('설정 초기화 완료','success'); location.reload(); }
  else toast('초기화 실패: '+r.msg,'error');
}

// 인증
async function doLogout() {
  await api('logout','POST',{});
  location.reload();
}

// 유틸
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatSize(b){ return b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'KB':(b/1048576).toFixed(1)+'MB'; }
function formatDate(ts){ return new Date(ts*1000).toLocaleString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }

// 키보드 접근성
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSidebar();
});

// 초기화
<?php if ($page_state === 'normal'): ?>
loadSettings();
loadEnvironmentStatus(false);
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
    const d = await requestJson('api.php?action=setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})},20000,'관리자 설정 API');
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
    const d = await requestJson('api.php?action=login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})},20000,'관리자 로그인 API');
    if (d.ok) location.reload();
    else { errEl.textContent=d.msg; errEl.style.display='flex'; btn.disabled=false; btn.innerHTML='<span class="mi" style="font-size:18px">login</span> 로그인'; }
  } catch(e){ errEl.textContent='오류: '+e.message; errEl.style.display='flex'; btn.disabled=false; btn.innerHTML='<span class="mi" style="font-size:18px">login</span> 로그인';}
}
document.getElementById('login-pw')?.addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
</script>
<?php endif; ?>
</body>
</html>

<!-- T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them. -->
