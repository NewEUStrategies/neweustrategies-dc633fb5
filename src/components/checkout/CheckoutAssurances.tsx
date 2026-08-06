// Obietnice składane kupującemu tuż nad przyciskiem płatności (atom listy
// wskazówek checkoutu).
//
// Reguła: pokazujemy WYŁĄCZNIE to, co faktycznie pojedzie do sesji Stripe.
// Źródłem jest ten sam `checkoutSessionParams`, który serwer rozwija w
// parametrach sesji, więc lista nie może rozjechać się z rzeczywistością:
//   * pole kodu promocyjnego znika, gdy zamówienie niesie już rabat kuponu B2B
//     (Stripe nie łączy `discounts` z `allow_promotion_codes`),
//   * wskazówka o automatycznym VAT pojawia się tylko na płaszczyźnie
//     sprzedawcy (własny Stripe Tax), bo tylko tam `automatic_tax` istnieje,
//   * wskazówka o fakturze uwzględnia, że subskrypcja fakturowana jest zawsze,
//     a operator w trybie MoR wystawia dokument samodzielnie.
import { useTranslation } from "react-i18next";
import { checkoutSessionParams, type CheckoutSettings } from "@/lib/billing/checkoutSettings";

export interface CheckoutAssurancesProps {
  settings: CheckoutSettings | undefined;
  /** Tryb sesji - subskrypcja ma fakturę zawsze, niezależnie od flagi. */
  mode: "payment" | "subscription";
  /** Zamówienie ma już rabat operatora (kupon B2B). */
  hasDiscount?: boolean;
  className?: string;
}

export function CheckoutAssurances({
  settings,
  mode,
  hasDiscount = false,
  className,
}: CheckoutAssurancesProps) {
  const { t } = useTranslation();
  if (!settings) return null;

  // Kupujący jest zawsze zalogowany na tej ścieżce (GuestCheckoutGate), więc
  // sesja ma przypiętego klienta - to samo założenie co po stronie serwera.
  const params = checkoutSessionParams(settings, { mode, hasCustomer: true, hasDiscount });

  const items: string[] = [];
  if (params.allow_promotion_codes) items.push(t("checkout.promoHint"));
  if (params.automatic_tax?.enabled) items.push(t("checkout.taxHint"));
  if (params.tax_id_collection?.enabled) items.push(t("checkout.taxIdHint"));
  // Fakturę dostaje kupujący w obu płaszczyznach - wystawia ją albo Stripe jako
  // operator rozliczeniowy (MoR), albo sesja z `invoice_creation`; subskrypcja
  // fakturowana jest zawsze. Obietnicę wiążemy więc z INTENCJĄ operatora, nie z
  // techniczną obecnością parametru w sesji.
  if (settings.invoice_creation || mode === "subscription") items.push(t("checkout.invoiceHint"));
  if (items.length === 0) return null;

  return (
    <ul className={className ?? "space-y-1 border-t pt-3 text-xs text-muted-foreground"}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
