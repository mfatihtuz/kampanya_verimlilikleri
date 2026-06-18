<?php
/**
 * Kampanya Verimlilikleri - JSON API
 *
 * Uygulamanin (PWA) konustugu tek arka uc. Tum uclar JSON dondurur.
 *
 *  GET  ?action=session        Oturum durumu (giris yapildi mi, kim, yonetici mi)
 *  POST ?action=login          1. adim: e-posta veya yonetici anahtari
 *  POST ?action=verify         2. adim: e-posta dogrulama kodu (OTP)
 *  POST ?action=logout         Cikis
 *  GET  ?action=data           Kampanya verisi + ozet (giris gerekir)
 *  POST ?action=upload         Yeni Excel yukle (yalnizca yonetici)
 */

define('APP_BOOT', true);
require __DIR__ . '/config.php';
require __DIR__ . '/lib.php';

mb_internal_encoding('UTF-8');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/* ---------------- Yardimcilar ---------------- */

function json_out($data, $code = 200)
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function body_json()
{
    $raw = file_get_contents('php://input');
    $j = json_decode($raw, true);
    return is_array($j) ? $j : [];
}

function start_app_session()
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') == 443);
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => $https,
    ]);
    session_start();
}

function b64url_encode($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function b64url_decode($s) { return base64_decode(strtr($s, '-_', '+/')); }

/** Imzali "beni hatirla" jetonu uretir.
 *  Guvenlik: jeton ASLA yonetici yetkisi tasimaz. Kalici oturum yalnizca
 *  goruntuleme (calisan) seviyesindedir; "Veri Guncelle" icin her seferinde
 *  yonetici sifresiyle giris gerekir. */
function make_remember_token($email)
{
    $payload = [
        'e' => $email,
        'x' => time() + REMEMBER_DAYS * 86400,
    ];
    $p = b64url_encode(json_encode($payload, JSON_UNESCAPED_UNICODE));
    $sig = b64url_encode(hash_hmac('sha256', $p, APP_SECRET, true));
    return $p . '.' . $sig;
}

/** Jetonu dogrular; gecerliyse payload dizisini, degilse null dondurur */
function verify_remember_token($token)
{
    if (!$token || strpos($token, '.') === false) return null;
    list($p, $sig) = explode('.', $token, 2);
    $expected = b64url_encode(hash_hmac('sha256', $p, APP_SECRET, true));
    if (!hash_equals($expected, $sig)) return null;
    $payload = json_decode(b64url_decode($p), true);
    if (!is_array($payload) || ($payload['x'] ?? 0) < time()) return null;
    return $payload;
}

function set_remember_cookie($email)
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') == 443);
    setcookie('lav_remember', make_remember_token($email), [
        'expires' => time() + REMEMBER_DAYS * 86400,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => $https,
    ]);
}

function clear_remember_cookie()
{
    setcookie('lav_remember', '', [
        'expires' => time() - 3600,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function login_user($email, $isAdmin, $remember)
{
    $_SESSION['auth'] = true;
    $_SESSION['email'] = $email;
    $_SESSION['is_admin'] = (bool) $isAdmin;
    // Guvenlik: Yonetici oturumu KALICI YAPILMAZ. "Veri Guncelle" yetkisi
    // yalnizca, o oturumda sifreyle giris yapildiginda gecerlidir. Yalnizca
    // calisan (e-posta) girisleri "beni hatirla" ile kalici olabilir.
    if ($remember && !$isAdmin) {
        set_remember_cookie($email);
    }
}

/** Oturum yoksa "beni hatirla" cerezinden geri yukler.
 *  Kalici oturum ASLA yonetici degildir (yalnizca goruntuleme). */
function ensure_session_from_cookie()
{
    if (!empty($_SESSION['auth'])) return;
    if (!empty($_COOKIE['lav_remember'])) {
        $payload = verify_remember_token($_COOKIE['lav_remember']);
        if ($payload) {
            $_SESSION['auth'] = true;
            $_SESSION['email'] = $payload['e'];
            $_SESSION['is_admin'] = false;
        }
    }
}

function require_auth()
{
    if (empty($_SESSION['auth'])) {
        json_out(['error' => 'unauthorized'], 401);
    }
}

function require_admin()
{
    require_auth();
    if (empty($_SESSION['is_admin'])) {
        json_out(['error' => 'forbidden'], 403);
    }
}

/* ---------------- WebAuthn (Face ID / parmak izi ile giris) ----------------
 * Standart passkey akisi. Sunucu, cihazin urettigi imzayi saklanan acik
 * anahtarla dogrular; e-posta ile giris her zaman yedek olarak kalir.
 */

function wa_rpid()
{
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return preg_replace('/:\d+$/', '', $host);
}

function wa_origin()
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') == 443);
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

function wa_file()
{
    return CACHE_DIR . '/webauthn.json';
}

function wa_load()
{
    if (!file_exists(wa_file())) return [];
    $j = json_decode(file_get_contents(wa_file()), true);
    return is_array($j) ? $j : [];
}

function wa_save($data)
{
    if (!is_dir(CACHE_DIR)) @mkdir(CACHE_DIR, 0775, true);
    @file_put_contents(wa_file(), json_encode($data, JSON_UNESCAPED_UNICODE));
}

/** clientDataJSON dogrulamasi: tip, challenge ve origin */
function wa_check_clientdata($clientDataJson, $expectedType)
{
    $cd = json_decode($clientDataJson, true);
    if (!is_array($cd)) return 'clientData';
    if (($cd['type'] ?? '') !== $expectedType) return 'type';
    $chal = $_SESSION['wa_challenge'] ?? '';
    if ($chal === '' || !hash_equals($chal, (string) ($cd['challenge'] ?? ''))) return 'challenge';
    if (($cd['origin'] ?? '') !== wa_origin()) return 'origin';
    return true;
}

/* ---------------- Yonlendirme ---------------- */

start_app_session();
ensure_session_from_cookie();

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

switch ($action) {

    case 'session':
        json_out([
            'authed' => !empty($_SESSION['auth']),
            'email' => $_SESSION['email'] ?? null,
            'isAdmin' => !empty($_SESSION['is_admin']),
            'domain' => ALLOWED_DOMAIN,
        ]);
        break;

    case 'login':
        if ($method !== 'POST') json_out(['error' => 'method'], 405);
        $in = body_json();
        $identifier = trim($in['identifier'] ?? '');
        $remember = !empty($in['remember']);

        if ($identifier === '') {
            json_out(['error' => 'empty', 'message' => 'Lutfen e-posta adresinizi girin.'], 422);
        }

        // Yonetici anahtari (tek alandan, sessizce). Arayuzde ima edilmez.
        if (hash_equals(ADMIN_KEY, $identifier)) {
            login_user('Yönetici', true, $remember);
            json_out(['status' => 'ok']);
        }

        // Kurumsal e-posta -> dogrulama kodu gonder
        if (str_ends_with(mb_strtolower($identifier), ALLOWED_DOMAIN)) {
            $otp = random_int(100000, 999999);
            $_SESSION['otp_code'] = (string) $otp;
            $_SESSION['otp_time'] = time();
            $_SESSION['otp_email'] = $identifier;
            $_SESSION['otp_remember'] = $remember;

            $subject = 'LAV Panel Giris Kodu';
            $message = "Merhaba,\r\n\r\nGuvenli giris kodunuz: $otp\r\n\r\nBu kod " . (OTP_VALIDITY / 60) . " dakika gecerlidir.";
            $headers = 'From: LAV Panel <' . SMTP_USER . ">\r\n";
            $headers .= 'Content-Type: text/plain; charset=UTF-8';

            $smtp = new SimpleSMTP();
            $sent = $smtp->send($identifier, $subject, $message, $headers);
            if (!$sent) {
                json_out([
                    'error' => 'mail',
                    'message' => 'Dogrulama e-postasi gonderilemedi. Lutfen tekrar deneyin.',
                    'detail' => $smtp->getLastError(),
                ], 502);
            }
            json_out(['status' => 'otp', 'email' => $identifier]);
        }

        json_out([
            'error' => 'domain',
            'message' => 'Yalnizca kurumsal e-posta adresiniz ile giris yapabilirsiniz.',
        ], 422);
        break;

    case 'verify':
        if ($method !== 'POST') json_out(['error' => 'method'], 405);
        $in = body_json();
        $code = trim($in['otp'] ?? '');
        if (empty($_SESSION['otp_code'])) {
            json_out(['error' => 'expired', 'message' => 'Oturum bulunamadi. Lutfen tekrar deneyin.'], 422);
        }
        if ((time() - ($_SESSION['otp_time'] ?? 0)) > OTP_VALIDITY) {
            unset($_SESSION['otp_code']);
            json_out(['error' => 'expired', 'message' => 'Kodun suresi doldu. Lutfen tekrar deneyin.'], 422);
        }
        if (hash_equals((string) $_SESSION['otp_code'], $code)) {
            $email = $_SESSION['otp_email'];
            $remember = !empty($_SESSION['otp_remember']);
            unset($_SESSION['otp_code'], $_SESSION['otp_time'], $_SESSION['otp_remember']);
            login_user($email, false, $remember);
            json_out(['status' => 'ok']);
        }
        json_out(['error' => 'wrong', 'message' => 'Girdiginiz kod hatali.'], 422);
        break;

    case 'logout':
        clear_remember_cookie();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
        json_out(['status' => 'ok']);
        break;

    case 'data':
        require_auth();
        if (!is_dir(CACHE_DIR)) @mkdir(CACHE_DIR, 0775, true);
        $ds = build_dataset(XLSX_PATH, CACHE_DATA);
        json_out($ds);
        break;

    case 'upload':
        require_admin();
        if ($method !== 'POST') json_out(['error' => 'method'], 405);
        if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            json_out(['error' => 'upload', 'message' => 'Dosya yuklenemedi.'], 422);
        }
        $tmp = $_FILES['file']['tmp_name'];
        $name = $_FILES['file']['name'] ?? '';
        if (strtolower(pathinfo($name, PATHINFO_EXTENSION)) !== 'xlsx') {
            json_out(['error' => 'type', 'message' => 'Lutfen .xlsx uzantili bir Excel dosyasi secin.'], 422);
        }
        // Gercekten gecerli bir xlsx mi? (icinde sayfa var mi)
        $zip = new ZipArchive();
        if ($zip->open($tmp) !== true || $zip->locateName('xl/worksheets/sheet1.xml') === false) {
            if ($zip) @$zip->close();
            json_out(['error' => 'invalid', 'message' => 'Dosya gecerli bir Excel dosyasi degil.'], 422);
        }
        $zip->close();

        // Yeni dosyayi gecici konuma al, parse edilebiliyor mu dogrula
        if (!is_dir(CACHE_DIR)) @mkdir(CACHE_DIR, 0775, true);
        $staging = CACHE_DIR . '/staging.xlsx';
        if (!@move_uploaded_file($tmp, $staging) && !@rename($tmp, $staging) && !@copy($tmp, $staging)) {
            json_out(['error' => 'io', 'message' => 'Dosya kaydedilemedi.'], 500);
        }
        $parser = new SimpleXLSXParser();
        $analyzer = new CampaignAnalyzer();
        if (!$parser->parse($staging)) {
            @unlink($staging);
            json_out(['error' => 'parse', 'message' => 'Excel okunamadi.'], 422);
        }
        $analyzer->loadDataFromArray($parser->getRows());
        $campaigns = $analyzer->analyze();
        if (count($campaigns) === 0) {
            @unlink($staging);
            json_out(['error' => 'empty', 'message' => 'Dosyada uygun veri bulunamadi. Sutun duzenini kontrol edin.'], 422);
        }

        // Eskisini yedekle, yenisini yerine koy, onbellegi yenile
        if (file_exists(XLSX_PATH)) {
            @copy(XLSX_PATH, CACHE_DIR . '/yedek_' . date('Ymd_His') . '.xlsx');
        }
        if (!@rename($staging, XLSX_PATH) && !@copy($staging, XLSX_PATH)) {
            json_out(['error' => 'io', 'message' => 'Dosya degistirilemedi (yazma izni?).'], 500);
        }
        @unlink($staging);
        @unlink(CACHE_DATA); // bir sonraki istekte yeniden hesaplanir
        $ds = build_dataset(XLSX_PATH, CACHE_DATA);
        json_out(['status' => 'ok', 'summary' => $ds['summary']]);
        break;

    /* ---- WebAuthn: kayit secenekleri (yalnizca e-posta ile giris yapmis calisan) ---- */
    case 'webauthn_reg_options':
        require_auth();
        // Guvenlik: Face ID yalnizca calisan (goruntuleme) hesaplari icindir.
        // Yonetici hesabi hizli giris kuramaz; veri guncelleme sifreye baglidir.
        if (!empty($_SESSION['is_admin'])) {
            json_out(['error' => 'admin_no_bio', 'message' => 'Yönetici hesabı için hızlı giriş kullanılmaz.'], 403);
        }
        $challenge = b64url_encode(random_bytes(32));
        $_SESSION['wa_challenge'] = $challenge;
        $uid = b64url_encode($_SESSION['email'] ?: 'user');
        json_out([
            'challenge' => $challenge,
            'rp' => ['id' => wa_rpid(), 'name' => 'Kampanya Verimlilikleri'],
            'user' => ['id' => $uid, 'name' => $_SESSION['email'], 'displayName' => $_SESSION['email']],
            'pubKeyCredParams' => [
                ['type' => 'public-key', 'alg' => -7],
                ['type' => 'public-key', 'alg' => -257],
            ],
            'authenticatorSelection' => [
                'authenticatorAttachment' => 'platform',
                'userVerification' => 'required',
                'residentKey' => 'preferred',
            ],
            'timeout' => 60000,
            'attestation' => 'none',
        ]);
        break;

    /* ---- WebAuthn: kaydi tamamla ---- */
    case 'webauthn_register':
        require_auth();
        if ($method !== 'POST') json_out(['error' => 'method'], 405);
        // Yonetici hesabi passkey kaydedemez (guvenlik)
        if (!empty($_SESSION['is_admin'])) {
            json_out(['error' => 'admin_no_bio'], 403);
        }
        $in = body_json();
        $err = wa_check_clientdata(b64url_decode($in['clientDataJSON'] ?? ''), 'webauthn.create');
        if ($err !== true) json_out(['error' => 'verify', 'detail' => $err], 422);
        if (empty($in['id']) || empty($in['publicKey'])) json_out(['error' => 'missing'], 422);
        $store = wa_load();
        // Tum passkey'ler yalnizca goruntuleme seviyesindedir (admin degil).
        $store[$in['id']] = [
            'pub' => $in['publicKey'],            // SPKI DER (base64url)
            'alg' => (int) ($in['alg'] ?? -7),
            'email' => $_SESSION['email'],
            'created' => date('c'),
        ];
        wa_save($store);
        unset($_SESSION['wa_challenge']);
        json_out(['status' => 'ok']);
        break;

    /* ---- WebAuthn: giris secenekleri (oturum gerekmez) ---- */
    case 'webauthn_login_options':
        $challenge = b64url_encode(random_bytes(32));
        $_SESSION['wa_challenge'] = $challenge;
        json_out([
            'challenge' => $challenge,
            'rpId' => wa_rpid(),
            'timeout' => 60000,
            'userVerification' => 'required',
        ]);
        break;

    /* ---- WebAuthn: giris dogrulamasi (oturum gerekmez) ---- */
    case 'webauthn_login':
        if ($method !== 'POST') json_out(['error' => 'method'], 405);
        $in = body_json();
        $id = $in['id'] ?? '';
        $store = wa_load();
        if ($id === '' || !isset($store[$id])) json_out(['error' => 'unknown_credential'], 422);
        $cred = $store[$id];

        $clientDataJson = b64url_decode($in['clientDataJSON'] ?? '');
        $err = wa_check_clientdata($clientDataJson, 'webauthn.get');
        if ($err !== true) json_out(['error' => 'verify', 'detail' => $err], 422);

        $authData = b64url_decode($in['authenticatorData'] ?? '');
        $sig = b64url_decode($in['signature'] ?? '');
        if (strlen($authData) < 37) json_out(['error' => 'authdata'], 422);

        // Bayraklar: UP (kullanici mevcut) ve UV (kullanici dogrulandi)
        $flags = ord($authData[32]);
        if (!($flags & 0x01)) json_out(['error' => 'user_presence'], 422);

        // rpIdHash dogrulamasi
        if (!hash_equals(hash('sha256', wa_rpid(), true), substr($authData, 0, 32))) {
            json_out(['error' => 'rpid'], 422);
        }

        // Imza dogrulama: data = authData || SHA256(clientDataJSON)
        $signedData = $authData . hash('sha256', $clientDataJson, true);
        $der = b64url_decode($cred['pub']);
        $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
        $pk = openssl_pkey_get_public($pem);
        if (!$pk) json_out(['error' => 'pubkey'], 500);
        $ok = openssl_verify($signedData, $sig, $pk, OPENSSL_ALGO_SHA256);
        if ($ok !== 1) json_out(['error' => 'signature'], 422);

        // Face ID girisi ASLA yonetici degildir (yalnizca goruntuleme).
        login_user($cred['email'], false, false);
        unset($_SESSION['wa_challenge']);
        json_out(['status' => 'ok']);
        break;

    /* ---- WebAuthn: bu cihazdaki passkey'i kaldir ---- */
    case 'webauthn_disable':
        if ($method !== 'POST') json_out(['error' => 'method'], 405);
        $in = body_json();
        $id = $in['id'] ?? '';
        $store = wa_load();
        if ($id !== '' && isset($store[$id])) {
            unset($store[$id]);
            wa_save($store);
        }
        json_out(['status' => 'ok']);
        break;

    default:
        json_out(['error' => 'unknown_action'], 404);
}
