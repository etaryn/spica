import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";

export default async function Home() {
  redirect((await getSessionUser()) ? "/chat" : "/login");
}
