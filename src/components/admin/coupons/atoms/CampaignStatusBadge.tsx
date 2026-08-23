// Atom: status kampanii kuponowej.
//
// CO BYŁO W TRASIE. `admin.coupons.campaigns.tsx` (dawne 272-276) renderował
// SUROWY enum bazy: `<Badge variant={c.status === "sent" ? "default" : "secondary"}>{c.status}</Badge>`.
// Operator widział więc angielskie „generated"/„archived" w polskim panelu,
// a rozróżnienie wariantu (wyróżniony tylko „sent") było zaszyte w wyrażeniu
// warunkowym w środku tabeli.
//
// PRZENIESIONE ZNAK W ZNAK: napis nadal przychodzi z zewnątrz i nadal domyślnie
// jest surowym enumem - atom NIE tłumaczy sam z siebie. Zmiana jest jedna
// i strukturalna: napis jest teraz PROPEM, więc miejsce, w którym powinien
// stanąć klucz i18n, jest widoczne i ma test.
import { Badge } from "@/components/ui/badge";
import type { CampaignStatus } from "@/lib/billing/couponCampaignForm";

export function CampaignStatusBadge({ status, label }: { status: CampaignStatus; label: string }) {
  return <Badge variant={status === "sent" ? "default" : "secondary"}>{label}</Badge>;
}
