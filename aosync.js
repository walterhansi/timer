/* ao Sync – Übertragung gesicherter Daten zwischen zwei Geräten per QR-Code
   Gemeinsames Modul für ao timer und ao Puls (identische Datei in beiden Apps).

   Senden:    AOSync.send({ app, data, summary })
   Empfangen: AOSync.receive({ app, apply })   // apply(data) → Ergebnistext

   Ablauf: Daten → JSON → komprimiert → Base64url → in Teile zerlegt.
   Jeder Teil ist ein eigener QR-Code; bei mehreren Teilen wechselt die Anzeige
   automatisch, das empfangende Gerät sammelt alle Teile ein.
   Kein Server, kein Internet nötig. Zusammengeführt wird in der jeweiligen App. */
(() => {
  'use strict';

  const PREFIX = 'AO1';
  const CHUNK = 320;        // Zeichen pro QR-Code – klein genug für sicheres Scannen vom Monitor
  const FRAME_MS = 1100;    // Wechselzeit bei mehreren QR-Codes
  const SCAN_MS = 160;
  const APP_NAMES = { timer: 'ao timer', puls: 'ao Puls' };
  // Wo die Knöpfe in der jeweiligen App sitzen – muss zu den Beschriftungen in der App passen
  const WHERE = {
    timer: { send: 'unter „List“ auf „Senden (QR)“', recv: 'unter „List“ auf „Empfangen (QR)“' },
    puls:  { send: 'unter „Intervals“ oder „Zones“ auf „QR fürs Handy“', recv: 'unter „Intervals“ oder „Zones“ auf „QR einlesen“' }
  };
  const BASE = (document.currentScript && document.currentScript.src)
    ? new URL('.', document.currentScript.src).href : new URL('.', location.href).href;

  /* ---------- Hilfen ---------- */
  const loaded = {};
  function loadScript(rel) {
    if (!loaded[rel]) {
      loaded[rel] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = new URL(rel, BASE).href;
        s.onload = res;
        s.onerror = () => { delete loaded[rel]; rej(new Error('Bibliothek nicht ladbar: ' + rel)); };
        document.head.append(s);
      });
    }
    return loaded[rel];
  }

  function toB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function pipe(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }
  async function pack(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      try { return { flag: 'z', text: toB64url(await pipe(raw, new CompressionStream('deflate'))) }; } catch (e) { /* weiter unkomprimiert */ }
    }
    return { flag: 'j', text: toB64url(raw) };
  }
  async function unpack(flag, text) {
    let bytes = fromB64url(text);
    if (flag === 'z') {
      if (typeof DecompressionStream !== 'function') throw new Error('Dieser Browser kann die Daten nicht entpacken.');
      bytes = await pipe(bytes, new DecompressionStream('deflate'));
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /* ---------- Dialog ---------- */
  let dlg, cleanup = null;
  function injectStyle() {
    if (document.getElementById('aos-style')) return;
    const st = document.createElement('style');
    st.id = 'aos-style';
    st.textContent = `
      #aos-dlg { border: 0; padding: 0; background: #16181c; color: #f2f2f2; border-radius: 16px;
        width: min(560px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); box-shadow: 0 10px 40px rgba(0,0,0,.7);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      #aos-dlg::backdrop { background: rgba(0,0,0,.75); }
      #aos-dlg .aos-in { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
      #aos-dlg h3 { margin: 0; font-size: 1.2rem; }
      #aos-dlg p { margin: 0; line-height: 1.45; color: #c9cbd1; }
      #aos-dlg .aos-qr { background: #fff; border-radius: 10px; padding: 10px; align-self: center;
        width: min(460px, 100%, 62dvh); aspect-ratio: 1; box-sizing: border-box; }
      #aos-dlg .aos-qr canvas { width: 100%; height: 100%; image-rendering: pixelated; display: block; }
      #aos-dlg .aos-cam { position: relative; background: #000; border-radius: 10px; overflow: hidden; aspect-ratio: 1; width: 100%; max-height: 60dvh; }
      #aos-dlg video { width: 100%; height: 100%; object-fit: cover; display: block; }
      #aos-dlg .aos-frame { position: absolute; inset: 14%; border: 3px solid rgba(255,255,255,.85); border-radius: 14px; pointer-events: none; }
      #aos-dlg .aos-status { font-weight: 600; color: #f2f2f2; min-height: 1.4em; }
      #aos-dlg .aos-status:empty { display: none; }
      #aos-dlg .aos-bar { height: 8px; background: #2a2d33; border-radius: 4px; overflow: hidden; }
      #aos-dlg .aos-bar i { display: block; height: 100%; width: 0; background: #22c55e; transition: width .2s; }
      #aos-dlg .aos-res { white-space: pre-line; color: #f2f2f2; }
      #aos-dlg .aos-err { color: #ff8a8a; }
      #aos-dlg button { font: inherit; font-weight: 600; min-height: 48px; border-radius: 12px; border: 0;
        background: #2a2d33; color: #f2f2f2; cursor: pointer; }
      #aos-dlg button.aos-primary { background: #0a84ff; }
    `;
    document.head.append(st);
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function openDialog(children) {
    injectStyle();
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'aos-dlg';
      dlg.addEventListener('close', () => { if (cleanup) { const c = cleanup; cleanup = null; c(); } });
      dlg.addEventListener('cancel', () => {});   // Esc schließt normal
      document.body.append(dlg);
    }
    const box = el('div', 'aos-in');
    box.append(...children);
    dlg.replaceChildren(box);
    if (!dlg.open) dlg.showModal();
  }
  function closeBtn(label, primary) {
    const b = el('button', primary ? 'aos-primary' : '', label);
    b.type = 'button';
    b.onclick = () => dlg.close();
    return b;
  }

  /* ---------- Senden ---------- */
  function drawQR(canvas, text) {
    const qr = window.qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount(), q = 4, size = n + 2 * q;
    canvas.width = size; canvas.height = size;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(c + q, r + q, 1, 1);
  }

  async function send({ app, data, summary }) {
    try {
      await loadScript('lib/qrcode.js');
      const { flag, text } = await pack(data);
      const parts = Math.max(1, Math.ceil(text.length / CHUNK));
      const set = Math.random().toString(36).slice(2, 6);
      const codes = [];
      for (let i = 0; i < parts; i++) {
        codes.push([PREFIX, app, set, i + 1, parts, flag, text.slice(i * CHUNK, (i + 1) * CHUNK)].join('|'));
      }
      const canvas = el('canvas');
      const wrap = el('div', 'aos-qr'); wrap.append(canvas);
      const status = el('p', 'aos-status');
      openDialog([
        el('h3', '', 'An anderes Gerät senden'),
        el('p', '', `${summary}. Tippe auf dem Handy in ${APP_NAMES[app]} ${WHERE[app].recv} und halte die Kamera auf diesen Code.`),
        wrap, status,
        el('p', '', 'Auf dem Handy wird nichts gelöscht. Bei gleichem Namen gewinnt die jüngere Fassung.'),
        closeBtn('Schließen', true)
      ]);
      let idx = 0;
      const show = () => {
        drawQR(canvas, codes[idx]);
        status.textContent = parts > 1 ? `Code ${idx + 1} von ${parts} – wechselt automatisch` : '';
        idx = (idx + 1) % parts;
      };
      show();
      const timer = parts > 1 ? setInterval(show, FRAME_MS) : null;
      // Bildschirm während des Sendens anlassen
      let lock = null;
      try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) {}
      cleanup = () => { if (timer) clearInterval(timer); try { lock && lock.release(); } catch (e) {} };
    } catch (e) {
      openDialog([el('h3', '', 'Senden nicht möglich'), el('p', 'aos-err', e.message || String(e)), closeBtn('Schließen', true)]);
    }
  }

  /* ---------- Empfangen ---------- */
  async function makeDetector() {
    if ('BarcodeDetector' in window) {
      try {
        const fmts = await window.BarcodeDetector.getSupportedFormats();
        if (fmts.includes('qr_code')) {
          const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
          return async video => (await bd.detect(video)).map(c => c.rawValue);
        }
      } catch (e) { /* Reserve unten */ }
    }
    await loadScript('lib/jsqr.js');
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d', { willReadFrequently: true });
    return async video => {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return [];
      const k = Math.min(1, 900 / Math.max(vw, vh));
      cv.width = Math.round(vw * k); cv.height = Math.round(vh * k);
      g.drawImage(video, 0, 0, cv.width, cv.height);
      const img = g.getImageData(0, 0, cv.width, cv.height);
      const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      return r ? [r.data] : [];
    };
  }

  async function receive({ app, apply }) {
    const video = el('video');
    video.setAttribute('playsinline', ''); video.muted = true; video.autoplay = true;
    const cam = el('div', 'aos-cam'); cam.append(video, el('div', 'aos-frame'));
    const status = el('p', 'aos-status', 'Kamera wird gestartet …');
    const bar = el('div', 'aos-bar'); const fill = el('i'); bar.append(fill);
    openDialog([
      el('h3', '', 'Von anderem Gerät empfangen'),
      el('p', '', `Tippe am PC in ${APP_NAMES[app]} ${WHERE[app].send} und richte die Kamera auf den QR-Code.`),
      cam, status, bar, closeBtn('Abbrechen')
    ]);

    let stream = null, stopped = false, tm = null;
    const stop = () => {
      stopped = true; clearTimeout(tm);
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null;
    };
    cleanup = stop;

    const fail = msg => {
      stop();
      openDialog([el('h3', '', 'Empfangen nicht möglich'), el('p', 'aos-err', msg), closeBtn('Schließen', true)]);
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return fail('Dieser Browser erlaubt hier keinen Kamerazugriff. Die App muss über https geöffnet sein.');
    }
    let detect;
    try {
      detect = await makeDetector();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false
      });
      if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      const none = e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError');
      return fail(denied ? 'Kamerazugriff wurde verweigert. Erlaube ihn in den Website-Einstellungen des Browsers (Schloss-Symbol neben der Adresse bzw. App-Info → Berechtigungen) und versuche es erneut.'
        : none ? 'Keine Kamera gefunden.' : 'Kamera konnte nicht gestartet werden: ' + (e && e.message || e));
    }

    status.textContent = 'Suche QR-Code …';
    let set = null, total = 0, flag = 'z';
    const parts = new Map();
    let warned = '';

    const handle = async text => {
      const f = String(text).split('|');
      if (f.length !== 7 || f[0] !== PREFIX) { warned = 'Das ist kein Code von ao timer / ao Puls.'; return false; }
      if (f[1] !== app) { warned = `Das ist ein Code von ${APP_NAMES[f[1]] || 'einer anderen App'}. Bitte in ${APP_NAMES[f[1]] || 'der passenden App'} empfangen.`; return false; }
      const i = +f[3], n = +f[4];
      if (!(n >= 1 && i >= 1 && i <= n)) return false;
      if (f[2] !== set) { set = f[2]; total = n; flag = f[5]; parts.clear(); }
      parts.set(i, f[6]);
      warned = '';
      fill.style.width = Math.round(100 * parts.size / total) + '%';
      status.textContent = total > 1 ? `${parts.size} von ${total} Codes erfasst …` : 'Code erfasst …';
      if (parts.size < total) return false;
      let joined = '';
      for (let k = 1; k <= total; k++) joined += parts.get(k);
      let data;
      try { data = await unpack(flag, joined); }
      catch (e) { set = null; parts.clear(); fill.style.width = '0%'; status.textContent = 'Lesefehler – bitte weiter auf den Code halten.'; return false; }
      stop();
      if (navigator.vibrate) navigator.vibrate(80);
      let result;
      try { result = await apply(data); }
      catch (e) { fail('Die Daten konnten nicht übernommen werden: ' + (e.message || e)); return true; }
      openDialog([el('h3', '', 'Übertragung abgeschlossen'), el('p', 'aos-res', result), closeBtn('Fertig', true)]);
      return true;
    };

    const loop = async () => {
      if (stopped) return;
      try {
        if (video.readyState >= 2) {
          for (const code of await detect(video)) { if (await handle(code)) return; }
          if (warned) status.textContent = warned;
        }
      } catch (e) { /* einzelnes Kamerabild nicht lesbar – einfach weiter */ }
      if (!stopped) tm = setTimeout(loop, SCAN_MS);
    };
    loop();
  }

  window.AOSync = { send, receive };
})();
