<?php
// Path: T2Editor/admin/update_api.php
// Developer note: 호환 엔드포인트 이름과 응답 형식은 유지하고, 구현 수정은 update_api.core.php에서 한다.
/** Immutable administrator endpoint bridge. */
require_once dirname(__DIR__) . '/config/extend.php';
// Require at file scope: endpoint core files may declare state consumed through
// `global`, which would be lost when required from inside a bridge function.
require t2_extend_endpoint_target(__FILE__);

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
