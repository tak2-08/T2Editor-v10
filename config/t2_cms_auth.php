<?php
// Path: T2Editor/config/t2_cms_auth.php
// Developer note: 이 파일은 관리자 인증 공개 API만 유지한다. CMS 세션 판정은 각 어댑터 capability에 둔다.
/** T2Editor administrator authorization facade. */
require_once __DIR__ . '/t2_cms.php';

if (!function_exists('t2editor_admin_auth_context')) {
    function t2editor_admin_auth_context()
    {
        return t2editor_detect_cms(defined('T2EDITOR_BASE_PATH') ? T2EDITOR_BASE_PATH : dirname(__DIR__));
    }
}

if (!function_exists('t2editor_admin_register_auth_adapter')) {
    function t2editor_admin_register_auth_adapter($cmsId, $bootstrap, $authorize)
    {
        $cmsId = strtolower(trim((string)$cmsId));
        if ($cmsId === '' || $cmsId === 'standalone' || !is_callable($authorize) || ($bootstrap !== null && !is_callable($bootstrap))) return false;
        if (!isset($GLOBALS['T2EDITOR_CMS_AUTH_ADAPTERS']) || !is_array($GLOBALS['T2EDITOR_CMS_AUTH_ADAPTERS'])) $GLOBALS['T2EDITOR_CMS_AUTH_ADAPTERS'] = array();
        $GLOBALS['T2EDITOR_CMS_AUTH_ADAPTERS'][$cmsId] = array('bootstrap' => $bootstrap, 'authorize' => $authorize);
        $adapter = t2editor_cms_adapter($cmsId);
        if ($adapter) {
            $adapter['auth_bootstrap'] = $bootstrap;
            $adapter['auth_authorize'] = $authorize;
            t2editor_cms_register_adapter($cmsId, $adapter);
        }
        return true;
    }
}

if (!function_exists('t2editor_admin_auth_adapter')) {
    function t2editor_admin_auth_adapter($cmsId)
    {
        $cmsId = strtolower(trim((string)$cmsId));
        if (isset($GLOBALS['T2EDITOR_CMS_AUTH_ADAPTERS'][$cmsId]) && is_array($GLOBALS['T2EDITOR_CMS_AUTH_ADAPTERS'][$cmsId])) {
            $custom = $GLOBALS['T2EDITOR_CMS_AUTH_ADAPTERS'][$cmsId];
            if (!empty($custom['authorize']) && is_callable($custom['authorize']) && (empty($custom['bootstrap']) || is_callable($custom['bootstrap']))) return $custom;
        }
        $adapter = t2editor_cms_adapter($cmsId);
        if (!$adapter || empty($adapter['auth_authorize']) || !is_callable($adapter['auth_authorize'])) return null;
        return array('bootstrap' => $adapter['auth_bootstrap'] ?? null, 'authorize' => $adapter['auth_authorize']);
    }
}

if (!function_exists('t2editor_admin_builtin_auth_adapters')) {
    function t2editor_admin_builtin_auth_adapters()
    {
        $result = array();
        foreach (t2editor_cms_adapters() as $id => $adapter) {
            if (!empty($adapter['auth_authorize']) && is_callable($adapter['auth_authorize'])) {
                $result[$id] = array('bootstrap' => $adapter['auth_bootstrap'] ?? null, 'authorize' => $adapter['auth_authorize']);
            }
        }
        return $result;
    }
}

if (!function_exists('t2editor_admin_auth_require_path')) {
    /**
     * Ask the detected CMS adapter for a host bootstrap file it needs
     * required at the caller's true top-level scope (e.g. gnuboard5's
     * common.php — see t2editor_g5_common_path() for why this cannot be
     * done from inside a function). Returns '' when the adapter has nothing
     * to require, or already did so via another mechanism (e.g. Rhymix's
     * OOP-based Context::init(), which is scope-safe and stays on the
     * regular 'auth_bootstrap' capability).
     */
    function t2editor_admin_auth_require_path()
    {
        $context = t2editor_admin_auth_context();
        $adapter = t2editor_cms_adapter($context['id'] ?? 'standalone');
        if (!is_array($adapter) || empty($adapter['auth_require_path']) || !is_callable($adapter['auth_require_path'])) return '';
        try {
            $path = call_user_func($adapter['auth_require_path'], $context);
        } catch (Throwable $e) {
            error_log('[T2Editor] CMS auth_require_path failed: ' . $e->getMessage());
            return '';
        }
        return is_string($path) ? $path : '';
    }
}

if (!function_exists('t2editor_admin_auth_bootstrap')) {
    function t2editor_admin_auth_bootstrap()
    {
        static $done = array();
        $context = t2editor_admin_auth_context();
        $id = (string)($context['id'] ?? 'standalone');
        $key = $id . ':' . (string)($context['root_path'] ?? '');
        if (empty($done[$key])) {
            $done[$key] = true;
            $adapter = t2editor_admin_auth_adapter($id);
            if (is_array($adapter) && !empty($adapter['bootstrap'])) call_user_func($adapter['bootstrap'], $context);
        }
        if (session_status() !== PHP_SESSION_ACTIVE) @session_start();
    }
}

if (!function_exists('t2editor_admin_session_unlock')) {
    function t2editor_admin_session_unlock() { if (session_status() === PHP_SESSION_ACTIVE) @session_write_close(); }
}

if (!function_exists('t2editor_admin_requires_local_credentials')) {
    function t2editor_admin_requires_local_credentials()
    {
        $context = t2editor_admin_auth_context();
        return ($context['id'] ?? 'standalone') === 'standalone' || t2editor_admin_auth_adapter($context['id'] ?? '') === null;
    }
}

if (!function_exists('t2editor_admin_cms_is_authorized')) {
    function t2editor_admin_cms_is_authorized()
    {
        $context = t2editor_admin_auth_context();
        $adapter = t2editor_admin_auth_adapter($context['id'] ?? 'standalone');
        if (($context['id'] ?? 'standalone') === 'standalone' || !is_array($adapter)) return false;
        t2editor_admin_auth_bootstrap();
        try { return (bool)call_user_func($adapter['authorize'], $context); }
        catch (Throwable $e) { error_log('[T2Editor] CMS admin authorization failed: ' . $e->getMessage()); return false; }
    }
}

if (!function_exists('t2editor_admin_local_session_is_authorized')) {
    function t2editor_admin_local_session_is_authorized()
    {
        t2editor_admin_auth_bootstrap();
        return !empty($_SESSION['t2admin_logged_in']) && $_SESSION['t2admin_logged_in'] === true;
    }
}

if (!function_exists('t2editor_admin_is_authorized')) {
    function t2editor_admin_is_authorized()
    {
        t2editor_admin_auth_bootstrap();
        if (t2editor_admin_local_session_is_authorized()) return true;
        return t2editor_admin_cms_is_authorized();
    }
}

if (!function_exists('t2editor_admin_auth_mode')) {
    function t2editor_admin_auth_mode()
    {
        $context = t2editor_admin_auth_context();
        $local = t2editor_admin_requires_local_credentials();
        $localAuthorized = t2editor_admin_local_session_is_authorized();
        $cmsAuthorized = t2editor_admin_cms_is_authorized();
        return array(
            'mode' => $local ? 'local' : 'cms',
            'cms' => (string)($context['id'] ?? 'standalone'),
            'label' => (string)($context['label'] ?? '독립환경'),
            'requires_local_credentials' => $local,
            'local_login_supported' => true,
            'local_authorized' => $localAuthorized,
            'cms_authorized' => $cmsAuthorized,
            'authorized' => $localAuthorized || $cmsAuthorized,
        );
    }
}

if (!function_exists('t2editor_admin_verify_local_or_cms')) {
    function t2editor_admin_verify_local_or_cms($password, $authFile)
    {
        if (t2editor_admin_cms_is_authorized()) return true;
        if (!is_string($password) || $password === '' || !is_file($authFile)) return false;
        if (!function_exists('t2_private_store_read')) require_once __DIR__ . '/t2_private_store.php';
        $auth = t2_private_store_read($authFile, array());
        return is_array($auth) && !empty($auth['password_hash']) && password_verify($password, (string)$auth['password_hash']);
    }
}

// PHP 스코프 주의: 아래 require는 반드시 이 파일의 최상위(함수 밖)에서 실행해야
// 한다. 그누보드5의 is_admin()/get_member() 등은 $config/$member 를
// `global $config;` 로 읽는데, 이는 항상 "진짜" 전역 스코프만을 가리킨다.
// common.php를 함수 안에서 require하면 — 이후 $GLOBALS로 복사해도 — 그
// 함수의 지역 스코프에 값이 갇혀 그누보드 자체 함수들이 값을 보지 못하고,
// 결과적으로 실제 최고관리자도 항상 "로그인 필요"로 판정된다. 이 파일은
// 모든 admin 진입점에서 최상위 require_once로 로드되므로, 여기서도 함수로
// 감싸지 않고 최상위에서 require해야 체인 전체가 진짜 전역 스코프로 유지된다.
if (!isset($GLOBALS['__T2EDITOR_ADMIN_HOST_REQUIRED']) || !is_array($GLOBALS['__T2EDITOR_ADMIN_HOST_REQUIRED'])) {
    $GLOBALS['__T2EDITOR_ADMIN_HOST_REQUIRED'] = array();
}
$__t2_admin_host_require = function_exists('t2editor_admin_auth_require_path') ? t2editor_admin_auth_require_path() : '';
if ($__t2_admin_host_require !== '' && empty($GLOBALS['__T2EDITOR_ADMIN_HOST_REQUIRED'][$__t2_admin_host_require])) {
    $GLOBALS['__T2EDITOR_ADMIN_HOST_REQUIRED'][$__t2_admin_host_require] = true;
    $__t2_admin_host_ob_level = ob_get_level();
    ob_start();
    try {
        require_once $__t2_admin_host_require;
    } catch (Throwable $__t2_admin_host_e) {
        error_log('[T2Editor] CMS host bootstrap require failed: ' . $__t2_admin_host_e->getMessage());
    }
    while (ob_get_level() > $__t2_admin_host_ob_level) @ob_end_clean();
    unset($__t2_admin_host_ob_level, $__t2_admin_host_e);
}
unset($__t2_admin_host_require);

require_once dirname(__DIR__) . '/integration/cms/legacy-auth-api.php';

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
