<?php
//Path: T2Editor/config/get_webrtc_config.php
//
// video 플러그인의 자동 P2P 영상채팅(video_chat.js)이 사용할 STUN/TURN(ICE) 서버
// 목록을 반환한다.
//
// ── "공통 사용 데이터 폴더" 사용 ──────────────────────────────────────────
// T2Editor는 그누보드5 / 라이믹스 / 독립설치 어디에서 동작하든 t2_config.php가
// 계산한 T2EDITOR_DATA_PATH(및 그 URL 짝인 T2EDITOR_DATA_URL) 하나만을 "공용
// 데이터 폴더"로 사용한다(admin_settings.json 등 기존 관리자 설정도 전부 이
// 폴더에 저장됨). TURN 서버 자격증명처럼 CMS마다 새로 넣기 번거로운 값도
// 이 폴더에 JSON 파일 하나로 두면, 그누보드5/라이믹스/워드프레스 등 어떤
// 환경에 설치돼도 별도 설정 없이 동일한 값을 공유해서 쓸 수 있다.
//
//   T2EDITOR_DATA_PATH/webrtc_turn_config.json
//   {
//       "ice_servers": [
//           { "urls": "turn:turn.example.com:3478", "username": "user", "credential": "pass" }
//       ]
//   }
//
// 파일이 없거나 읽기 실패해도 기본 STUN + 무료 공개 TURN(Open Relay Project)
// 목록으로 자동 폴백하므로, "유저나 서버의 추가 설정 없이" 바로 동작한다.
// ─────────────────────────────────────────────────────────────────────────

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/upload_config.php'; // check_request_origin() 재사용 (중복 선언 방지)
require_once __DIR__ . '/t2_config.php';

if (!check_request_origin()) {
    http_response_code(403);
    echo json_encode(['error' => 'Access denied']);
    exit;
}

// ── 기본값 (collab 플러그인과 동일한 공개 STUN + Open Relay 무료 TURN) ─────
$default_ice_servers = [
    ['urls' => 'stun:stun.l.google.com:19302'],
    ['urls' => 'stun:stun1.l.google.com:19302'],
    ['urls' => 'stun:stun.cloudflare.com:3478'],
    ['urls' => 'stun:global.stun.twilio.com:3478'],
    ['urls' => 'turn:openrelay.metered.ca:80',                 'username' => 'openrelayproject', 'credential' => 'openrelayproject'],
    ['urls' => 'turn:openrelay.metered.ca:443',                'username' => 'openrelayproject', 'credential' => 'openrelayproject'],
    ['urls' => 'turn:openrelay.metered.ca:443?transport=tcp',  'username' => 'openrelayproject', 'credential' => 'openrelayproject'],
];

$ice_servers = $default_ice_servers;
$peer_brokers = [
    ['host' => '0.peerjs.com', 'port' => 443, 'secure' => true, 'path' => '/'],
];

$config_file = rtrim(T2EDITOR_DATA_PATH, '/\\') . '/webrtc_turn_config.json';

if (is_file($config_file) && is_readable($config_file)) {
    $raw = @file_get_contents($config_file);
    $decoded = $raw !== false ? @json_decode($raw, true) : null;

    if (is_array($decoded)) {
        // 관리자가 ice_servers를 직접 지정했으면 그 값으로 완전히 대체한다.
        // (형식이 잘못된 항목만 방어적으로 걸러낸다)
        if (isset($decoded['ice_servers']) && is_array($decoded['ice_servers']) && count($decoded['ice_servers']) > 0) {
            $custom = [];
            foreach ($decoded['ice_servers'] as $entry) {
                if (!is_array($entry) || empty($entry['urls']) || !is_string($entry['urls'])) continue;
                $item = ['urls' => $entry['urls']];
                if (isset($entry['username']) && is_string($entry['username'])) $item['username'] = $entry['username'];
                if (isset($entry['credential']) && is_string($entry['credential'])) $item['credential'] = $entry['credential'];
                $custom[] = $item;
            }
            if (count($custom) > 0) $ice_servers = $custom;
        }

        if (isset($decoded['peer_brokers']) && is_array($decoded['peer_brokers']) && count($decoded['peer_brokers']) > 0) {
            $custom_brokers = [];
            foreach ($decoded['peer_brokers'] as $entry) {
                if (!is_array($entry) || empty($entry['host']) || !is_string($entry['host'])) continue;
                $custom_brokers[] = [
                    'host'   => $entry['host'],
                    'port'   => isset($entry['port']) ? (int)$entry['port'] : 443,
                    'secure' => !isset($entry['secure']) || (bool)$entry['secure'],
                    'path'   => isset($entry['path']) && is_string($entry['path']) ? $entry['path'] : '/',
                ];
            }
            if (count($custom_brokers) > 0) $peer_brokers = $custom_brokers;
        }
    }
}

echo json_encode([
    'ice_servers'  => $ice_servers,
    'peer_brokers' => $peer_brokers,
], JSON_UNESCAPED_SLASHES);
