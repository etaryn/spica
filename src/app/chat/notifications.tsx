"use client";
import { useEffect, useState } from "react";
import { pushOptedOut, pushSupported, registerSw, subscribePush } from "../push-client";
import styles from "./chat.module.css";

const DISMISSED = "spica.notifications.dismissed";
const read = () => {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
};
const write = () => {
  try {
    localStorage.setItem(DISMISSED, "1");
  } catch {
    /* private window */
  }
};

/** Spec D7: a one-time banner; once allowed, everything she sends pushes until switched off in /settings. */
export function NotificationsBanner({ publicKey }: { publicKey: string | null }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!publicKey || !pushSupported()) return;
    void (async () => {
      try {
        await registerSw();
        if (Notification.permission === "granted") {
          // Unless switched off in /settings: always (re)post this browser's subscription, so one another account
          // left behind is reassigned to whoever is signed in now (the upsert moves the endpoint); subscribe silently
          // if there is none.
          if (!pushOptedOut()) await subscribePush(publicKey);
          return;
        }
        setShow(Notification.permission === "default" && !read());
      } catch {
        /* push is optional: the chat works without it */
      }
    })();
  }, [publicKey]);
  if (!show || !publicKey) return null;
  const turnOn = async () => {
    let ok = false;
    try {
      ok = await subscribePush(publicKey);
    } catch {
      ok = false;
    }
    if (ok) write(); // a failed subscribe keeps the banner available for another try
    setShow(false);
  };
  return (
    <div className={styles.banner} role="region" aria-label="Notifications">
      <span>Get her messages when the app is closed.</span>
      <button onClick={turnOn}>Turn on notifications</button>
      <button
        aria-label="Dismiss"
        onClick={() => {
          write();
          setShow(false);
        }}
      >
        ×
      </button>
    </div>
  );
}
