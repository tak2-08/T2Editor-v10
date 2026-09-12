<?php
/** Immutable administrator endpoint bridge. */
require_once dirname(__DIR__) . '/config/extend.php';
// Require at file scope: endpoint core files may declare state consumed through
// `global`, which would be lost when required from inside a bridge function.
require t2_extend_endpoint_target(__FILE__);
