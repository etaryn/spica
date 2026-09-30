// public/sw.js: Phase 6 (spec §8.3). Shows her message only when no Spica tab is visible.
self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    return; // malformed payload: nothing to show, and never throw in the worker
  }
  if (!data || typeof data !== "object") return;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (tabs.some((c) => c.visibilityState === "visible")) return;
    await self.registration.showNotification(data.title || "Spica", { body: data.body, tag: data.tag, renotify: false, data: { url: data.url || "/chat" } });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/chat";
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = tabs.find((c) => new URL(c.url).pathname === url);
    if (open) return open.focus();
    return self.clients.openWindow(url);
  })());
});
