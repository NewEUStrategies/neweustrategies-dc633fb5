// Trasa listy kuponow B2B - cienkie opakowanie organizmu.
// Zawartosc panelu mieszka w `@/components/admin/coupons`.
//
// `?code=` waliduje uklad `/admin/coupons` (rodzic) - tu tylko czytamy go
// i przekazujemy do listy jako filtr (deep link z huba, SPEC §2.6).
import { createFileRoute } from "@tanstack/react-router";
import { CouponsListPage } from "@/components/admin/coupons/organisms/CouponsListPage";
import { adminPageHead } from "@/lib/adminPageHead";

export const Route = createFileRoute("/admin/coupons/")({
  head: () =>
    adminPageHead(
      "Kupony B2B - lista kodów",
      "Lista kodów rabatowych B2B: rabat, limit i liczba użyć, ważność, nadawana subskrypcja i aktywność.",
    ),
  component: CouponsListRoute,
});

function CouponsListRoute() {
  const { code } = Route.useSearch();
  return <CouponsListPage code={code} />;
}
