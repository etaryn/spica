"use client";

import { useState, useTransition } from "react";
import { forgetFactAction } from "./actions";
import styles from "./memory.module.css";

export function ForgetButton({ factId }: { factId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  if (!confirming) {
    return <button className={styles.forget} onClick={() => setConfirming(true)}>Forget</button>;
  }
  return (
    <span className={styles.confirm}>
      Forget this?{" "}
      <button className={styles.danger} disabled={pending} onClick={() => startTransition(async () => { await forgetFactAction(factId); })}>
        {pending ? "Forgetting…" : "Yes, forget"}
      </button>{" "}
      <button className={styles.forget} disabled={pending} onClick={() => setConfirming(false)}>Keep</button>
    </span>
  );
}
