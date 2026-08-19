// Atom: data na karcie rozliczeniowej.
//
// Do 19.08.2026 osiem miejsc w `components/billing` liczyło datę własnym
// `new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL")` - bez
// zabezpieczenia przed wartością niepoprawną, więc uszkodzony znacznik czasu
// pokazywał klientowi napis „Invalid Date" w miejscu daty faktury. Wspólny
// `formatDate` z `lib/i18n/format` ma to zabezpieczenie od początku.
//
// Kontrakt dostępności i maszynowej czytelności: `<time dateTime={iso}>`. Data
// płatności bez znacznika `<time>` jest dla maszyny zwykłym tekstem, a klient
// i wsparcie muszą móc jednoznacznie ustalić DZIEŃ, w którym pobrano pieniądze.
import { useTranslation } from "react-i18next";

import { formatDate } from "@/lib/i18n/format";

/** Domyślny format: „12 lipca 2026" / „12 July 2026". */
const LONG: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };
/** Skrócony wariant kart z tabelami: „12 lip 2026" / „12 Jul 2026". */
const SHORT: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

export function BillingDate({
  iso,
  variant = "long",
  /** Co pokazać, gdy daty NIE MA (np. subskrypcja bez końca okresu). */
  fallback = "-",
  className,
}: {
  iso: string | null | undefined;
  variant?: "long" | "short";
  fallback?: string;
  className?: string;
}) {
  const { i18n } = useTranslation();
  if (!iso) return <span className={className}>{fallback}</span>;
  const text = formatDate(iso, i18n.language, variant === "short" ? SHORT : LONG);
  // `formatDate` zwraca pusty napis dla wartości niepoprawnej - wtedy pokazujemy
  // to samo, co przy braku daty, zamiast „Invalid Date".
  if (!text) return <span className={className}>{fallback}</span>;
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
