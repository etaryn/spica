"use client";
import { useEffect, useState } from "react";
import { isSubscribed, pushOptedOut, pushSupported, registerSw, subscribePush } from "../push-client";
import styles from "./chat.module.css";

const DISMISSED = "spica.notifications.dismissed";
const read = () => { try { return localStorage.getItem(DISMISSED) === "1"; } catch { return false; } };
const write = () => { try { localStorage.setItem(DISMISSED, "1"); } catch { /* private window */ } };

/** Spec D7: a one-time banner; once allowed, everything she sends pushes until switched off in /settings. */
export function NotificationsBanner({ publicKey }: { publicKey: string | null }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!publicKey || !pushSupported()) return;
    void registerSw();
    void (async () => {
      if (Notification.permission === "granted") {
        // Re-subscribe silently, unless she was switched off in /settings.
        if (!pushOptedOut() && !(await isSubscribed())) await subscribePush(publicKey);
        return;
      }
      setShow(Notification.permission === "default" && !read());
    })();
  }, [publicKey]);
  if (!show || !publicKey) return null;
  return (
    <div className={styles.banner} role="region" aria-label="Notifications">
      <span>Get her messages when the app is closed.</span>
      <button onClick={async () => { await subscribePush(publicKey); write(); setShow(false); }}>Turn on notifications</button>
      <button aria-label="Dismiss" onClick={() => { write(); setShow(false); }}>×</button>
    </div>
  );
}
