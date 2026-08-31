// Trasa listy kuponow B2B - cienkie opakowanie organizmu.
// Zawartosc panelu mieszka w `@/components/admin/coupons`.
import { createFileRoute } from "@tanstack/react-router";
import { CouponsListPage } from "@/components/admin/coupons/organisms/CouponsListPage";

export const Route = createFileRoute("/admin/coupons/")({
  component: CouponsListPage,
});
