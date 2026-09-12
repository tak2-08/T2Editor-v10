<?php
// Path: T2Editor/integration/rhymix/iframe_autoregister.php
// Developer note: @t2-scope와 등록 키는 자동 로더 계약이다. 경로는 T2EDITOR_PATH/데이터 경로 헬퍼로 계산한다.
/**
 * @t2-scope editor
 * T2Editor self-hosted iframe auto-registration for Rhymix 2.1.x.
 *
 * This file is loaded automatically by editor.lib.php. It registers only the
 * two T2 video-player endpoints in Rhymix's media whitelist. No addon needs to
 * be enabled and no URL needs to be entered in the admin panel.
 */

if (!defined('RX_BASEDIR') || !defined('RX_BASEURL')) {
    return;
}

if (!class_exists('Context') || !class_exists('\Rhymix\Framework\Filters\MediaFilter')) {
    return;
}

try {
    // __DIR__ = .../t2editor/extend/php
    $skin_root = realpath(dirname(__DIR__, 2));
    $rx_root   = realpath(RX_BASEDIR);
    if (!$skin_root || !$rx_root) {
        return;
    }

    $rx_prefix = rtrim(str_replace('\\', '/', $rx_root), '/') . '/';
    $skin_path = str_replace('\\', '/', $skin_root);
    if (strncmp($skin_path . '/', $rx_prefix, strlen($rx_prefix)) !== 0) {
        return;
    }

    $skin_relative = trim(substr($skin_path, strlen($rx_prefix)), '/');
    if ($skin_relative === '') {
        return;
    }

    $default_url = (string) Context::getDefaultUrl();
    $url_parts = parse_url($default_url);
    if (!$url_parts || empty($url_parts['host'])) {
        return;
    }

    $authority = strtolower((string) $url_parts['host']);
    if (!empty($url_parts['port'])) {
        $authority .= ':' . (int) $url_parts['port'];
    }

    $base_url = '/' . trim(str_replace('\\', '/', (string) RX_BASEURL), '/') . '/';
    $base_url = preg_replace('!/++!', '/', $base_url);

    $player_base = $authority . $base_url . $skin_relative . '/plugin/video/';
    $required = [
        \Rhymix\Framework\Filters\MediaFilter::formatPrefix($player_base . 'video_player.php'),
        \Rhymix\Framework\Filters\MediaFilter::formatPrefix($player_base . 'video_view.php'),
    ];

    $current = \Rhymix\Framework\Filters\MediaFilter::getWhitelist();
    $missing = array_values(array_diff($required, $current));
    $last = count($missing) - 1;

    foreach ($missing as $index => $prefix) {
        // Save only once. The final call persists all prefixes already added to
        // the in-memory whitelist by previous calls in this loop.
        \Rhymix\Framework\Filters\MediaFilter::addPrefix($prefix, $index === $last);
    }
} catch (\Throwable $e) {
    error_log('[T2Editor] Rhymix iframe auto-registration failed: ' . $e->getMessage());
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
