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
        coverage: ''
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
                    persistRemember(identifier);
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
            if (res.status === 401) { showLogin(); return; }
            if (res.data && res.data.campaigns) {
                applyDataset(res.data);
                try { localStorage.setItem(STORE_DATA, JSON.stringify(res.data)); } catch (e) {}
            } else if (!hadCache) {
                $('loadingState').hidden = true;
                toast('Veri yüklenemedi.', 'error');
            }
        }).catch(function () {
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
        updateKPIs();
        updateAnalytics();
        renderReset();
    }

    function sortFiltered() {
        var by = $('sortBy').value;
        state.filtered.sort(function (a, b) {
            switch (by) {
                case 'verim_desc': return b.verim - a.verim;
                case 'verim_asc': return a.verim - b.verim;
                case 'saat_desc': return b.saat - a.saat;
                case 'date_desc': return (b.bitis_iso || '').localeCompare(a.bitis_iso || '');
                default:
                    return a.kalem.localeCompare(b.kalem, 'tr') ||
                        a.hat.localeCompare(b.hat, 'tr') ||
                        (a.baslangic_iso || '').localeCompare(b.baslangic_iso || '');
            }
        });
    }

    function updateKPIs() {
        var totalHours = 0, wV = 0, wD = 0;
        state.filtered.forEach(function (c) {
            totalHours += c.saat;
            wV += c.verim * c.saat;
            wD += c.devir * c.saat;
        });
        var avgV = totalHours > 0 ? wV / totalHours : 0;
        var avgD = totalHours > 0 ? wD / totalHours : 0;

        setKPI('kpiCount', fmt(state.filtered.length));
        setKPI('kpiVerim', '%' + fmt(avgV, 1));
        setKPI('kpiDevir', fmt(avgD));
        setKPI('kpiSaat', fmt(totalHours));
        $('kpiVerimBar').style.width = Math.min(avgV, 100) + '%';
        $('kpiDevirBar').style.width = Math.min(avgD, 100) + '%';

        $('resultCount').textContent = fmt(state.filtered.length) + ' kampanya';
    }

    function setKPI(id, val) {
        var el = $(id);
        if (el.textContent === val) return;
        el.style.opacity = '.45';
        setTimeout(function () { el.textContent = val; el.style.opacity = '1'; }, 130);
    }

    function updateAnalytics() {
        var hi = 0, mid = 0, lo = 0;
        var yearAgg = {};
        state.filtered.forEach(function (c) {
            var bd = band(c.verim);
            if (bd === 'high') hi++; else if (bd === 'mid') mid++; else lo++;
            var yr = c.yil;
            if (!yearAgg[yr]) yearAgg[yr] = { w: 0, h: 0 };
            yearAgg[yr].w += c.verim * c.saat;
            yearAgg[yr].h += c.saat;
        });
        var total = hi + mid + lo || 1;
        $('segHigh').style.width = (hi / total * 100) + '%';
        $('segMid').style.width = (mid / total * 100) + '%';
        $('segLow').style.width = (lo / total * 100) + '%';
        $('cntHigh').textContent = fmt(hi);
        $('cntMid').textContent = fmt(mid);
        $('cntLow').textContent = fmt(lo);
        $('distTotal').textContent = fmt(hi + mid + lo) + ' kampanya';

        var years = Object.keys(yearAgg).sort();
        var html = '';
        years.forEach(function (yr) {
            var avg = yearAgg[yr].h > 0 ? yearAgg[yr].w / yearAgg[yr].h : 0;
            html += '<div class="year-row"><span class="yr-label">' + esc(yr) + '</span>' +
                '<span class="yr-track"><span class="yr-fill" style="width:' + Math.min(avg, 100) + '%"></span></span>' +
                '<span class="yr-val">%' + fmt(avg, 1) + '</span></div>';
        });
        $('yearChart').innerHTML = html || '<span class="muted" style="font-size:12px">Veri yok</span>';
    }

    /* ---------------- Liste (kademeli yukleme) ---------------- */

    function renderReset() {
        state.rendered = 0;
        $('rows').innerHTML = '';
        var empty = state.filtered.length === 0;
        $('emptyState').hidden = !empty;
        $('tableHead').style.display = empty ? 'none' : '';
        if (!empty) renderChunk();
        setupObserver();
    }

    function rowHTML(c) {
        var bc = bandClass(c.verim);
        return '<div class="row" role="listitem">' +
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
        var html = '';
        for (var i = state.rendered; i < end; i++) html += rowHTML(state.filtered[i]);
        $('rows').insertAdjacentHTML('beforeend', html);
        fixUseHrefs($('rows'));   // dinamik satir ikonlari (eski tarayici uyumlulugu)
        state.rendered = end;
    }

    function setupObserver() {
        if (state.observer) state.observer.disconnect();
        if (!('IntersectionObserver' in window)) {
            // Yedek: hepsini render et
            while (state.rendered < state.filtered.length) renderChunk();
            return;
        }
        state.observer = new IntersectionObserver(function (entries) {
            if (entries[0].isIntersecting && state.rendered < state.filtered.length) {
                renderChunk();
            }
        }, { rootMargin: '600px' });
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
        $('sortBy').addEventListener('change', function () { sortFiltered(); renderReset(); });
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
            if (e.key === 'Escape' && !$('uploadModal').hidden) closeUpload();
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
