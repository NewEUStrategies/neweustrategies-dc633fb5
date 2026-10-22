// Atom treści: powód rezygnacji z `retention_feedback.reason_label` słowami
// panelu (I9, Z-S7-08 - Z-S2-04/Z-S2-11 poza hubem).
//
// Ta sama reguła co karta powodów w hubie (`retentionReasonLabel`):
// `not_given` to „Bez podanego powodu", nie surowy klucz; `stripe:<kod>` to
// „Portal Stripe: <kod>", żeby było widać, że ankieta nie pochodzi z dialogu
// serwisu. Treść powodu z dialogu zostaje bez zmian (zamrożona przy zapisie).
import { useTranslation } from "react-i18next";

import { retentionReasonLabel } from "@/lib/retention/reasonLabel";

export function RetentionReasonText({ label }: { label: string }) {
  const { t } = useTranslation();
  const reason = retentionReasonLabel(label);
  if (reason.kind === "not_given") return <>{t("adminPricing.retention.reasonNotGiven")}</>;
  if (reason.kind === "stripe") {
    return <>{t("adminPricing.retention.stripePortalReason", { code: reason.code })}</>;
  }
  return <>{reason.text}</>;
}
