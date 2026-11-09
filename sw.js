// ============================================================================
// WindFoil — Service Worker
// ----------------------------------------------------------------------------
// Ausschließlich Web Push. Bewusst KEIN Asset-Caching: die Seiten werden ohne
// Build-Step deployt, ein Cache würde nach jedem Deploy alte Skripte servieren.
// ============================================================================

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  // Kein oder kaputtes Payload: lieber eine neutrale Meldung als nichts — ohne
  // showNotification() entzieht der Browser die Push-Berechtigung.
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* kein JSON */ }

  event.waitUntil(self.registration.showNotification(d.title || '🌬️ WindFoil', {
    body: d.body || 'Ein Spot erreicht deine Score-Schwelle.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'wf-alert',
    data: { url: d.url || '/vergleich.html' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/vergleich.html';
  event.waitUntil((async () => {
    // Ist WindFoil schon offen, wird dieser Tab benutzt — sonst sammeln sich
    // bei jedem Alarm neue Fenster an.
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ('navigate' in c) await c.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
