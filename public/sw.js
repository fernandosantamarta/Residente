/* Residente service worker — web push.
   Shows a notification when the server pushes a notice, and focuses (or opens)
   the right page when the resident clicks it. Payload shape from
   notice-push-fanout: { title, body, url }. */

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (_) { data = {} }
  const title = data.title || 'Residente'
  const options = {
    body: data.body || '',
    icon: '/residente-logo.png',
    badge: '/residente-logo.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/app' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/app'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(url) && 'focus' in w) return w.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
