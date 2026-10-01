"use client";
import { useEffect, useState } from "react";
import { isSubscribed, pushSupported, subscribePush, unsubscribePush } from "@/app/push-client";

export function NotificationsSwitch({ publicKey }: { publicKey: string }) {
  // Both unknown until mounted, so the server render and the first client render match (nothing).
  const [supported, setSupported] = useState<boolean | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    const ok = pushSupported();
    setSupported(ok);
    if (ok) void isSubscribed().then(setOn);
  }, []);
  if (supported === null) return null;
  if (!supported) return <p>This browser doesn&apos;t support notifications.</p>;
  if (on === null) return null;
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input
        type="checkbox"
        checked={on}
        onChange={async (e) => {
          if (e.target.checked) setOn(await subscribePush(publicKey));
          else {
            await unsubscribePush();
            setOn(false);
          }
        }}
      />
      Notify me when Spica messages
    </label>
  );
}
