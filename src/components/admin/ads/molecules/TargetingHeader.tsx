// Molekula: naglowek kolumny targetingu w tabeli slotow.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-ads-admin";

export function TargetingHeader() {
  const { t } = useTranslation();
  return <>{t("adsAdmin.columnTargeting")}</>;
}
