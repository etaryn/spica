"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import styles from "../auth.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(f.get("email") ?? ""),
      password: String(f.get("password") ?? ""),
    });
    setBusy(false);
    if (error) {
      setError(error.message ?? "Login failed.");
      return;
    }
    router.push("/chat");
  }

  return (
    <div className={styles.wrap}>
      <h1>Welcome back</h1>
      <form className={styles.form} onSubmit={onSubmit}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className={styles.alt}>
        New here? <Link href="/signup">Create an account</Link>
      </p>
    </div>
  );
}
