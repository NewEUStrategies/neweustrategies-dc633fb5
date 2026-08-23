// Atom: komórka statusu slotu w tabeli slotów.
//
// Gałąź DOMYŚLNA jest "wstrzymany", nie "aktywny": tylko dosłowne `"active"`
// czyta się jako slot emitowany. Wiersz z kolumną statusu z innej migracji
// (albo z literówką) pokazuje więc "wstrzymany" - bezpieczniejsze kłamstwo
// niż odwrotne, bo nie sugeruje emisji, której nie ma.
import { useTranslation } from "react-i18next";
import type { AdSlot } from "@/lib/ads/types";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";

export function AdSlotStatusLabel({ status }: { status: AdSlot["status"] }) {
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  return (
    <>{status === "active" ? t("adsAdmin.slots.statusActive") : t("adsAdmin.slots.statusPaused")}</>
  );
}
