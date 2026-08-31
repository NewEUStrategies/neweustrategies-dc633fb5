// Molekula: naglowek kolumny targetingu w tabeli slotow.
import { useTranslation } from "react-i18next";

export function TargetingHeader() {
  const { t } = useTranslation();
  return <>{t("adsAdmin.columnTargeting")}</>;
}
