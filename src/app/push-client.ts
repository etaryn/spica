"use client";
/** Browser side of Web Push (spec §8.3). Every call is safe to make where push isn't supported. */
export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function registerSw(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return navigator.serviceWorker.register("/sw.js");
}

export async function subscribePush(publicKey: string): Promise<boolean> {
  const reg = await registerSw();
  if (!reg || (await Notification.requestPermission()) !== "granted") return false;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  return res.ok;
}

export async function unsubscribePush(): Promise<void> {
  const reg = pushSupported() ? await navigator.serviceWorker.getRegistration() : null;
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
  await sub.unsubscribe();
}

export async function isSubscribed(): Promise<boolean> {
  const reg = pushSupported() ? await navigator.serviceWorker.getRegistration() : null;
  return !!(await reg?.pushManager.getSubscription());
}
