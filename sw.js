/* Zal — офлайн-режим (service worker).
 *
 * Правила простые:
 *   • страницы (переходы) — сначала сеть, при отсутствии интернета отдаём копию;
 *   • файлы приложения — сначала копия (быстро), а обновление подтягиваем в фоне.
 *
 * При изменении файлов приложения поднимите номер версии ниже: CACHE_VERSION.
 */
var CACHE_VERSION = 'zal-v1.0.0';
var OFFLINE_URLS = [
  './',
  './index.html',
  './styles.css',
  './logic.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-120.png',
  './icons/icon-152.png',
  './icons/icon-167.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/favicon-64.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) { return cache.addAll(OFFLINE_URLS); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { /* часть файлов недоступна — установимся без них */ })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE_VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // чужие адреса не трогаем

  // Переходы по приложению: сеть, при офлайне — сохранённая страница
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  // Файлы приложения: отдаём из копии, обновляем в фоне
  event.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || network;
    })
  );
});
