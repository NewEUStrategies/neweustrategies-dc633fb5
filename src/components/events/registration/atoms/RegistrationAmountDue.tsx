// Atom: zdanie „Do zapłaty: <kwota>" albo nic.
//
// SAMO FORMATOWANIE MIESZKA W `@/lib/events/amountDue`, bo tę samą kwotę
// pokazują trzy powierzchnie (potwierdzenie zapisu, „Moje zgłoszenia",
// samoobsługa zgłoszenia), a każda miała dotąd własne `Intl.NumberFormat`.
// Ten plik odpowiada wyłącznie za to, JAK zdanie wygląda na ekranie.
//
// BRAK KWOTY TO BRAK ZDANIA, a nie „0,00 zł". Zero złotych na ekranie o
// płatności znaczy „nic nie płacisz" - i to jest inna informacja niż „nie
// wiemy, ile".
import { useTranslation } from "react-i18next";

import { formatAmountDue } from "@/lib/events/amountDue";

export function RegistrationAmountDue({
  amountCents,
  currency,
  className,
}: {
  amountCents: number | null;
  currency: string | null;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const label = formatAmountDue(amountCents, currency, i18n.language);
  if (label === null) return null;
  return (
    <p className={className ?? "text-sm font-medium text-foreground"}>
      {t("eventRegistration.payment.amountDue", { amount: label })}
    </p>
  );
}
