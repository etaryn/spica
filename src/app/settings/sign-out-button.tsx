"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/server/auth-client";
import { releasePush } from "@/app/push-client";

/** Detaches this browser's push subscription first (while the session still authorizes the DELETE), best-effort. */
export function SignOutButton({ pushTimeoutMs }: { pushTimeoutMs: number }) {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await releasePush(pushTimeoutMs); // never throws, bounded
        await authClient.signOut();
        router.push("/login");
      }}
    >
      Sign out
    </button>
  );
}
