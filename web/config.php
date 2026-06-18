<?php
/**
 * Kampanya Verimlilikleri - Sunucu Ayarlari
 *
 * ONEMLI: Bu dosya gizli bilgiler icerir (giris anahtari, e-posta sifresi).
 * .php uzantili oldugu icin sunucu bunu tarayiciya METIN olarak GOSTERMEZ;
 * yalnizca calistirir. Yine de dosyayi herkese acik paylasmayin.
 */

if (!defined('APP_BOOT')) {
    http_response_code(403);
    exit('Forbidden');
}

/* --- Giris Ayarlari --- */

// Hizli erisim anahtari (yonetici). Tek alandan girilir; arayuzde hicbir
// yerde gosterilmez veya ima edilmez. Diledigin zaman degistirebilirsin.
define('ADMIN_KEY', 'Lav_2025.');

// Calisanlarin giris yapabilecegi kurumsal e-posta uzantisi
define('ALLOWED_DOMAIN', '@lav.com.tr');

// E-posta dogrulama kodu (OTP) gecerlilik suresi (saniye)
define('OTP_VALIDITY', 300);

// "Beni hatirla" suresi (gun). Bu sure boyunca tekrar giris istenmez.
define('REMEMBER_DAYS', 30);

// Imza anahtari: "beni hatirla" jetonlarini imzalamak icin kullanilir.
// Bunu kendine ozel, uzun ve rastgele bir metinle degistirmen onerilir.
// (Degistirirsen mevcut "beni hatirla" oturumlari sifirlanir, sorun degil.)
define('APP_SECRET', 'lav-dashboard-degistir-bu-anahtari-2025-xJ29ftQ');

/* --- E-posta (SMTP) Ayarlari --- */
define('SMTP_HOST', 'smtp-mail.outlook.com');
define('SMTP_PORT', 587);
define('SMTP_USER', 'rg18organize@guralcloud.com');
define('SMTP_PASS', 'kldgpjcrhwtkbncy');
define('SMTP_SECURE', 'tls');

/* --- Dosya Yollari --- */
define('XLSX_PATH', __DIR__ . '/uretim_verileri.xlsx');
define('CACHE_DIR', __DIR__ . '/cache');
define('CACHE_DATA', CACHE_DIR . '/data.json');
