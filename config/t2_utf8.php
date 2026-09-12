<?php
// Path: T2Editor/config/t2_utf8.php
// Developer note: 경로·도메인·권한 값은 공용 헬퍼를 통해 바꾸고 CMS별 절대경로를 직접 하드코딩하지 않는다.

if (!isset($GLOBALS['T2EDITOR_UTF8_LEGACY_POLYFILLS']) || !is_array($GLOBALS['T2EDITOR_UTF8_LEGACY_POLYFILLS'])) {
    $GLOBALS['T2EDITOR_UTF8_LEGACY_POLYFILLS'] = array();
}

if (!function_exists('t2_utf8_has_mb_provider')) {
    function t2_utf8_has_mb_provider($function)
    {
        return function_exists($function)
            && empty($GLOBALS['T2EDITOR_UTF8_LEGACY_POLYFILLS'][$function]);
    }
}

if (!function_exists('t2_utf8_is_utf8')) {
    function t2_utf8_is_utf8($encoding)
    {
        $encoding = strtoupper(str_replace(array('-', '_'), '', trim((string)$encoding)));
        return $encoding === '' || $encoding === 'UTF8';
    }
}

if (!function_exists('t2_utf8_length')) {
    function t2_utf8_length($value, $encoding = 'UTF-8')
    {
        $value = (string)$value;
        $encoding = (string)$encoding !== '' ? (string)$encoding : 'UTF-8';

        if (t2_utf8_has_mb_provider('mb_strlen')) {
            try {
                $length = @mb_strlen($value, $encoding);
                if ($length !== false) return $length;
            } catch (Throwable $e) {
            }
        }

        if (function_exists('iconv_strlen')) {
            $length = @iconv_strlen($value, $encoding);
            if ($length !== false) return $length;
        }

        if (t2_utf8_is_utf8($encoding) && function_exists('preg_match_all')
            && @preg_match_all('/./us', $value, $matches) !== false) {
            return count($matches[0]);
        }

        return strlen($value);
    }
}

if (!function_exists('t2_utf8_substr')) {
    function t2_utf8_substr($value, $start, $length = null, $encoding = 'UTF-8')
    {
        $value = (string)$value;
        $start = (int)$start;
        $encoding = (string)$encoding !== '' ? (string)$encoding : 'UTF-8';

        if (t2_utf8_has_mb_provider('mb_substr')) {
            try {
                $result = @mb_substr($value, $start, $length === null ? null : (int)$length, $encoding);
                if ($result !== false) return $result;
            } catch (Throwable $e) {
            }
        }

        if (function_exists('iconv_substr')) {
            $result = @iconv_substr($value, $start, $length === null ? 2147483647 : (int)$length, $encoding);
            if ($result !== false) return $result;
        }

        if (t2_utf8_is_utf8($encoding) && function_exists('preg_match_all')
            && @preg_match_all('/./us', $value, $matches) !== false) {
            $slice = $length === null
                ? array_slice($matches[0], $start)
                : array_slice($matches[0], $start, (int)$length);
            return implode('', $slice);
        }

        return $length === null ? substr($value, $start) : substr($value, $start, (int)$length);
    }
}

if (!function_exists('t2_utf8_lower')) {
    function t2_utf8_lower($value, $encoding = 'UTF-8')
    {
        $value = (string)$value;
        $encoding = (string)$encoding !== '' ? (string)$encoding : 'UTF-8';

        if (t2_utf8_has_mb_provider('mb_strtolower')) {
            try {
                $result = @mb_strtolower($value, $encoding);
                if (is_string($result)) return $result;
            } catch (Throwable $e) {
            }
        }

        return strtolower($value);
    }
}

if (!function_exists('t2_utf8_pos')) {
    function t2_utf8_pos($haystack, $needle, $offset = 0, $encoding = 'UTF-8')
    {
        $haystack = (string)$haystack;
        $needle = (string)$needle;
        $offset = (int)$offset;
        $encoding = (string)$encoding !== '' ? (string)$encoding : 'UTF-8';

        if (t2_utf8_has_mb_provider('mb_strpos')) {
            try {
                $result = @mb_strpos($haystack, $needle, $offset, $encoding);
                if ($result !== false) return $result;
            } catch (Throwable $e) {
            }
        }

        if (function_exists('iconv_strpos')) {
            $result = @iconv_strpos($haystack, $needle, $offset, $encoding);
            if ($result !== false) return $result;
        }

        if (t2_utf8_is_utf8($encoding)
            && function_exists('preg_match_all')
            && @preg_match_all('/./us', $haystack, $haystackChars) !== false
            && @preg_match_all('/./us', $needle, $needleChars) !== false) {
            $source = $haystackChars[0];
            $search = $needleChars[0];
            $sourceCount = count($source);
            if ($offset < 0) $offset = max(0, $sourceCount + $offset);
            if ($offset > $sourceCount) return false;
            if (!$search) return $offset;
            $limit = $sourceCount - count($search);
            for ($i = $offset; $i <= $limit; $i++) {
                if (array_slice($source, $i, count($search)) === $search) return $i;
            }
            return false;
        }

        $byteLength = strlen($haystack);
        if ($offset < 0) $offset = max(0, $byteLength + $offset);
        if ($offset > $byteLength) return false;
        if ($needle === '') return $offset;
        return strpos($haystack, $needle, $offset);
    }
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
