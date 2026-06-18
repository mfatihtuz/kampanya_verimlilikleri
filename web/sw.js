/* Kampanya Verimlilikleri - Servis Calisani
   - Uygulama kabugunu cevrimdisi kullanim icin onbellege alir
   - api.php her zaman agina gider (taze veri / oturum guvenligi)
   - Statik dosyalar "once onbellek, arkada guncelle" mantigiyla sunulur,
     boylece yeni surum yuklediginde otomatik yenilenir.
*/
var CACHE = 'kampanya-shell-v3';
var CORE = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE).then(function (c) {
        return Promise.all(CORE.map(function (u) {
            return c.add(u).catch(function () {});
        }));
    }));
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) {
                if (k !== CACHE) return caches.delete(k);
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;

    var url = new URL(req.url);

    // API: asla onbellekleme, dogrudan aga git
    if (url.pathname.indexOf('api.php') !== -1) return;

    // Capraz kaynak (orn. Google Fonts): once onbellek, yoksa ag
    if (url.origin !== self.location.origin) {
        e.respondWith(
            caches.match(req).then(function (hit) {
                return hit || fetch(req).then(function (res) {
                    var copy = res.clone();
                    caches.open(CACHE).then(function (c) { c.put(req, copy); });
                    return res;
                }).catch(function () { return hit; });
            })
        );
        return;
    }

    // Ayni kaynak: once onbellek, arkada guncelle (stale-while-revalidate)
    e.respondWith(
        caches.match(req).then(function (hit) {
            var net = fetch(req).then(function (res) {
                if (res && res.status === 200) {
                    var copy = res.clone();
                    caches.open(CACHE).then(function (c) { c.put(req, copy); });
                }
                return res;
            }).catch(function () { return hit; });
            return hit || net;
        })
    );
});
