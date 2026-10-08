/** User mind jobs: one batch of her thinking about a user, after a big event. */
import type { PgBoss } from "pg-boss";
import type { Deps } from "@/mind/platform/deps";
import { USER_MIND_RUN_QUEUE, type UserMindRunJob } from "@/mind/platform/jobs";
import { runUserMind } from "@/mind/process/user/run";
import { scrubErrors } from "./jobs";

export const USER_MIND_QUEUES = [USER_MIND_RUN_QUEUE];

export async function registerUserMindJobs(boss: PgBoss, deps: Deps): Promise<void> {
  await boss.work<UserMindRunJob>(
    USER_MIND_RUN_QUEUE,
    scrubErrors(USER_MIND_RUN_QUEUE, deps.log, async (jobs) => {
      for (const job of jobs) await runUserMind(deps, job.data);
    }),
  );
}
