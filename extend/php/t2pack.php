<?php
// Path: T2Editor/extend/php/t2pack.php
// Developer note: @t2-scope와 등록 키는 자동 로더 계약이다. 경로는 T2EDITOR_PATH/데이터 경로 헬퍼로 계산한다.
/**
 * @t2-scope admin
 * T2Pack package manager Extend registration.
 * The bootstrap does not depend on this file name; T2Pack publishes a generic
 * runtime pointer consumed by config/extend.php.
 */
if (!defined('T2PACK_EXTEND_VERSION')) define('T2PACK_EXTEND_VERSION', '1.0.0');
if (!defined('T2PACK_BOOTSTRAP_REQUIRED')) define('T2PACK_BOOTSTRAP_REQUIRED', 1);

if (!function_exists('t2pack_paths')) {
    function t2pack_paths()
    {
        $private = rtrim(T2EDITOR_PRIVATE_PATH, '/\\') . '/t2pack';
        $public = rtrim(T2EDITOR_DB_PATH, '/\\') . '/t2pack/assets';
        return array(
            'private'=>$private,
            'public'=>$public,
            'mode'=>$private . '/mode.php',
            'active'=>$private . '/active.php',
            'installed'=>$private . '/installed.php',
            'health'=>$private . '/health.php',
            'lock'=>$private . '/lock',
            'releases'=>$private . '/releases',
            'extensions'=>$private . '/extensions',
            'packages'=>$private . '/packages',
            'work'=>$private . '/work',
            'trash'=>$private . '/trash',
            'assets_releases'=>$public . '/releases',
            'assets_extensions'=>$public . '/extensions',
        );
    }
}

if (!function_exists('t2pack_mode')) {
    function t2pack_mode()
    {
        $paths = t2pack_paths();
        $row = t2_private_store_read($paths['mode'], array('core'=>'data','third_party'=>'data'));
        if (!is_array($row)) $row = array();
        return array(
            'core' => in_array((string)($row['core'] ?? ''), array('data','direct'), true) ? (string)$row['core'] : 'data',
            'third_party' => in_array((string)($row['third_party'] ?? ''), array('data','direct'), true) ? (string)$row['third_party'] : 'data',
        );
    }
}

if (!function_exists('t2pack_register_admin')) {
    function t2pack_register_admin()
    {
        $GLOBALS['T2EDITOR_ADMIN_EXTENDS']['t2pack'] = array(
            'id'=>'t2pack',
            'title'=>'T2Pack',
            'version'=>T2PACK_EXTEND_VERSION,
            'bootstrap_required'=>T2PACK_BOOTSTRAP_REQUIRED,
            'mode'=>t2pack_mode(),
        );
    }
    t2pack_register_admin();
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
