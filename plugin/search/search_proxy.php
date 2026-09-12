<?php
// Path: T2Editor/plugin/search/search_proxy.php
// Same-origin bridge for the fixed T2Search API endpoints.

include_once __DIR__ . '/../../config/remote_proxy.php';
t2proxy_require_same_origin();

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$action = strtolower(trim((string)($_GET['action'] ?? '')));

$search_url = defined('T2EDITOR_SEARCH_API_URL')
    ? (string)T2EDITOR_SEARCH_API_URL
    : 'https://dsclub.kr/api/search/index.php';
$cache_url = defined('T2EDITOR_SEARCH_CACHE_URL')
    ? (string)T2EDITOR_SEARCH_CACHE_URL
    : 'https://dsclub.kr/api/search/cache.php';
$api_key = defined('T2EDITOR_SEARCH_API_KEY')
    ? (string)T2EDITOR_SEARCH_API_KEY
    : 'dsclubSEARCH2025';

if ($action === 'search') {
    if ($method !== 'POST') t2proxy_fail(405, 'Search requires POST.');
    $data = t2proxy_read_json_body(32768);
    $tags = $data['tags'] ?? [];
    if (!is_array($tags) || count($tags) < 1 || count($tags) > 20) {
        t2proxy_fail(400, 'tags must be a non-empty array with at most 20 items.');
    }
    $clean_tags = [];
    foreach ($tags as $tag) {
        $tag = trim((string)$tag);
        if ($tag === '' || strlen($tag) > 240) t2proxy_fail(400, 'Invalid tag.');
        $clean_tags[] = $tag;
    }
    $limit = max(1, min(50, (int)($data['limit'] ?? 15)));
    $offset = max(0, min(100000, (int)($data['offset'] ?? 0)));
    $body = json_encode(['tags' => $clean_tags, 'limit' => $limit, 'offset' => $offset], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $response = t2proxy_fetch_json($search_url, 'POST', [
        'Accept: application/json',
        'Content-Type: application/json',
        'X-API-Key: ' . $api_key,
        'X-T2Editor: true',
    ], $body);
    t2proxy_output_json_response($response);
}

if ($action === 'cache') {
    if ($method === 'GET') {
        $tags = trim((string)($_GET['tags'] ?? ''));
        if ($tags === '' || strlen($tags) > 1000) t2proxy_fail(400, 'Invalid tags.');
        $limit = max(1, min(100, (int)($_GET['limit'] ?? 15)));
        $offset = max(0, min(100000, (int)($_GET['offset'] ?? 0)));
        $url = $cache_url . (strpos($cache_url, '?') === false ? '?' : '&') . http_build_query([
            'tags' => $tags,
            'limit' => $limit,
            'offset' => $offset,
        ], '', '&', PHP_QUERY_RFC3986);
        t2proxy_output_json_response(t2proxy_fetch_json($url, 'GET', ['Accept: application/json']));
    }

    if ($method === 'POST') {
        $data = t2proxy_read_json_body(2097152);
        $tags = trim((string)($data['tags'] ?? ''));
        $results = $data['results'] ?? null;
        if ($tags === '' || strlen($tags) > 1000 || !is_array($results) || count($results) > 100) {
            t2proxy_fail(400, 'Invalid cache payload.');
        }
        $payload = [
            'tags' => $tags,
            'limit' => max(1, min(100, (int)($data['limit'] ?? 15))),
            'offset' => max(0, min(100000, (int)($data['offset'] ?? 0))),
            'results' => $results,
            'total' => max(0, (int)($data['total'] ?? count($results))),
        ];
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        t2proxy_output_json_response(t2proxy_fetch_json($cache_url, 'POST', [
            'Accept: application/json',
            'Content-Type: application/json',
        ], $body));
    }

    t2proxy_fail(405, 'Cache supports GET and POST only.');
}

t2proxy_fail(400, 'Unknown proxy action.');
