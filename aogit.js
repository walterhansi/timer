/* ao Baukasten – gemeinsame Datei für alle ao-Apps (identisch in jeder App, Stand siehe AOKIT_VERSION).
   Enthält:
   - AOGit: Abgleich über GitHub (Senden / Holen) im privaten Daten-Repository, eigener Ordner pro App.
            Zugang (Repository + Schlüssel) und Gerätename gelten für alle ao-Apps gemeinsam;
            ist fitlog schon verbunden, wird dessen Zugang automatisch mitbenutzt.
            Senden holt vorher automatisch, was andere Geräte gesendet haben, und führt es zusammen.
            Zusammengeführt wird immer in der App selbst (apply) – es wird nie blind überschrieben.
   - AOUi:  Nachfrage-Fenster im Stil der Apps (statt grauer Browser-Fenster).
   - AOUpdate: „Aktualisieren“ – neue Version holen und neu starten.
   Benutzung:
     AOGit.setup({ app: 'timer', title: 'ao timer', getData: () => daten, apply: daten => 'Zusammenfassung', onNews: bool => {} });
     AOGit.renderDataPage(element, { version: '1.2.3', cards: [eigeneKarten…], intro: 'Text' });
*/
(() => {
  'use strict';
  const AOKIT_VERSION = '1';
  const K_GIT = 'ao_github';       // { repo, token } – gemeinsam für alle ao-Apps
  const K_DEV = 'ao_device';       // Gerätename – gemeinsam für alle ao-Apps
  const API = 'https://api.github.com';

  /* ---------- Hilfen ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* egal */ } };
  const fmt = ts => {
    if (!ts) return 'noch nie';
    const d = new Date(ts), p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())} Uhr`;
  };
  function b64enc(str) {
    const bytes = new TextEncoder().encode(str); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64dec(b64) {
    const bin = atob(String(b64).replace(/\s/g, '')); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ---------- Aussehen (ao-Farbwelt) ---------- */
  const CSS = `
  .aok{--k-bg:#131419;--k-s:#1d1f27;--k-s2:#262935;--k-l:#343848;--k-t:#f2f3f6;--k-m:#a9aebb;--k-z1:#00b5a6;--k-z2:#124f92;--k-z3:#247d4d;--k-z4:#f9a73b;--k-z5:#cc2d3f;
    color:var(--k-t);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;max-width:720px;margin:0;text-align:left}
  .aok *{box-sizing:border-box}
  .aok h1{font-size:1.5rem;margin:4px 0 14px;font-weight:800;letter-spacing:-.01em}
  .aok .aok-card{background:var(--k-s);border:1px solid var(--k-l);border-radius:16px;padding:16px;margin:0 0 14px}
  .aok .aok-card h3{font-size:1.08rem;margin:0 0 6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .aok p{margin:6px 0;color:var(--k-m);font-size:.93rem}
  .aok b{color:var(--k-t)}
  .aok .aok-badge{font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--k-z1);color:#000}
  .aok .aok-badge.or{background:var(--k-z4);color:#000}
  .aok .aok-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
  .aok .aok-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 20px;border-radius:12px;border:none;
    background:var(--k-z1);color:#000;font:inherit;font-weight:700;cursor:pointer}
  .aok .aok-btn.ghost{background:var(--k-s2);color:var(--k-t);border:1px solid var(--k-l)}
  .aok .aok-btn.or{background:var(--k-z4);color:#000}
  .aok .aok-btn.red{background:var(--k-z5);color:#fff}
  .aok .aok-btn:disabled{opacity:.5;cursor:default}
  .aok .aok-btn svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
  .aok .aok-link{background:none;border:none;color:var(--k-m);text-decoration:underline;font:inherit;font-size:.88rem;cursor:pointer;padding:6px 0}
  .aok label{display:block;font-size:.85rem;color:var(--k-m);margin:12px 0 4px}
  .aok input[type=text],.aok input[type=password]{width:100%;min-height:46px;padding:0 12px;border-radius:10px;border:1px solid var(--k-l);background:var(--k-bg);color:var(--k-t);font:inherit}
  .aok .aok-note{border-radius:12px;padding:12px;margin:10px 0 0;font-size:.93rem;background:var(--k-s2);border-left:5px solid var(--k-z1);color:var(--k-t)}
  .aok .aok-note.or{border-left-color:var(--k-z4)}
  .aok .aok-note.red{border-left-color:var(--k-z5)}
  .aok .aok-status{min-height:1.2em;margin-top:10px;font-size:.93rem;color:var(--k-t);white-space:pre-line}
  .aok-dlg-back{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px;z-index:10000}
  .aok-dlg{background:#1d1f27;color:#f2f3f6;border:1px solid #343848;border-radius:16px;padding:20px;width:100%;max-width:420px;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5)}
  .aok-dlg h3{margin:0 0 8px;font-size:1.15rem}
  .aok-dlg p{margin:0 0 18px;color:#c9cdd8;white-space:pre-line}
  .aok-dlg .aok-row{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
  .aok-dlg button{min-height:46px;padding:0 20px;border-radius:12px;border:1px solid #343848;background:#262935;color:#f2f3f6;font:inherit;font-weight:700;cursor:pointer}
  .aok-dlg button.ok{background:#00b5a6;color:#000;border-color:#00b5a6}
  .aok-dlg button.danger{background:#cc2d3f;color:#fff;border-color:#cc2d3f}
  `;
  function injectCss() {
    if (document.getElementById('aok-css')) return;
    const st = document.createElement('style'); st.id = 'aok-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const ICON = {
    up: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>',
    sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.7-4.3L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.3L20 16M20 20v-4h-4"/></svg>'
  };

  /* ---------- Nachfrage-Fenster ---------- */
  const AOUi = {
    // Liefert true bei „OK“, sonst false
    confirm(title, text, okLabel = 'OK', danger = false) {
      injectCss();
      return new Promise(res => {
        const back = document.createElement('div'); back.className = 'aok-dlg-back';
        back.innerHTML = `<div class="aok-dlg" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
          <div class="aok-row"><button type="button" data-v="0">Abbrechen</button><button type="button" data-v="1" class="${danger ? 'danger' : 'ok'}">${esc(okLabel)}</button></div></div>`;
        const done = v => { back.remove(); document.removeEventListener('keydown', key, true); res(v); };
        const key = e => { if (e.key === 'Escape') { e.preventDefault(); done(false); } else if (e.key === 'Enter') { e.preventDefault(); done(true); } };
        back.addEventListener('click', e => { if (e.target === back) done(false); const b = e.target.closest('button[data-v]'); if (b) done(b.dataset.v === '1'); });
        document.addEventListener('keydown', key, true);
        document.body.appendChild(back);
        back.querySelector('button.ok,button.danger').focus();
      });
    },
    alert(title, text) {
      return AOUi.confirm(title, text, 'OK').then(() => {});
    }
  };

  /* ---------- Aktualisieren ---------- */
  const AOUpdate = {
    // Neue Version holen und neu starten (für den Knopf „Aktualisieren“)
    async now() {
      try {
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update().catch(() => {});
          const w = reg.waiting || reg.installing;
          if (w) {
            await new Promise(res => {
              const t = setTimeout(res, 4000);
              navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); res(); }, { once: true });
              try { w.postMessage('skipWaiting'); w.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { res(); }
            });
          }
        }
      } catch (e) { /* trotzdem neu laden */ }
      location.reload();
    }
  };

  /* ---------- Gerätename ---------- */
  function deviceName() {
    let d = lsGet(K_DEV, null);
    if (d == null) {
      try { d = (JSON.parse(localStorage.getItem('aofl_data') || 'null') || {}).device || ''; } catch (e) { d = ''; }
      if (!d) { try { d = localStorage.getItem('bb_device') || ''; } catch (e) { d = ''; } }
      if (d) lsSet(K_DEV, d);
    }
    return d || '';
  }
  function setDeviceName(n) { lsSet(K_DEV, String(n || '').trim()); }

  /* ---------- Zugang ---------- */
  function access() {
    const own = lsGet(K_GIT, null);
    if (own && own.repo && own.token) return { repo: own.repo, token: own.token, from: '' };
    for (const [k, name] of [['aofl_sync', 'fitlog'], ['bb_sync', 'basementBOX']]) {
      const s = lsGet(k, null);
      if (s && s.repo && s.token) return { repo: s.repo, token: s.token, from: name };
    }
    return null;
  }
  function parseRepo(s) {
    s = String(s || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
    const m = s.match(/(?:github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    return m ? `${m[1]}/${m[2]}` : '';
  }

  class GitErr extends Error {}
  async function gh(path, o = {}) {
    const acc = o.acc || access();
    let res;
    try {
      res = await fetch(API + path, {
        method: o.method || 'GET', cache: 'no-store',
        headers: Object.assign({ Authorization: 'Bearer ' + acc.token, Accept: 'application/vnd.github+json' }, o.body ? { 'Content-Type': 'application/json' } : {}),
        body: o.body ? JSON.stringify(o.body) : undefined
      });
    } catch (e) { throw new GitErr('Keine Verbindung zu GitHub. Bitte Internet prüfen.'); }
    if (o.allow404 && res.status === 404) return null;
    if (res.ok) return res.status === 204 ? null : res.json();
    let msg = ''; try { msg = (await res.json()).message || ''; } catch (e) { /* egal */ }
    if (res.status === 401) throw new GitErr('GitHub lehnt den Schlüssel ab. Bitte unter „Zugang ändern“ einen gültigen Schlüssel eintragen.');
    if (res.status === 403 && /rate limit/i.test(msg)) throw new GitErr('GitHub bremst gerade zu viele Anfragen. Bitte in ein paar Minuten nochmal.');
    if (res.status === 403) throw new GitErr('Keine Schreibberechtigung. Beim Schlüssel muss „Contents: Read and write“ erlaubt sein.');
    if (res.status === 404) throw new GitErr('Repository nicht gefunden. Name prüfen und ob der Schlüssel Zugriff darauf hat.');
    if (res.status === 409 || res.status === 422) throw Object.assign(new GitErr('conflict'), { conflict: true });
    throw new GitErr(`GitHub meldet Fehler ${res.status}${msg ? ': ' + msg : ''}.`);
  }
  let checkedRepo = '';
  async function ensurePrivate(acc) {
    if (checkedRepo === acc.repo) return;
    const r = await gh(`/repos/${acc.repo}`, { acc });
    if (!r.private) throw new GitErr('Das Repository ist öffentlich. Deine Daten gehören in ein privates Repository.');
    if (r.permissions && !r.permissions.push) throw new GitErr('Der Schlüssel darf in dieses Repository nicht schreiben.');
    checkedRepo = acc.repo;
  }

  /* ---------- Abgleich ---------- */
  let cfg = null;          // { app, title, getData, apply, onNews, isBusy }
  let st = {};             // je App: { sha, lastSend, lastFetch }
  let busy = '', status = '', news = null, editing = false;
  const mounts = new Map();   // Element → Optionen
  const stKey = () => 'ao_git_' + cfg.app;
  const path = () => `${cfg.app}/daten.json`;
  const saveSt = () => lsSet(stKey(), st);

  async function getRemote(acc) {
    const r = await gh(`/repos/${acc.repo}/contents/${path()}`, { acc, allow404: true });
    if (!r) return null;
    let text = r.content && r.encoding === 'base64' ? b64dec(r.content) : null;
    if (text == null) { const b = await gh(`/repos/${acc.repo}/git/blobs/${r.sha}`, { acc }); text = b64dec(b.content); }
    let d; try { d = JSON.parse(text); } catch (e) { throw new GitErr('Die Daten auf GitHub sind nicht lesbar.'); }
    if (!d || d.app !== cfg.app) throw new GitErr('Die Datei auf GitHub gehört zu einer anderen App.');
    return { sha: r.sha, d };
  }
  function applyRemote(rem) {
    const summary = cfg.apply(rem.d.data);
    st.sha = rem.sha; st.lastFetch = Date.now(); saveSt();
    setNews(null);
    return summary || '';
  }
  function setNews(n) { news = n; if (cfg && cfg.onNews) try { cfg.onNews(!!n); } catch (e) { /* egal */ } }
  function from(rem) { const d = rem.d; return `${d.device ? ' von „' + d.device + '“' : ''}${d.sentAt ? ' (gesendet ' + fmt(d.sentAt) + ')' : ''}`; }

  async function send() {
    const acc = access(); if (!acc || busy) return;
    if (cfg.isBusy && cfg.isBusy()) { setStatus('Bitte erst das laufende Training beenden.'); return; }
    if (!deviceName()) { setStatus('Bitte zuerst oben einen Gerätenamen eintragen.'); return; }
    setBusy('Senden …');
    let merged = '';
    try {
      await ensurePrivate(acc);
      for (let attempt = 0; ; attempt++) {
        const rem = await getRemote(acc);
        if (rem && rem.sha !== st.sha) merged = `Vorher übernommen${from(rem)}:\n` + applyRemote(rem) + '\n';
        const body = { app: cfg.app, schema: 1, title: cfg.title, device: deviceName(), sentAt: Date.now(), data: cfg.getData() };
        try {
          const r = await gh(`/repos/${acc.repo}/contents/${path()}`, { acc, method: 'PUT', body: {
            message: `${cfg.title} – ${deviceName()}: Daten gesendet`, content: b64enc(JSON.stringify(body)), sha: rem ? rem.sha : undefined } });
          st.sha = r.content.sha; st.lastSend = Date.now(); saveSt();
          break;
        } catch (e) {
          if (!e.conflict || attempt >= 3) throw e.conflict ? new GitErr('Gerade sendet ein anderes Gerät. Bitte gleich nochmal tippen.') : e;
        }
      }
      setNews(null);
      setStatus(merged + 'Gesendet. Die anderen Geräte können jetzt „Holen“ tippen.');
    } catch (e) { setStatus(errText(e)); }
    finally { setBusy(''); }
  }
  async function fetchNow() {
    const acc = access(); if (!acc || busy) return;
    if (cfg.isBusy && cfg.isBusy()) { setStatus('Bitte erst das laufende Training beenden.'); return; }
    setBusy('Holen …');
    try {
      await ensurePrivate(acc);
      const rem = await getRemote(acc);
      if (!rem) { setStatus('Auf GitHub liegen noch keine Daten dieser App. Zuerst auf einem anderen Gerät „Senden“ tippen.'); return; }
      const s = applyRemote(rem);
      setStatus(`Geholt${from(rem)} und zusammengeführt.\n${s}`);
    } catch (e) { setStatus(errText(e)); }
    finally { setBusy(''); }
  }
  async function check() {
    const acc = access(); if (!acc || busy || navigator.onLine === false) return;
    try {
      const r = await gh(`/repos/${acc.repo}/contents/${path()}`, { acc, allow404: true });
      if (r && r.sha !== st.sha) { if (!news) { setNews({ sha: r.sha }); rerender(); } }
      else if (news) { setNews(null); rerender(); }
    } catch (e) { /* still */ }
  }
  function errText(e) { return e instanceof GitErr ? e.message : 'Fehler beim Abgleich: ' + ((e && e.message) || e); }
  function setBusy(b) { busy = b; rerender(); }
  function setStatus(s) { status = s; rerender(); }

  /* ---------- Darstellung ---------- */
  function deviceCard() {
    return `<div class="aok-card"><h3>Dieses Gerät</h3>
      <label for="aokDev">Gerätename (gilt für alle ao-Apps, erscheint beim Abgleich)</label>
      <input type="text" id="aokDev" data-aok="dev" value="${esc(deviceName())}" placeholder="z. B. Handy, PC oder Chromebook" autocomplete="off"></div>`;
  }
  function syncCard() {
    const acc = access();
    if (!acc || editing) {
      const cur = lsGet(K_GIT, null) || acc || {};
      return `<div class="aok-card"><h3>Abgleich über GitHub <span class="aok-badge">Standardweg</span></h3>
        <p>So tauschen deine Geräte ihre Daten aus: <b>Senden</b> auf dem einen Gerät, <b>Holen</b> auf dem anderen. Es wird immer zusammengeführt, nichts wird blind überschrieben. Einmal einrichten – derselbe Zugang gilt dann für alle ao-Apps (wie in fitlog).</p>
        <label for="aokRepo">Privates Repository</label>
        <input type="text" id="aokRepo" value="${esc(cur.repo || '')}" placeholder="walterhansi/fitlog-daten" autocomplete="off" autocapitalize="off" spellcheck="false">
        <label for="aokTok">Schlüssel (Token)</label>
        <input type="password" id="aokTok" value="" placeholder="${cur.token ? 'unverändert lassen' : 'github_pat_…'}" autocomplete="off" autocapitalize="off" spellcheck="false">
        <div class="aok-row"><button class="aok-btn" type="button" data-aok="save">Speichern</button>${editing ? '<button class="aok-btn ghost" type="button" data-aok="cancel">Abbrechen</button>' : ''}</div>
        <div class="aok-status">${esc(status)}</div></div>`;
    }
    const dis = busy ? 'disabled' : '';
    return `<div class="aok-card"><h3>Abgleich über GitHub <span class="aok-badge">Standardweg</span></h3>
      ${news ? '<div class="aok-note or">Ein anderes Gerät hat neue Daten gesendet. Tippe „Holen“.</div>' : ''}
      <div class="aok-row"><button class="aok-btn" type="button" data-aok="send" ${dis}>${ICON.up}${busy === 'Senden …' ? 'Senden …' : 'Senden'}</button>
        <button class="aok-btn ${news ? 'or' : 'ghost'}" type="button" data-aok="fetch" ${dis}>${ICON.down}${busy === 'Holen …' ? 'Holen …' : 'Holen'}</button></div>
      <div class="aok-status">${esc(status)}</div>
      <p><b>Senden</b> legt die Daten dieses Geräts auf GitHub ab (vorher wird automatisch übernommen, was andere Geräte gesendet haben). <b>Holen</b> übernimmt, was die anderen Geräte gesendet haben.</p>
      <p>Zuletzt gesendet: <b>${fmt(st.lastSend)}</b> · zuletzt geholt: <b>${fmt(st.lastFetch)}</b></p>
      <p>Ablage: ${esc(acc.repo)}, Ordner „${esc(cfg.app)}/“${acc.from ? ` · Zugang aus ${esc(acc.from)} übernommen` : ''}</p>
      <button class="aok-link" type="button" data-aok="edit">Zugang ändern</button></div>`;
  }
  function helpCard(o) {
    return `<div class="aok-card"><h3>Hilfe</h3><p>${esc(cfg.title)} Version <b>${esc(o.version || '?')}</b></p>
      <div class="aok-row"><button class="aok-btn ghost" type="button" data-aok="update">${ICON.sync}Aktualisieren</button>${o.guide ? `<a class="aok-btn ghost" href="${esc(o.guide)}" target="_blank" rel="noopener">Anleitung öffnen</a>` : ''}</div>
      <p>„Aktualisieren“ holt die neueste Version der App und startet sie neu. Deine Daten bleiben erhalten.</p></div>`;
  }
  function render(m) {
    const o = m.opts;
    m.el.classList.add('aok');
    const keep = document.activeElement && m.el.contains(document.activeElement) ? document.activeElement.id : '';
    m.el.innerHTML = `${o.heading === false ? '' : `<h1>${esc(o.heading || 'Daten')}</h1>`}${o.intro ? `<p style="margin:-6px 0 14px">${esc(o.intro)}</p>` : ''}
      ${deviceCard()}${syncCard()}<div data-aok-slot></div>${helpCard(o)}`;
    const slot = m.el.querySelector('[data-aok-slot]');
    for (const c of o.cards || []) slot.appendChild(c);
    if (keep && keep !== 'aokTok') { const k = document.getElementById(keep); if (k) k.focus(); }
  }
  function rerender() { for (const [el, opts] of mounts) if (el.isConnected) render({ el, opts }); else mounts.delete(el); }

  function onClick(e) {
    const b = e.target.closest('[data-aok]'); if (!b) return;
    const a = b.dataset.aok;
    if (a === 'send') send();
    else if (a === 'fetch') fetchNow();
    else if (a === 'update') { b.disabled = true; b.textContent = 'Wird aktualisiert …'; AOUpdate.now(); }
    else if (a === 'edit') { editing = true; status = ''; rerender(); }
    else if (a === 'cancel') { editing = false; status = ''; rerender(); }
    else if (a === 'save') saveAccess();
  }
  async function saveAccess() {
    const repo = parseRepo(document.getElementById('aokRepo').value);
    const cur = lsGet(K_GIT, null) || access() || {};
    const token = document.getElementById('aokTok').value.trim() || cur.token || '';
    if (!repo) { setStatus('Bitte das Repository angeben, z. B. walterhansi/fitlog-daten.'); return; }
    if (!token) { setStatus('Bitte den Schlüssel (Token) eintragen.'); return; }
    setStatus('Prüfe Zugang …');
    try {
      checkedRepo = '';
      await ensurePrivate({ repo, token });
      if (!cur.repo || cur.repo !== repo) st = {};   // neues Repository: Abgleich-Stand neu
      lsSet(K_GIT, { repo, token }); saveSt();
      editing = false; status = 'Zugang gespeichert. Jetzt „Holen“ oder „Senden“ tippen.';
      rerender(); check();
    } catch (e) { setStatus(errText(e)); }
  }

  const AOGit = {
    setup(o) {
      cfg = o; st = lsGet(stKey(), {}) || {}; injectCss();
      document.addEventListener('click', ev => { if (ev.target.closest('.aok')) onClick(ev); });
      document.addEventListener('change', ev => { if (ev.target.dataset && ev.target.dataset.aok === 'dev') setDeviceName(ev.target.value); });
      setTimeout(check, 1500);
      setInterval(() => { if (document.visibilityState === 'visible') check(); }, 5 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    },
    renderDataPage(el, opts = {}) { mounts.set(el, opts); render({ el, opts }); },
    send, fetch: fetchNow, check,
    ready: () => !!access(),
    hasNews: () => !!news,
    deviceName, version: AOKIT_VERSION
  };
  window.AOGit = AOGit; window.AOUi = AOUi; window.AOUpdate = AOUpdate;
})();
