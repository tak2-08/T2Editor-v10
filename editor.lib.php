<?php
// Path: T2Editor/editor.lib.php
// Developer note: 부트스트랩 공개 함수와 include 순서는 10.4.0 CMS 연결 계약이므로 이름을 바꾸지 않는다.
/**
 * T2Editor immutable bootstrap (T2 Extend Bootstrap ABI 2).
 *
 * Keep this file small and stable. The selected runtime implementation lives
 * in editor.core.php inside the base installation or an immutable data slot.
 */
require_once __DIR__ . '/config/extend.php';
t2_extend_bootstrap_editor(__FILE__);

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
