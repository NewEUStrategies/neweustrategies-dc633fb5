// Kampania kuponowa - REGUŁY wyjęte z ciała `CampaignCreateDialog`
// (`src/routes/admin.coupons.campaigns.tsx`, dawne linie 362-390 i 277-324).
//
// CO JEST TU REGUŁĄ, A NIE UKŁADEM.
//
//   1. BRAMKA ZAPISU. Panel kampanii sprawdza DOKŁADNIE JEDNO: czy nazwa nie
//      jest pusta. Nie sprawdza procentu (1-100), kwoty (> 0), liczby kodów
//      (1-10000) ani długości kodu (4-24) - a baza sprawdza wszystkie cztery
//      (migracje 20260721070203 i 20260721082414). Ta asymetria jest DECYZJĄ
//      widoczną tylko wtedy, gdy stoi w jednym miejscu i ma test; rozsypana po
//      JSX-ie wygląda jak przeoczenie w recenzji i takim pozostaje.
//   2. ŁADUNEK. Dokładnie jedno pole rabatu jest niepuste (wybiera je bieżący
//      `kind`), waluta istnieje wyłącznie dla rabatu kwotowego, a liczba dni
//      subskrypcji jest BRAMKOWANA warstwą - inaczej niż w dialogu pojedynczego
//      kuponu, gdzie tej bramki nie ma. Kontrast między dwoma bliźniaczymi
//      formularzami tej samej powierzchni jest wart nazwania.
//   3. AKCJE WIERSZA. To, która akcja jest dostępna dla którego statusu, było
//      trzema warunkami w JSX-ie oddalonymi od siebie o 40 linii. Jako funkcja
//      statusu daje się przejechać tabelarycznie i nie da się jej po cichu
//      rozszczelnić (np. „Wyślij" dla kampanii już wysłanej).
//
// GRANICA WARSTW: zero Reacta, zero i18n, zero klienta Supabase. Wychodzą stąd
// KLUCZE i18n i ładunek, nigdy gotowy tekst.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI. `codeLength`/`codeCount` przychodzą
// jako `number` (stan dialogu robi `Number(e.target.value)` przy wpisywaniu),
// więc puste pole daje tu 0, a wartość nieliczbowa NaN - i jedno, i drugie
// wychodzi do bazy. To nie jest do naprawienia w ekstrakcji; to jest do
// zgłoszenia (`it.fails` w `couponCampaignForm.test.ts`).

/** Status kampanii - enum kolumny `b2b_coupon_campaigns.status`. */
export type CampaignStatus = "draft" | "generated" | "sent" | "archived";

/** Rodzaj rabatu - enum kolumny `discount_kind`. */
export type CampaignDiscountKind = "percent" | "fixed";

/** Stan formularza kampanii dokładnie w kształcie, w jakim trzyma go dialog. */
export interface CampaignFormState {
  readonly name: string;
  readonly description: string;
  readonly prefix: string;
  readonly codeLength: number;
  readonly codeCount: number;
  readonly kind: CampaignDiscountKind;
  readonly percent: number;
  readonly cents: number;
  readonly currency: string;
  readonly validUntil: Date | undefined;
  readonly tierKey: string;
  /** STRING z pola liczbowego - pusty znaczy „bez limitu dni". */
  readonly durationDays: string;
  readonly segment: string;
}

/** Wynik bramki zapisu: klucz i18n zamiast gotowego napisu. */
export type CampaignFormCheck = { ok: true } | { ok: false; errorKey: "adminCoupons.enterName" };

/**
 * JEDYNA walidacja panelu kampanii: niepusta nazwa. Reszta reguł (percent
 * 1-100, kwota > 0, liczba kodów 1-10000, długość kodu 4-24) żyje wyłącznie
 * w CHECK-ach bazy, więc odmowa przychodzi surowym komunikatem Postgresa.
 */
export function validateCampaignForm(form: CampaignFormState): CampaignFormCheck {
  if (!form.name.trim()) {
    return { ok: false, errorKey: "adminCoupons.enterName" };
  }
  return { ok: true };
}

/** Wiersz wstawiany do `b2b_coupon_campaigns`. */
export interface CampaignInsert {
  readonly name: string;
  readonly description: string | null;
  readonly prefix: string;
  readonly code_length: number;
  readonly code_count: number;
  readonly discount_kind: CampaignDiscountKind;
  readonly discount_percent: number | null;
  readonly discount_cents: number | null;
  readonly currency: string | null;
  readonly valid_until: string | null;
  readonly grants_tier_key: string | null;
  readonly grants_duration_days: number | null;
  readonly newsletter_segment: string | null;
}

/** Ładunek insertu - przeniesiony znak w znak z ciała `submit`. */
export function buildCampaignInsert(form: CampaignFormState): CampaignInsert {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    prefix: form.prefix.trim(),
    code_length: form.codeLength,
    code_count: form.codeCount,
    discount_kind: form.kind,
    discount_percent: form.kind === "percent" ? form.percent : null,
    discount_cents: form.kind === "fixed" ? form.cents : null,
    currency: form.kind === "fixed" ? form.currency.toUpperCase() : null,
    valid_until: form.validUntil ? form.validUntil.toISOString() : null,
    grants_tier_key: form.tierKey || null,
    grants_duration_days: form.durationDays && form.tierKey ? Number(form.durationDays) : null,
    newsletter_segment: form.segment.trim() || null,
  };
}

/** Akcja dostępna w wierszu listy kampanii. */
export type CampaignAction = "generate" | "export" | "send" | "archive";

/**
 * Które akcje pokazuje wiersz o danym statusie. Kolejność jest ta sama, co
 * w JSX-ie: najpierw akcja właściwa dla statusu, archiwizacja na końcu.
 */
export function campaignActions(status: CampaignStatus): CampaignAction[] {
  const actions: CampaignAction[] = [];
  if (status === "draft") actions.push("generate");
  if (status === "generated") actions.push("export", "send");
  if (status !== "archived") actions.push("archive");
  return actions;
}
