import Link from "next/link";
import { adminListUsers } from "@/db/repos/users";
import { getDeps } from "@/server/deps";
import { assertInspectorAccess } from "@/server/inspector-guard";
import styles from "./inspector.module.css";

export default async function InspectorHome() {
  await assertInspectorAccess();
  const users = await adminListUsers(getDeps().db);
  return (
    <>
      <h1>Memory inspector</h1>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>User</th>
            <th>Email</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                <Link href={`/inspector/${u.id}`}>{u.name}</Link>
              </td>
              <td>{u.email}</td>
              <td>{u.createdAt.toISOString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
