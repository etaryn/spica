import Link from "next/link";
import { requireUser } from "@/lib/session";
import { deleteAccountAction } from "./actions";
import { SignOutButton } from "./sign-out-button";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 480, margin: "8vh auto", padding: "0 16px", display: "grid", gap: 24 }}>
      <Link href="/chat">← Back to chat</Link>
      <section>
        <h1 style={{ fontSize: 24 }}>Settings</h1>
        <p>Signed in as {user.email}</p>
        <SignOutButton />
      </section>
      <section>
        <h2 style={{ fontSize: 18 }}>Delete account</h2>
        <p>This permanently deletes your account, your conversations and everything your friend remembers about you.</p>
        <form action={deleteAccountAction} style={{ display: "flex", gap: 8 }}>
          <input name="confirm" placeholder='Type "delete" to confirm' aria-label="Type delete to confirm" required />
          <button type="submit" style={{ background: "var(--danger)", color: "white", border: "none", borderRadius: 8, padding: "0 14px" }}>
            Delete
          </button>
        </form>
        {error === "confirm" && <p style={{ color: "var(--danger)" }}>Type &quot;delete&quot; exactly to confirm.</p>}
      </section>
    </main>
  );
}
