// Reguła retencji dowodów księgowych - JEDNO miejsce decyzji po stronie TS.
//
// Baza liczy termin funkcją `public.accounting_retention_until(timestamptz)`
// (20261012121000) i stempluje nim `payment_orders.retention_until` oraz
// `user_purchases.retention_until`; nocny purge usuwa zanonimizowany dowód
// dopiero po tym terminie. Ten moduł jest jej lustrem dla aplikacji (nota
// retencyjna przy usuwaniu konta podaje okres z tej stałej), a test
// parzystości (`__tests__/accountingRetentionRule.test.ts`) czyta najnowszą
// definicję SQL i czerwieni się, gdy strony się rozjadą.
//
// DLACZEGO 6, A NIE 5 (INV-13). Art. 74 ust. 2 ustawy o rachunkowości to
// 5 lat od początku roku po roku obrotowym (31.12 R+5). Ale te same dowody
// są dokumentami rozliczenia podatku, a te trzyma się do przedawnienia
// zobowiązania (art. 86 § 1 Ordynacji podatkowej, art. 112 ustawy o VAT):
// 5 lat od końca roku, w którym upłynął TERMIN PŁATNOŚCI podatku (art. 70
// § 1 OP). VAT za grudzień R płaci się do 25.01 R+1, CIT roczny za R - do
// końca marca R+1, więc przedawnienie mija 31.12 R+6. Usunięcie dowodu rok
// wcześniej jest nieodwracalne; rok dłużej z mocy obowiązku prawnego RODO
// dopuszcza (art. 6 ust. 1 lit. c, art. 17 ust. 3 lit. b).
//
// STATUS: konserwatywne odczytanie, DO POTWIERDZENIA PRZEZ DORADCĘ
// PODATKOWEGO. Zmiana (inna liczba lat, rok obrotowy inny niż kalendarzowy)
// = ta stała + stała w ciele `accounting_retention_until` w nowej migracji
// + daty w `supabase/tests/accounting_retention_test.sql`. Przedłużenie dla
// pojedynczego dowodu (zawieszenie/przerwanie biegu przedawnienia, art. 70
// § 2-6 OP) nie zmienia reguły - to `retention_hold` ustawiany przez dział
// księgowy (service_role).
//
// Moduł jest czysty (bez klienta Supabase), więc wolno go importować także
// z komponentów.

/** Ile pełnych lat po końcu roku obrotowego dowód musi przetrwać. */
export const ACCOUNTING_RETENTION_YEARS_AFTER_FISCAL_YEAR = 6;

/**
 * Strefa siedziby, w której rozstrzyga się rok obrotowy - ta sama, którą
 * `accounting_retention_until` przekazuje do `AT TIME ZONE`.
 */
export const ACCOUNTING_TIME_ZONE = "Europe/Warsaw";

const yearInAccountingZone = new Intl.DateTimeFormat("en-US", {
  timeZone: ACCOUNTING_TIME_ZONE,
  year: "numeric",
});

/**
 * Ostatni dzień obowiązkowego przechowywania dowodu transakcji z chwili `at`,
 * jako data `RRRR-MM-DD` (kształt kolumny `date`). Lustro
 * `public.accounting_retention_until` - ta sama reguła, ta sama strefa.
 */
export function accountingRetentionUntil(at: Date | string | number): string {
  const moment = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(moment.getTime())) {
    throw new RangeError(`accountingRetentionUntil: invalid date ${String(at)}`);
  }
  const fiscalYear = Number(yearInAccountingZone.format(moment));
  return `${fiscalYear + ACCOUNTING_RETENTION_YEARS_AFTER_FISCAL_YEAR}-12-31`;
}
