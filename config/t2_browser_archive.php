<?php
// Path: T2Editor/config/t2_browser_archive.php
// Developer note: 경로·도메인·권한 값은 공용 헬퍼를 통해 바꾸고 CMS별 절대경로를 직접 하드코딩하지 않는다.

if (!function_exists('t2browser_archive_backend')) {
    function t2browser_archive_backend()
    {
        if (class_exists('ZipArchive')) return 'ziparchive';
        if (function_exists('gzinflate')) return 'zlib';
        return 'browser';
    }
}


if (!function_exists('t2browser_utf8_valid')) {
    function t2browser_utf8_valid($value)
    {
        return is_string($value) && preg_match('//u', $value) === 1;
    }
}

if (!function_exists('t2browser_token_valid')) {
    function t2browser_token_valid($expected, $provided)
    {
        return is_string($expected) && is_string($provided) && $expected !== '' && hash_equals($expected, $provided);
    }
}

if (!function_exists('t2browser_read_chunk')) {
    function t2browser_read_chunk($maxBytes)
    {
        $maxBytes = max(1, (int)$maxBytes);
        $declared = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : 0;
        if ($declared < 1 || $declared > $maxBytes) throw new RuntimeException('업로드 조각 크기가 허용 범위를 벗어났습니다.');
        $data = file_get_contents('php://input');
        if (!is_string($data) || strlen($data) !== $declared) throw new RuntimeException('업로드 조각을 모두 읽지 못했습니다.');
        return $data;
    }
}

if (!function_exists('t2browser_append_chunk')) {
    function t2browser_append_chunk($file, $offset, $data, $expectedBytes)
    {
        $offset = (int)$offset;
        $expectedBytes = (int)$expectedBytes;
        if ($offset < 0 || $expectedBytes < 0 || $offset + strlen($data) > $expectedBytes) throw new RuntimeException('업로드 위치 또는 크기가 올바르지 않습니다.');
        $dir = dirname($file);
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('브라우저 업로드 임시 폴더를 만들 수 없습니다.');
        $fp = @fopen($file, 'c+b');
        if ($fp === false) throw new RuntimeException('브라우저 업로드 임시 파일을 열 수 없습니다.');
        try {
            if (!flock($fp, LOCK_EX)) throw new RuntimeException('브라우저 업로드 파일 잠금을 얻지 못했습니다.');
            $stat = fstat($fp);
            $current = is_array($stat) && isset($stat['size']) ? (int)$stat['size'] : 0;
            $length = strlen($data);
            if ($current !== $offset) {
                if ($length > 0 && $current === $offset + $length && fseek($fp, $offset) === 0) {
                    $existing = (string)fread($fp, $length);
                    if (strlen($existing) === $length && hash_equals($existing, $data)) return $current;
                }
                throw new RuntimeException('업로드 조각 순서가 일치하지 않습니다.');
            }
            if (fseek($fp, $offset) !== 0) throw new RuntimeException('업로드 위치를 찾지 못했습니다.');
            $written = 0;
            while ($written < $length) {
                $n = fwrite($fp, substr($data, $written));
                if ($n === false || $n < 1) throw new RuntimeException('업로드 조각을 저장하지 못했습니다.');
                $written += $n;
            }
            fflush($fp);
            return $offset + $written;
        } finally {
            @flock($fp, LOCK_UN);
            fclose($fp);
        }
    }
}

if (!function_exists('t2browser_crc32_file')) {
    function t2browser_crc32_file($file)
    {
        $hash = @hash_file('crc32b', $file);
        return is_string($hash) ? strtolower($hash) : '';
    }
}

if (!function_exists('t2browser_dos_time_date')) {
    function t2browser_dos_time_date($timestamp = null)
    {
        $timestamp = $timestamp === null ? time() : (int)$timestamp;
        $parts = getdate($timestamp);
        $year = max(1980, min(2107, (int)$parts['year']));
        $time = ((int)$parts['hours'] << 11) | ((int)$parts['minutes'] << 5) | ((int)$parts['seconds'] >> 1);
        $date = (($year - 1980) << 9) | ((int)$parts['mon'] << 5) | (int)$parts['mday'];
        return array($time, $date);
    }
}

if (!function_exists('t2browser_crc_le')) {
    function t2browser_crc_le($hex)
    {
        $hex = strtolower((string)$hex);
        if (!preg_match('/^[a-f0-9]{8}$/', $hex)) throw new RuntimeException('CRC 값이 올바르지 않습니다.');
        return pack('H*', implode('', array_reverse(str_split($hex, 2))));
    }
}

if (!function_exists('t2browser_write_store_zip')) {
    function t2browser_write_store_zip($output, $entries)
    {
        if (!is_array($entries) || !$entries) throw new RuntimeException('ZIP으로 만들 파일이 없습니다.');
        $dir = dirname($output);
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('ZIP 출력 폴더를 만들 수 없습니다.');
        $fp = @fopen($output, 'wb');
        if ($fp === false) throw new RuntimeException('ZIP 출력 파일을 만들 수 없습니다.');
        $central = array();
        $seen = array();
        $offset = 0;
        list($dosTime, $dosDate) = t2browser_dos_time_date();
        try {
            foreach ($entries as $entry) {
                $name = isset($entry['name']) ? str_replace('\\', '/', (string)$entry['name']) : '';
                $source = isset($entry['file']) ? (string)$entry['file'] : '';
                $size = is_file($source) ? (int)@filesize($source) : -1;
                $crc = is_file($source) ? t2browser_crc32_file($source) : '';
                $unsafe = $name === '' || substr($name, -1) === '/' || strpos($name, "\0") !== false || $name[0] === '/' || preg_match('#^[A-Za-z]:/#', $name) || preg_match('#(^|/)\.\.?(/|$)#', $name);
                if ($unsafe || !t2browser_utf8_valid($name) || strlen($name) > 65535 || isset($seen[$name]) || $size < 0 || $size > 0xffffffff || $crc === '') throw new RuntimeException('STORE ZIP 입력 파일 정보가 올바르지 않습니다.');
                $seen[$name] = true;
                $nameBytes = $name;
                $local = pack('Vvvvvv', 0x04034b50, 20, 0x0800, 0, $dosTime, $dosDate)
                    . t2browser_crc_le($crc)
                    . pack('VVvv', $size, $size, strlen($nameBytes), 0)
                    . $nameBytes;
                if (fwrite($fp, $local) !== strlen($local)) throw new RuntimeException('ZIP 로컬 헤더를 저장하지 못했습니다.');
                $in = @fopen($source, 'rb');
                if ($in === false) throw new RuntimeException('ZIP 입력 파일을 열 수 없습니다.');
                $copied = stream_copy_to_stream($in, $fp);
                fclose($in);
                if ($copied === false || (int)$copied !== $size) throw new RuntimeException('ZIP 입력 파일을 모두 저장하지 못했습니다.');
                $central[] = array('name'=>$nameBytes, 'size'=>$size, 'crc'=>$crc, 'offset'=>$offset);
                $offset += strlen($local) + $size;
            }
            $centralOffset = $offset;
            foreach ($central as $entry) {
                $header = pack('Vvvvvvv', 0x02014b50, 20, 20, 0x0800, 0, $dosTime, $dosDate)
                    . t2browser_crc_le($entry['crc'])
                    . pack('VVvvvvvVV', $entry['size'], $entry['size'], strlen($entry['name']), 0, 0, 0, 0, 0, $entry['offset'])
                    . $entry['name'];
                if (fwrite($fp, $header) !== strlen($header)) throw new RuntimeException('ZIP 중앙 디렉터리를 저장하지 못했습니다.');
                $offset += strlen($header);
            }
            $count = count($central);
            if ($count > 65535) throw new RuntimeException('STORE ZIP 파일 수가 너무 많습니다.');
            $eocd = pack('VvvvvVVv', 0x06054b50, 0, 0, $count, $count, $offset - $centralOffset, $centralOffset, 0);
            if (fwrite($fp, $eocd) !== strlen($eocd)) throw new RuntimeException('ZIP 종료 레코드를 저장하지 못했습니다.');
        } finally {
            fclose($fp);
        }
        return $output;
    }
}

// T2Editor Coding-Agent Rule: Write only concise, high-value comments. Preserve "Path: T2Editor/..." comments; update them when files move—never delete them.
