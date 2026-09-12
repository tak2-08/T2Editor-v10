<?php
// Path: T2Editor/integration/cms/bootstrap.php
// Developer note: CMS adapters are drop-in files; registration priority decides execution order.
require_once __DIR__ . '/registry.php';

$adapterDir = __DIR__ . '/adapters';
$adapterFiles = glob($adapterDir . '/*.php');
if (is_array($adapterFiles)) {
    sort($adapterFiles, SORT_STRING);
    $adapterRoot = t2editor_cms_real_path($adapterDir);
    foreach ($adapterFiles as $adapterFile) {
        $real = t2editor_cms_real_path($adapterFile);
        if ($real !== '' && t2editor_cms_path_is_inside($real, $adapterRoot) && is_file($real)) require_once $real;
    }
}
unset($adapterDir, $adapterFiles, $adapterRoot, $adapterFile, $real);
// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
