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
import type { EventTicketInput, EventTicketRow } from "@/lib/events/registrationsApi";

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
  /** Grosze/eurocenty jako tekst - input HTML nie zna liczb, tylko znaki. */
  priceCents: string;
  currency: TicketCurrency;
  /** Pusty tekst = bez limitu miejsc na tym bilecie. */
  quota: string;
  /** `datetime-local` albo pusty tekst. */
  salesFrom: string;
  salesTo: string;
  minTierRank: string;
  requiresApproval: boolean;
  groupId: string | null;
  isActive: boolean;
  sortOrder: string;
  /** Cena promocyjna obowiązująca do `earlyBirdUntil`; pusty tekst = brak. */
  earlyBirdPriceCents: string;
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
}

export const TICKET_ACCESS_CODE_MIN = 4;
export const TICKET_ACCESS_CODE_MAX = 64;
export const TICKET_MAX_ACCESS_CODE_HINT = 120;

export function emptyTicketDraft(sortOrder: number): TicketDraft {
  return {
    id: null,
    key: "",
    namePl: "",
    nameEn: "",
    descriptionPl: "",
    descriptionEn: "",
    priceCents: "0",
    currency: "PLN",
    quota: "",
    salesFrom: "",
    salesTo: "",
    minTierRank: "0",
    requiresApproval: false,
    groupId: null,
    isActive: true,
    sortOrder: String(sortOrder),
    earlyBirdPriceCents: "",
    earlyBirdUntil: "",
    accessCode: "",
    hasAccessCode: false,
    removeAccessCode: false,
    accessCodeHint: "",
    waitlistEnabled: true,
  };
}

/** ISO z bazy -> wartość `datetime-local` (bez sekund, w czasie przeglądarki). */
export function toLocalInput(iso: string | null): string {
  if (iso === null || iso === "") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Wartość `datetime-local` -> ISO albo `null`, gdy pole puste/niepełne. */
export function fromLocalInput(value: string): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function ticketDraftFromRow(row: EventTicketRow): TicketDraft {
  return {
    id: row.id,
    key: row.key,
    namePl: row.name_pl,
    nameEn: row.name_en,
    descriptionPl: row.description_pl ?? "",
    descriptionEn: row.description_en ?? "",
    priceCents: String(row.price_cents ?? 0),
    currency: (TICKET_CURRENCIES as readonly string[]).includes(row.currency)
      ? (row.currency as TicketCurrency)
      : "PLN",
    // `quota` jest w wygenerowanym typie liczbą, ale kolumna jest NULL-owalna -
    // brak limitu przychodzi jako `null` i musi zostać pustym polem.
    quota: row.quota === null || row.quota === undefined ? "" : String(row.quota),
    salesFrom: toLocalInput(row.sales_from ?? null),
    salesTo: toLocalInput(row.sales_to ?? null),
    minTierRank: String(row.min_tier_rank ?? 0),
    requiresApproval: row.requires_approval,
    groupId: row.group_id ?? null,
    isActive: row.is_active,
    sortOrder: String(row.sort_order ?? 0),
    earlyBirdPriceCents:
      row.early_bird_price_cents === null || row.early_bird_price_cents === undefined
        ? ""
        : String(row.early_bird_price_cents),
    earlyBirdUntil: toLocalInput(row.early_bird_until ?? null),
    accessCode: "",
    hasAccessCode: row.has_access_code === true,
    removeAccessCode: false,
    accessCodeHint: row.access_code_hint ?? "",
    waitlistEnabled: row.waitlist_enabled !== false,
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
  | "priceCents"
  | "quota"
  | "salesTo"
  | "minTierRank"
  | "earlyBirdPriceCents"
  | "earlyBirdUntil"
  | "accessCode"
  | "accessCodeHint";

export interface TicketDraftIssue {
  field: TicketDraftField;
  /** Klucz w `adminEventRegistration.errors.*`. */
  errorKey: string;
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

  const price = intOrNull(draft.priceCents);
  if (price === null || Number.isNaN(price) || price < 0 || price > TICKET_MAX_PRICE_CENTS) {
    return { field: "priceCents", errorKey: "invalidRequest" };
  }

  const quota = intOrNull(draft.quota);
  if (quota !== null && (Number.isNaN(quota) || quota < 0 || quota > TICKET_MAX_QUOTA)) {
    return { field: "quota", errorKey: "invalidRequest" };
  }

  const tier = intOrNull(draft.minTierRank);
  if (tier === null || Number.isNaN(tier) || tier < 0 || tier > 100) {
    return { field: "minTierRank", errorKey: "invalidRequest" };
  }

  // Okno sprzedaży zamknięte przed otwarciem to bilet, którego nie da się kupić
  // ani dziś, ani nigdy - baza odrzuca to CHECK-iem, więc odcinamy wcześniej.
  const from = fromLocalInput(draft.salesFrom);
  const to = fromLocalInput(draft.salesTo);
  if (from !== null && to !== null && new Date(to).getTime() <= new Date(from).getTime()) {
    return { field: "salesTo", errorKey: "invalidRequest" };
  }

  // Para early-bird jest niepodzielna: cena bez terminu obowiązywałaby wiecznie,
  // a termin bez ceny nie zmieniałby niczego. CHECK w bazie odrzuca oba przypadki
  // bez nazwy pola, więc rozstrzygamy je tutaj, przy właściwym polu.
  const early = intOrNull(draft.earlyBirdPriceCents);
  const hasEarlyDate = draft.earlyBirdUntil.trim() !== "";
  if (early !== null && !hasEarlyDate) {
    return { field: "earlyBirdUntil", errorKey: "invalidEarlyBird" };
  }
  if (early === null && hasEarlyDate) {
    return { field: "earlyBirdPriceCents", errorKey: "invalidEarlyBird" };
  }
  if (early !== null) {
    const base = intOrNull(draft.priceCents);
    if (
      Number.isNaN(early) ||
      early < 0 ||
      base === null ||
      Number.isNaN(base) ||
      early > base
    ) {
      return { field: "earlyBirdPriceCents", errorKey: "invalidEarlyBird" };
    }
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
    priceCents: Number(draft.priceCents.trim()),
    currency: draft.currency,
    quota: quota === null || Number.isNaN(quota) ? null : quota,
    salesFrom: fromLocalInput(draft.salesFrom),
    salesTo: fromLocalInput(draft.salesTo),
    minTierRank: Number(draft.minTierRank.trim()),
    requiresApproval: draft.requiresApproval,
    groupId: draft.groupId,
    isActive: draft.isActive,
    sortOrder: Number(draft.sortOrder.trim() === "" ? "0" : draft.sortOrder.trim()),
    earlyBirdPriceCents:
      draft.earlyBirdPriceCents.trim() === "" ? null : Number(draft.earlyBirdPriceCents.trim()),
    earlyBirdUntil: fromLocalInput(draft.earlyBirdUntil),
    // Trzy stany kodu: `undefined` = zostaw, `null` = zdejmij, napis = ustaw.
    accessCode: draft.removeAccessCode
      ? null
      : draft.accessCode.trim() === ""
        ? undefined
        : draft.accessCode.trim(),
    accessCodeHint: draft.accessCodeHint.trim(),
    waitlistEnabled: draft.waitlistEnabled,
  };
}
