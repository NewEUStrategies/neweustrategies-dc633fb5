// Trasa panelu darowizn - cienkie opakowanie organizmu.
// Zawartosc panelu mieszka w `@/components/admin/donations`.
import { createFileRoute } from "@tanstack/react-router";
import { AdminDonations } from "@/components/admin/donations/organisms/AdminDonations";

export const Route = createFileRoute("/admin/donations")({
  head: () => ({
    meta: [{ title: "Darowizny - Panel" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminDonations,
});
