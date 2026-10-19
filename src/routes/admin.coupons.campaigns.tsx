// Trasa kampanii kuponowych - cienkie opakowanie organizmu.
// Zawartosc panelu mieszka w `@/components/admin/coupons`.
//
// `?id=<uuid>` (SPEC §2.6) - deep link z huba i z edytora kampanii newslettera:
// wskazana kampania jest przewinieta do widoku i wyrozniona. Walidator bez
// importow (jedzie w chunku wejsciowym); nie-UUID = brak wskazania.
import { createFileRoute } from "@tanstack/react-router";
import { CampaignsPage } from "@/components/admin/coupons/organisms/CampaignsPage";
import { adminPageHead } from "@/lib/adminPageHead";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/admin/coupons/campaigns")({
  // Jawne `undefined` przy odrzuceniu: router scala surowe zapytanie z wynikiem
  // walidatora, więc pominięty klucz zostałby jako niezweryfikowany napis.
  validateSearch: (raw: Record<string, unknown>): { id?: string } => {
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    return { id: UUID_RE.test(id) ? id.toLowerCase() : undefined };
  },
  head: () =>
    adminPageHead(
      "Kampanie kuponowe",
      "Kampanie kuponowe: generowanie kodów, eksport, przygotowanie wysyłki newsletterem z kodem dla każdego odbiorcy i archiwizacja.",
    ),
  component: CouponCampaignsRoute,
});

function CouponCampaignsRoute() {
  const { id } = Route.useSearch();
  return <CampaignsPage highlightId={id} />;
}
