import Link from "next/link";
import { notFound } from "next/navigation";
import { adminGetUser } from "@/db/repos/admin/users";
import { getDeps } from "@/server/deps";
import { parseUserIdParam } from "@/server/inspector-access";
import { assertInspectorAccess } from "@/server/inspector-guard";
import styles from "../inspector.module.css";
import {
  EntitiesThreadsTab,
  FactsTab,
  JudgeLogTab,
  LifeTab,
  ReachOutsTab,
  RelationshipTab,
  RetrievalTab,
  TranscriptTab,
  TurnStateTab,
} from "./tabs";

const TABS = {
  transcript: "Transcript",
  facts: "Facts",
  graph: "Entities & Threads",
  relationship: "Relationship",
  life: "Life",
  retrieval: "Retrieval",
  turn: "Turn-taking",
  judge: "Judge log",
  reachouts: "Reach-outs",
} as const;
type Tab = keyof typeof TABS;

export default async function InspectUser({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await assertInspectorAccess();
  const userId = parseUserIdParam((await params).userId);
  if (!userId) notFound();
  const { db, clock, config } = getDeps();
  const target = await adminGetUser(db, userId);
  if (!target) notFound();
  const sp = await searchParams;
  const tab: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : "transcript";
  const base = `/inspector/${userId}`;

  return (
    <>
      <Link href="/inspector">← users</Link>
      <h1>
        {target.name} <small>{target.email}</small>
      </h1>
      <nav className={styles.nav}>
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link key={t} href={`${base}?tab=${t}`} className={t === tab ? styles.active : undefined}>
            {TABS[t]}
          </Link>
        ))}
        <Link href="/inspector/core">Core mind</Link>
      </nav>
      {tab === "transcript" && <TranscriptTab db={db} userId={userId} />}
      {tab === "facts" && <FactsTab db={db} userId={userId} sp={sp} />}
      {tab === "graph" && <EntitiesThreadsTab db={db} userId={userId} base={base} />}
      {tab === "relationship" && (
        <RelationshipTab db={db} userId={userId} now={clock.now()} cfg={config.relationship} />
      )}
      {tab === "life" && <LifeTab db={db} now={clock.now()} cfg={config.life} />}
      {tab === "retrieval" && <RetrievalTab db={db} userId={userId} />}
      {tab === "turn" && <TurnStateTab db={db} userId={userId} />}
      {tab === "judge" && <JudgeLogTab db={db} userId={userId} />}
      {tab === "reachouts" && (
        <ReachOutsTab db={db} userId={userId} limit={config.outreach.log_list_limit} />
      )}
    </>
  );
}
