// Wersja robocza BILETU wydarzenia: wiersz bazy <-> pola formularza <-> payload.
//
// DLACZEGO OSOBNY MODUŁ, A NIE STAN W DIALOGU. Formularz biletu ma czternaście
// pól, z których cztery są liczbami, a dwie datami. Wpisane w input-y są
// tekstem - także wtedy, gdy pole jest puste albo zawiera minus. Konwersja
// wykonana w handlerze `onChange` daje `NaN` w payloadzie i odmowę CHECK-a bez
// wskazania pola; tutaj każde pole ma jedną funkcję wejścia i jedną wyjścia,
// a przypadki brzegowe mają tabelę w testach.
//
// PUSTA PULA TO BRAK LIMITU, NIE ZERO. `quota = 0` znaczy „bilet bez ani jednego
// miejsca", czyli natychmiast wyprzedany; `quota = null` znaczy „bez limitu".
// Sklejenie obu zamknęłoby sprzedaż biletu, który miał jej nie mieć.
//
// WALIDACJA ODCINA ZAPIS PRZED ŻĄDANIEM. Odmowa CHECK-a wraca jako `23514` bez
// nazwy pola, więc każdy warunek, który baza sprawdza, ma tu odpowiednik z
// kluczem komunikatu przy polu.
//
// TERMINY SĄ ZEGAREM W STREFIE WYDARZENIA, nie przeglądarki (klasa OPS-15).
// „Sprzedaż do 18:00" wpisane w Londynie dla kongresu w Warszawie zamykało
// sprzedaż o 19:00 czasu kongresu. Szkic niesie strefę (`timeZone`) i chwile
// z bazy (`savedTimes`, `savedFrom`/`savedTo` faz): nietknięte pole wraca co do
// milisekundy, więc „przełącz aktywność" i duplikacja nie przycinają
// `sales_to` 23:59:59 do pełnej minuty. Konwersje: `lib/events/eventLocalInput.ts`.
//
// CENY W POLACH SĄ W JEDNOSTCE GŁÓWNEJ WALUTY (TIX-14a). Formularz prowadził
// je w groszach, więc redaktor, który wpisał „899", myśląc o złotych,
// wystawiał bilet za 8,99 zł. Pole mówi teraz „899,00", a grosze liczy
// wyłącznie `parseMoneyInput` / `centsToMoneyInput` - zapis niejednoznaczny
// („8,999", „1,299") jest błędem przy polu, nie zgadywaną kwotą. Reguły kwot
// (sufit, early bird nie droższy od ceny bazowej) porównują GROSZE.
import {
  centsToMoneyInput,
  parseMoneyInput,
  type MoneyDecimalSeparator,
} from "@/lib/billing/moneyInput";
import {
  canonicalInstant,
  eventLocalInput,
  eventLocalInputToIso,
  type SavedInstants,
} from "@/lib/events/eventLocalInput";
import { eventTimeZone } from "@/lib/events/timezone";
import type {
  EventTicketInput,
  EventTicketRow,
  TicketPricePhaseInput,
} from "@/lib/events/registrationsApi";

/** Waluty dopuszczone CHECK-iem `event_ticket_types_currency_values`. */
export const TICKET_CURRENCIES = ["PLN", "EUR"] as const;
export type TicketCurrency = (typeof TICKET_CURRENCIES)[number];

export const TICKET_KEY_PATTERN = /^[a-z][a-z0-9_]{1,48}$/;
export const TICKET_MAX_NAME = 200;
export const TICKET_MAX_DESCRIPTION = 1000;
/** Górna granica ceny: 10 000 000 groszy = 100 000,00. Wyżej to literówka. */
export const TICKET_MAX_PRICE_CENTS = 10_000_000;
export const TICKET_MAX_QUOTA = 100_000;

export interface TicketDraft {
  /** `null` = nowy bilet. Klucz jest wtedy edytowalny, później zamrożony. */
  id: string | null;
  key: string;
  namePl: string;
  nameEn: string;
  descriptionPl: string;
  descriptionEn: string;
  /**
   * Cena w jednostce głównej waluty jako tekst („899,00"), NIE w groszach -
   * grosze liczy `parseMoneyInput` dopiero przy walidacji i w payloadzie.
   */
  price: string;
  currency: TicketCurrency;
  /** Pusty tekst = bez limitu miejsc na tym bilecie. */
  quota: string;
  /** `datetime-local` w strefie `timeZone` albo pusty tekst. */
  salesFrom: string;
  salesTo: string;
  minTierRank: string;
  requiresApproval: boolean;
  groupId: string | null;
  isActive: boolean;
  sortOrder: string;
  /**
   * Cena promocyjna (jednostka główna waluty) obowiązująca do `earlyBirdUntil`;
   * pusty tekst = brak ceny promocyjnej.
   */
  earlyBirdPrice: string;
  /** `datetime-local` - termin końca ceny promocyjnej. */
  earlyBirdUntil: string;
  /**
   * NOWY kod dostępu w postaci jawnej. Pusty tekst NIE kasuje kodu - baza trzyma
   * wyłącznie skrót, więc formularz nigdy nie zna obecnego kodu i nie może go
   * odesłać z powrotem. Zdjęcie bramki ma własny przełącznik.
   */
  accessCode: string;
  /** Czy bilet ma już zapisany kod (z wiersza) - sterowanie treścią pomocy. */
  hasAccessCode: boolean;
  /** Zaznaczone = zdejmij kod przy zapisie. */
  removeAccessCode: boolean;
  accessCodeHint: string;
  waitlistEnabled: boolean;
  /** Korzysci - jedna w linii. Tekst, bo textarea nie zna tablic. */
  benefitsPl: string;
  benefitsEn: string;
  /** Progi cenowe w czasie; pusta lista = tylko cena bazowa i early bird. */
  phases: TicketPhaseDraft[];
  /** Strefa wydarzenia (IANA, zwalidowana), w której pola dat są zegarem. */
  timeZone: string;
  /** Chwile z bazy, z których powstały pola dat (edycja); pusto dla nowego biletu. */
  savedTimes: SavedInstants<"salesFrom" | "salesTo" | "earlyBirdUntil">;
}

/** Jeden wiersz cennika fazowego w formularzu (wartosci jako tekst). */
export interface TicketPhaseDraft {
  labelPl: string;
  labelEn: string;
  /** `datetime-local` w strefie biletu albo pusty tekst = od zawsze / bezterminowo. */
  from: string;
  to: string;
  /** Cena progu w jednostce głównej waluty („899,00"), jak cena bazowa. */
  price: string;
  /** Chwile z bazy, z których powstały `from`/`to`; brak = faza nowa. */
  savedFrom?: string | null;
  savedTo?: string | null;
}

export const TICKET_MAX_PHASES = 12;
export const TICKET_MAX_BENEFITS = 20;
export const TICKET_MAX_BENEFIT_LENGTH = 200;

export function emptyTicketPhase(): TicketPhaseDraft {
  return { labelPl: "", labelEn: "", from: "", to: "", price: "" };
}

/**
 * Tekst pola ceny -> grosze dla payloadu. Zapis błędny daje `NaN`, a nie zero:
 * zero to bilet bezpłatny, więc cicha zamiana „abc" na 0 zł rozdawałaby
 * bilety. `ticketDraftIssue` odcina taki zapis wcześniej.
 */
function moneyCents(value: string): number {
  return parseMoneyInput(value) ?? Number.NaN;
}

/** Textarea -> lista korzysci: puste linie odpadaja, kolejnosc zostaje. */
export function benefitsFromText(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export const TICKET_ACCESS_CODE_MIN = 4;
export const TICKET_ACCESS_CODE_MAX = 64;
export const TICKET_MAX_ACCESS_CODE_HINT = 120;

export function emptyTicketDraft(
  sortOrder: number,
  timeZone: string | null | undefined,
): TicketDraft {
  return {
    id: null,
    key: "",
    namePl: "",
    nameEn: "",
    descriptionPl: "",
    descriptionEn: "",
    // „0" czyta się tak samo z przecinkiem i z kropką - nowy bilet jest
    // bezpłatny, dopóki redaktor nie wpisze kwoty.
    price: "0",
    currency: "PLN",
    quota: "",
    salesFrom: "",
    salesTo: "",
    minTierRank: "0",
    requiresApproval: false,
    groupId: null,
    isActive: true,
    sortOrder: String(sortOrder),
    earlyBirdPrice: "",
    earlyBirdUntil: "",
    accessCode: "",
    hasAccessCode: false,
    removeAccessCode: false,
    accessCodeHint: "",
    waitlistEnabled: true,
    benefitsPl: "",
    benefitsEn: "",
    phases: [],
    timeZone: eventTimeZone({ timezone: timeZone }),
    savedTimes: {},
  };
}

/** ISO z bazy -> wartość `datetime-local` w strefie wydarzenia (bez sekund). */
export function toLocalInput(iso: string | null, timeZone: string | null | undefined): string {
  return eventLocalInput(iso, timeZone);
}

/**
 * Wartość `datetime-local` w strefie wydarzenia -> ISO albo `null`, gdy pole
 * puste/niepełne. `saved` - chwila z bazy, którą nietknięte pole oddaje bez zmian.
 */
export function fromLocalInput(
  value: string,
  timeZone: string | null | undefined,
  saved: string | null = null,
): string | null {
  return eventLocalInputToIso(value, timeZone, saved);
}

/** Pole daty szkicu -> chwila (z pamięcią chwili z bazy). */
function draftInstant(
  draft: TicketDraft,
  field: "salesFrom" | "salesTo" | "earlyBirdUntil",
): string | null {
  return fromLocalInput(draft[field], draft.timeZone, draft.savedTimes[field] ?? null);
}

/**
 * Wiersz bazy -> formularz. Daty jako zegar strefy wydarzenia `timeZone`;
 * kwoty z groszy na jednostkę główną („1999" -> „19,99"). `decimalSeparator`
 * dobiera wołający do języka interfejsu, a parser przyjmuje oba, więc wybór
 * nie zmienia kwoty.
 */
export function ticketDraftFromRow(
  row: EventTicketRow,
  timeZone: string | null | undefined,
  decimalSeparator: MoneyDecimalSeparator = ",",
): TicketDraft {
  const zone = eventTimeZone({ timezone: timeZone });
  const salesFrom = canonicalInstant(row.sales_from);
  const salesTo = canonicalInstant(row.sales_to);
  const earlyBirdUntil = canonicalInstant(row.early_bird_until);
  return {
    id: row.id,
    key: row.key,
    namePl: row.name_pl,
    nameEn: row.name_en,
    descriptionPl: row.description_pl ?? "",
    descriptionEn: row.description_en ?? "",
    price: centsToMoneyInput(row.price_cents ?? 0, decimalSeparator),
    currency: (TICKET_CURRENCIES as readonly string[]).includes(row.currency)
      ? (row.currency as TicketCurrency)
      : "PLN",
    // `quota` jest w wygenerowanym typie liczbą, ale kolumna jest NULL-owalna -
    // brak limitu przychodzi jako `null` i musi zostać pustym polem.
    quota: row.quota === null || row.quota === undefined ? "" : String(row.quota),
    salesFrom: toLocalInput(salesFrom, zone),
    salesTo: toLocalInput(salesTo, zone),
    minTierRank: String(row.min_tier_rank ?? 0),
    requiresApproval: row.requires_approval,
    groupId: row.group_id ?? null,
    isActive: row.is_active,
    sortOrder: String(row.sort_order ?? 0),
    // Brak ceny promocyjnej zostaje pustym polem (`centsToMoneyInput(null)`),
    // nie „0,00" - zero znaczyłoby promocję za darmo.
    earlyBirdPrice: centsToMoneyInput(row.early_bird_price_cents ?? null, decimalSeparator),
    earlyBirdUntil: toLocalInput(earlyBirdUntil, zone),
    accessCode: "",
    hasAccessCode: row.has_access_code === true,
    removeAccessCode: false,
    accessCodeHint: row.access_code_hint ?? "",
    waitlistEnabled: row.waitlist_enabled !== false,
    benefitsPl: (row.benefits_pl ?? []).join("\n"),
    benefitsEn: (row.benefits_en ?? []).join("\n"),
    phases: phasesFromJson(row.price_schedule, zone, decimalSeparator),
    timeZone: zone,
    savedTimes: { salesFrom, salesTo, earlyBirdUntil },
  };
}

function intOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^-?\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

export type TicketDraftField =
  | "key"
  | "namePl"
  | "nameEn"
  | "descriptionPl"
  | "descriptionEn"
  | "price"
  | "quota"
  | "salesTo"
  | "minTierRank"
  | "earlyBirdPrice"
  | "earlyBirdUntil"
  | "accessCode"
  | "accessCodeHint"
  | "benefitsPl"
  | "benefitsEn"
  | "sortOrder"
  | "phases";

export interface TicketDraftIssue {
  field: TicketDraftField;
  /** Klucz w `adminEventRegistration.errors.*` - ten, którym odmówiłaby baza. */
  errorKey: string;
  /**
   * Pełny klucz zdania przy polu, gdy mówi ono więcej niż odmowa bazy - dziś
   * zapis kwoty, której nie da się jednoznacznie przeczytać („8,999"). Brak =
   * `adminEventRegistration.errors.<errorKey>` (patrz `ticketDraftIssueMessage`).
   */
  messageKey?: string;
  /** Parametry zdania `messageKey` (np. numer progu cennika). */
  params?: Record<string, number | string>;
}

/** Klucz i parametry zdania, które formularz pokazuje przy polu `issue.field`. */
export function ticketDraftIssueMessage(issue: TicketDraftIssue): {
  key: string;
  params?: Record<string, number | string>;
} {
  return issue.messageKey === undefined
    ? { key: `adminEventRegistration.errors.${issue.errorKey}` }
    : { key: issue.messageKey, params: issue.params };
}

/**
 * Zdanie o zapisie kwoty w walucie biletu („Podaj cenę w złotych, np.
 * 899,00"). Klucz per waluta, bo „w złotych" / „w euro" odmienia się inaczej
 * niż kod waluty wstawiony w zdanie.
 */
function moneyFormatKey(currency: TicketCurrency): string {
  return `adminEventRegistration.tickets.editor.moneyFormat.${currency}`;
}

function phaseMoneyFormatKey(currency: TicketCurrency): string {
  return `adminEventRegistration.tickets.editor.phaseMoneyFormat.${currency}`;
}

/**
 * Pierwszy powód, dla którego bilet nie może zostać zapisany, albo `null`.
 *
 * Zwracamy JEDEN powód, bo formularz i tak podświetla jedno pole naraz, a lista
 * wszystkich braków przy pustym formularzu jest ścianą tekstu.
 */
export function ticketDraftIssue(draft: TicketDraft): TicketDraftIssue | null {
  if (draft.id === null && !TICKET_KEY_PATTERN.test(draft.key.trim())) {
    return { field: "key", errorKey: "invalidKey" };
  }
  if (draft.namePl.trim() === "" || draft.nameEn.trim() === "") {
    return { field: draft.namePl.trim() === "" ? "namePl" : "nameEn", errorKey: "invalidNames" };
  }
  if (draft.namePl.trim().length > TICKET_MAX_NAME) {
    return { field: "namePl", errorKey: "invalidNames" };
  }
  if (draft.nameEn.trim().length > TICKET_MAX_NAME) {
    return { field: "nameEn", errorKey: "invalidNames" };
  }
  if (draft.descriptionPl.length > TICKET_MAX_DESCRIPTION) {
    return { field: "descriptionPl", errorKey: "invalidRequest" };
  }
  if (draft.descriptionEn.length > TICKET_MAX_DESCRIPTION) {
    return { field: "descriptionEn", errorKey: "invalidRequest" };
  }

  // Cena jest obowiązkowa: puste pole, minus, litery i zapis niejednoznaczny
  // („8,999") dostają zdanie o formacie kwoty w walucie biletu. Sufit liczymy
  // w groszach, po przeczytaniu kwoty.
  const price = parseMoneyInput(draft.price);
  if (price === null) {
    return {
      field: "price",
      errorKey: "invalidRequest",
      messageKey: moneyFormatKey(draft.currency),
    };
  }
  if (price > TICKET_MAX_PRICE_CENTS) {
    return { field: "price", errorKey: "invalidRequest" };
  }

  const quota = intOrNull(draft.quota);
  if (quota !== null && (Number.isNaN(quota) || quota < 0 || quota > TICKET_MAX_QUOTA)) {
    return { field: "quota", errorKey: "invalidRequest" };
  }

  const tier = intOrNull(draft.minTierRank);
  if (tier === null || Number.isNaN(tier) || tier < 0 || tier > 100) {
    return { field: "minTierRank", errorKey: "invalidRequest" };
  }

  // KOLEJNOSC TEZ JEST LICZBA - i az do teraz nie byla sprawdzana WCALE, choc
  // blizniaczy `packageDraftIssue` ja sprawdza. `ticketDraftToInput` robi na tym
  // polu `Number()`, wiec wpisane slowo wychodzilo z formularza jako `NaN`,
  // w JSON-ie zamienialo sie w `null` i wracalo odmowa NOT NULL bez nazwy
  // kolumny: uzytkownik widzial „cos poszlo nie tak" i ani jednego
  // podswietlonego pola. Puste pole zostaje dozwolone, bo `ticketDraftToInput`
  // czyta je jako zero - to jest udokumentowane zachowanie, nie przeoczenie.
  const sort = intOrNull(draft.sortOrder);
  if (sort !== null && (Number.isNaN(sort) || sort < 0 || sort > 10_000)) {
    return { field: "sortOrder", errorKey: "invalidRequest" };
  }

  // Okno sprzedaży zamknięte przed otwarciem to bilet, którego nie da się kupić
  // ani dziś, ani nigdy - baza odrzuca to CHECK-iem, więc odcinamy wcześniej.
  const from = draftInstant(draft, "salesFrom");
  const to = draftInstant(draft, "salesTo");
  if (from !== null && to !== null && new Date(to).getTime() <= new Date(from).getTime()) {
    return { field: "salesTo", errorKey: "invalidRequest" };
  }

  // Para early-bird jest niepodzielna: cena bez terminu obowiązywałaby wiecznie,
  // a termin bez ceny nie zmieniałby niczego. CHECK w bazie odrzuca oba przypadki
  // bez nazwy pola, więc rozstrzygamy je tutaj, przy właściwym polu.
  //
  // SKŁADNIA KWOTY ROZSTRZYGA SIĘ PIERWSZA. „8,999" nie jest kwotą, więc jest
  // błędem CENY, a nie brakującego terminu. Odwrotna kolejność podświetlała pole
  // TERMINU: redaktor uzupełniał datę, zapisywał ponownie i dopiero w drugim
  // obiegu formularza dowiadywał się, co naprawdę jest źle. Puste pole to brak
  // ceny promocyjnej, nie błąd zapisu.
  const earlyText = draft.earlyBirdPrice.trim();
  const early = earlyText === "" ? null : parseMoneyInput(earlyText);
  const hasEarlyDate = draft.earlyBirdUntil.trim() !== "";
  if (earlyText !== "" && early === null) {
    return {
      field: "earlyBirdPrice",
      errorKey: "invalidEarlyBird",
      messageKey: moneyFormatKey(draft.currency),
    };
  }
  if (early !== null && !hasEarlyDate) {
    return { field: "earlyBirdUntil", errorKey: "invalidEarlyBird" };
  }
  if (early === null && hasEarlyDate) {
    return { field: "earlyBirdPrice", errorKey: "invalidEarlyBird" };
  }
  // Porównanie w GROSZACH: cena bazowa jest już przeczytana i mieści się
  // pod sufitem, więc promocja nie droższa od niej też się mieści.
  if (early !== null && early > price) {
    return { field: "earlyBirdPrice", errorKey: "invalidEarlyBird" };
  }

  const code = draft.accessCode.trim();
  if (
    code !== "" &&
    (code.length < TICKET_ACCESS_CODE_MIN || code.length > TICKET_ACCESS_CODE_MAX)
  ) {
    return { field: "accessCode", errorKey: "invalidAccessCode" };
  }
  if (draft.accessCodeHint.trim().length > TICKET_MAX_ACCESS_CODE_HINT) {
    return { field: "accessCodeHint", errorKey: "invalidRequest" };
  }

  for (const [field, value] of [
    ["benefitsPl", draft.benefitsPl],
    ["benefitsEn", draft.benefitsEn],
  ] as const) {
    const list = benefitsFromText(value);
    if (list.length > TICKET_MAX_BENEFITS) return { field, errorKey: "invalidBenefits" };
    if (list.some((entry) => entry.length > TICKET_MAX_BENEFIT_LENGTH)) {
      return { field, errorKey: "invalidBenefits" };
    }
  }

  // Cennik fazowy: kazda faza musi miec cene i okno, ktore konczy sie po tym,
  // jak sie zaczelo. Baza odrzuca to jednym komunikatem bez numeru wiersza,
  // wiec rozstrzygamy wczesniej - inaczej redaktor szuka bledu po omacku.
  if (draft.phases.length > TICKET_MAX_PHASES) {
    return { field: "phases", errorKey: "invalidPriceSchedule" };
  }
  for (const [index, phase] of draft.phases.entries()) {
    // Próg bez czytelnej kwoty dostaje zdanie z NUMEREM progu - komunikat stoi
    // pod całą listą, więc bez numeru redaktor szukałby wiersza po omacku.
    const phasePrice = parseMoneyInput(phase.price);
    if (phasePrice === null) {
      return {
        field: "phases",
        errorKey: "invalidPriceSchedule",
        messageKey: phaseMoneyFormatKey(draft.currency),
        params: { index: index + 1 },
      };
    }
    if (phasePrice > TICKET_MAX_PRICE_CENTS) {
      return { field: "phases", errorKey: "invalidPriceSchedule" };
    }
    const phaseFrom = fromLocalInput(phase.from, draft.timeZone, phase.savedFrom ?? null);
    const phaseTo = fromLocalInput(phase.to, draft.timeZone, phase.savedTo ?? null);
    if (
      phaseFrom !== null &&
      phaseTo !== null &&
      new Date(phaseTo).getTime() <= new Date(phaseFrom).getTime()
    ) {
      return { field: "phases", errorKey: "invalidPriceSchedule" };
    }
  }

  return null;
}

/** Szkic -> payload RPC. Wywoływać tylko, gdy `ticketDraftIssue` zwróci `null`. */
export function ticketDraftToInput(draft: TicketDraft, eventId: string): EventTicketInput {
  const quota = intOrNull(draft.quota);
  return {
    id: draft.id,
    eventId,
    key: draft.key.trim(),
    namePl: draft.namePl.trim(),
    nameEn: draft.nameEn.trim(),
    descriptionPl: draft.descriptionPl.trim(),
    descriptionEn: draft.descriptionEn.trim(),
    priceCents: moneyCents(draft.price),
    currency: draft.currency,
    quota: quota === null || Number.isNaN(quota) ? null : quota,
    salesFrom: draftInstant(draft, "salesFrom"),
    salesTo: draftInstant(draft, "salesTo"),
    minTierRank: Number(draft.minTierRank.trim()),
    requiresApproval: draft.requiresApproval,
    groupId: draft.groupId,
    isActive: draft.isActive,
    sortOrder: Number(draft.sortOrder.trim() === "" ? "0" : draft.sortOrder.trim()),
    earlyBirdPriceCents:
      draft.earlyBirdPrice.trim() === "" ? null : moneyCents(draft.earlyBirdPrice),
    earlyBirdUntil: draftInstant(draft, "earlyBirdUntil"),
    // Trzy stany kodu: `undefined` = zostaw, `null` = zdejmij, napis = ustaw.
    accessCode: draft.removeAccessCode
      ? null
      : draft.accessCode.trim() === ""
        ? undefined
        : draft.accessCode.trim(),
    accessCodeHint: draft.accessCodeHint.trim(),
    waitlistEnabled: draft.waitlistEnabled,
    benefitsPl: benefitsFromText(draft.benefitsPl),
    benefitsEn: benefitsFromText(draft.benefitsEn),
    priceSchedule: draft.phases.map((phase): TicketPricePhaseInput => ({
      labelPl: phase.labelPl.trim(),
      labelEn: phase.labelEn.trim(),
      from: fromLocalInput(phase.from, draft.timeZone, phase.savedFrom ?? null),
      to: fromLocalInput(phase.to, draft.timeZone, phase.savedTo ?? null),
      priceCents: moneyCents(phase.price),
    })),
  };
}

/**
 * `price_schedule` (jsonb) -> wiersze formularza w strefie `timeZone`, kwoty
 * z groszy na jednostkę główną („9900" -> „99,00"). Bełkot odpada po cichu.
 */
export function phasesFromJson(
  value: unknown,
  timeZone: string | null | undefined,
  decimalSeparator: MoneyDecimalSeparator = ",",
): TicketPhaseDraft[] {
  if (!Array.isArray(value)) return [];
  const out: TicketPhaseDraft[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const price = row.price_cents;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    const savedFrom = canonicalInstant(typeof row.from === "string" ? row.from : null);
    const savedTo = canonicalInstant(typeof row.to === "string" ? row.to : null);
    out.push({
      labelPl: typeof row.label_pl === "string" ? row.label_pl : "",
      labelEn: typeof row.label_en === "string" ? row.label_en : "",
      from: toLocalInput(savedFrom, timeZone),
      to: toLocalInput(savedTo, timeZone),
      price: centsToMoneyInput(Math.trunc(price), decimalSeparator),
      savedFrom,
      savedTo,
    });
  }
  return out;
}
