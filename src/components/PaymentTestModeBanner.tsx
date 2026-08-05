// Baner informujący o trybie testowym Stripe - pokazywany nad osadzonym
// checkoutem, gdy klucz publikowalny wskazuje środowisko `sandbox`.
import { useTranslation } from "react-i18next";
import { FlaskConical } from "lucide-react";
import { getStripeEnvironment, isPaymentsConfigured } from "@/lib/stripe";
import "@/lib/i18n-payments-banner";

export function PaymentTestModeBanner() {
  const { t } = useTranslation();
  if (!isPaymentsConfigured()) return null;
  let environment: "sandbox" | "live";
  try {
    environment = getStripeEnvironment();
  } catch {
    return null;
  }
  if (environment !== "sandbox") return null;

  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-[6px] border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300"
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-medium">{t("paymentsBanner.testMode")}</p>
        <p className="text-xs opacity-90">{t("paymentsBanner.testModeDesc")}</p>
      </div>
    </div>
  );
}
