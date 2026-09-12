<?php
// Path: T2Editor/config/t2_compat.php
// Developer note: 경로·도메인·권한 값은 공용 헬퍼를 통해 바꾸고 CMS별 절대경로를 직접 하드코딩하지 않는다.

require_once __DIR__ . '/t2_utf8.php';

if (!function_exists('t2_utf8_can_define_legacy_mb')) {
    function t2_utf8_can_define_legacy_mb($function)
    {
        if (function_exists($function)) return false;
        return PHP_VERSION_ID >= 80000
            || !function_exists('extension_loaded')
            || !extension_loaded('mbstring');
    }
}

if (t2_utf8_can_define_legacy_mb('mb_strlen')) {
    function mb_strlen($value, $encoding = null)
    {
        return t2_utf8_length($value, $encoding ?: 'UTF-8');
    }
    $GLOBALS['T2EDITOR_UTF8_LEGACY_POLYFILLS']['mb_strlen'] = true;
}

if (t2_utf8_can_define_legacy_mb('mb_substr')) {
    function mb_substr($value, $start, $length = null, $encoding = null)
    {
        return t2_utf8_substr($value, $start, $length, $encoding ?: 'UTF-8');
    }
    $GLOBALS['T2EDITOR_UTF8_LEGACY_POLYFILLS']['mb_substr'] = true;
}

if (t2_utf8_can_define_legacy_mb('mb_strtolower')) {
    function mb_strtolower($value, $encoding = null)
    {
        return t2_utf8_lower($value, $encoding ?: 'UTF-8');
    }
    $GLOBALS['T2EDITOR_UTF8_LEGACY_POLYFILLS']['mb_strtolower'] = true;
}

if (t2_utf8_can_define_legacy_mb('mb_strpos')) {
    function mb_strpos($haystack, $needle, $offset = 0, $encoding = null)
    {
        return t2_utf8_pos($haystack, $needle, $offset, $encoding ?: 'UTF-8');
    }
    $GLOBALS['T2EDITOR_UTF8_LEGACY_POLYFILLS']['mb_strpos'] = true;
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
