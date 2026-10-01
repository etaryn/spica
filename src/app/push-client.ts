"use client";
/** Browser side of Web Push. Every call is safe to make where push isn't supported. */
export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function registerSw(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return navigator.serviceWorker.register("/sw.js");
}

/** Explicit opt-out from the settings switch; survives because browser permission stays "granted" after unsubscribing. */
const OFF = "spica.notifications.off";
export const pushOptedOut = () => {
  try {
    return localStorage.getItem(OFF) === "1";
  } catch {
    return false;
  }
};
const setOptOut = (off: boolean) => {
  try {
    if (off) localStorage.setItem(OFF, "1");
    else localStorage.removeItem(OFF);
  } catch {
    /* private window */
  }
};

export async function subscribePush(publicKey: string): Promise<boolean> {
  const reg = await registerSw();
  if (!reg || (await Notification.requestPermission()) !== "granted") return false;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (res.ok) setOptOut(false);
  return res.ok;
}

export async function unsubscribePush(): Promise<void> {
  setOptOut(true);
  const reg = pushSupported() ? await navigator.serviceWorker.getRegistration() : null;
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}

/**
 * Sign-out (privacy): detach this browser's subscription from the account so her messages stop arriving here.
 * DELETEs the endpoint while the session is still valid and unsubscribes the browser (a leftover row then
 * answers 404/410 and is pruned by the pusher). Best-effort and bounded by `timeoutMs`: it never throws and never
 * blocks sign-out. It does not set the opt-out flag, so the next account to sign in here gets the silent resubscribe.
 */
export async function releasePush(timeoutMs: number): Promise<void> {
  const release = async () => {
    const reg = pushSupported() ? await navigator.serviceWorker.getRegistration() : null;
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    // The DELETE is sent first (the endpoint is already captured); the local unsubscribe runs alongside it, so a slow
    // or failing DELETE never leaves this browser subscribed.
    const del = fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
      keepalive: true,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await Promise.allSettled([del, sub.unsubscribe()]);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // `.catch` on release too: a rejection after the timeout won the race must not go unhandled.
    await Promise.race([
      release().catch(() => undefined),
      new Promise<void>((r) => {
        timer = setTimeout(r, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function isSubscribed(): Promise<boolean> {
  const reg = pushSupported() ? await navigator.serviceWorker.getRegistration() : null;
  return !!(await reg?.pushManager.getSubscription());
}
