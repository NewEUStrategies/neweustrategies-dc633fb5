// /admin/members - katalog członków: plan, podstawa planu, płatności oraz
// ręczne nadanie planu niezależne od operatora płatności.
//
// Nagłówek sekcyjny (AGENTS.md): layout `/admin` daje tylko ogólne „Admin",
// a panel tytułu nie ustawia.
import { createFileRoute } from "@tanstack/react-router";
import { MembersDirectoryPanel } from "@/components/admin/members/MembersDirectoryPanel";
import { adminPageHead } from "@/lib/adminPageHead";

export const Route = createFileRoute("/admin/members")({
  head: () =>
    adminPageHead(
      "Members",
      "Review member plans, plan sources and payments, and grant a plan manually. New European Strategies administration.",
    ),
  component: MembersDirectoryPanel,
});
