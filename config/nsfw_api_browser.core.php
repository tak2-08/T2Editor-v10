<?php
// Path: T2Editor/config/nsfw_api_browser.core.php
// Developer note: 경로·도메인·권한 값은 공용 헬퍼를 통해 바꾸고 CMS별 절대경로를 직접 하드코딩하지 않는다.
/**
 * T2Editor NSFW browser module MIME-safe fallback.
 *
 * The normal path is the immutable/static nsfw_api_browser.js asset. This
 * endpoint is used only when a CMS rewrite/router returns HTML or a 404 for
 * that ES module URL. The immutable wrapper selects this file from the active
 * runtime slot, so it always serves the matching module implementation.
 */

if (!defined('T2_EXTEND_RUNTIME_INTERNAL')) {
    http_response_code(404);
    exit('Not Found');
}

$source = __DIR__ . '/nsfw_api_browser.js';
if (!is_file($source) || is_link($source)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    exit('NSFW browser module not found.');
}

$mtime = (int)(@filemtime($source) ?: 0);
$size = (int)(@filesize($source) ?: 0);
$etag = '"t2-nsfw-' . dechex($mtime) . '-' . dechex($size) . '"';

header('Content-Type: application/javascript; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=3600, must-revalidate');
header('ETag: ' . $etag);
if ($mtime > 0) header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');

$ifNoneMatch = trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''));
if ($ifNoneMatch !== '' && hash_equals($etag, $ifNoneMatch)) {
    http_response_code(304);
    exit;
}

readfile($source);

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
