// Atom: komórka zgody marketingowej (RODO) w tabeli slotów.
//
// Osobny atom, bo to JEDYNE miejsce, w którym panel mówi o zgodzie na liście:
// slot bez zgody ładuje skrypt strony trzeciej czytelnikowi, który jej nie
// wyraził. Kolumna, która o tym kłamie, jest kłamstwem o zgodności z RODO,
// więc ma własny dowód i własny plik.
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";

export function AdConsentLabel({ requiresConsent }: { requiresConsent: boolean }) {
  ensureAdsAdminI18n();
  const { t } = useTranslation();
  return (
    <>
      {requiresConsent
        ? t("adsAdmin.slots.consentRequired")
        : t("adsAdmin.slots.consentNotRequired")}
    </>
  );
}
