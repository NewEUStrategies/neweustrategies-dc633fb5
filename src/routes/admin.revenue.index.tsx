// /admin/revenue/ - kokpit huba: co dziś wymaga uwagi i czy przychód rośnie.
//
// Kokpit jest INDEKSEM, a nie zakładką `$tab`: wejście na hub bez wyboru
// zakładki ma od razu mówić, gdzie patrzeć. Adres `/admin/revenue/overview`
// odrzuca trasa `$tab` (404), żeby ten sam ekran nie miał dwóch adresów.
import { createFileRoute } from "@tanstack/react-router";

import { RevenueOverviewTab } from "@/components/admin/revenue/tabs/RevenueOverviewTab";
import { adminPageHead } from "@/lib/adminPageHead";

export const Route = createFileRoute("/admin/revenue/")({
  head: () =>
    adminPageHead("Przychód i lejek - kokpit", "Co dziś wymaga uwagi i czy przychód rośnie."),
  component: RevenueOverviewTab,
});
