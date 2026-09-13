import type { Metadata } from "next";
import KnowledgeUsageSearch from "./KnowledgeUsageSearch";

export const metadata: Metadata = { title: "활용 메모 찾기 — Focus Feed", robots: { index: false } };
export default function Page() { return <KnowledgeUsageSearch />; }
