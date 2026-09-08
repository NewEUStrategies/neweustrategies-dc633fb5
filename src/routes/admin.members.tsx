// /admin/members - katalog członków: plan, podstawa planu, płatności oraz
// ręczne nadanie planu niezależne od operatora płatności.
import { createFileRoute } from "@tanstack/react-router";
import { MembersDirectoryPanel } from "@/components/admin/members/MembersDirectoryPanel";

export const Route = createFileRoute("/admin/members")({
  component: MembersDirectoryPanel,
});
