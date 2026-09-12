<?php
/**
 * T2Editor immutable bootstrap (T2 Extend Bootstrap ABI 2).
 *
 * Keep this file small and stable. The selected runtime implementation lives
 * in editor.core.php inside the base installation or an immutable data slot.
 */
require_once __DIR__ . '/config/extend.php';
t2_extend_bootstrap_editor(__FILE__);
