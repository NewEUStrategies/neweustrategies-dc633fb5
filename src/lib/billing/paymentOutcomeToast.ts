// Jedna semantyka toastu dla odmowy operacji na subskrypcji (zmiana planu,
// miejsca, wznowienie) - dla karty operatora i karty lokalnej.
//
// Odmowa DOPŁATY (`payment_failed` / `payment_requires_action`) to nie
// awaria: zmiana NIE weszła, plan i uprawnienia zostały bez zmian, a klient
// ma konkretny krok - opłacić fakturę operatora (inną kartą albo z
// potwierdzeniem 3DS), po czym operator sam dokończy zmianę. Ogólne „nie udało
// się" przy pobranej próbie płatności wyglądało jak błąd systemu i odsyłało
// do kontaktu, zamiast do zapłaty.
import { toast } from "sonner";
import { paymentOutcomeMessageKey } from "@/lib/billing/planSwitch";
import { providerErrorCode, providerInvoiceUrl } from "@/lib/billing/providerResult";

/**
 * @param fallbackKey klucz komunikatu dla każdej innej odmowy/awarii
 * @returns true, gdy była to odmowa dopłaty (zmiana czeka na fakturę)
 */
export function toastSubscriptionFailure(
  t: (key: string) => string,
  error: unknown,
  fallbackKey: string,
): boolean {
  const key = paymentOutcomeMessageKey(providerErrorCode(error));
  if (!key) {
    toast.error(t(fallbackKey));
    return false;
  }
  const url = providerInvoiceUrl(error);
  if (!url) {
    toast.error(t(key));
    return true;
  }
  toast.error(t(key), {
    // Strona faktury operatora nie działa w iframe - zawsze nowa karta.
    action: {
      label: t("profile.subscription.payment.payInvoice"),
      onClick: () => window.open(url, "_blank", "noopener,noreferrer"),
    },
  });
  return true;
}
