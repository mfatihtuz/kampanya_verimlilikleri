/* ===================================================================
   Kampanya Verimlilikleri - Uygulama Mantigi (PWA)
   =================================================================== */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var API = 'api.php';

    /* "Beni hatirla" icin yerel saklama anahtari (sade, ayirt edilemez) */
    var STORE_ID = 'lav_saved_id';
    var STORE_REMEMBER = 'lav_remember_pref';
    var STORE_DATA = 'lav_data_cache_v1';
    var STORE_BIO = 'lav_bio_cred';        // bu cihazda kayitli passkey kimligi
    var STORE_BIO_ASK = 'lav_bio_asked';   // hizli giris onerisi gosterildi mi

    var state = {
        campaigns: [],
        filtered: [],
        rendered: 0,
        chunk: 60,
        session: null,
        observer: null,
        pendingFile: null,
        coverage: '',
        sortKey: 'kalem',
        sortDir: 'asc',
        lbMode: 'top',
        lbTop: [],
        lbBottom: [],
        months: [],
        dataSeq: 0
    };

    /* ---------------- Yardimcilar ---------------- */

    function api(action, opts) {
        opts = opts || {};
        var url = API + '?action=' + encodeURIComponent(action);
        var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
        if (opts.body && !opts.isForm) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(opts.body);
        } else if (opts.isForm) {
            init.body = opts.body; // FormData
        }
        return fetch(url, init).then(function (r) {
            return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; });
        });
    }

    function fmt(num, dec) {
        dec = dec || 0;
        if (num === null || num === undefined || isNaN(num)) num = 0;
        return Number(num).toLocaleString('tr-TR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }

    var lower = function (s) { return (s || '').toLocaleLowerCase('tr-TR'); };

    // Giris alanini YALNIZCA kayitli e-posta ile doldur (yoksa bos birak).
    // Yonetici sifresi hicbir zaman alanda gosterilmez/on-doldurulmaz.
    function prefillIdentifier() {
        var savedId = null;
        try {
            savedId = localStorage.getItem(STORE_ID);
            if (savedId && savedId.indexOf('@') === -1) {
                localStorage.removeItem(STORE_ID); // eski surumden kalmis gecersiz deger
                savedId = null;
            }
        } catch (e) {}
        var el = $('identifier');
        if (el) el.value = savedId || '';
    }

    /* Verim bandi: web sitesindeki esiklerle ayni (>=91 yuksek, >=83 orta) */
    function band(v) { return v >= 91 ? 'high' : (v >= 83 ? 'mid' : 'low'); }
    function bandClass(v) { return v >= 91 ? 'green' : (v >= 83 ? 'amber' : 'red'); }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Bazi eski tarayicilar (ozellikle eski iOS Safari) <use href="..."> yerine
    // yalnizca xlink:href tanir; ikonlarin her yerde gorunmesi icin ikisini de ekle.
    var XLINK = 'http://www.w3.org/1999/xlink';
    function fixUseHrefs(root) {
        try {
            var uses = (root || document).getElementsByTagName('use');
            for (var i = 0; i < uses.length; i++) {
                var h = uses[i].getAttribute('href');
                if (h && !uses[i].getAttributeNS(XLINK, 'href')) {
                    uses[i].setAttributeNS(XLINK, 'href', h);
                }
            }
        } catch (e) {}
    }

    function toast(msg, type) {
        var t = $('toast');
        t.textContent = msg;
        t.className = 'toast' + (type ? ' ' + type : '');
        t.hidden = false;
        requestAnimationFrame(function () { t.classList.add('show'); });
        clearTimeout(t._tm);
        t._tm = setTimeout(function () {
            t.classList.remove('show');
            setTimeout(function () { t.hidden = true; }, 300);
        }, 3200);
    }

    function showAlert(el, type, html) {
        el.className = 'alert ' + type;
        el.innerHTML = '<svg class="ic"><use href="#i-' + (type === 'error' ? 'alert' : (type === 'success' ? 'check' : 'alert')) + '"/></svg><div>' + html + '</div>';
        el.hidden = false;
    }
    function hideAlert(el) { el.hidden = true; }

    function setLoading(btn, on) {
        var label = btn.querySelector('.btn-label');
        var sp = btn.querySelector('.spin');
        btn.disabled = on;
        if (label) label.style.opacity = on ? '.6' : '1';
        if (sp) sp.hidden = !on;
    }

    /* ---- Biyometrik (WebAuthn) yardimcilari ---- */
    function bioSupported() {
        return !!(window.PublicKeyCredential && navigator.credentials &&
            navigator.credentials.create && navigator.credentials.get);
    }
    function getBioCred() { try { return localStorage.getItem(STORE_BIO); } catch (e) { return null; } }
    function bufToB64url(buf) {
        var b = new Uint8Array(buf), s = '';
        for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function b64urlToBuf(str) {
        str = String(str).replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) str += '=';
        var bin = atob(str), b = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
        return b.buffer;
    }

    /* ---------------- Acilis ---------------- */

    function boot() {
        var y = new Date().getFullYear();
        $('loginYear').textContent = y;
        $('footYear').textContent = y;
        $('todayDate').textContent = new Date().toLocaleDateString('tr-TR');

        // "Beni hatirla" tercihi (kutu durumu)
        try {
            var pref = localStorage.getItem(STORE_REMEMBER);
            $('rememberMe').checked = pref === null ? true : pref === '1';
        } catch (e) {}
        prefillIdentifier();

        bindEvents();
        fixUseHrefs();   // statik ikonlar (eski tarayici uyumlulugu)
        registerSW();

        api('session').then(function (res) {
            if (res.data && res.data.authed) {
                enterApp(res.data);
            } else {
                showLogin();
            }
        }).catch(showLogin);
    }

    function showLogin() {
        $('appScreen').hidden = true;
        $('loginScreen').hidden = false;
        $('formStep1').hidden = false;
        $('formStep2').hidden = true;
        hideAlert($('loginAlert'));
        prefillIdentifier();   // yazilan sifre ekranda birakilmaz
        $('otpCode').value = '';
        updateBioUI();
        setTimeout(function () { try { $('identifier').focus(); } catch (e) {} }, 50);
    }

    function enterApp(session) {
        state.session = session;
        $('loginScreen').hidden = true;
        $('appScreen').hidden = false;
        $('userEmail').textContent = session.email || '';
        $('adminUpdateBtn').hidden = !session.isAdmin;
        loadData();
        setTimeout(maybeOfferBio, 1200);
    }

    /* ---------------- Giris akisi ---------------- */

    function persistRemember(identifier) {
        try {
            var remember = $('rememberMe').checked;
            localStorage.setItem(STORE_REMEMBER, remember ? '1' : '0');
            // Guvenlik: YALNIZCA e-posta hatirlanir. Yonetici sifresi (veya '@'
            // icermeyen herhangi bir deger) hicbir zaman saklanmaz/gosterilmez.
            if (remember && identifier && identifier.indexOf('@') !== -1) {
                localStorage.setItem(STORE_ID, identifier);
            } else {
                localStorage.removeItem(STORE_ID);
            }
        } catch (e) {}
    }

    function onStep1(e) {
        e.preventDefault();
        hideAlert($('loginAlert'));
        var identifier = $('identifier').value.trim();
        var remember = $('rememberMe').checked;
        if (!identifier) return;
        setLoading($('step1Btn'), true);
        api('login', { method: 'POST', body: { identifier: identifier, remember: remember } })
            .then(function (res) {
                setLoading($('step1Btn'), false);
                var d = res.data || {};
                if (d.status === 'ok') {
                    // Yonetici girisi: kimlik (sifre) ASLA hatirlanmaz/saklanmaz.
                    return refreshAndEnter();
                }
                if (d.status === 'otp') {
                    persistRemember(identifier);
                    $('otpEmail').textContent = d.email || identifier;
                    $('formStep1').hidden = true;
                    $('formStep2').hidden = false;
                    setTimeout(function () { $('otpCode').focus(); }, 50);
                    return;
                }
                showAlert($('loginAlert'), 'error', esc(d.message || 'Giriş yapılamadı. Lütfen tekrar deneyin.'));
            })
            .catch(function () {
                setLoading($('step1Btn'), false);
                showAlert($('loginAlert'), 'error', 'Bağlantı hatası. İnternet bağlantınızı kontrol edin.');
            });
    }

    function onStep2(e) {
        e.preventDefault();
        hideAlert($('loginAlert'));
        var code = $('otpCode').value.trim();
        if (!code) return;
        setLoading($('step2Btn'), true);
        api('verify', { method: 'POST', body: { otp: code } })
            .then(function (res) {
                setLoading($('step2Btn'), false);
                var d = res.data || {};
                if (d.status === 'ok') return refreshAndEnter();
                showAlert($('loginAlert'), 'error', esc(d.message || 'Kod doğrulanamadı.'));
            })
            .catch(function () {
                setLoading($('step2Btn'), false);
                showAlert($('loginAlert'), 'error', 'Bağlantı hatası. Lütfen tekrar deneyin.');
            });
    }

    function refreshAndEnter() {
        return api('session').then(function (res) {
            if (res.data && res.data.authed) enterApp(res.data);
            else showLogin();
        });
    }

    function onLogout() {
        state.session = null;
        state.dataSeq++; // ucusta olan veri isteklerinin sonucunu gecersiz kil
        api('logout', { method: 'POST' }).then(function () {
            try { localStorage.removeItem(STORE_DATA); } catch (e) {}
            state.campaigns = []; state.filtered = [];
            $('otpCode').value = '';
            showLogin();
        });
    }

    /* ---------------- Biyometrik giris (Face ID / parmak izi) ---------------- */

    // Giris ekranindaki hizli giris dugmesi/baglantisini guncelle
    function updateBioUI() {
        var has = bioSupported() && !!getBioCred();
        $('bioBox').hidden = !has;
        $('bioRemove').hidden = !has;
    }

    // Bu cihazda passkey kur (kullanici giris yaptiktan sonra)
    function bioRegister(btn) {
        if (!bioSupported()) { toast('Bu cihaz biyometrik girişi desteklemiyor.', 'error'); return; }
        if (btn) setLoading(btn, true);
        var newId = null;
        api('webauthn_reg_options', { method: 'POST', body: {} })
            .then(function (res) {
                var o = res.data;
                if (!o || !o.challenge) throw new Error('options');
                return navigator.credentials.create({
                    publicKey: {
                        challenge: b64urlToBuf(o.challenge),
                        rp: o.rp,
                        user: { id: b64urlToBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
                        pubKeyCredParams: o.pubKeyCredParams,
                        authenticatorSelection: o.authenticatorSelection,
                        timeout: o.timeout,
                        attestation: o.attestation
                    }
                });
            })
            .then(function (cred) {
                newId = cred.id;
                var resp = cred.response;
                var pub = resp.getPublicKey ? resp.getPublicKey() : null;
                if (!pub) throw new Error('getPublicKey');
                var alg = resp.getPublicKeyAlgorithm ? resp.getPublicKeyAlgorithm() : -7;
                return api('webauthn_register', { method: 'POST', body: {
                    id: cred.id,
                    publicKey: bufToB64url(pub),
                    alg: alg,
                    clientDataJSON: bufToB64url(resp.clientDataJSON)
                }});
            })
            .then(function (r) {
                if (btn) setLoading(btn, false);
                if (r.data && r.data.status === 'ok') {
                    try { localStorage.setItem(STORE_BIO, newId); } catch (e) {}
                    hideBioOffer();
                    toast('Hızlı giriş etkinleştirildi.', 'success');
                } else {
                    toast('Hızlı giriş kurulamadı.', 'error');
                }
            })
            .catch(function () {
                if (btn) setLoading(btn, false);
                // Kullanici vazgectiyse sessiz kal
            });
    }

    // Passkey ile giris yap (oturum yokken)
    function bioLogin() {
        if (!bioSupported()) return;
        var credId = getBioCred();
        if (!credId) return;
        hideAlert($('loginAlert'));
        setLoading($('bioBtn'), true);
        api('webauthn_login_options', { method: 'POST', body: {} })
            .then(function (res) {
                var o = res.data;
                return navigator.credentials.get({
                    publicKey: {
                        challenge: b64urlToBuf(o.challenge),
                        rpId: o.rpId,
                        timeout: o.timeout,
                        userVerification: 'required',
                        allowCredentials: [{ type: 'public-key', id: b64urlToBuf(credId) }]
                    }
                });
            })
            .then(function (assertion) {
                var r = assertion.response;
                return api('webauthn_login', { method: 'POST', body: {
                    id: assertion.id,
                    authenticatorData: bufToB64url(r.authenticatorData),
                    clientDataJSON: bufToB64url(r.clientDataJSON),
                    signature: bufToB64url(r.signature)
                }});
            })
            .then(function (r) {
                setLoading($('bioBtn'), false);
                if (r.data && r.data.status === 'ok') return refreshAndEnter();
                showAlert($('loginAlert'), 'error', 'Hızlı giriş doğrulanamadı. E-posta ile giriş yapın.');
            })
            .catch(function () {
                setLoading($('bioBtn'), false);
                // Kullanici vazgecti / cihaz reddetti -> e-posta yedek
            });
    }

    // Bu cihazdaki passkey'i kaldir
    function bioDisable() {
        var credId = getBioCred();
        try { localStorage.removeItem(STORE_BIO); } catch (e) {}
        if (credId) api('webauthn_disable', { method: 'POST', body: { id: credId } });
        updateBioUI();
        toast('Bu cihazda hızlı giriş kaldırıldı.');
    }

    function maybeOfferBio() {
        if (!bioSupported()) return;
        // Face ID yalnizca calisan (goruntuleme) hesaplari icindir; yoneticiye
        // hizli giris onerilmez (veri guncelleme sifreye baglidir).
        if (state.session && state.session.isAdmin) return;
        if (getBioCred()) return;             // zaten kurulu
        var asked; try { asked = localStorage.getItem(STORE_BIO_ASK); } catch (e) {}
        if (asked === '1') return;            // daha once soruldu
        $('bioOffer').hidden = false;
    }
    function hideBioOffer() {
        $('bioOffer').hidden = true;
        try { localStorage.setItem(STORE_BIO_ASK, '1'); } catch (e) {}
    }

    /* ---------------- Veri ---------------- */

    function loadData() {
        var seq = ++state.dataSeq;     // bu istegi etiketle (yaris/cikis korumasi)
        // Once yerel onbellek (aninda gosterim / cevrimdisi)
        var hadCache = false;
        try {
            var cached = localStorage.getItem(STORE_DATA);
            if (cached) {
                var j = JSON.parse(cached);
                if (j && j.campaigns) { applyDataset(j); hadCache = true; }
            }
        } catch (e) {}

        if (!hadCache) { $('loadingState').hidden = false; }

        api('data').then(function (res) {
            // Bu sirada cikis yapildiysa veya daha yeni bir istek baslatildiysa yok say
            if (seq !== state.dataSeq || !state.session) return;
            if (res.status === 401) { showLogin(); return; }
            if (res.data && res.data.campaigns) {
                applyDataset(res.data);
                try { localStorage.setItem(STORE_DATA, JSON.stringify(res.data)); } catch (e) {}
            } else if (!hadCache) {
                $('loadingState').hidden = true;
                toast('Veri yüklenemedi.', 'error');
            }
        }).catch(function () {
            if (seq !== state.dataSeq || !state.session) return;
            if (!hadCache) {
                $('loadingState').hidden = true;
                toast('Çevrimdışısınız. Kayıtlı veri yok.', 'error');
            }
        });
    }

    function applyDataset(ds) {
        $('loadingState').hidden = true;
        state.campaigns = ds.campaigns || [];
        var sum = ds.summary || {};

        // Filtre secenekleri (hat / yil)
        fillSelect($('fHat'), sum.lines || [], 'Tüm hatlar');
        fillSelect($('fYil'), (sum.years || []).slice().sort(function (a, b) { return b - a; }), 'Tüm yıllar');

        // Kapsam notu (tarih araligi)
        computeCoverage();

        applyFilters();
    }

    function fillSelect(sel, items, allLabel) {
        var cur = sel.value;
        sel.innerHTML = '<option value="">' + allLabel + '</option>';
        items.forEach(function (it) {
            var o = document.createElement('option');
            o.value = it; o.textContent = it;
            sel.appendChild(o);
        });
        if (cur) sel.value = cur;
    }

    function computeCoverage() {
        var min = null, max = null;
        state.campaigns.forEach(function (c) {
            if (c.baslangic_iso && (!min || c.baslangic_iso < min)) min = c.baslangic_iso;
            if (c.bitis_iso && (!max || c.bitis_iso > max)) max = c.bitis_iso;
        });
        if (min && max) {
            var f = function (iso) { var p = iso.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; };
            $('coverageNote').textContent = f(min) + ' – ' + f(max) + ' tarihleri arasını kapsar';
        }
    }

    /* ---------------- Filtre + siralama ---------------- */

    function applyFilters() {
        var k = lower($('fKalem').value.trim());
        var h = $('fHat').value;
        var y = $('fYil').value;
        var b = $('fBand').value;

        state.filtered = state.campaigns.filter(function (c) {
            if (k && lower(c.kalem).indexOf(k) === -1) return false;
            if (h && c.hat !== h) return false;
            if (y && String(c.yil) !== String(y)) return false;
            if (b && band(c.verim) !== b) return false;
            return true;
        });

        sortFiltered();
        recomputeDashboard();
        renderReset();
    }

    var NUM_SORT = { verim: 1, adetsel: 1, zamansal: 1, saat: 1, devir: 1 };
    function sortFiltered() {
        var key = state.sortKey, dir = state.sortDir === 'desc' ? -1 : 1;
        state.filtered.sort(function (a, b) {
            if (key === 'date') {
                return dir * ((a.baslangic_iso || '').localeCompare(b.baslangic_iso || ''));
            }
            if (NUM_SORT[key]) {
                return dir * (((+a[key]) || 0) - ((+b[key]) || 0));
            }
            return dir * (a.kalem.localeCompare(b.kalem, 'tr')
                || a.hat.localeCompare(b.hat, 'tr')
                || (a.baslangic_iso || '').localeCompare(b.baslangic_iso || ''));
        });
    }

    function setSort(key, dir) {
        state.sortKey = key;
        state.sortDir = dir;
        syncSortHeaders();
        sortFiltered();
        renderReset();
    }

    function syncSortHeaders() {
        Array.prototype.forEach.call(document.querySelectorAll('.th-sort'), function (th) {
            var active = th.getAttribute('data-sort') === state.sortKey;
            th.classList.toggle('active', active);
            th.classList.toggle('asc', active && state.sortDir === 'asc');
            th.classList.toggle('desc', active && state.sortDir === 'desc');
        });
    }

    /* ---------------- BI: toplulastirma yardimcilari ---------------- */
    var TR_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    function sumSaat(rows) { var h = 0; for (var i = 0; i < rows.length; i++) h += rows[i].saat; return h; }
    function wAvg(rows, f) { var w = 0, h = 0; for (var i = 0; i < rows.length; i++) { h += rows[i].saat; w += rows[i][f] * rows[i].saat; } return h > 0 ? w / h : 0; }
    function bandHex(v) { return v >= 91 ? '#22c55e' : (v >= 83 ? '#f59e0b' : '#ef4444'); }

    function monthlySeries(rows) {
        var m = {};
        rows.forEach(function (c) {
            var ym = (c.baslangic_iso || '').slice(0, 7);
            if (!ym) return;
            if (!m[ym]) m[ym] = { ym: ym, wV: 0, wD: 0, h: 0, n: 0 };
            m[ym].wV += c.verim * c.saat; m[ym].wD += c.devir * c.saat; m[ym].h += c.saat; m[ym].n++;
        });
        return Object.keys(m).sort().map(function (k) {
            var o = m[k];
            return { ym: k, verim: o.h ? o.wV / o.h : 0, devir: o.h ? o.wD / o.h : 0, saat: o.h, count: o.n };
        });
    }
    function groupBy(rows, field) {
        var m = {};
        rows.forEach(function (c) {
            var key = c[field];
            if (!m[key]) m[key] = { key: key, wV: 0, wD: 0, h: 0, n: 0 };
            m[key].wV += c.verim * c.saat; m[key].wD += c.devir * c.saat; m[key].h += c.saat; m[key].n++;
        });
        return m;
    }

    /* ---------------- BI: tum panelin yeniden hesabi ---------------- */
    function recomputeDashboard() {
        var rows = state.filtered;
        state.months = monthlySeries(rows);
        renderKPIs(rows, state.months);
        renderInsights(rows);
        renderTrend(state.months);
        renderLineCompare(rows);
        renderHistogram(rows);
        renderLeaderboard(rows);
        renderFooter(rows);
        $('resultCount').textContent = fmt(rows.length) + ' kampanya';
    }

    function setText(id, val) { var el = $(id); if (el && el.textContent !== val) el.textContent = val; }

    function setDelta(id, diff, prevYear, unit) {
        var el = $(id);
        el.hidden = false;
        var cls = diff > 0.0001 ? 'up' : (diff < -0.0001 ? 'down' : 'flat');
        var sign = diff > 0 ? '+' : (diff < 0 ? '−' : '');
        el.className = 'kpi-delta ' + cls;
        el.textContent = sign + fmt(Math.abs(diff), unit === 'pt' ? 1 : 0) + (unit ? ' ' + unit : '');
        el.title = prevYear + ' yılına göre';
    }

    function renderKPIs(rows, months) {
        setText('kpiCount', fmt(rows.length));
        setText('kpiVerim', '%' + fmt(wAvg(rows, 'verim'), 1));
        setText('kpiDevir', fmt(wAvg(rows, 'devir')));
        setText('kpiSaat', fmt(sumSaat(rows)));

        // Yil bazli degisim: yalnizca ORAN metrikleri (verim/devir). Hacim
        // metrikleri (kampanya sayisi/saat) son yil kismi olabileceginden
        // yaniltici olur; onlar icin delta gosterilmez.
        $('kpiCountDelta').hidden = true;
        $('kpiSaatDelta').hidden = true;
        var yv = groupBy(rows, 'yil');
        var yrs = Object.keys(yv).sort();
        var cur = yrs.length >= 2 ? yv[yrs[yrs.length - 1]] : null;
        var prev = yrs.length >= 2 ? yv[yrs[yrs.length - 2]] : null;
        if (cur && prev && cur.h > 0 && prev.h > 0) {
            var py = yrs[yrs.length - 2];
            setDelta('kpiVerimDelta', (cur.wV / cur.h) - (prev.wV / prev.h), py, 'pt');
            setDelta('kpiDevirDelta', (cur.wD / cur.h) - (prev.wD / prev.h), py, '');
        } else {
            $('kpiVerimDelta').hidden = true;
            $('kpiDevirDelta').hidden = true;
        }

        sparkline('kpiCountSpark', months.map(function (m) { return m.count; }), '#0ea5e9');
        sparkline('kpiVerimSpark', months.map(function (m) { return m.verim; }), '#22c55e');
        sparkline('kpiDevirSpark', months.map(function (m) { return m.devir; }), '#6366f1');
        sparkline('kpiSaatSpark', months.map(function (m) { return m.saat; }), '#8b5cf6');
    }

    function renderInsights(rows) {
        var strip = $('insightStrip');
        if (!rows.length) { strip.hidden = true; strip.innerHTML = ''; return; }
        var ins = [];
        // 1) Yillik degisim (oran metrigi; hacimden bagimsiz)
        var yv = groupBy(rows, 'yil'), yrs = Object.keys(yv).sort();
        if (yrs.length >= 2) {
            var cur = yv[yrs[yrs.length - 1]], prev = yv[yrs[yrs.length - 2]];
            if (cur.h > 0 && prev.h > 0) {
                var d = (cur.wV / cur.h) - (prev.wV / prev.h);
                ins.push({ dir: d >= 0 ? 'up' : 'down', html: '<b>' + esc(yrs[yrs.length - 1]) + '</b> verimi ' + esc(yrs[yrs.length - 2]) + '’e göre <b>' + (d >= 0 ? '+' : '−') + fmt(Math.abs(d), 1) + ' puan</b> ' + (d >= 0 ? 'arttı' : 'azaldı') + '.' });
            }
        }
        // 2) Ana kisit: verim ≈ adetsel × zamansal; dusuk olan bilesen kisittir
        var aAd = wAvg(rows, 'adetsel'), aZa = wAvg(rows, 'zamansal');
        if (aAd > 0 && aZa > 0) {
            var bn = aZa <= aAd
                ? { n: 'Zamansal', v: aZa, why: 'duruş/süre kayıpları' }
                : { n: 'Adetsel', v: aAd, why: 'hız/fire kayıpları' };
            ins.push({ dir: 'down', html: 'Verimi en çok sınırlayan: <b>' + bn.n + '</b> (%' + fmt(bn.v, 1) + ') — ' + bn.why + '.' });
        }
        // 3) En iyi / en dusuk hat
        var lines = lineStats(rows);
        if (lines.length >= 2) {
            var best = lines[0], worst = lines[lines.length - 1];
            ins.push({ dir: 'flat', html: 'En iyi hat <b>' + esc(best.label) + '</b> (%' + fmt(best.value, 1) + '), en düşük <b>' + esc(worst.label) + '</b> (%' + fmt(worst.value, 1) + ').' });
        } else if (lines.length === 1) {
            ins.push({ dir: 'flat', html: 'Hat <b>' + esc(lines[0].label) + '</b>: %' + fmt(lines[0].value, 1) + '.' });
        }

        strip.hidden = false;
        strip.innerHTML = ins.slice(0, 3).map(function (o) {
            return '<div class="insight"><span class="ins-ic ' + o.dir + '"><svg class="ic"><use href="#i-trend"/></svg></span><span class="ins-txt">' + o.html + '</span></div>';
        }).join('');
        fixUseHrefs(strip);
    }

    function lineStats(rows) {
        var m = groupBy(rows, 'hat');
        return Object.keys(m).map(function (k) {
            var o = m[k];
            return { label: k, value: o.h ? o.wV / o.h : 0, saat: o.h, count: o.n };
        }).sort(function (a, b) { return b.value - a.value; });
    }

    function renderTrend(months) {
        var series = months.map(function (m) {
            var y = m.ym.slice(0, 4), mo = parseInt(m.ym.slice(5, 7), 10);
            return { label: (mo < 10 ? '0' + mo : '' + mo) + '.' + y.slice(2), value: m.verim,
                tipLabel: TR_MONTHS[mo - 1] + ' ' + y, sub: fmt(m.saat) + ' sa · ' + m.count + ' kampanya' };
        });
        $('trendNote').textContent = series.length ? series.length + ' ay' : '';
        lineChart('trendChart', series);
    }

    function renderLineCompare(rows) {
        var items = lineStats(rows);
        var el = $('lineCompareChart');
        if (!items.length) { el.innerHTML = '<div class="muted" style="padding:16px;font-size:13px">Veri yok</div>'; return; }
        el.innerHTML = items.map(function (it) {
            var bc = bandClass(it.value);
            return '<div class="hbar" title="' + esc('Hat ' + it.label + ' · %' + fmt(it.value, 1) + ' · ' + it.count + ' kampanya · ' + fmt(it.saat) + ' sa') + '">' +
                '<span class="hbar-name">' + esc(it.label) + '</span>' +
                '<span class="hbar-track"><span class="hbar-fill ' + bc + '" style="width:' + Math.min(it.value, 100) + '%"></span></span>' +
                '<span class="hbar-val ' + bc + '">%' + fmt(it.value, 1) + '</span>' +
            '</div>';
        }).join('');
    }

    function renderHistogram(rows) {
        var hi = 0, mid = 0, lo = 0;
        rows.forEach(function (c) { var b = band(c.verim); if (b === 'high') hi++; else if (b === 'mid') mid++; else lo++; });
        setText('cntHigh', fmt(hi)); setText('cntMid', fmt(mid)); setText('cntLow', fmt(lo));
        setText('distTotal', fmt(hi + mid + lo) + ' kampanya');

        var edges = [0, 80, 83, 86, 89, 91, 94, 97, Infinity];
        var labels = ['<80', '80', '83', '86', '89', '91', '94', '97+'];
        var bins = []; for (var i = 0; i < edges.length - 1; i++) bins.push(0);
        rows.forEach(function (c) {
            for (var i = 0; i < edges.length - 1; i++) { if (c.verim < edges[i + 1]) { bins[i]++; break; } }
        });
        var items = bins.map(function (cnt, i) {
            var lo = edges[i], hi = edges[i + 1];
            var mid2 = isFinite(hi) ? (lo + hi) / 2 : lo + 2;
            var sub = i === 0 ? '%80 altı verim' : (isFinite(hi) ? '%' + lo + '–' + hi + ' verim' : '%' + lo + ' ve üzeri verim');
            return { label: labels[i], value: cnt, color: bandHex(mid2), sub: sub };
        });
        barsV('histChart', items, { tipUnit: 'kampanya' });
    }

    function renderLeaderboard(rows) {
        var m = groupBy(rows, 'kalem');
        var prods = Object.keys(m).map(function (k) {
            var o = m[k]; return { kalem: k, verim: o.h ? o.wV / o.h : 0, saat: o.h, count: o.n };
        });
        var sig = prods.filter(function (p) { return p.saat >= 48; });
        if (sig.length >= 6) prods = sig;
        prods.sort(function (a, b) { return b.verim - a.verim; });
        state.lbTop = prods.slice(0, 6);
        state.lbBottom = prods.slice(-6).reverse();
        drawLeaderboard();
    }
    function drawLeaderboard() {
        var list = state.lbMode === 'bottom' ? state.lbBottom : state.lbTop;
        var el = $('leaderboard');
        if (!list || !list.length) { el.innerHTML = '<div class="chart-empty muted" style="padding:20px;font-size:13px">Veri yok</div>'; return; }
        el.innerHTML = list.map(function (p, i) {
            var bc = bandClass(p.verim);
            return '<div class="lb-row" data-kalem="' + esc(p.kalem) + '">' +
                '<span class="lb-rank">' + (i + 1) + '</span>' +
                '<span class="lb-name">' + esc(p.kalem) + '<small>' + p.count + ' kampanya · ' + fmt(p.saat) + ' sa</small></span>' +
                '<span class="lb-track"><span class="lb-fill ' + bc + '" style="width:' + Math.min(p.verim, 100) + '%"></span></span>' +
                '<span class="lb-val ' + bc + '">%' + fmt(p.verim, 1) + '</span>' +
            '</div>';
        }).join('');
    }

    function renderFooter(rows) {
        var foot = $('tableFoot');
        if (!rows.length) { foot.hidden = true; return; }
        foot.hidden = false;
        var bc = bandClass(wAvg(rows, 'verim'));
        setText('footLabel', fmt(rows.length) + ' kampanya');
        $('footVerim').innerHTML = '<span class="badge ' + bc + '">%' + fmt(wAvg(rows, 'verim'), 1) + '</span>';
        setText('footAdetsel', '%' + fmt(wAvg(rows, 'adetsel'), 1));
        setText('footZamansal', '%' + fmt(wAvg(rows, 'zamansal'), 1));
        setText('footSaat', fmt(sumSaat(rows)) + ' sa');
        setText('footDevir', fmt(wAvg(rows, 'devir')) + ' ad/dk');
    }

    /* ---------------- BI: SVG grafik yardimcilari ---------------- */
    function sparkline(id, vals, hex) {
        var el = $(id); if (!el) return;
        vals = vals.filter(function (v) { return isFinite(v); });
        if (vals.length < 2) { el.innerHTML = ''; return; }
        var W = 120, H = 34, p = 3;
        var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), rng = (max - min) || 1;
        var step = (W - 2 * p) / (vals.length - 1);
        var pts = vals.map(function (v, i) { return (p + i * step).toFixed(1) + ',' + (H - p - ((v - min) / rng) * (H - 2 * p)).toFixed(1); });
        var area = 'M' + pts.join(' L') + ' L' + (p + (vals.length - 1) * step).toFixed(1) + ',' + (H - p) + ' L' + p + ',' + (H - p) + ' Z';
        el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
            '<path d="' + area + '" fill="' + hex + '" opacity="0.12"/>' +
            '<path d="M' + pts.join(' L') + '" fill="none" stroke="' + hex + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
    }

    function lineChart(id, series) {
        var el = $(id); if (!el) return;
        if (series.length < 2) { el.innerHTML = '<div class="chart-empty muted" style="padding:30px;text-align:center;font-size:13px">Trend için yeterli veri yok</div>'; return; }
        var W = 1000, H = 235, L = 46, R = 18, T = 16, B = 28, xw = W - L - R, yh = H - T - B, n = series.length;
        var vals = series.map(function (s) { return s.value; });
        var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
        var yMin = Math.max(0, Math.floor((min - 3) / 5) * 5), yMax = Math.ceil((max + 3) / 5) * 5;
        if (yMax > 100 && max <= 100) yMax = 100;   // veri 100'u asmiyorsa tavanda kal
        if (yMax <= yMin) yMax = yMin + 5;
        var X = function (i) { return L + (n === 1 ? xw / 2 : i * xw / (n - 1)); };
        var Y = function (v) { return T + yh - ((v - yMin) / (yMax - yMin)) * yh; };
        var g = '';
        for (var s = 0; s <= 4; s++) {
            var gv = yMin + (yMax - yMin) * s / 4, gy = Y(gv);
            g += '<line class="grid-line" x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '"/>';
            g += '<text class="ax-label y" x="' + (L - 6) + '" y="' + (gy + 3).toFixed(1) + '">%' + Math.round(gv) + '</text>';
        }
        var everyX = Math.ceil(n / 8);
        for (var i = 0; i < n; i++) {
            if (i % everyX !== 0 && i !== n - 1) continue;
            g += '<text class="ax-label x" x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '">' + esc(series[i].label) + '</text>';
        }
        var pts = series.map(function (s, i) { return X(i).toFixed(1) + ',' + Y(s.value).toFixed(1); });
        g += '<path d="M' + pts.join(' L') + ' L' + X(n - 1).toFixed(1) + ',' + (T + yh) + ' L' + X(0).toFixed(1) + ',' + (T + yh) + ' Z" fill="url(#trendGrad)" opacity="0.5"/>';
        g += '<path class="tr-line" d="M' + pts.join(' L') + '"/>';
        var slot = xw / Math.max(1, n - 1);
        for (var i = 0; i < n; i++) {
            g += '<circle class="tr-dot" cx="' + X(i).toFixed(1) + '" cy="' + Y(series[i].value).toFixed(1) + '" r="3"/>';
            g += '<rect class="tr-hit" x="' + (X(i) - slot / 2).toFixed(1) + '" y="' + T + '" width="' + slot.toFixed(1) + '" height="' + yh + '" data-tip="' + esc(series[i].tipLabel || series[i].label) + '|%' + fmt(series[i].value, 1) + '|' + esc(series[i].sub || '') + '"/>';
        }
        el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '"><defs><linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0ea5e9"/><stop offset="1" stop-color="#0ea5e9" stop-opacity="0"/></linearGradient></defs>' + g + '</svg>';
        bindTips(el);
    }

    function barsV(id, items, opts) {
        var el = $(id); if (!el) return; opts = opts || {};
        if (!items.length) { el.innerHTML = ''; return; }
        var W = 600, H = 180, L = 30, R = 8, T = 16, B = 24, yh = H - T - B;
        var maxV = Math.max.apply(null, items.map(function (it) { return it.value; })) || 1;
        var n = items.length, bw = (W - L - R) / n, barW = bw * 0.6, g = '';
        for (var s = 0; s <= 3; s++) {
            var gy = T + yh - (s / 3) * yh;
            g += '<line class="grid-line" x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '"/>';
            g += '<text class="ax-label y" x="' + (L - 5) + '" y="' + (gy + 3).toFixed(1) + '">' + fmt(Math.round(maxV * s / 3)) + '</text>';
        }
        items.forEach(function (it, i) {
            var x = L + i * bw + (bw - barW) / 2, h = (it.value / maxV) * yh, y = T + yh - h;
            g += '<rect class="bar-g" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="3" fill="' + (it.color || '#0284c7') + '" data-tip="' + esc(it.sub || '') + '|' + fmt(it.value) + (opts.tipUnit ? ' ' + opts.tipUnit : '') + '|' + esc(it.label) + '"/>';
            if (it.value > 0) g += '<text class="bar-val" x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="middle">' + fmt(it.value) + '</text>';
            g += '<text class="ax-label x" x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 8) + '">' + esc(it.label) + '</text>';
        });
        el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
        bindTips(el);
    }

    /* ---------------- BI: tooltip ---------------- */
    function bindTips(el) {
        Array.prototype.forEach.call(el.querySelectorAll('[data-tip]'), function (node) {
            node.addEventListener('pointerenter', function (e) { showTip(node, e); });
            node.addEventListener('pointermove', moveTip);
            node.addEventListener('pointerleave', hideTip);
        });
    }
    function showTip(node, e) {
        var parts = (node.getAttribute('data-tip') || '').split('|');
        var tip = $('chartTip');
        tip.innerHTML = '<b>' + parts[1] + '</b>' + (parts[0] || parts[2] ? '<span class="tip-sub">' + (parts[0] || '') + (parts[2] ? (parts[0] ? ' · ' : '') + parts[2] : '') + '</span>' : '');
        tip.hidden = false; moveTip(e);
    }
    function moveTip(e) { var tip = $('chartTip'); tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; }
    function hideTip() { $('chartTip').hidden = true; }

    /* ---------------- BI: urun detayi (drill-down) ---------------- */
    function openDetail(kalem) {
        var all = state.campaigns.filter(function (c) { return c.kalem === kalem; });
        if (!all.length) return;
        setText('detailTitle', kalem);
        setText('detailSub', all.length + ' kampanya · ' + fmt(sumSaat(all)) + ' saat');
        $('detailKpis').innerHTML =
            dk('Ort. Verim', '%' + fmt(wAvg(all, 'verim'), 1)) +
            dk('Ort. Devir', fmt(wAvg(all, 'devir'))) +
            dk('Toplam Saat', fmt(sumSaat(all))) +
            dk('Kampanya', fmt(all.length));
        var months = monthlySeries(all);
        var series = months.map(function (m) {
            var y = m.ym.slice(0, 4), mo = parseInt(m.ym.slice(5, 7), 10);
            return { label: (mo < 10 ? '0' + mo : '' + mo) + '.' + y.slice(2), value: m.verim, tipLabel: TR_MONTHS[mo - 1] + ' ' + y, sub: fmt(m.saat) + ' sa' };
        });
        lineChart('detailChart', series);
        var sorted = all.slice().sort(function (a, b) { return (b.baslangic_iso || '').localeCompare(a.baslangic_iso || ''); });
        $('detailList').innerHTML = sorted.map(function (c) {
            return '<div class="dl-row"><span><span class="tag line"><svg class="ic"><use href="#i-factory"/></svg>' + esc(c.hat) + '</span> <span class="dl-date">' + esc(c.baslangic) + ' – ' + esc(c.bitis) + '</span></span>' +
                '<span class="badge ' + bandClass(c.verim) + '">%' + fmt(c.verim, 1) + '</span>' +
                '<span class="dl-date">' + fmt(c.saat) + ' sa</span></div>';
        }).join('');
        fixUseHrefs($('detailList'));
        $('detailModal').hidden = false;
    }
    function dk(label, val) { return '<div class="detail-kpi"><div class="dk-label">' + label + '</div><div class="dk-value">' + val + '</div></div>'; }
    function closeDetail() { $('detailModal').hidden = true; }

    /* ---------------- Liste (kademeli yukleme) ---------------- */

    function renderReset() {
        state.rendered = 0;
        $('rows').innerHTML = '';
        var empty = state.filtered.length === 0;
        $('emptyState').hidden = !empty;
        $('tableScroll').style.display = empty ? 'none' : '';
        $('tableScroll').scrollTop = 0;
        setupObserver();
        if (!empty) { renderChunk(); pump(); }   // ilk parca her zaman render edilir
    }

    function rowHTML(c) {
        var bc = bandClass(c.verim);
        return '<div class="row" role="listitem" data-kalem="' + esc(c.kalem) + '" title="Detay için tıklayın">' +
            '<div class="cell-kalem">' +
                '<span class="k-name">' + esc(c.kalem) + '</span>' +
                '<div class="k-tags">' +
                    '<span class="tag year">' + esc(c.yil) + '</span>' +
                    '<span class="tag line"><svg class="ic"><use href="#i-factory"/></svg>' + esc(c.hat) + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="cell cell-date"><span class="lbl">Başlangıç</span><span>' + esc(c.baslangic) + '</span></div>' +
            '<div class="cell cell-date"><span class="lbl">Bitiş</span><span>' + esc(c.bitis) + '</span></div>' +
            '<div class="cell cell-num"><span class="lbl">Verim</span><span class="badge ' + bc + '">%' + fmt(c.verim, 1) + '</span></div>' +
            '<div class="cell cell-num"><span class="lbl">Adetsel</span><span>%' + fmt(c.adetsel, 1) + '</span></div>' +
            '<div class="cell cell-num"><span class="lbl">Zamansal</span><span>%' + fmt(c.zamansal, 1) + '</span></div>' +
            '<div class="cell cell-num"><span class="lbl">Saat</span><span>' + fmt(c.saat) + ' <span class="unit">sa</span></span></div>' +
            '<div class="cell cell-num strong"><span class="lbl">Devir</span><span>' + fmt(c.devir) + ' <span class="unit">ad/dk</span></span></div>' +
        '</div>';
    }

    function renderChunk() {
        var end = Math.min(state.rendered + state.chunk, state.filtered.length);
        if (end <= state.rendered) return;
        // Yeni satirlari ayri bir parcada olustur, ikon uyumlulugunu YALNIZCA bu
        // parcaya uygula (tum listeyi her seferinde tarayan O(n^2) maliyet ortadan kalkar).
        var tmp = document.createElement('div');
        var html = '';
        for (var i = state.rendered; i < end; i++) html += rowHTML(state.filtered[i]);
        tmp.innerHTML = html;
        fixUseHrefs(tmp);
        var rowsEl = $('rows');
        while (tmp.firstChild) rowsEl.appendChild(tmp.firstChild);
        state.rendered = end;
    }

    // Sentinel gorus alanindayken kademeli doldurur (IO yalnizca gecislerde
    // tetiklendiginden, tek seferde ekran dolmazsa takilmayi onler).
    function pump() {
        var sc = $('tableScroll'), guard = 0;
        while (state.rendered < state.filtered.length && guard < 80) {
            var s = $('scrollSentinel').getBoundingClientRect();
            var c = sc.getBoundingClientRect();
            if (s.top > c.bottom + 600) break;   // sentinel panelin görünür alanının çok altında
            renderChunk();
            guard++;
        }
    }

    function setupObserver() {
        if (state.observer) state.observer.disconnect();
        if (!('IntersectionObserver' in window)) {
            while (state.rendered < state.filtered.length) renderChunk();
            return;
        }
        state.observer = new IntersectionObserver(function (entries) {
            if (entries[0].isIntersecting) pump();
        }, { root: $('tableScroll'), rootMargin: '600px' });
        state.observer.observe($('scrollSentinel'));
    }

    /* ---------------- Excel disa aktarma (bagimliliksiz) ---------------- */

    function exportExcel() {
        if (state.filtered.length === 0) { toast('Dışa aktarılacak kayıt yok.', 'error'); return; }
        var header = ['Kalem', 'Hat', 'Yıl', 'Başlangıç', 'Bitiş', 'Verim (%)', 'Adetsel (%)', 'Zamansal (%)', 'Saat', 'Devir (Ad/Dk)'];
        var rows = state.filtered.map(function (c) {
            return [c.kalem, c.hat, c.yil, c.baslangic, c.bitis,
                round(c.verim, 2), round(c.adetsel, 2), round(c.zamansal, 2), round(c.saat, 2), round(c.devir, 2)];
        });
        var blob = buildXlsx(header, rows);
        var d = new Date();
        var name = 'Kampanya_Raporu_' + d.toLocaleDateString('tr-TR').replace(/\./g, '_') + '.xlsx';
        downloadBlob(blob, name);
        toast(fmt(rows.length) + ' kayıt dışa aktarıldı.', 'success');
    }

    function round(n, d) { var m = Math.pow(10, d); return Math.round((Number(n) || 0) * m) / m; }

    function downloadBlob(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    }

    /* --- Minimal XLSX uretici (ZIP + worksheet, harici kutuphane yok) --- */
    function colName(n) {
        var s = '';
        n++;
        while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
        return s;
    }
    function buildSheetXml(header, rows) {
        var all = [header].concat(rows);
        var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
        for (var r = 0; r < all.length; r++) {
            xml += '<row r="' + (r + 1) + '">';
            for (var ci = 0; ci < all[r].length; ci++) {
                var ref = colName(ci) + (r + 1);
                var v = all[r][ci];
                if (typeof v === 'number' && isFinite(v)) {
                    xml += '<c r="' + ref + '"><v>' + v + '</v></c>';
                } else {
                    xml += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
                }
            }
            xml += '</row>';
        }
        xml += '</sheetData></worksheet>';
        return xml;
    }
    function buildXlsx(header, rows) {
        var files = {
            '[Content_Types].xml':
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                '</Types>',
            '_rels/.rels':
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                '</Relationships>',
            'xl/workbook.xml':
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                '<sheets><sheet name="Kampanya Raporu" sheetId="1" r:id="rId1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels':
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
                '</Relationships>',
            'xl/worksheets/sheet1.xml': buildSheetXml(header, rows)
        };
        return zipStore(files);
    }

    // CRC32
    var crcTable = (function () {
        var t = [], c, n, k;
        for (n = 0; n < 256; n++) {
            c = n;
            for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(bytes) {
        var c = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    // ZIP (sadece "store" / sikistirmasiz) -> gecerli .xlsx
    function zipStore(files) {
        var enc = new TextEncoder();
        var parts = [], central = [], offset = 0;
        function u16(n) { return [n & 255, (n >>> 8) & 255]; }
        function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }

        Object.keys(files).forEach(function (name) {
            var nameBytes = enc.encode(name);
            var data = enc.encode(files[name]);
            var crc = crc32(data);
            var local = [].concat(
                u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
                u32(crc), u32(data.length), u32(data.length),
                u16(nameBytes.length), u16(0)
            );
            parts.push(new Uint8Array(local), nameBytes, data);
            var localSize = local.length + nameBytes.length + data.length;

            central.push([].concat(
                u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
                u32(crc), u32(data.length), u32(data.length),
                u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
            ), nameBytes);
            offset += localSize;
        });

        var centralStart = offset;
        var centralBytes = [];
        central.forEach(function (c) {
            if (Array.isArray(c)) centralBytes.push(new Uint8Array(c)); else centralBytes.push(c);
        });
        var centralSize = centralBytes.reduce(function (s, b) { return s + b.length; }, 0);
        var fileCount = Object.keys(files).length;
        var eocd = new Uint8Array([].concat(
            u32(0x06054b50), u16(0), u16(0), u16(fileCount), u16(fileCount),
            u32(centralSize), u32(centralStart), u16(0)
        ));

        var blobParts = parts.concat(centralBytes).concat([eocd]);
        return new Blob(blobParts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    /* ---------------- Yonetici: veri guncelleme ---------------- */

    function openUpload() {
        $('uploadModal').hidden = false;
        $('uploadAlert').hidden = true;
        $('fileChosen').hidden = true;
        state.pendingFile = null;
        $('doUploadBtn').disabled = true;
        $('fileInput').value = '';
    }
    function closeUpload() { $('uploadModal').hidden = true; }

    function chooseFile(file) {
        if (!file) return;
        if (!/\.xlsx$/i.test(file.name)) {
            showAlert($('uploadAlert'), 'error', 'Lütfen .xlsx uzantılı bir Excel dosyası seçin.');
            return;
        }
        state.pendingFile = file;
        $('fileName').textContent = file.name;
        $('fileChosen').hidden = false;
        hideAlert($('uploadAlert'));
        $('doUploadBtn').disabled = false;
    }

    function doUpload() {
        if (!state.pendingFile) return;
        setLoading($('doUploadBtn'), true);
        hideAlert($('uploadAlert'));
        var fd = new FormData();
        fd.append('file', state.pendingFile);
        api('upload', { method: 'POST', isForm: true, body: fd })
            .then(function (res) {
                setLoading($('doUploadBtn'), false);
                var d = res.data || {};
                if (d.status === 'ok') {
                    try { localStorage.removeItem(STORE_DATA); } catch (e) {}
                    closeUpload();
                    toast('Veri güncellendi: ' + fmt((d.summary && d.summary.count) || 0) + ' kampanya.', 'success');
                    loadData();
                } else {
                    showAlert($('uploadAlert'), 'error', esc(d.message || 'Yükleme başarısız.'));
                }
            })
            .catch(function () {
                setLoading($('doUploadBtn'), false);
                showAlert($('uploadAlert'), 'error', 'Yükleme sırasında bağlantı hatası oluştu.');
            });
    }

    /* ---------------- Olaylar ---------------- */

    function debounce(fn, ms) {
        var t; return function () { clearTimeout(t); var a = arguments, c = this; t = setTimeout(function () { fn.apply(c, a); }, ms); };
    }

    function bindEvents() {
        $('formStep1').addEventListener('submit', onStep1);
        $('formStep2').addEventListener('submit', onStep2);
        $('backToStep1').addEventListener('click', showLogin);
        $('logoutBtn').addEventListener('click', onLogout);

        // Biyometrik (Face ID / parmak izi)
        $('bioBtn').addEventListener('click', bioLogin);
        $('bioRemove').addEventListener('click', bioDisable);
        $('bioEnable').addEventListener('click', function () { bioRegister($('bioEnable')); });
        $('bioDismiss').addEventListener('click', hideBioOffer);

        $('fKalem').addEventListener('input', debounce(applyFilters, 180));
        $('fHat').addEventListener('change', applyFilters);
        $('fYil').addEventListener('change', applyFilters);
        $('fBand').addEventListener('change', applyFilters);
        var SELECT_SORT = { kalem: ['kalem', 'asc'], verim_desc: ['verim', 'desc'], verim_asc: ['verim', 'asc'], saat_desc: ['saat', 'desc'], date_desc: ['date', 'desc'] };
        $('sortBy').addEventListener('change', function () {
            var m = SELECT_SORT[this.value] || ['kalem', 'asc'];
            setSort(m[0], m[1]);
        });
        // Tiklanabilir sutun basliklari
        Array.prototype.forEach.call(document.querySelectorAll('.th-sort'), function (th) {
            th.addEventListener('click', function () {
                var key = th.getAttribute('data-sort');
                var dir = (state.sortKey === key && state.sortDir === 'asc') ? 'desc' : (state.sortKey === key && state.sortDir === 'desc') ? 'asc' : (key === 'kalem' ? 'asc' : 'desc');
                setSort(key, dir);
            });
        });
        // Urun performansi gecisi (En iyi / En dusuk)
        Array.prototype.forEach.call(document.querySelectorAll('#lbToggle button'), function (b) {
            b.addEventListener('click', function () {
                state.lbMode = b.getAttribute('data-lb');
                Array.prototype.forEach.call(document.querySelectorAll('#lbToggle button'), function (x) { x.classList.remove('active'); });
                b.classList.add('active');
                drawLeaderboard();
            });
        });
        // Drill-down: tablo satiri ve liderlik satiri tiklamasi
        $('rows').addEventListener('click', function (e) {
            var r = e.target.closest('.row'); if (r && r.getAttribute('data-kalem')) openDetail(r.getAttribute('data-kalem'));
        });
        $('leaderboard').addEventListener('click', function (e) {
            var r = e.target.closest('.lb-row'); if (r && r.getAttribute('data-kalem')) openDetail(r.getAttribute('data-kalem'));
        });
        // Detay modali kapatma
        Array.prototype.forEach.call(document.querySelectorAll('[data-dclose]'), function (el) {
            el.addEventListener('click', closeDetail);
        });

        var clear = function () {
            $('fKalem').value = ''; $('fHat').value = ''; $('fYil').value = ''; $('fBand').value = '';
            applyFilters();
        };
        $('clearBtn').addEventListener('click', clear);
        $('clearBtn2').addEventListener('click', clear);
        $('exportBtn').addEventListener('click', exportExcel);

        // Yonetici yukleme
        $('adminUpdateBtn').addEventListener('click', openUpload);
        $('doUploadBtn').addEventListener('click', doUpload);
        $('fileInput').addEventListener('change', function (e) { chooseFile(e.target.files[0]); });
        Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (el) {
            el.addEventListener('click', closeUpload);
        });
        var dz = $('dropZone');
        ['dragenter', 'dragover'].forEach(function (ev) {
            dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
            dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
        });
        dz.addEventListener('drop', function (e) {
            if (e.dataTransfer.files && e.dataTransfer.files[0]) chooseFile(e.dataTransfer.files[0]);
        });

        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (!$('uploadModal').hidden) closeUpload();
            else if (!$('detailModal').hidden) closeDetail();
        });

        // OTP: yalnizca rakam
        $('otpCode').addEventListener('input', function () {
            this.value = this.value.replace(/\D/g, '');
        });
    }

    function registerSW() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function () {
                navigator.serviceWorker.register('sw.js').catch(function () {});
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
