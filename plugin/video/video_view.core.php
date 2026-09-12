<?php
// Path: T2Editor/plugin/video/video_view.core.php
// Developer note: video 엔드포인트 입력명·응답 JSON·보안 허용목록은 클라이언트 코드와 함께 수정한다.
if (!defined('T2_EXTEND_RUNTIME_INTERNAL')) { http_response_code(404); exit('Not Found'); }

// Host detection, URL policy and data paths are resolved by the shared adapter facade.
require_once __DIR__ . '/../../config/t2_config.php';

// [UPLOAD-CONFIG] 허용 확장자·MIME 맵을 upload_config.php 에서 가져온다
// video_view.php 단독으로 하드코딩하던 $mime_types 를 제거하고
// upload_config.php 의 get_ext_mime_map() + get_video_extensions() 로 통일한다.
// → 허용 목록을 한 곳에서만 관리(단일 소스)하게 된다.
if (!function_exists('get_video_extensions')) {
    require_once __DIR__ . '/../../config/upload_config.php';
}

// 비디오 확장자별 대표 MIME 타입 맵 구성
// get_ext_mime_map() 은 확장자당 허용 MIME 배열을 반환하므로 첫 번째(대표) 값만 사용.
$_full_mime_map  = get_ext_mime_map();
$_video_exts     = get_video_extensions();  // ['mp4','webm','ogg','mov','avi','mkv','wmv','flv','m4v']
$mime_types      = [];
foreach ($_video_exts as $_ext) {
    if (isset($_full_mime_map[$_ext]) && !empty($_full_mime_map[$_ext])) {
        $mime_types[$_ext] = $_full_mime_map[$_ext][0];
    }
}
// HLS manifest는 업로드 대상이 아니라 URL 삽입 대상으로 별도 허용한다.
$mime_types['m3u8'] = 'application/vnd.apple.mpegurl';
unset($_full_mime_map, $_video_exts, $_ext);

$allowed_exts = array_keys($mime_types);

// 비디오 경로 수신
$video_path = isset($_GET['video']) ? (string)$_GET['video'] : '';

if ($video_path === '') {
    http_response_code(400);
    exit('Video file not found.');
}

// URL 유형 판별 및 보안 검증
//
// · 절대 URL (http:// / https:// / //) → t2editor_is_allowed_url() 로 도메인 확인
//   - 허용 도메인(서버 자신 + T2EDITOR_ALLOWED_URL_DOMAINS)이면 직접 재생
//   - 허가되지 않은 외부 도메인이면 403
// · 상대 경로 → 경로 탈출(path traversal) 검증 유지
//
// 허용 도메인 관리는 T2Editor/config/t2_config.php 의
// T2EDITOR_ALLOWED_URL_DOMAINS 상수를 수정하면 된다.

// 호스트 다운로드 URL처럼 경로에 확장자가 없는
// 경우를 대비해, video.js가 함께 실어보내는 t2ext 힌트를 폴백으로 사용한다.
// (video_player.php와 동일한 로직 — 상세 주석은 그쪽 참고)
$ext_hint = '';
$hint_query = parse_url($video_path, PHP_URL_QUERY);
if ($hint_query) {
    parse_str($hint_query, $hint_params);
    $ext_hint = isset($hint_params['t2ext']) ? strtolower(preg_replace('/[^a-z0-9]/i', '', (string)$hint_params['t2ext'])) : '';
}

// 절대 URL 처리
if (preg_match('#^(https?:)?//#i', $video_path)) {

    // Security:
    // t2editor_is_allowed_url() 는 t2_config.php 에 정의된 허용 도메인 목록과
    // 현재 서버 도메인(자동 감지)을 대조해 안전 여부를 판단한다.
    // 파일 업로드 후 서버가 반환하는 https://same-domain/data/.../video.mp4 는
    // 서버 도메인으로 자동 허용되므로 정상 재생된다.
    if (!t2editor_is_allowed_url($video_path)) {
        http_response_code(403);
        exit('Disallowed external URL. Ask the administrator to allow the domain.');
    }

    // 확장자 추출: URL의 경로 부분에서만 확인 (쿼리스트링 제거)
    $url_path = parse_url($video_path, PHP_URL_PATH) ?? '';
    $ext = strtolower(pathinfo($url_path, PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed_exts, true) && $ext_hint !== '' && in_array($ext_hint, $allowed_exts, true)) {
        $ext = $ext_hint;
    }

    if (!in_array($ext, $allowed_exts, true)) {
        http_response_code(400);
        exit('Unsupported video format.');
    }

    // 허용된 절대 URL → 그대로 플레이어에 전달
    $video_url = $video_path;
    $mime_type = $mime_types[$ext] ?? 'video/mp4';

} else {
    // 상대 경로 처리 (로컬 파일)
    // Security:
    // ltrim 이후 남은 경로가 T2EDITOR_DATA_PATH 안에 있는지 realpath 로 확인한다.
    // '../../etc/passwd.mp4' 같은 경로가 확장자 검사를 통과해도 실제 파일 경로가
    // 데이터 디렉터리 밖을 가리키면 차단된다.

    $relative_full = ltrim(str_replace('\\', '/', $video_path), '/');
    $relative = parse_url($relative_full, PHP_URL_PATH) ?? $relative_full;

    // 확장자 빠른 거부 (경로 포함 검증 전)
    $ext = strtolower(pathinfo($relative, PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed_exts, true) && $ext_hint !== '' && in_array($ext_hint, $allowed_exts, true)) {
        $ext = $ext_hint;
    }

    if (!in_array($ext, $allowed_exts, true)) {
        http_response_code(400);
        exit('Unsupported video format.');
    }

    // 실제 파일 경로가 T2EDITOR_DATA_PATH 안에 있는지 확인
    $expected_base  = rtrim(str_replace('\\', '/', realpath(T2EDITOR_DATA_PATH) ?: T2EDITOR_DATA_PATH), '/');
    $candidate      = T2EDITOR_DATA_PATH . '/' . $relative;
    $real_candidate = realpath($candidate);

    if (
        $real_candidate === false ||
        strpos(str_replace('\\', '/', $real_candidate), $expected_base . '/') !== 0
    ) {
        http_response_code(403);
        exit('Disallowed path.');
    }

    // 서버 내부 경로가 확인된 파일 → URL 구성
    $video_url = T2EDITOR_DATA_URL . '/' . $relative;
    $mime_type = $mime_types[$ext] ?? 'video/mp4';
}
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Video Player</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            background: #000;
            display: flex;
            justify-content: center;
            align-items: center;
            /* [VIEWPORT-FIX] 100vh는 모바일 브라우저 주소창/하단 툴바를 포함한
               레이아웃 뷰포트 기준이라 실제 보이는 영역보다 커서, 화면 상/하단이
               브라우저 자체 UI에 가려지는 문제가 있었다. 100dvh(동적 뷰포트)를
               지원 브라우저에서 우선 적용하고, 미지원 브라우저는 100vh로 폴백한다. */
            min-height: 100vh;   /* 폴백 */
            min-height: 100dvh;
            padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
                     env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
            overflow: hidden;
        }
        video {
            width: 100%;
            height: 100vh;   /* 폴백 */
            height: 100dvh;
            max-height: 100%;
            object-fit: contain;
        }
    </style>
</head>
<body>
    <video controls autoplay>
        <source src="<?php echo htmlspecialchars($video_url, ENT_QUOTES, 'UTF-8'); ?>" type="<?php echo htmlspecialchars($mime_type, ENT_QUOTES, 'UTF-8'); ?>">
        Your browser does not support the video tag.
    </video>
</body>
</html>

<!-- T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them. -->
