import { assertInspectorAccess } from "@/lib/inspector-guard";
import styles from "./inspector.module.css";

export default async function InspectorLayout({ children }: { children: React.ReactNode }) {
  await assertInspectorAccess();
  return <div className={styles.wrap}>{children}</div>;
}
