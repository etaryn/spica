"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/server/auth-client";
import styles from "../auth.module.css";

export default function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: String(f.get("name") ?? ""),
      email: String(f.get("email") ?? ""),
      password: String(f.get("password") ?? ""),
      dateOfBirth: String(f.get("dateOfBirth") ?? ""),
    });
    setBusy(false);
    if (error) {
      setError(error.message ?? "Sign-up failed.");
      return;
    }
    router.push("/chat");
  }

  return (
    <div className={styles.wrap}>
      <h1>Meet your friend</h1>
      <p className={styles.lede}>Spica is for adults (18+).</p>
      <form className={styles.form} onSubmit={onSubmit}>
        <label>
          What should we call you?
          <input name="name" required autoComplete="given-name" />
        </label>
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
          />
        </label>
        <label>
          Date of birth
          <input name="dateOfBirth" type="date" required />
        </label>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className={styles.alt}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </div>
  );
}
