<?php
// Path: T2Editor/plugin/meme/meme_api_proxy.php
// Same-origin bridge for the fixed T2Meme search API.

include_once __DIR__ . '/../../config/remote_proxy.php';
t2proxy_require_same_origin();

if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    t2proxy_fail(405, 'Method not allowed.');
}

$query = trim((string)($_GET['q'] ?? ''));
if (strlen($query) > 300) t2proxy_fail(400, 'Query is too long.');
$page = max(1, min(10000, (int)($_GET['page'] ?? 1)));
$limit = max(1, min(50, (int)($_GET['limit'] ?? 24)));

$upstream = defined('T2EDITOR_MEME_API_URL')
    ? (string)T2EDITOR_MEME_API_URL
    : 'https://dsclub.kr/api/meme/index.php';
$url = $upstream . (strpos($upstream, '?') === false ? '?' : '&') . http_build_query([
    'q' => $query,
    'page' => $page,
    'limit' => $limit,
], '', '&', PHP_QUERY_RFC3986);

t2proxy_output_json_response(t2proxy_fetch_json($url, 'GET', ['Accept: application/json']));
