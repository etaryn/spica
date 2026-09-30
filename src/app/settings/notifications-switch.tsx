"use client";
import { useEffect, useState } from "react";
import { isSubscribed, pushSupported, subscribePush, unsubscribePush } from "../push-client";

export function NotificationsSwitch({ publicKey }: { publicKey: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { void isSubscribed().then(setOn); }, []);
  if (!pushSupported()) return <p>This browser doesn&apos;t support notifications.</p>;
  if (on === null) return null;
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input type="checkbox" checked={on} onChange={async (e) => {
        if (e.target.checked) setOn(await subscribePush(publicKey));
        else { await unsubscribePush(); setOn(false); }
      }} />
      Notify me when Spica messages
    </label>
  );
}
