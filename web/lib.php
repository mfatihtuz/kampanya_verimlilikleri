<?php
/**
 * Kampanya Verimlilikleri - Cekirdek Kutuphane
 *
 * Bu dosya uc bilesen icerir:
 *  1) SimpleXLSXParser : Bagimliliksiz .xlsx okuyucu
 *  2) CampaignAnalyzer : Gunluk uretim kayitlarini "kampanya" gruplarina cevirir
 *  3) SimpleSMTP       : E-posta ile dogrulama kodu (OTP) gonderimi
 *
 * Analiz mantigi, mevcut web sitesindeki ile birebir aynidir; boylece
 * uretilen sayilar kullanicinin alisik oldugu degerlerle ayni kalir.
 */

if (!defined('APP_BOOT')) {
    http_response_code(403);
    exit('Forbidden');
}

/* ------------------------------------------------------------------ */
/* 1) XLSX OKUYUCU                                                     */
/* ------------------------------------------------------------------ */
class SimpleXLSXParser
{
    private $sharedStrings = [];
    private $rows = [];

    public function parse($filename)
    {
        if (!file_exists($filename)) {
            return false;
        }
        $zip = new ZipArchive();
        if ($zip->open($filename) !== true) {
            return false;
        }

        if ($zip->locateName('xl/sharedStrings.xml') !== false) {
            $xml = simplexml_load_string($zip->getFromName('xl/sharedStrings.xml'));
            if ($xml) {
                foreach ($xml->si as $si) {
                    // Hem duz metin hem zengin metin (rich text) parcalarini topla
                    if (isset($si->t)) {
                        $this->sharedStrings[] = (string) $si->t;
                    } else {
                        $buf = '';
                        foreach ($si->r as $r) {
                            $buf .= (string) $r->t;
                        }
                        $this->sharedStrings[] = $buf;
                    }
                }
            }
        }

        if ($zip->locateName('xl/worksheets/sheet1.xml') !== false) {
            $xml = simplexml_load_string($zip->getFromName('xl/worksheets/sheet1.xml'));
            if ($xml) {
                foreach ($xml->sheetData->row as $row) {
                    $rowData = [];
                    foreach ($row->c as $c) {
                        $cellIndex = (string) $c['r'];
                        $type = (string) $c['t'];
                        $val = (string) $c->v;
                        if ($type === 's') {
                            $val = isset($this->sharedStrings[(int) $val]) ? $this->sharedStrings[(int) $val] : $val;
                        } elseif ($type === 'inlineStr' && isset($c->is)) {
                            // Satir ici metin: <is><t>..</t></is> veya zengin metin parcalari
                            if (isset($c->is->t)) {
                                $val = (string) $c->is->t;
                            } else {
                                $buf = '';
                                foreach ($c->is->r as $r) {
                                    $buf .= (string) $r->t;
                                }
                                $val = $buf;
                            }
                        }
                        $colLetter = preg_replace('/[0-9]+/', '', $cellIndex);
                        $colIndex = $this->columnLetterToNumber($colLetter) - 1;
                        $rowData[$colIndex] = $val;
                    }
                    ksort($rowData);
                    $maxKey = !empty($rowData) ? max(array_keys($rowData)) : -1;
                    $cleanRow = [];
                    for ($i = 0; $i <= $maxKey; $i++) {
                        $cleanRow[$i] = isset($rowData[$i]) ? $rowData[$i] : '';
                    }
                    $this->rows[] = $cleanRow;
                }
            }
        }
        $zip->close();
        return true;
    }

    public function getRows()
    {
        return $this->rows;
    }

    private function columnLetterToNumber($c)
    {
        $c = strtoupper($c);
        $l = strlen($c);
        $n = 0;
        for ($i = 0; $i < $l; $i++) {
            $n = $n * 26 + ord($c[$i]) - 0x40;
        }
        return $n;
    }
}

/* ------------------------------------------------------------------ */
/* 2) KAMPANYA ANALIZ MOTORU                                           */
/* ------------------------------------------------------------------ */
class CampaignAnalyzer
{
    private $data = [];
    private $campaigns = [];
    private $months = [
        'OCA' => '01', 'SUB' => '02', 'ŞUB' => '02', 'MAR' => '03',
        'NIS' => '04', 'NİS' => '04', 'MAY' => '05', 'HAZ' => '06',
        'TEM' => '07', 'AGU' => '08', 'AĞU' => '08', 'EYL' => '09',
        'EKI' => '10', 'EKİ' => '10', 'KAS' => '11', 'ARA' => '12',
    ];

    private function parseDate($dateVal)
    {
        $dateVal = trim($dateVal);
        if ($dateVal === '') {
            return null;
        }
        // Excel seri numarasi (gun) ise tarihe cevir
        if (is_numeric($dateVal) && $dateVal > 10000) {
            return gmdate('Y-m-d', ((int) $dateVal - 25569) * 86400);
        }
        $dateStr = mb_strtoupper($dateVal, 'UTF-8');
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateStr)) {
            return $dateStr;
        }
        if (strpos($dateStr, '-') !== false) {
            $parts = explode('-', $dateStr);
            if (count($parts) === 3) {
                if (is_numeric($parts[1])) {
                    return $parts[2] . '-' . str_pad($parts[1], 2, '0', STR_PAD_LEFT) . '-' . str_pad($parts[0], 2, '0', STR_PAD_LEFT);
                }
                $month = isset($this->months[$parts[1]]) ? $this->months[$parts[1]] : '01';
                return $parts[2] . '-' . $month . '-' . str_pad($parts[0], 2, '0', STR_PAD_LEFT);
            }
        }
        if (strpos($dateStr, '.') !== false) {
            $parts = explode('.', $dateStr);
            if (count($parts) === 3) {
                return $parts[2] . '-' . str_pad($parts[1], 2, '0', STR_PAD_LEFT) . '-' . str_pad($parts[0], 2, '0', STR_PAD_LEFT);
            }
        }
        return null;
    }

    public function loadDataFromArray($rows)
    {
        if (empty($rows)) {
            return;
        }
        // Baslik satirini bul (KALEM / TARIH iceren satir)
        $startIndex = 0;
        foreach ($rows as $i => $row) {
            $rowStr = implode(' ', $row);
            if (mb_stripos($rowStr, 'KALEM') !== false || mb_stripos($rowStr, 'TARİH') !== false || mb_stripos($rowStr, 'TARIH') !== false) {
                $startIndex = $i + 1;
                break;
            }
        }
        $cleanFloat = function ($val) {
            return (float) str_replace(',', '.', $val);
        };
        for ($i = $startIndex; $i < count($rows); $i++) {
            $row = $rows[$i];
            if (count($row) < 9 || empty($row[0])) {
                continue;
            }
            $parsedDate = $this->parseDate($row[3]);
            if (!$parsedDate) {
                continue;
            }
            $this->data[] = [
                'kalem' => trim($row[0]),
                'yil' => trim($row[1]),
                'hat' => trim($row[2]),
                'tarih' => $parsedDate,
                'saat' => $cleanFloat($row[4]),
                'devir' => $cleanFloat($row[5]),
                'adetsel' => $cleanFloat($row[6]),
                'zamansal' => $cleanFloat($row[7]),
                'verim' => $cleanFloat($row[8]),
            ];
        }
    }

    public function analyze()
    {
        if (empty($this->data)) {
            return [];
        }
        usort($this->data, function ($a, $b) {
            return strcmp($a['kalem'], $b['kalem'])
                ?: strcmp($a['hat'], $b['hat'])
                ?: strcmp($a['yil'], $b['yil'])
                ?: strcmp($a['tarih'], $b['tarih']);
        });

        $current = null;
        foreach ($this->data as $row) {
            $consecutive = false;
            if ($current
                && $current['kalem'] === $row['kalem']
                && $current['hat'] === $row['hat']
                && $current['yil'] === $row['yil']) {
                $diff = (new DateTime($current['last_date']))->diff(new DateTime($row['tarih']));
                if ($diff->days <= 1) {
                    $consecutive = true;
                }
            }
            if ($consecutive) {
                $current['last_date'] = $row['tarih'];
                $current['total_hours'] += $row['saat'];
                $current['w_devir'] += ($row['devir'] * $row['saat']);
                $current['w_adetsel'] += ($row['adetsel'] * $row['saat']);
                $current['w_zamansal'] += ($row['zamansal'] * $row['saat']);
                $current['w_verim'] += ($row['verim'] * $row['saat']);
            } else {
                if ($current) {
                    $this->finalize($current);
                }
                $current = [
                    'kalem' => $row['kalem'], 'hat' => $row['hat'], 'yil' => $row['yil'],
                    'start_date' => $row['tarih'], 'last_date' => $row['tarih'],
                    'total_hours' => $row['saat'],
                    'w_devir' => $row['devir'] * $row['saat'],
                    'w_adetsel' => $row['adetsel'] * $row['saat'],
                    'w_zamansal' => $row['zamansal'] * $row['saat'],
                    'w_verim' => $row['verim'] * $row['saat'],
                ];
            }
        }
        if ($current) {
            $this->finalize($current);
        }
        return $this->campaigns;
    }

    private function finalize($c)
    {
        $h = $c['total_hours'] ?: 1;
        $this->campaigns[] = [
            'kalem' => $c['kalem'],
            'hat' => $c['hat'],
            'yil' => $c['yil'],
            'baslangic' => date('d.m.Y', strtotime($c['start_date'])),
            'bitis' => date('d.m.Y', strtotime($c['last_date'])),
            'baslangic_iso' => $c['start_date'],
            'bitis_iso' => $c['last_date'],
            'verim' => ($c['w_verim'] / $h) * 100,
            'adetsel' => ($c['w_adetsel'] / $h) * 100,
            'zamansal' => ($c['w_zamansal'] / $h) * 100,
            'saat' => $c['total_hours'],
            'devir' => ($c['w_devir'] / $h),
        ];
    }
}

/* ------------------------------------------------------------------ */
/* 3) SMTP (OTP gonderimi)                                             */
/* ------------------------------------------------------------------ */
class SimpleSMTP
{
    private $connection;
    private $lastError = '';

    public function getLastError()
    {
        return $this->lastError;
    }

    public function send($to, $subject, $message, $headers)
    {
        $context = stream_context_create([
            'ssl' => [
                'verify_peer' => false,
                'verify_peer_name' => false,
                'allow_self_signed' => true,
            ],
        ]);

        $this->connection = @stream_socket_client(
            SMTP_HOST . ':' . SMTP_PORT,
            $errno,
            $errstr,
            30,
            STREAM_CLIENT_CONNECT,
            $context
        );

        if (!$this->connection) {
            $this->lastError = "Baglanti Hatasi: $errstr ($errno)";
            return false;
        }

        if (!$this->expect(220, 'Baglanti reddedildi')) return false;

        fputs($this->connection, 'EHLO ' . ($_SERVER['SERVER_NAME'] ?? 'localhost') . "\r\n");
        if (!$this->expect(250, 'EHLO hatasi')) return false;

        if (SMTP_SECURE === 'tls') {
            fputs($this->connection, "STARTTLS\r\n");
            if (!$this->expect(220, 'STARTTLS baslatilamadi')) return false;
            if (!stream_socket_enable_crypto($this->connection, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                $this->lastError = 'TLS tuneli kurulamadi.';
                return false;
            }
            fputs($this->connection, 'EHLO ' . ($_SERVER['SERVER_NAME'] ?? 'localhost') . "\r\n");
            if (!$this->expect(250, 'TLS sonrasi EHLO hatasi')) return false;
        }

        if (defined('SMTP_USER') && SMTP_USER != '') {
            fputs($this->connection, "AUTH LOGIN\r\n");
            if (!$this->expect(334, 'Auth Login reddedildi')) return false;
            fputs($this->connection, base64_encode(SMTP_USER) . "\r\n");
            if (!$this->expect(334, 'Kullanici adi reddedildi')) return false;
            fputs($this->connection, base64_encode(SMTP_PASS) . "\r\n");
            if (!$this->expect(235, 'Sifre reddedildi')) return false;
        }

        fputs($this->connection, 'MAIL FROM: <' . SMTP_USER . ">\r\n");
        if (!$this->expect(250, 'Gonderici adresi reddedildi')) return false;

        fputs($this->connection, 'RCPT TO: <' . $to . ">\r\n");
        if (!$this->expect([250, 251], 'Alici adresi reddedildi')) return false;

        fputs($this->connection, "DATA\r\n");
        if (!$this->expect(354, 'DATA komutu reddedildi')) return false;

        $mailContent = "Subject: $subject\r\n";
        $mailContent .= "To: $to\r\n";
        $mailContent .= $headers . "\r\n\r\n";
        $mailContent .= $message . "\r\n.";
        fputs($this->connection, $mailContent . "\r\n");
        if (!$this->expect(250, 'Mesaj govdesi reddedildi')) return false;

        fputs($this->connection, "QUIT\r\n");
        fclose($this->connection);
        return true;
    }

    private function expect($codes, $failMsg)
    {
        $response = '';
        while ($line = fgets($this->connection, 515)) {
            $response .= $line;
            if (substr($line, 3, 1) == ' ') break;
        }
        $code = (int) substr($response, 0, 3);
        if (!is_array($codes)) $codes = [$codes];
        if (!in_array($code, $codes)) {
            $this->lastError = "$failMsg [Sunucu Yaniti: $response]";
            return false;
        }
        return true;
    }
}

/* ------------------------------------------------------------------ */
/* YARDIMCI: Excel'i isle, sonucu onbellege al                         */
/* ------------------------------------------------------------------ */

/**
 * Excel dosyasini okuyup kampanya listesini ve ozet KPI'lari uretir.
 * Sonuc, Excel degismedikce onbellekten (cache/data.json) servis edilir.
 * Boylece 18binden fazla satir her istekte yeniden islenmez.
 */
function build_dataset($xlsxPath, $cachePath)
{
    $useCache = file_exists($cachePath)
        && file_exists($xlsxPath)
        && filemtime($cachePath) >= filemtime($xlsxPath);

    if ($useCache) {
        $json = json_decode(file_get_contents($cachePath), true);
        if (is_array($json) && isset($json['campaigns'])) {
            return $json;
        }
    }

    $analyzer = new CampaignAnalyzer();
    $parser = new SimpleXLSXParser();
    if (!file_exists($xlsxPath) || !$parser->parse($xlsxPath)) {
        return ['campaigns' => [], 'summary' => null, 'error' => 'Excel dosyasi okunamadi.'];
    }
    $analyzer->loadDataFromArray($parser->getRows());
    $campaigns = $analyzer->analyze();
    $dataset = [
        'campaigns' => $campaigns,
        'summary' => summarize($campaigns),
        'generated_at' => date('c'),
        'source_updated_at' => date('c', @filemtime($xlsxPath) ?: time()),
    ];

    @file_put_contents($cachePath, json_encode($dataset, JSON_UNESCAPED_UNICODE));
    return $dataset;
}

/** Genel KPI ozetleri + filtre secenekleri (yil/hat listeleri) */
function summarize($campaigns)
{
    $totalHours = 0.0;
    $wVerim = 0.0;
    $wDevir = 0.0;
    $years = [];
    $lines = [];
    foreach ($campaigns as $r) {
        $totalHours += $r['saat'];
        $wVerim += $r['verim'] * $r['saat'];
        $wDevir += $r['devir'] * $r['saat'];
        if ($r['yil'] !== '') $years[$r['yil']] = true;
        if ($r['hat'] !== '') $lines[$r['hat']] = true;
    }
    $years = array_keys($years);
    $lines = array_keys($lines);
    sort($years);
    natcasesort($lines);
    $lines = array_values($lines);

    return [
        'count' => count($campaigns),
        'total_hours' => $totalHours,
        'avg_verim' => $totalHours > 0 ? $wVerim / $totalHours : 0,
        'avg_devir' => $totalHours > 0 ? $wDevir / $totalHours : 0,
        'years' => $years,
        'lines' => $lines,
    ];
}
