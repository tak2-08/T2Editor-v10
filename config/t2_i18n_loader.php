<?php
/**
 * T2Editor separated i18n loader.
 *
 * Responsibility boundaries:
 *   locales/<locale>.json                    Core UI only.
 *   plugin/<plugin>/locales/<locale>.json   That plugin only.
 *   extend/locales/<locale>.json             Bundled /extend modules only.
 *
 * Only core locale files register selectable languages. Plugin and extension
 * locale files are optional overlays for an already registered core language.
 * A missing, unreadable, oversized or malformed overlay is ignored; it never
 * participates in plugin registration and must never stop a plugin running.
 *
 * PHP 7.4+ compatible. No optional PHP extension is required.
 */

if (!function_exists('t2editor_i18n_normalize_locale')) {
    function t2editor_i18n_normalize_locale($locale): string
    {
        if (!is_string($locale)) return '';
        $locale = strtolower(trim(str_replace('_', '-', $locale)));
        $locale = preg_replace('/-+/', '-', $locale);
        $locale = trim((string)$locale, '-');
        if ($locale === '' || strlen($locale) > 63) return '';
        if (!preg_match('/^[a-z0-9]{1,8}(?:-[a-z0-9]{1,8})*$/', $locale)) return '';
        return $locale;
    }
}

if (!function_exists('t2editor_i18n_safe_text')) {
    function t2editor_i18n_safe_text($value, int $max = 120): string
    {
        if (!is_scalar($value)) return '';
        $value = trim((string)$value);
        $value = preg_replace('/[\x00-\x1F\x7F]/u', '', $value);
        if (!is_string($value)) return '';
        if (function_exists('mb_strlen') && function_exists('mb_substr')) {
            return mb_strlen($value, 'UTF-8') > $max ? mb_substr($value, 0, $max, 'UTF-8') : $value;
        }
        return strlen($value) > $max ? substr($value, 0, $max) : $value;
    }
}

if (!function_exists('t2editor_i18n_read_json')) {
    function t2editor_i18n_read_json(string $path): ?array
    {
        $key = str_replace('\\', '/', $path);
        if (!isset($GLOBALS['_T2_I18N_JSON_CACHE']) || !is_array($GLOBALS['_T2_I18N_JSON_CACHE'])) {
            $GLOBALS['_T2_I18N_JSON_CACHE'] = array();
        }
        if (array_key_exists($key, $GLOBALS['_T2_I18N_JSON_CACHE'])) return $GLOBALS['_T2_I18N_JSON_CACHE'][$key];
        if (!is_file($path) || !is_readable($path)) return $GLOBALS['_T2_I18N_JSON_CACHE'][$key] = null;
        $size = @filesize($path);
        if ($size === false || $size < 2 || $size > 4 * 1024 * 1024) return $GLOBALS['_T2_I18N_JSON_CACHE'][$key] = null;
        $raw = @file_get_contents($path);
        if (!is_string($raw)) return $GLOBALS['_T2_I18N_JSON_CACHE'][$key] = null;
        if (strncmp($raw, "\xEF\xBB\xBF", 3) === 0) $raw = substr($raw, 3);
        $decoded = json_decode($raw, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
            error_log('[T2Editor I18N] Invalid optional locale JSON ignored: ' . $path . ' (' . json_last_error_msg() . ')');
            return $GLOBALS['_T2_I18N_JSON_CACHE'][$key] = null;
        }
        return $GLOBALS['_T2_I18N_JSON_CACHE'][$key] = $decoded;
    }
}

if (!function_exists('t2editor_i18n_locale_root')) {
    function t2editor_i18n_locale_root(): string
    {
        return defined('T2EDITOR_I18N_LOCALES_PATH')
            ? rtrim((string)T2EDITOR_I18N_LOCALES_PATH, '/\\')
            : rtrim((string)T2EDITOR_PATH, '/\\') . '/locales';
    }
}

if (!function_exists('t2editor_i18n_plugin_path')) {
    function t2editor_i18n_plugin_path(string $plugin): string
    {
        if (function_exists('t2_extend_plugin_descriptor')) {
            $descriptor = t2_extend_plugin_descriptor($plugin);
            if (is_array($descriptor) && !empty($descriptor['path'])) return rtrim((string)$descriptor['path'], '/\\');
        }
        return rtrim((string)T2EDITOR_PATH, '/\\') . '/plugin/' . $plugin;
    }
}

if (!function_exists('t2editor_i18n_extend_locale_roots')) {
    function t2editor_i18n_extend_locale_roots(): array
    {
        if (isset($GLOBALS['_T2_I18N_EXTEND_ROOTS']) && is_array($GLOBALS['_T2_I18N_EXTEND_ROOTS'])) return $GLOBALS['_T2_I18N_EXTEND_ROOTS'];
        $roots = array();
        $base = defined('T2EDITOR_BASE_PATH') ? T2EDITOR_BASE_PATH . '/extend/locales' : rtrim((string)T2EDITOR_PATH, '/\\') . '/extend/locales';
        if (is_dir($base)) $roots[] = $base;
        $runtime = defined('T2EDITOR_RUNTIME_PATH') ? T2EDITOR_RUNTIME_PATH . '/extend/locales' : rtrim((string)T2EDITOR_PATH, '/\\') . '/extend/locales';
        if (is_dir($runtime) && !in_array($runtime, $roots, true)) $roots[] = $runtime;
        if (function_exists('t2_extend_data_extension_roots')) {
            foreach (t2_extend_data_extension_roots('locales') as $row) if (is_array($row) && !empty($row['path']) && is_dir($row['path'])) $roots[] = (string)$row['path'];
        }
        return $GLOBALS['_T2_I18N_EXTEND_ROOTS'] = array_values(array_unique($roots));
    }
}

if (!function_exists('t2editor_i18n_file_candidates')) {
    /** @return array<int,array{path:string,root:bool,package:string}> */
    function t2editor_i18n_file_candidates(): array
    {
        if (isset($GLOBALS['_T2_I18N_FILE_CANDIDATES']) && is_array($GLOBALS['_T2_I18N_FILE_CANDIDATES'])) return $GLOBALS['_T2_I18N_FILE_CANDIDATES'];
        $root = t2editor_i18n_locale_root();
        if (!is_dir($root)) return $GLOBALS['_T2_I18N_FILE_CANDIDATES'] = array();
        $entries = @scandir($root);
        if (!is_array($entries)) return $GLOBALS['_T2_I18N_FILE_CANDIDATES'] = array();
        sort($entries, SORT_STRING);
        $result = array();
        foreach ($entries as $entry) {
            if (!preg_match('/^[a-z0-9][a-z0-9._-]{0,79}\.json$/i', $entry)) continue;
            $path = $root . '/' . $entry;
            if (is_file($path)) $result[] = array('path' => $path, 'root' => true, 'package' => 'core');
        }
        return $GLOBALS['_T2_I18N_FILE_CANDIDATES'] = $result;
    }
}

if (!function_exists('t2editor_get_locale_registry')) {
    /**
     * Discover selectable languages exclusively from core /locales JSON.
     * Plugin locale packs cannot create a partially translated editor locale.
     *
     * @return array<string,array<string,mixed>>
     */
    function t2editor_get_locale_registry(): array
    {
        if (isset($GLOBALS['_T2_I18N_LOCALE_REGISTRY']) && is_array($GLOBALS['_T2_I18N_LOCALE_REGISTRY'])) return $GLOBALS['_T2_I18N_LOCALE_REGISTRY'];
        $registry = array();

        foreach (t2editor_i18n_file_candidates() as $candidate) {
            $decoded = t2editor_i18n_read_json($candidate['path']);
            if (!is_array($decoded)) continue;
            $meta = isset($decoded['_meta']) && is_array($decoded['_meta']) ? $decoded['_meta'] : array();
            if (isset($meta['enabled']) && $meta['enabled'] === false) continue;

            $filenameCode = pathinfo($candidate['path'], PATHINFO_FILENAME);
            $hasMetadataCode = isset($meta['code']) && is_string($meta['code']) && trim($meta['code']) !== '';
            if (!$hasMetadataCode && !preg_match('/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i', $filenameCode)) continue;
            $code = t2editor_i18n_normalize_locale($hasMetadataCode ? $meta['code'] : $filenameCode);
            if ($code === '') continue;

            $native = t2editor_i18n_safe_text(isset($meta['native']) ? $meta['native'] : '', 120);
            $name = t2editor_i18n_safe_text(isset($meta['language']) ? $meta['language'] : '', 120);
            if ($native === '') $native = $name !== '' ? $name : $code;
            if ($name === '') $name = $native;

            $aliases = array();
            $rawAliases = isset($meta['aliases']) && is_array($meta['aliases']) ? $meta['aliases'] : array();
            $rawAliases[] = $filenameCode;
            foreach ($rawAliases as $alias) {
                $alias = t2editor_i18n_normalize_locale($alias);
                if ($alias !== '' && $alias !== $code && !in_array($alias, $aliases, true)) $aliases[] = $alias;
            }

            $fallback = t2editor_i18n_normalize_locale(isset($meta['fallback']) ? $meta['fallback'] : '');
            $direction = strtolower(trim((string)(isset($meta['direction']) ? $meta['direction'] : 'ltr')));
            $direction = $direction === 'rtl' ? 'rtl' : 'ltr';
            $order = isset($meta['order']) && is_numeric($meta['order']) ? (int)$meta['order'] : 1000;

            $registry[$code] = array(
                'code' => $code,
                'native' => $native,
                'language' => $name,
                'direction' => $direction,
                'fallback' => $fallback,
                'aliases' => $aliases,
                'version' => t2editor_i18n_safe_text(isset($meta['version']) ? $meta['version'] : '', 64),
                'default' => !empty($meta['default']),
                'package' => 'core',
                'file' => $candidate['path'],
                'order' => $order,
            );
        }

        if (defined('T2EDITOR_I18N_SUPPORTED_LANGS') && is_array(T2EDITOR_I18N_SUPPORTED_LANGS)) {
            $filtered = array();
            foreach (T2EDITOR_I18N_SUPPORTED_LANGS as $requested) {
                $requested = t2editor_i18n_normalize_locale($requested);
                $candidate = $requested;
                $resolved = '';
                while ($candidate !== '') {
                    if (isset($registry[$candidate])) { $resolved = $candidate; break; }
                    foreach ($registry as $code => $info) {
                        if (in_array($candidate, (array)$info['aliases'], true)) { $resolved = (string)$code; break 2; }
                    }
                    $pos = strrpos($candidate, '-');
                    if ($pos === false) break;
                    $candidate = substr($candidate, 0, $pos);
                }
                if ($resolved !== '' && !isset($filtered[$resolved])) $filtered[$resolved] = $registry[$resolved];
            }
            $registry = $filtered;
        } else {
            uasort($registry, static function (array $a, array $b): int {
                $order = ((int)$a['order']) <=> ((int)$b['order']);
                if ($order !== 0) return $order;
                return strcmp((string)$a['code'], (string)$b['code']);
            });
        }
        $GLOBALS['_T2_I18N_LOCALE_REGISTRY'] = $registry;
        return $registry;
    }
}

if (!function_exists('t2editor_get_locale_aliases')) {
    /** @return array<string,string> */
    function t2editor_get_locale_aliases(): array
    {
        if (isset($GLOBALS['_T2_I18N_ALIASES_CACHE']) && is_array($GLOBALS['_T2_I18N_ALIASES_CACHE'])) return $GLOBALS['_T2_I18N_ALIASES_CACHE'];
        $aliases = array();
        foreach (t2editor_get_locale_registry() as $code => $info) {
            $aliases[$code] = $code;
            foreach ((array)$info['aliases'] as $alias) $aliases[$alias] = $code;
        }
        return $GLOBALS['_T2_I18N_ALIASES_CACHE'] = $aliases;
    }
}

if (!function_exists('t2editor_resolve_locale')) {
    function t2editor_resolve_locale($locale): ?string
    {
        $locale = t2editor_i18n_normalize_locale($locale);
        if ($locale === '') return null;
        $registry = t2editor_get_locale_registry();
        $aliases = t2editor_get_locale_aliases();
        $candidate = $locale;
        while ($candidate !== '') {
            if (isset($registry[$candidate])) return $candidate;
            if (isset($aliases[$candidate]) && isset($registry[$aliases[$candidate]])) return $aliases[$candidate];
            $pos = strrpos($candidate, '-');
            if ($pos === false) break;
            $candidate = substr($candidate, 0, $pos);
        }
        return null;
    }
}

if (!function_exists('t2editor_get_supported_langs')) {
    /** @return array<int,string> */
    function t2editor_get_supported_langs(): array
    {
        return array_keys(t2editor_get_locale_registry());
    }
}

if (!function_exists('t2editor_get_default_lang')) {
    function t2editor_get_default_lang(): string
    {
        $supported = t2editor_get_supported_langs();
        if (!$supported) return 'en';
        if (defined('T2EDITOR_I18N_DEFAULT_LANG')) {
            $resolved = t2editor_resolve_locale(T2EDITOR_I18N_DEFAULT_LANG);
            if ($resolved !== null) return $resolved;
        }
        foreach (t2editor_get_locale_registry() as $code => $info) {
            if (!empty($info['default'])) return (string)$code;
        }
        $english = t2editor_resolve_locale('en');
        return $english !== null ? $english : (string)$supported[0];
    }
}

if (!function_exists('t2editor_get_language_display_map')) {
    /** @return array<string,array{0:string,1:string}> */
    function t2editor_get_language_display_map(): array
    {
        $display = array();
        foreach (t2editor_get_locale_registry() as $code => $info) {
            $display[$code] = array((string)$info['native'], (string)$info['language']);
        }
        if (defined('T2EDITOR_I18N_LANG_DISPLAY') && is_array(T2EDITOR_I18N_LANG_DISPLAY)) {
            foreach (T2EDITOR_I18N_LANG_DISPLAY as $code => $names) {
                $resolved = t2editor_resolve_locale($code);
                if ($resolved === null || !is_array($names)) continue;
                $native = t2editor_i18n_safe_text(isset($names[0]) ? $names[0] : '', 120);
                $english = t2editor_i18n_safe_text(isset($names[1]) ? $names[1] : '', 120);
                if ($native !== '') $display[$resolved][0] = $native;
                if ($english !== '') $display[$resolved][1] = $english;
            }
        }
        return $display;
    }
}

if (!function_exists('t2editor_get_locale_directions')) {
    /** @return array<string,string> */
    function t2editor_get_locale_directions(): array
    {
        $result = array();
        foreach (t2editor_get_locale_registry() as $code => $info) $result[$code] = (string)$info['direction'];
        return $result;
    }
}

if (!function_exists('t2editor_get_locale_fallbacks')) {
    /** @return array<string,string> */
    function t2editor_get_locale_fallbacks(): array
    {
        $result = array();
        foreach (t2editor_get_locale_registry() as $code => $info) {
            $fallback = t2editor_resolve_locale($info['fallback']);
            if ($fallback !== null && $fallback !== $code) $result[$code] = $fallback;
        }
        return $result;
    }
}

if (!function_exists('t2editor_parse_accept_language')) {
    function t2editor_parse_accept_language(string $accept, array $supported = array()): ?string
    {
        $ranked = array();
        $position = 0;
        foreach (explode(',', $accept) as $part) {
            $segments = explode(';', trim($part));
            $tag = isset($segments[0]) ? trim($segments[0]) : '';
            if ($tag === '' || $tag === '*') continue;
            $q = 1.0;
            for ($i = 1; $i < count($segments); $i++) {
                if (preg_match('/^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i', trim($segments[$i]), $m)) {
                    $q = (float)$m[1];
                    break;
                }
            }
            if ($q <= 0) continue;
            $ranked[] = array('tag' => $tag, 'q' => $q, 'position' => $position++);
        }
        usort($ranked, static function (array $a, array $b): int {
            if ($a['q'] === $b['q']) return $a['position'] <=> $b['position'];
            return $a['q'] < $b['q'] ? 1 : -1;
        });
        foreach ($ranked as $candidate) {
            $resolved = t2editor_resolve_locale($candidate['tag']);
            if ($resolved !== null && (!$supported || in_array($resolved, $supported, true))) return $resolved;
        }
        return null;
    }
}

if (!function_exists('t2editor_detect_requested_lang')) {
    /**
     * 쿠키 또는 Accept-Language에서 실제로 일치한 언어만 반환한다.
     * 일치 항목이 없을 때 기본 언어를 섞지 않아 클라이언트가 navigator.languages를
     * 다시 검사할 수 있게 한다.
     */
    function t2editor_detect_requested_lang(): ?string
    {
        if (!empty($_COOKIE['t2editor_lang'])) {
            $resolved = t2editor_resolve_locale((string)$_COOKIE['t2editor_lang']);
            if ($resolved !== null) return $resolved;
        }
        $accept = isset($_SERVER['HTTP_ACCEPT_LANGUAGE']) ? (string)$_SERVER['HTTP_ACCEPT_LANGUAGE'] : '';
        if ($accept !== '') {
            $resolved = t2editor_parse_accept_language($accept, t2editor_get_supported_langs());
            if ($resolved !== null) return $resolved;
        }
        return null;
    }
}

if (!function_exists('t2editor_detect_user_lang')) {
    function t2editor_detect_user_lang(): string
    {
        $detected = t2editor_detect_requested_lang();
        return $detected !== null ? $detected : t2editor_get_default_lang();
    }
}

if (!function_exists('t2editor_i18n_find_overlay_file')) {
    function t2editor_i18n_find_overlay_file(string $directory, string $lang): ?string
    {
        $lang = t2editor_i18n_normalize_locale($lang);
        $key = str_replace('\\', '/', rtrim($directory, '/\\')) . '|' . $lang;
        if (!isset($GLOBALS['_T2_I18N_OVERLAY_CACHE']) || !is_array($GLOBALS['_T2_I18N_OVERLAY_CACHE'])) $GLOBALS['_T2_I18N_OVERLAY_CACHE'] = array();
        if (array_key_exists($key, $GLOBALS['_T2_I18N_OVERLAY_CACHE'])) return $GLOBALS['_T2_I18N_OVERLAY_CACHE'][$key];
        if (!is_dir($directory) || $lang === '') return $GLOBALS['_T2_I18N_OVERLAY_CACHE'][$key] = null;
        $direct = rtrim($directory, '/\\') . '/' . $lang . '.json';
        if (is_file($direct)) return $GLOBALS['_T2_I18N_OVERLAY_CACHE'][$key] = $direct;
        $entries = @scandir($directory);
        if (!is_array($entries)) return $GLOBALS['_T2_I18N_OVERLAY_CACHE'][$key] = null;
        sort($entries, SORT_STRING);
        $fallback = null;
        $checked = 0;
        foreach ($entries as $entry) {
            if (++$checked > 250) break;
            if (!preg_match('/^[a-z0-9][a-z0-9._-]{0,79}\.json$/i', $entry)) continue;
            $path = $directory . '/' . $entry;
            if (!is_file($path)) continue;
            $fileCode = t2editor_i18n_normalize_locale(pathinfo($entry, PATHINFO_FILENAME));
            if ($fileCode === $lang) return $GLOBALS['_T2_I18N_OVERLAY_CACHE'][$key] = $path;
            $catalog = t2editor_i18n_read_json($path);
            if (!is_array($catalog)) continue;
            $meta = isset($catalog['_meta']) && is_array($catalog['_meta']) ? $catalog['_meta'] : array();
            if (isset($meta['enabled']) && $meta['enabled'] === false) continue;
            $metaCode = t2editor_i18n_normalize_locale(isset($meta['code']) ? $meta['code'] : '');
            if ($metaCode === $lang) return $GLOBALS['_T2_I18N_OVERLAY_CACHE'][$key] = $path;
            foreach ((array)(isset($meta['aliases']) ? $meta['aliases'] : array()) as $alias) {
                if (t2editor_i18n_normalize_locale($alias) === $lang) $fallback = $path;
            }
        }
        return $GLOBALS['_T2_I18N_OVERLAY_CACHE'][$key] = $fallback;
    }
}

if (!function_exists('t2editor_i18n_active_plugins')) {
    /** @return array<int,string> */
    function t2editor_i18n_active_plugins(): array
    {
        $plugins = isset($GLOBALS['T2EDITOR_PLUGINS']) && is_array($GLOBALS['T2EDITOR_PLUGINS']) ? $GLOBALS['T2EDITOR_PLUGINS'] : array();
        $signature = hash('sha256', serialize($plugins));
        if (isset($GLOBALS['_T2_I18N_ACTIVE_PLUGIN_CACHE'][$signature])) return $GLOBALS['_T2_I18N_ACTIVE_PLUGIN_CACHE'][$signature];
        $result = array();
        foreach ($plugins as $plugin) {
            if (!is_string($plugin) || !preg_match('/^[a-zA-Z0-9_-]{1,80}$/', $plugin)) continue;
            if (in_array($plugin, $result, true)) continue;
            if (!is_dir(t2editor_i18n_plugin_path($plugin))) continue;
            $result[] = $plugin;
        }
        if (!isset($GLOBALS['_T2_I18N_ACTIVE_PLUGIN_CACHE']) || !is_array($GLOBALS['_T2_I18N_ACTIVE_PLUGIN_CACHE'])) $GLOBALS['_T2_I18N_ACTIVE_PLUGIN_CACHE'] = array();
        return $GLOBALS['_T2_I18N_ACTIVE_PLUGIN_CACHE'][$signature] = $result;
    }
}

if (!function_exists('t2editor_i18n_flatten_into')) {
    function t2editor_i18n_flatten_into(array $data, array &$target, string $prefix = ''): void
    {
        foreach ($data as $key => $value) {
            if ($prefix === '' && $key === '_meta') continue;
            $key = (string)$key;
            if ($key === '' || strlen($key) > 200) continue;
            $fullKey = $prefix === '' ? $key : $prefix . '.' . $key;
            if (is_array($value) && array_values($value) !== $value) {
                t2editor_i18n_flatten_into($value, $target, $fullKey);
            } elseif (is_array($value)) {
                $target[$fullKey] = $value;
            } elseif (is_scalar($value) || $value === null) {
                $target[$fullKey] = $value === null ? '' : (string)$value;
            }
        }
    }
}

if (!function_exists('t2editor_i18n_merge_plugin_catalog')) {
    /**
     * Merge only the namespace owned by this plugin. A third-party locale pack
     * therefore cannot replace core/common strings or another plugin's text.
     */
    function t2editor_i18n_merge_plugin_catalog(array $catalog, string $plugin, array &$target): void
    {
        $meta = isset($catalog['_meta']) && is_array($catalog['_meta']) ? $catalog['_meta'] : array();
        if (isset($meta['enabled']) && $meta['enabled'] === false) return;
        if (isset($meta['plugin']) && (string)$meta['plugin'] !== $plugin) return;
        if (!isset($catalog[$plugin]) || !is_array($catalog[$plugin])) return;
        t2editor_i18n_flatten_into(array($plugin => $catalog[$plugin]), $target);
    }
}

if (!function_exists('t2editor_i18n_reset_request_cache')) {
    function t2editor_i18n_reset_request_cache(): void
    {
        foreach (array('_T2_I18N_JSON_CACHE','_T2_I18N_EXTEND_ROOTS','_T2_I18N_FILE_CANDIDATES','_T2_I18N_LOCALE_REGISTRY','_T2_I18N_ALIASES_CACHE','_T2_I18N_OVERLAY_CACHE','_T2_I18N_ACTIVE_PLUGIN_CACHE','_T2_I18N_MESSAGES_CACHE','_T2_I18N_COMPILED_CACHE') as $key) unset($GLOBALS[$key]);
    }
}

if (!function_exists('t2editor_i18n_compiled_file')) {
    function t2editor_i18n_compiled_file(): string
    {
        $private = defined('T2EDITOR_PRIVATE_PATH') ? T2EDITOR_PRIVATE_PATH : rtrim((string)T2EDITOR_PATH, '/\\') . '/data/t2editor_db/t2admin-private';
        return rtrim((string)$private, '/\\') . '/t2pack/cache/compiled-locales.php';
    }
}

if (!function_exists('t2editor_i18n_compiled_catalogs')) {
    function t2editor_i18n_compiled_catalogs(): ?array
    {
        if (!empty($GLOBALS['_T2_I18N_COMPILING'])) return null;
        if (array_key_exists('_T2_I18N_COMPILED_CACHE', $GLOBALS)) return $GLOBALS['_T2_I18N_COMPILED_CACHE'];
        $row = function_exists('t2_private_store_read') ? t2_private_store_read(t2editor_i18n_compiled_file(), null) : null;
        $index = function_exists('t2_extend_runtime_index') ? t2_extend_runtime_index() : null;
        $hasEmbedded = is_array($row) && isset($row['messages']) && is_array($row['messages']);
        $hasFiles = is_array($row) && isset($row['files']) && is_array($row['files']) && !empty($row['files']);
        if (!is_array($row) || !is_array($index)
            || (string)($row['release_id'] ?? '') !== (string)($index['release_id'] ?? '')
            || (string)($row['generation'] ?? '') !== (string)($index['generation'] ?? '')
            || (!$hasEmbedded && !$hasFiles)) {
            return $GLOBALS['_T2_I18N_COMPILED_CACHE'] = null;
        }
        return $GLOBALS['_T2_I18N_COMPILED_CACHE'] = $row;
    }
}

if (!function_exists('t2editor_i18n_compiled_message')) {
    function t2editor_i18n_compiled_message(array $compiled, string $lang): ?array
    {
        // Accept the previous all-in-one format so in-flight requests remain
        // safe while a newly activated release regenerates the lightweight map.
        if (isset($compiled['messages'][$lang]) && is_array($compiled['messages'][$lang])) {
            return $compiled['messages'][$lang];
        }
        $file = isset($compiled['files'][$lang]) && is_string($compiled['files'][$lang]) ? $compiled['files'][$lang] : '';
        if ($file === '' || !preg_match('/^[A-Za-z0-9_-]{1,80}$/', $lang)) return null;
        $root = dirname(t2editor_i18n_compiled_file()) . '/locales';
        $normalFile = str_replace('\\', '/', $file);
        $normalRoot = rtrim(str_replace('\\', '/', $root), '/');
        if ($normalFile !== $normalRoot && strncmp($normalFile . '/', $normalRoot . '/', strlen($normalRoot) + 1) !== 0) return null;
        $messages = function_exists('t2_private_store_read') ? t2_private_store_read($file, null) : null;
        return is_array($messages) ? $messages : null;
    }
}

if (!function_exists('t2editor_i18n_build_messages_for_plugins')) {
    function t2editor_i18n_build_messages_for_plugins(string $lang, array $plugins): array
    {
        $registry = t2editor_get_locale_registry();
        if (!isset($registry[$lang])) return array();
        $flattened = array();
        $core = t2editor_i18n_read_json((string)$registry[$lang]['file']);
        if (is_array($core)) t2editor_i18n_flatten_into($core, $flattened);
        foreach (t2editor_i18n_extend_locale_roots() as $extendRoot) {
            $extendFile = t2editor_i18n_find_overlay_file($extendRoot, $lang);
            if ($extendFile === null) continue;
            $extendCatalog = t2editor_i18n_read_json($extendFile);
            if (is_array($extendCatalog)) t2editor_i18n_flatten_into($extendCatalog, $flattened);
        }
        foreach ($plugins as $plugin) {
            if (!is_string($plugin) || !preg_match('/^[A-Za-z0-9_-]{1,80}$/', $plugin)) continue;
            $directory = t2editor_i18n_plugin_path($plugin) . '/locales';
            $file = t2editor_i18n_find_overlay_file($directory, $lang);
            if ($file === null) continue;
            $catalog = t2editor_i18n_read_json($file);
            if (is_array($catalog)) t2editor_i18n_merge_plugin_catalog($catalog, $plugin, $flattened);
        }
        return $flattened;
    }
}

if (!function_exists('t2editor_i18n_atomic_json')) {
    function t2editor_i18n_atomic_json(string $file, array $value): bool
    {
        $dir = dirname($file);
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) return false;
        try { $suffix = bin2hex(random_bytes(6)); } catch (Throwable $e) { $suffix = str_replace('.', '', uniqid('', true)); }
        $tmp = $file . '.tmp.' . $suffix;
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | (defined('JSON_INVALID_UTF8_SUBSTITUTE') ? JSON_INVALID_UTF8_SUBSTITUTE : 0));
        if (!is_string($json) || @file_put_contents($tmp, $json, LOCK_EX) === false) return false;
        @chmod($tmp, 0644);
        if (!@rename($tmp, $file)) { @unlink($tmp); return false; }
        @chmod($file, 0644);
        return true;
    }
}

if (!function_exists('t2editor_i18n_compile_lock_file')) {
    function t2editor_i18n_compile_lock_file(): string
    {
        return dirname(t2editor_i18n_compiled_file()) . '/locale-compile.lock';
    }
}

if (!function_exists('t2editor_i18n_remove_tree')) {
    function t2editor_i18n_remove_tree(string $path): void
    {
        if (!is_dir($path) || is_link($path)) { @unlink($path); return; }
        $items = @scandir($path);
        if (is_array($items)) {
            foreach ($items as $item) {
                if ($item === '.' || $item === '..') continue;
                t2editor_i18n_remove_tree($path . '/' . $item);
            }
        }
        @rmdir($path);
    }
}

if (!function_exists('t2editor_i18n_cleanup_public_generations')) {
    function t2editor_i18n_cleanup_public_generations(string $currentPath, int $keep = 3): void
    {
        $parent = dirname($currentPath);
        if (!is_dir($parent)) return;
        $currentName = basename($currentPath);
        $rows = array();
        $dirs = glob(rtrim($parent, '/\\') . '/*', GLOB_ONLYDIR);
        if (!is_array($dirs)) return;
        foreach ($dirs as $dir) {
            $name = basename($dir);
            if (!preg_match('/^[A-Za-z0-9._-]{1,180}$/', $name)) continue;
            $rows[] = array('path'=>$dir, 'name'=>$name, 'mtime'=>(int)(@filemtime($dir) ?: 0));
        }
        usort($rows, static function ($a, $b) {
            if ($a['name'] === $b['name']) return 0;
            if ($a['mtime'] === $b['mtime']) return strcmp($b['name'], $a['name']);
            return $b['mtime'] <=> $a['mtime'];
        });
        $keep = max(1, $keep);
        $keepNames = array($currentName => true);
        foreach ($rows as $row) {
            if (isset($keepNames[$row['name']])) continue;
            if (count($keepNames) >= $keep) break;
            $keepNames[$row['name']] = true;
        }
        foreach ($rows as $row) {
            if (!isset($keepNames[$row['name']])) t2editor_i18n_remove_tree($row['path']);
        }
    }
}

if (!function_exists('t2editor_i18n_compile_public_catalogs')) {
    function t2editor_i18n_compile_public_catalogs(array $index): array
    {
        if (empty($index['locale_public_path']) || empty($index['locale_public_url'])) return $index;
        $GLOBALS['_T2_I18N_COMPILING'] = true;
        t2editor_i18n_reset_request_cache();
        try {
            $plugins = isset($index['plugins']) && is_array($index['plugins']) ? array_keys($index['plugins']) : array();
            $urls = array();
            $files = array();
            $publicPath = rtrim((string)$index['locale_public_path'], '/\\');
            $publicUrl = rtrim((string)$index['locale_public_url'], '/');
            $generation = (string)($index['generation'] ?? '');
            if (!preg_match('/^[A-Za-z0-9._-]{1,180}$/', $generation)) throw new RuntimeException('번역 캐시 세대 식별자가 올바르지 않습니다.');
            $privatePath = dirname(t2editor_i18n_compiled_file()) . '/locales/' . $generation;
            if (!is_dir($publicPath) && !@mkdir($publicPath, 0755, true) && !is_dir($publicPath)) throw new RuntimeException('번역 정적 캐시 디렉터리를 만들 수 없습니다.');
            if (!is_dir($privatePath) && !@mkdir($privatePath, 0700, true) && !is_dir($privatePath)) throw new RuntimeException('번역 비공개 캐시 디렉터리를 만들 수 없습니다.');
            @chmod($publicPath, 0755);
            @chmod($privatePath, 0700);
            foreach (t2editor_get_supported_langs() as $lang) {
                $catalog = t2editor_i18n_build_messages_for_plugins($lang, $plugins);
                $privateFile = $privatePath . '/' . $lang . '.php';
                if (!t2_private_store_write($privateFile, $catalog)) throw new RuntimeException('번역 비공개 캐시를 저장하지 못했습니다: ' . $lang);
                $files[$lang] = $privateFile;
                $publicFile = $publicPath . '/' . $lang . '.json';
                if (!t2editor_i18n_atomic_json($publicFile, $catalog)) throw new RuntimeException('번역 정적 캐시를 저장하지 못했습니다: ' . $lang);
                $urls[$lang] = $publicUrl . '/' . rawurlencode($lang) . '.json';
            }
            $compiled = array(
                'release_id'=>(string)($index['release_id'] ?? ''),
                'generation'=>$generation,
                'generated_at'=>gmdate('c'),
                'files'=>$files,
            );
            if (!t2_private_store_write(t2editor_i18n_compiled_file(), $compiled)) throw new RuntimeException('번역 컴파일 캐시를 저장하지 못했습니다.');
            $index['locale_urls'] = $urls;
            if (function_exists('t2_extend_runtime_index_file')) t2_private_store_write(t2_extend_runtime_index_file(), $index);
            $GLOBALS['_T2_I18N_COMPILED_CACHE'] = $compiled;
            $GLOBALS['_T2_EXTEND_RUNTIME_INDEX'] = $index;
            t2editor_i18n_cleanup_public_generations($publicPath, 3);
            t2editor_i18n_cleanup_public_generations($privatePath, 3);
            return $index;
        } finally {
            unset($GLOBALS['_T2_I18N_COMPILING']);
            foreach (array('_T2_I18N_JSON_CACHE','_T2_I18N_EXTEND_ROOTS','_T2_I18N_FILE_CANDIDATES','_T2_I18N_LOCALE_REGISTRY','_T2_I18N_ALIASES_CACHE','_T2_I18N_OVERLAY_CACHE','_T2_I18N_ACTIVE_PLUGIN_CACHE','_T2_I18N_MESSAGES_CACHE') as $key) unset($GLOBALS[$key]);
        }
    }
}

if (!function_exists('t2editor_i18n_ensure_compiled_catalogs')) {
    function t2editor_i18n_ensure_compiled_catalogs(): ?array
    {
        $compiled = t2editor_i18n_compiled_catalogs();
        if (is_array($compiled)) return $compiled;
        $index = function_exists('t2_extend_runtime_index') ? t2_extend_runtime_index() : null;
        if (!is_array($index) || empty($index['locale_public_path'])) return null;
        $lockPath = t2editor_i18n_compile_lock_file();
        $lockDir = dirname($lockPath);
        if (!is_dir($lockDir) && !@mkdir($lockDir, 0700, true) && !is_dir($lockDir)) return null;
        @chmod($lockDir, 0700);
        $lock = @fopen($lockPath, 'c+');
        if ($lock === false || !@flock($lock, LOCK_EX)) {
            if (is_resource($lock)) @fclose($lock);
            return null;
        }
        try {
            // Another request may have completed the projection while this one
            // waited. Drop request-local negative caches and check again.
            unset($GLOBALS['_T2_I18N_COMPILED_CACHE']);
            if (function_exists('t2_private_store_forget')) t2_private_store_forget(t2editor_i18n_compiled_file());
            $compiled = t2editor_i18n_compiled_catalogs();
            if (is_array($compiled)) return $compiled;
            $index = function_exists('t2_extend_runtime_index') ? t2_extend_runtime_index() : null;
            if (!is_array($index) || empty($index['locale_public_path'])) return null;
            t2editor_i18n_compile_public_catalogs($index);
            unset($GLOBALS['_T2_I18N_COMPILED_CACHE']);
            if (function_exists('t2_private_store_forget')) t2_private_store_forget(t2editor_i18n_compiled_file());
            return t2editor_i18n_compiled_catalogs();
        } catch (Throwable $e) {
            error_log('[T2Editor I18N] Locale compilation failed; dynamic loader retained: ' . $e->getMessage());
            return null;
        } finally {
            @flock($lock, LOCK_UN);
            @fclose($lock);
        }
    }
}

if (!function_exists('t2editor_i18n_locale_urls')) {
    function t2editor_i18n_locale_urls(): array
    {
        t2editor_i18n_ensure_compiled_catalogs();
        $index = function_exists('t2_extend_runtime_index') ? t2_extend_runtime_index() : null;
        return is_array($index) && isset($index['locale_urls']) && is_array($index['locale_urls']) ? $index['locale_urls'] : array();
    }
}

if (!function_exists('t2editor_get_messages')) {
    function t2editor_get_messages(string $lang = ''): array
    {
        $resolved = t2editor_resolve_locale($lang);
        $lang = $resolved !== null ? $resolved : t2editor_get_default_lang();
        $plugins = t2editor_i18n_active_plugins();
        $cacheKey = $lang . '|' . implode(',', $plugins);
        if (isset($GLOBALS['_T2_I18N_MESSAGES_CACHE'][$cacheKey])) return $GLOBALS['_T2_I18N_MESSAGES_CACHE'][$cacheKey];
        $compiled = t2editor_i18n_ensure_compiled_catalogs();
        $compiledResult = is_array($compiled) ? t2editor_i18n_compiled_message($compiled, $lang) : null;
        if (is_array($compiledResult)) {
            $result = $compiledResult;
        } else {
            $result = t2editor_i18n_build_messages_for_plugins($lang, $plugins);
        }
        if (!isset($GLOBALS['_T2_I18N_MESSAGES_CACHE']) || !is_array($GLOBALS['_T2_I18N_MESSAGES_CACHE'])) $GLOBALS['_T2_I18N_MESSAGES_CACHE'] = array();
        return $GLOBALS['_T2_I18N_MESSAGES_CACHE'][$cacheKey] = $result;
    }
}

if (!function_exists('t2editor_get_all_messages')) {
    function t2editor_get_all_messages(): array
    {
        $compiled = t2editor_i18n_ensure_compiled_catalogs();
        $all = array();
        if (is_array($compiled)) {
            foreach (t2editor_get_supported_langs() as $lang) {
                $catalog = t2editor_i18n_compiled_message($compiled, $lang);
                if (!is_array($catalog)) { $all = array(); break; }
                $all[$lang] = $catalog;
            }
            if ($all) return $all;
        }
        foreach (t2editor_get_supported_langs() as $lang) $all[$lang] = t2editor_get_messages($lang);
        return $all;
    }
}

if (!function_exists('t2editor_get_public_locale_registry')) {
    /** @return array<string,array<string,mixed>> */
    function t2editor_get_public_locale_registry(): array
    {
        $public = array();
        $fallbacks = t2editor_get_locale_fallbacks();
        foreach (t2editor_get_locale_registry() as $code => $info) {
            $public[$code] = array(
                'code' => $code,
                'native' => $info['native'],
                'language' => $info['language'],
                'direction' => $info['direction'],
                'fallback' => isset($fallbacks[$code]) ? $fallbacks[$code] : '',
                'aliases' => $info['aliases'],
                'version' => $info['version'],
                'default' => !empty($info['default']),
                'package' => 'core',
            );
        }
        return $public;
    }
}
