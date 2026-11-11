/** Her drafted posts, newest first, with Ethan's approve and reject buttons. */
import Link from "next/link";
import { getDeps } from "@/server/deps";
import { assertInspectorAccess } from "@/server/inspector-guard";
import styles from "../inspector.module.css";
import { decidePostAction } from "./actions";

const iso = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "—");

export default async function InspectPosts() {
  await assertInspectorAccess();
  const { core, config } = getDeps();
  const posts = await core.posts.recent(config.posts.recent_limit);

  return (
    <>
      <Link href="/inspector/core">← her core mind</Link>
      <h1>Her posts</h1>
      {posts.length === 0 && <p>No posts yet.</p>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Image</th>
            <th>Words</th>
            <th>Find</th>
            <th>Check</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id}>
              <td>
                {p.medium === "reel" ? (
                  <video src={`/inspector/posts/${p.id}/image`} controls muted width={240} />
                ) : (
                  <img src={`/inspector/posts/${p.id}/image`} alt="" width={240} />
                )}
              </td>
              <td>
                <p>{p.caption}</p>
                {p.overlay_text && <p>on image: {p.overlay_text}</p>}
                <p>
                  {p.format} · {p.pose} · skill {p.skill.toFixed(2)}
                </p>
              </td>
              <td>
                {p.title} ({p.source})
              </td>
              <td>
                {p.check}
                {p.check_reason ? `: ${p.check_reason}` : ""}
              </td>
              <td>
                {p.status === "draft" ? (
                  <form action={decidePostAction}>
                    <input type="hidden" name="postId" value={p.id} />
                    <button name="decision" value="approve">
                      Approve
                    </button>{" "}
                    <button name="decision" value="reject">
                      Reject
                    </button>
                  </form>
                ) : (
                  `${p.status} ${iso(p.decided_at)}`
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
