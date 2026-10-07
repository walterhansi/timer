/* ao timer – Service Worker
   Macht die App offline nutzbar.
   - Seitenaufrufe: erst Netzwerk (für Updates), bei Funklöchern Cache
   - Icons/Manifest: aus dem Cache, sonst Netzwerk
   Bei Änderungen an Icons oder Manifest CACHE_VERSION erhöhen (v2, v3, …). */

'use strict';

const CACHE_VERSION = 'ao-timer-v1';
const NETWORK_TIMEOUT_MS = 3000;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

/* ---------- Installation: App-Dateien vorab speichern ---------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => Promise.allSettled(APP_SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

/* ---------- Aktivierung: alte Cache-Versionen entfernen ---------- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- Anfragen beantworten ---------- */
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

/* Netzwerk zuerst (mit Zeitlimit), bei Fehler gespeicherte Version */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
    if (response && response.ok) {
      cache.put('./index.html', response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match('./index.html') || await cache.match('./');
    if (cached) return cached;
    return new Response('Offline – bitte einmal mit Internetverbindung öffnen.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/* Cache zuerst, sonst Netzwerk (und Ergebnis speichern) */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      res => { clearTimeout(timer); resolve(res); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}