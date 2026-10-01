import Link from "next/link";
import { getDeps, getVapidPublicKey } from "@/server/deps";
import { requireUser } from "@/server/session";
import { deleteAccountAction } from "./actions";
import { NotificationsSwitch } from "./notifications-switch";
import { SignOutButton } from "./sign-out-button";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { error } = await searchParams;
  const vapidKey = getVapidPublicKey();
  return (
    <main
      style={{ maxWidth: 480, margin: "8vh auto", padding: "0 16px", display: "grid", gap: 24 }}
    >
      <Link href="/chat">← Back to chat</Link>
      <section>
        <h1 style={{ fontSize: 24 }}>Settings</h1>
        <p>Signed in as {user.email}</p>
        <p>
          <Link href="/memory">What Spica remembers about you</Link>
        </p>
        <SignOutButton pushTimeoutMs={getDeps().config.push.timeout_ms} />
      </section>
      {vapidKey && (
        <section>
          <h2 style={{ fontSize: 18 }}>Notifications</h2>
          <NotificationsSwitch publicKey={vapidKey} />
        </section>
      )}
      <section>
        <h2 style={{ fontSize: 18 }}>Delete account</h2>
        <p>
          This permanently deletes your account, your conversations and everything your friend
          remembers about you.
        </p>
        <form action={deleteAccountAction} style={{ display: "flex", gap: 8 }}>
          <input
            name="confirm"
            placeholder='Type "delete" to confirm'
            aria-label="Type delete to confirm"
            required
          />
          <button
            type="submit"
            style={{
              background: "var(--danger)",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "0 14px",
            }}
          >
            Delete
          </button>
        </form>
        {error === "confirm" && (
          <p style={{ color: "var(--danger)" }}>Type &quot;delete&quot; exactly to confirm.</p>
        )}
      </section>
    </main>
  );
}
