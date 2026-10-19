// Organizm: podgląd płaszczyzny rozliczeniowej sesji Stripe dla bieżących
// (także niezapisanych) ustawień kasy. Reużywa go hub S7 obok
// `CheckoutSettingsCard`.
//
// DLACZEGO CZYSTA FUNKCJA SERWERA. Lista parametrów liczy się tym samym
// `checkoutSessionParams`, którym `createCheckoutOrder` składa sesję - panel nie
// może obiecać flagi, której API nie dostanie (np. `automatic_tax` w trybie
// operatora rozliczeniowego MoR).
import { useTranslation } from "react-i18next";

import {
  checkoutBillingPlane,
  checkoutSessionParams,
  type CheckoutSettings,
} from "@/lib/billing/checkoutSettings";
import { ensureI18n } from "@/lib/i18n-admin-paywall-sync";

export function CheckoutPlanePreview({ settings }: { settings: CheckoutSettings }) {
  ensureI18n();
  const { t } = useTranslation();
  const plane = checkoutBillingPlane(settings);
  // Podgląd dla zakupu jednorazowego z przypiętym klientem - jedyny tryb, w
  // którym widać komplet flag (subskrypcja nie przyjmuje `invoice_creation`).
  const params = checkoutSessionParams(settings, {
    mode: "payment",
    hasCustomer: true,
    hasDiscount: false,
  });
  const keys = Object.keys(params).sort().join(", ");
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="text-xs font-medium">{t("adminPaywall.checkout.plane.title")}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {plane === "managed"
          ? t("adminPaywall.checkout.plane.managed")
          : t("adminPaywall.checkout.plane.merchant")}
      </p>
      <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
        {t("adminPaywall.checkout.plane.params", { params: keys })}
      </p>
    </div>
  );
}
