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
4. HTTPS önerilir (telefona kurulum, "beni hatırla" ve Face ID için gereklidir).

Bu kadar. `https://siteniz/` adresini açtığınızda giriş ekranı gelir.

### Sunucu güvenliği (önemli)

Ham veri dosyaları (`uretim_verileri.xlsx`, `cache/`) **giriş yapmadan dışarıdan
indirilememelidir.** Bunun için pakette **`.htaccess`** dosyaları hazır gelir;
**Apache / cPanel** kullanıyorsanız ek işlem gerekmez.

**Nginx** kullanıyorsanız `.htaccess` çalışmaz; sunucu yapılandırmanıza şunu ekleyin:

```nginx
location ~* \.xlsx$        { deny all; }
location /cache/           { deny all; }
```

---

## 3) Giriş nasıl çalışır

- **Çalışanlar:** Kurumsal e-posta adreslerini (`@lav.com.tr`) yazar; e-postayla
  gelen 6 haneli kodu girip giriş yapar.
- **Beni hatırla:** İşaretliyken bir sonraki açılışta tekrar kod istenmez ve
  e-posta alanı hazır gelir — diğer uygulamalardaki gibi sıradan davranır.
- **Face ID / parmak izi (hızlı giriş):** **Çalışanlar için** bir kolaylıktır.
  Çalışan e-posta ile giriş yaptıktan sonra "Etkinleştir" diyerek kurar; sonraki
  açılışlarda giriş ekranındaki **"Face ID ile giriş"** düğmesiyle saniyeler
  içinde girer. Standart **passkey (WebAuthn)** kullanılır; doğrulama sunucuda
  imzayla yapılır. Cihaz desteklemezse seçenek hiç görünmez, e-posta ile giriş
  her zaman çalışır.

  > Not: Face ID/parmak izi yalnızca **HTTPS** üzerinde (veya `localhost`)
  > çalışır. Canlıda sitenizin HTTPS olması yeterlidir.

### Güvenlik modeli (önemli)

- **"Veri Güncelle" yalnızca yönetici şifresiyle giriş yapıldığında** etkindir.
  Bu yetki sunucu tarafında zorunludur; gizlemekle kalmaz, sunucu da yetkisiz
  güncellemeyi reddeder.
- **Yönetici oturumu kalıcı değildir** ve **Face ID asla yönetici yetkisi
  vermez.** Yani "beni hatırla" çerezi veya Face ID ile giren hiç kimse veri
  güncelleyemez — güncelleme için her seferinde şifreyle giriş gerekir.
- **Çalışanlar yalnızca görüntüler** ve Face ID'yi ancak e-posta ile giriş
  yaptıktan sonra kurabilir. Yönetici hesabına Face ID önerilmez.
- **Yönetici şifresi hiçbir aşamada ekranda gösterilmez/önbelleğe alınmaz;**
  yalnızca kurumsal e-posta (@ içeren) "beni hatırla" ile hatırlanır.

İzin verilen e-posta uzantısı ve diğer ayarlar `web/config.php` içindedir.

---

## 4) Veriyi güncelleme (3 ayda bir) — en kolay yol

Excel'i sunucuya elle atmanıza gerek yok. Bilgisayarınızdan:

1. Uygulamayı açıp **yönetici şifrenizle giriş yapın** (güvenlik gereği bu işlem
   her zaman şifreyle girişi gerektirir; Face ID veya hatırlanan oturum yetmez).
2. Sağ üstteki **"Veri Güncelle"** düğmesine tıklayın.
   *(Bu düğme yalnızca yönetici şifresiyle giriş yapıldığında görünür.)*
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

### Panel (BI) özellikleri

Kurumsal bir analiz panosu olarak şunları sunar:

- **Otomatik içgörü şeridi** — filtreye göre öne çıkan 2-3 sonuç (yıllık değişim,
  en iyi hat, hedef altı oranı).
- **KPI kartları** — kampanya sayısı, ağırlıklı ortalama verim, ortalama devir,
  toplam saat; verim/devir için **önceki yıla göre değişim** ve her kartta **mini
  trend (sparkline)**.
- **Aylık verim trendi** (alan/çizgi grafiği), **hatlara göre verim** (sıralı
  karşılaştırma), **verim dağılımı** (histogram) — hepsi ipucu (tooltip) ile.
- **Ürün performansı** — en iyi / en düşük 6 ürün listesi.
- **Filtreler** (ürün/hat/yıl/verim bandı), **tıklanabilir sütun başlıklarıyla
  sıralama**, alttaki **toplam/ağırlıklı ortalama satırı**.
- **Ürün detayı (drill-down)** — bir satıra ya da ürüne tıklayınca o ürünün
  KPI'ları, verim trendi ve tüm kampanyaları açılır.
- Filtrelenmiş veriyi **Excel'e aktarma**, **çevrimdışı** çalışma.

Tüm grafikler ve KPI'lar uygulanan filtreye göre **anlık** yeniden hesaplanır.

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
