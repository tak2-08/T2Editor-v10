<?php
// Path: T2Editor/plugin/search/search_proxy.php
// Developer note: 호환 엔드포인트 이름과 응답 형식은 유지하고, 구현 수정은 search_proxy.core.php에서 한다.
/** T2Editor immutable endpoint bootstrap (T2 Extend Bootstrap ABI 2). */
require_once dirname(__DIR__, 2) . '/config/extend.php';
require t2_extend_endpoint_target(__FILE__);

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
