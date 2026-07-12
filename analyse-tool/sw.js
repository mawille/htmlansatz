/*
 * Service Worker: macht das Tool installierbar und offline-fähig.
 *
 * Strategie "Netz zuerst, Cache als Fallback": Da das Tool laufend
 * weiterentwickelt wird, kommt online immer die frischeste Version;
 * ohne Netz (oder im Flugzeug) läuft die zuletzt gecachte Version im
 * Demo-Modus weiter. API-Aufrufe (Twelve Data) werden nie gecacht.
 */

const CACHE = 'day-trading-analyse-v2';

const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './css/styles.css',
    './js/settings.js',
    './js/indicators.js',
    './js/data.js',
    './js/signals.js',
    './js/recommendation.js',
    './js/calendar.js',
    './js/backtest.js',
    './js/journal.js',
    './js/alerts.js',
    './js/chart.js',
    './js/simple-chart.js',
    './js/app.js',
    './icons/icon-192.png',
    './icons/icon-512.png',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Kursdaten-API nie cachen – veraltete Kurse wären gefährlich
    if (url.hostname.endsWith('twelvedata.com')) return;

    // Nur eigene GET-Anfragen behandeln
    if (event.request.method !== 'GET' || url.origin !== location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Frische Antwort in den Cache legen
                const copy = response.clone();
                caches.open(CACHE).then(cache => cache.put(event.request, copy));
                return response;
            })
            .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
});
