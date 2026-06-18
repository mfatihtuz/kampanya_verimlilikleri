# Kampanya Verimlilikleri

Üretim kampanyalarının verimlilik raporunu gösteren, telefona uygulama gibi
kurulabilen (iOS / Android) ve aynı zamanda bilgisayardan da açılabilen bir
**PWA** (yüklenebilir web uygulaması).

Mevcut web sitenizin verisini ve giriş yöntemini korur; üstüne modern, kurumsal
bir arayüz, hızlı (önbellekli) veri, çevrimdışı çalışma ve uygulama içinden
**tek tıkla Excel güncelleme** ekler.

Tüm uygulama **`web/`** klasöründedir. Sunucuya yüklenecek olan budur.

---

## 1) Telefona "uygulama" olarak kurma

Uygulama mağazaya gerek olmadan ana ekrana eklenir ve tam ekran, simgesiyle
normal bir uygulama gibi açılır.

- **iPhone / iPad (Safari):** Siteyi açın → alttaki **Paylaş** simgesi →
  **Ana Ekrana Ekle**.
- **Android (Chrome):** Siteyi açın → sağ üst **⋮** menü → **Uygulamayı yükle**
  (veya çıkan "Yükle" önerisi).

Kurulduktan sonra çalışanlar simgeye dokunup doğrudan giriş ekranına ulaşır.

---

## 2) Sunucuya kurulum (tek seferlik)

Gereken: PHP 7.4+ çalışan bir hosting (sizin mevcut sitenizin çalıştığı yer
yeterlidir). Ek kütüphane/kurulum yoktur.

1. **`web/` klasörünün içindeki her şeyi** sitenizin yayın klasörüne yükleyin.
2. Eski tek dosyalık `index.php` siteniz varsa onu kaldırın; yeni uygulamanın
   açılış sayfası **`index.html`** ve veri servisi **`api.php`** dosyalarıdır.
3. `web/cache/` klasörünün **yazılabilir** olduğundan emin olun (genelde
   otomatiktir; sorun olursa izinleri `755`/`775` yapın). Veriler ilk açılışta
   bu klasöre önbelleklenir, sonraki açılışlar çok hızlı olur.
4. HTTPS önerilir (telefona kurulum ve "beni hatırla" için en sağlıklısı).

Bu kadar. `https://siteniz/` adresini açtığınızda giriş ekranı gelir.

---

## 3) Giriş nasıl çalışır

- **Çalışanlar:** Kurumsal e-posta adreslerini (`@lav.com.tr`) yazar; e-postayla
  gelen 6 haneli kodu girip giriş yapar.
- **Beni hatırla:** İşaretliyken bir sonraki açılışta tekrar kod istenmez ve
  e-posta alanı hazır gelir — diğer uygulamalardaki gibi sıradan davranır.
- **Face ID / parmak izi (hızlı giriş):** Destekleyen cihazlarda, ilk girişten
  sonra "Etkinleştir" denilerek kurulur. Sonraki açılışlarda giriş ekranındaki
  **"Face ID ile giriş"** düğmesiyle saniyeler içinde girilir. Standart
  **passkey (WebAuthn)** teknolojisi kullanılır; doğrulama sunucuda imzayla
  yapılır. Cihaz desteklemezse bu seçenek hiç görünmez, e-posta ile giriş
  her zaman çalışır.

  > Not: Face ID/parmak izi yalnızca **HTTPS** üzerinde (veya `localhost`)
  > çalışır. Canlıda sitenizin HTTPS olması yeterlidir.

İzin verilen e-posta uzantısı ve diğer ayarlar `web/config.php` içindedir.

---

## 4) Veriyi güncelleme (3 ayda bir) — en kolay yol

Excel'i sunucuya elle atmanıza gerek yok. Bilgisayarınızdan:

1. Uygulamayı açıp giriş yapın.
2. Sağ üstteki **"Veri Güncelle"** düğmesine tıklayın.
   *(Bu düğme yalnızca yönetici girişinde görünür.)*
3. Yeni `uretim_verileri.xlsx` dosyasını sürükleyin ya da seçin → **Yükle ve
   Güncelle**.

Yükleme biter bitmez **tüm kullanıcılar** anında güncel veriyi görür. Eski dosya
güvenlik için `web/cache/` içine otomatik yedeklenir.

> Excel'in **sütun düzeni aynı kalmalıdır:**
> `Kalem · Yıl · Hat · Tarih · Üretim Saati · Devir · Adetsel Verim · Zamansal Verim · Verim`

**Alternatif (elle):** İsterseniz eski yönteminizdeki gibi `uretim_verileri.xlsx`
dosyasını sunucuda doğrudan değiştirebilirsiniz; uygulama dosyanın değiştiğini
algılayıp veriyi kendiliğinden yeniden hesaplar.

---

## 5) Hesaplama mantığı

Veri, web sitenizdeki ile **birebir aynı** şekilde işlenir: aynı ürün/hat/yıl
için ardışık günler bir "kampanya" olarak gruplanır ve değerler **üretim saatine
göre ağırlıklı ortalama** ile hesaplanır (verim, adetsel, zamansal, devir).
Böylece alıştığınız sayılar değişmez.

Arayüzde ek olarak: canlı KPI kartları, verim dağılımı, yıllara göre ortalama
verim, ürün/hat/yıl/verim filtreleri, sıralama ve filtrelenmiş veriyi
**Excel'e aktarma** bulunur.

---

## 6) Ayarlar — `web/config.php`

| Ayar | Açıklama |
|------|----------|
| `ADMIN_KEY` | Yönetici hızlı giriş anahtarı. Giriş ekranındaki tek alana yazılır; arayüzde hiçbir yerde görünmez/ima edilmez. Dilediğinizde değiştirebilirsiniz. |
| `ALLOWED_DOMAIN` | Giriş yapabilen kurumsal e-posta uzantısı (`@lav.com.tr`). |
| `REMEMBER_DAYS` | "Beni hatırla" süresi (gün). |
| `APP_SECRET` | "Beni hatırla" güvenlik imzası. Size özel uzun bir metinle değiştirmeniz önerilir. |
| `SMTP_*` | Doğrulama kodu e-postasının gönderim ayarları (mevcut ayarlarınızla aynıdır). |

> Bu dosya gizli bilgiler içerir. `.php` olduğu için sunucu içeriğini tarayıcıya
> göstermez, yalnızca çalıştırır. Yine de bu deponun **özel (private)** kalmasına
> dikkat edin.

---

## 7) Markalama (logo / renk)

- Uygulama simgeleri `web/icons/` içindedir. Yeniden üretmek veya rengi
  değiştirmek için `web/generate_icons.php` dosyasındaki renk değerlerini
  güncelleyip sunucuda ya da yerelde `php generate_icons.php` çalıştırın.
- Arayüz renkleri `web/styles.css` en üstteki değişkenlerden (örn. `--brand-600`)
  yönetilir. Marka paleti web sitenizle uyumludur.

---

## 8) Dosya yapısı

```
web/
├── index.html              Uygulama arayüzü (giriş + panel)
├── styles.css              Tasarım sistemi (marka paleti)
├── app.js                  Uygulama mantığı (filtre, grafik, Excel dışa aktarma)
├── sw.js                   Servis çalışanı (çevrimdışı + otomatik güncelleme)
├── manifest.webmanifest    Telefona kurulum bilgisi
├── api.php                 Sunucu API'si (giriş, veri, yükleme)
├── config.php              Ayarlar (anahtar, domain, SMTP)
├── lib.php                 Excel okuyucu + kampanya analiz motoru + SMTP
├── generate_icons.php      Uygulama simgesi üretici
├── uretim_verileri.xlsx    Veri dosyası (uygulamadan güncellenir)
├── icons/                  Uygulama simgeleri
└── cache/                  Otomatik önbellek + Excel yedekleri + passkey'ler (yazılabilir)
```

---

## 9) Sık karşılaşılanlar

- **Kod e-postası gelmiyor:** Spam klasörünü kontrol edin. Sunucunuzun dışa
  e-posta (SMTP) gönderimine izin verdiğinden emin olun; ayarlar
  `config.php → SMTP_*` içindedir.
- **"Veri Güncelle" düğmesi yok:** O düğme yalnızca yönetici girişinde görünür.
- **Yükleme "yazma izni" hatası:** `web/` ve `web/cache/` klasörlerinin yazma
  iznini açın.
- **Veri eski görünüyor:** Tarayıcıyı/uygulamayı kapatıp açın; uygulama en güncel
  veriyi sunucudan çekip yeniler.
