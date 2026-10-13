// Wersja robocza PAKIETU GRUPOWEGO: wiersz bazy <-> pola formularza <-> payload.
//
// TE SAME ZASADY, CO W `ticketDraft.ts` - liczby i daty żyją w formularzu jako
// tekst, a każdy warunek, który sprawdza baza, ma tu odpowiednik z kluczem
// komunikatu przy polu. Odmowa CHECK-a wraca jako `23514` bez nazwy kolumny,
// więc bez tej warstwy organizator widzi „coś poszło nie tak" i zgaduje.
//
// LICZBA MIEJSC JEST SENSEM PAKIETU, więc nie może być pusta ani zerowa:
// pakiet na zero miejsc to oferta, której nie da się zrealizować, a jedno
// miejsce to zwykły bilet - dopuszczamy je, bo bywa etapem przejściowym przy
// przenoszeniu cennika, ale limit górny trzyma literówki w ryzach.
//
// CENA W POLU JEST W JEDNOSTCE GŁÓWNEJ WALUTY (TIX-14a). Pole pokazywało grosze
// („89900" dla 899 zł), więc organizator, który wpisał „899", myśląc
// o złotych, wystawiał pakiet za 8,99 zł. Grosze liczy wyłącznie
// `parseMoneyInput` / `centsToMoneyInput`; zapis niejednoznaczny („8,999")
// jest błędem przy polu, a nie zgadywaną kwotą.
//
// WARUNKI ZAKUPU I PROFIL PODATKOWY (TIX-07, TIX-09) są w szkicu jako `terms`,
// a `null` znaczy „nieznane" - baza bez migracji, nieudany odczyt albo pakiet,
// którego nie ma w odpowiedzi `admin_event_package_terms`. Nieznanych warunków
// formularz nie pokazuje, nie sprawdza i NIE WYSYŁA: upsert zmienia kolumnę
// tylko przy kluczu obecnym w ładunku, więc wartości domyślne wpisane w miejsce
// nieznanych nadpisałyby prawdziwe warunki przy pierwszej zmianie nazwy.
import {
  centsToMoneyInput,
  parseMoneyInput,
  type MoneyDecimalSeparator,
} from "@/lib/billing/moneyInput";
import {
  fromLocalInput,
  toLocalInput,
  TICKET_KEY_PATTERN,
  TICKET_MAX_DESCRIPTION,
  TICKET_MAX_NAME,
  TICKET_MAX_PRICE_CENTS,
  TICKET_MAX_QUOTA,
  TICKET_CURRENCIES,
  type TicketCurrency,
} from "@/lib/events/ticketDraft";
import {
  EMPTY_TAX_PROFILE,
  taxProfileFromRow,
  taxProfileIssues,
  taxProfileToPayload,
  type TaxProfileDraft,
  type TaxProfileField,
} from "@/lib/events/taxProfileDraft";
import {
  PACKAGE_AUDIENCES,
  type EventPackageInput,
  type EventPackageRow,
  type EventPackageTermsInput,
  type EventPackageTermsRow,
  type PackageAudience,
} from "@/lib/events/packagesApi";

export const PACKAGE_MAX_SEATS = 1_000;

/** Termin płatności - CHECK `event_ticket_packages_payment_terms_range` i DEFAULT kolumny. */
export const PACKAGE_MIN_PAYMENT_TERMS_DAYS = 1;
export const PACKAGE_MAX_PAYMENT_TERMS_DAYS = 120;
export const PACKAGE_DEFAULT_PAYMENT_TERMS_DAYS = 14;

/** Limit nieopłaconych zamówień - CHECK `event_ticket_packages_open_orders_range` i DEFAULT. */
export const PACKAGE_MIN_OPEN_ORDERS = 1;
export const PACKAGE_MAX_OPEN_ORDERS = 100;
export const PACKAGE_DEFAULT_OPEN_ORDERS = 3;

/** Warunki zakupu i profil podatkowy pakietu w formularzu (pola liczbowe jako tekst). */
export interface PackageTermsDraft {
  /** Zaufanie do faktury: delegat dostaje QR, zanim zamówienie zostanie opłacone. */
  admitBeforePayment: boolean;
  paymentTermsDays: string;
  /** Pusty tekst = bez limitu nieopłaconych zamówień. */
  maxOpenOrdersPerBuyer: string;
  taxProfile: TaxProfileDraft;
}

export interface PackageDraft {
  /** `null` = nowy pakiet; wtedy klucz jest edytowalny, później zamrożony. */
  id: string | null;
  key: string;
  ticketTypeId: string;
  namePl: string;
  nameEn: string;
  descriptionPl: string;
  descriptionEn: string;
  audience: PackageAudience;
  seats: string;
  /** Cena w jednostce głównej waluty („899,00"), nie w groszach. */
  price: string;
  currency: TicketCurrency;
  /** Pusty tekst = bez limitu sprzedanych pakietów. */
  quota: string;
  salesFrom: string;
  salesTo: string;
  minTierRank: string;
  requiresVerification: boolean;
  isActive: boolean;
  sortOrder: string;
  /** `null` = warunki nieznane: niepokazywane, niesprawdzane i niewysyłane. */
  terms: PackageTermsDraft | null;
}

export type PackageTermsField = "paymentTermsDays" | "maxOpenOrdersPerBuyer";

export type PackageDraftField =
  Exclude<keyof PackageDraft, "terms"> | PackageTermsField | TaxProfileField;

export interface PackageDraftIssue {
  field: PackageDraftField;
  /** Klucz w `adminEventRegistration.errors.*` - ten, którym odmówiłaby baza. */
  errorKey: string;
  /**
   * Pełny klucz zdania przy polu, gdy mówi ono więcej niż odmowa bazy (zapis
   * kwoty, termin płatności, profil podatkowy). Brak =
   * `adminEventRegistration.errors.<errorKey>` - patrz `packageDraftIssueMessage`.
   */
  messageKey?: string;
  /** Parametry zdania `messageKey`. */
  params?: Record<string, number | string>;
}

/** Klucz i parametry zdania, które formularz pokazuje przy polu `issue.field`. */
export function packageDraftIssueMessage(issue: PackageDraftIssue): {
  key: string;
  params?: Record<string, number | string>;
} {
  return issue.messageKey === undefined
    ? { key: `adminEventRegistration.errors.${issue.errorKey}` }
    : { key: issue.messageKey, params: issue.params };
}

const EDITOR = "adminEventRegistration.packages.editor";

/**
 * Co panel wie o warunkach zakupu pakietów wydarzenia (`usePackageTerms`).
 * Tylko `ready` daje szkicowi warunki; pozostałe stany zostawiają `terms: null`
 * i różnią się wyłącznie zdaniem, które formularz pokazuje w miejscu sekcji.
 */
export type PackageTermsLookup =
  | { status: "loading" }
  /** Baza bez migracji 20261012130000/130200. */
  | { status: "unavailable" }
  /** Odczyt się nie udał - warunków nie znamy, więc ich nie ruszamy. */
  | { status: "failed"; error: unknown }
  | { status: "ready"; byPackage: ReadonlyMap<string, EventPackageTermsRow> };

/** Warunki nowego pakietu = wartości domyślne kolumn (DEFAULT w migracjach). */
export function defaultPackageTerms(): PackageTermsDraft {
  return {
    admitBeforePayment: false,
    paymentTermsDays: String(PACKAGE_DEFAULT_PAYMENT_TERMS_DAYS),
    maxOpenOrdersPerBuyer: String(PACKAGE_DEFAULT_OPEN_ORDERS),
    taxProfile: { ...EMPTY_TAX_PROFILE },
  };
}

export function packageTermsDraftFromRow(row: EventPackageTermsRow): PackageTermsDraft {
  return {
    admitBeforePayment: row.admit_before_payment,
    paymentTermsDays: String(row.payment_terms_days),
    maxOpenOrdersPerBuyer:
      row.max_open_orders_per_buyer === null ? "" : String(row.max_open_orders_per_buyer),
    taxProfile: taxProfileFromRow(row),
  };
}

/**
 * Warunki, od których startuje formularz pakietu `packageId` (`null` = nowy).
 *
 * ZAPISANY PAKIET BEZ WIERSZA W ODPOWIEDZI TO WARUNKI NIEZNANE, nie domyślne -
 * np. pakiet założony przed chwilą, zanim lista warunków zdążyła się odświeżyć.
 */
export function packageTermsForDraft(
  packageId: string | null,
  lookup: PackageTermsLookup,
): PackageTermsDraft | null {
  if (lookup.status !== "ready") return null;
  if (packageId === null) return defaultPackageTerms();
  const row = lookup.byPackage.get(packageId);
  return row === undefined ? null : packageTermsDraftFromRow(row);
}

export function emptyPackageDraft(
  sortOrder: number,
  terms: PackageTermsDraft | null = null,
): PackageDraft {
  return {
    id: null,
    key: "",
    ticketTypeId: "",
    namePl: "",
    nameEn: "",
    descriptionPl: "",
    descriptionEn: "",
    audience: "company",
    seats: "5",
    price: "0",
    currency: "PLN",
    quota: "",
    salesFrom: "",
    salesTo: "",
    minTierRank: "0",
    requiresVerification: false,
    isActive: true,
    sortOrder: String(sortOrder),
    terms,
  };
}

/**
 * Wiersz bazy -> formularz. Cena z groszy na jednostkę główną („89900" ->
 * „899,00"); separator dobiera wołający do języka interfejsu, a parser
 * przyjmuje oba, więc wybór nie zmienia kwoty.
 */
export function packageDraftFromRow(
  row: EventPackageRow,
  terms: PackageTermsDraft | null = null,
  decimalSeparator: MoneyDecimalSeparator = ",",
): PackageDraft {
  return {
    id: row.id,
    key: row.key,
    ticketTypeId: row.ticket_type_id,
    namePl: row.name_pl,
    nameEn: row.name_en,
    descriptionPl: row.description_pl ?? "",
    descriptionEn: row.description_en ?? "",
    audience: (PACKAGE_AUDIENCES as readonly string[]).includes(row.audience)
      ? (row.audience as PackageAudience)
      : "company",
    seats: String(row.seats ?? 1),
    price: centsToMoneyInput(row.price_cents ?? 0, decimalSeparator),
    currency: (TICKET_CURRENCIES as readonly string[]).includes(row.currency)
      ? (row.currency as TicketCurrency)
      : "PLN",
    quota: row.quota === null || row.quota === undefined ? "" : String(row.quota),
    salesFrom: toLocalInput(row.sales_from ?? null),
    salesTo: toLocalInput(row.sales_to ?? null),
    minTierRank: String(row.min_tier_rank ?? 0),
    requiresVerification: row.requires_verification,
    isActive: row.is_active,
    sortOrder: String(row.sort_order ?? 100),
    terms,
  };
}

/** Liczba całkowita z pola tekstowego; `null` przy pustym/niepoprawnym. */
function intOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^-?\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function inRange(value: number | null, min: number, max: number): value is number {
  return value !== null && value >= min && value <= max;
}

/**
 * Pierwszy powód, dla którego warunki zakupu nie mogą zostać zapisane.
 *
 * ODMOWA, NIE PRZYCIĘCIE. „0" dni albo „150" zamówień nie zamienia się po
 * cichu w najbliższą dopuszczalną wartość - organizator dostaje zdanie przy
 * polu i sam decyduje, co miał na myśli.
 */
function packageTermsIssue(terms: PackageTermsDraft): PackageDraftIssue | null {
  const days = intOrNull(terms.paymentTermsDays);
  if (!inRange(days, PACKAGE_MIN_PAYMENT_TERMS_DAYS, PACKAGE_MAX_PAYMENT_TERMS_DAYS)) {
    return {
      field: "paymentTermsDays",
      errorKey: "invalidRequest",
      messageKey: `${EDITOR}.paymentTermsDaysRange`,
      params: { min: PACKAGE_MIN_PAYMENT_TERMS_DAYS, max: PACKAGE_MAX_PAYMENT_TERMS_DAYS },
    };
  }
  if (terms.maxOpenOrdersPerBuyer.trim() !== "") {
    const limit = intOrNull(terms.maxOpenOrdersPerBuyer);
    if (!inRange(limit, PACKAGE_MIN_OPEN_ORDERS, PACKAGE_MAX_OPEN_ORDERS)) {
      return {
        field: "maxOpenOrdersPerBuyer",
        errorKey: "invalidRequest",
        messageKey: `${EDITOR}.maxOpenOrdersRange`,
        params: { min: PACKAGE_MIN_OPEN_ORDERS, max: PACKAGE_MAX_OPEN_ORDERS },
      };
    }
  }
  // Zdania przy polach profilu rysuje `TaxProfileFields` (z liczbą znaków do
  // skrócenia); tutaj wystarczy, że błąd ZATRZYMUJE zapis i wskazuje pole.
  const tax = taxProfileIssues(terms.taxProfile);
  if (tax.stripeTaxCode === true) {
    return { field: "stripeTaxCode", errorKey: "invalidTaxCode" };
  }
  if (tax.vatExemptBasis === true) {
    return { field: "vatExemptBasis", errorKey: "invalidExemptBasis" };
  }
  return null;
}

export function packageDraftIssue(draft: PackageDraft): PackageDraftIssue | null {
  if (draft.id === null && !TICKET_KEY_PATTERN.test(draft.key.trim())) {
    return { field: "key", errorKey: "packageKeyPattern" };
  }
  if (draft.ticketTypeId.trim() === "") {
    return { field: "ticketTypeId", errorKey: "packageTicketRequired" };
  }
  if (draft.namePl.trim() === "" || draft.namePl.length > TICKET_MAX_NAME) {
    return { field: "namePl", errorKey: "packageNameRequired" };
  }
  if (draft.nameEn.trim() === "" || draft.nameEn.length > TICKET_MAX_NAME) {
    return { field: "nameEn", errorKey: "packageNameRequired" };
  }
  if (draft.descriptionPl.length > TICKET_MAX_DESCRIPTION) {
    return { field: "descriptionPl", errorKey: "packageDescriptionTooLong" };
  }
  if (draft.descriptionEn.length > TICKET_MAX_DESCRIPTION) {
    return { field: "descriptionEn", errorKey: "packageDescriptionTooLong" };
  }

  const seats = intOrNull(draft.seats);
  if (seats === null || seats < 1 || seats > PACKAGE_MAX_SEATS) {
    return { field: "seats", errorKey: "packageSeatsRange" };
  }

  // Puste pole, minus, litery i zapis niejednoznaczny („8,999") dostają zdanie
  // o formacie kwoty w walucie pakietu (klucz per waluta, bo „w złotych" /
  // „w euro" odmienia się inaczej niż kod waluty). Sufit liczymy w groszach.
  const price = parseMoneyInput(draft.price);
  if (price === null) {
    return {
      field: "price",
      errorKey: "packagePriceRange",
      messageKey: `${EDITOR}.priceFormat.${draft.currency}`,
    };
  }
  if (price > TICKET_MAX_PRICE_CENTS) {
    return { field: "price", errorKey: "packagePriceRange" };
  }

  if (draft.quota.trim() !== "") {
    const quota = intOrNull(draft.quota);
    if (quota === null || quota < 0 || quota > TICKET_MAX_QUOTA) {
      return { field: "quota", errorKey: "packageQuotaRange" };
    }
  }

  const tier = intOrNull(draft.minTierRank);
  if (tier === null || tier < 0 || tier > 100) {
    return { field: "minTierRank", errorKey: "packageTierRange" };
  }

  const from = fromLocalInput(draft.salesFrom);
  const to = fromLocalInput(draft.salesTo);
  if (from !== null && to !== null && new Date(from) >= new Date(to)) {
    return { field: "salesTo", errorKey: "packageSalesWindow" };
  }

  const sortOrder = intOrNull(draft.sortOrder);
  if (sortOrder === null || sortOrder < 0 || sortOrder > 10_000) {
    return { field: "sortOrder", errorKey: "packageSortRange" };
  }

  return draft.terms === null ? null : packageTermsIssue(draft.terms);
}

/**
 * Warunki szkicu -> ładunek. Warunki, których nie da się przeczytać, NIE jadą
 * (`null`), zamiast jechać wartością zastępczą: wołający, który pominął
 * `packageDraftIssue`, zostawia wtedy kolumny bez zmian, a nie wpisuje
 * „bez limitu" w miejsce literówki.
 */
function packageTermsToInput(terms: PackageTermsDraft | null): EventPackageTermsInput | null {
  if (terms === null || packageTermsIssue(terms) !== null) return null;
  const days = intOrNull(terms.paymentTermsDays);
  if (days === null) return null;
  return {
    admitBeforePayment: terms.admitBeforePayment,
    paymentTermsDays: days,
    maxOpenOrdersPerBuyer:
      terms.maxOpenOrdersPerBuyer.trim() === "" ? null : intOrNull(terms.maxOpenOrdersPerBuyer),
    tax: taxProfileToPayload(terms.taxProfile),
  };
}

export function packageDraftToInput(draft: PackageDraft, eventId: string): EventPackageInput {
  return {
    id: draft.id,
    eventId,
    key: draft.key.trim(),
    ticketTypeId: draft.ticketTypeId,
    namePl: draft.namePl.trim(),
    nameEn: draft.nameEn.trim(),
    descriptionPl: draft.descriptionPl.trim(),
    descriptionEn: draft.descriptionEn.trim(),
    audience: draft.audience,
    seats: intOrNull(draft.seats) ?? 1,
    priceCents: parseMoneyInput(draft.price) ?? 0,
    currency: draft.currency,
    quota: draft.quota.trim() === "" ? null : (intOrNull(draft.quota) ?? null),
    salesFrom: fromLocalInput(draft.salesFrom),
    salesTo: fromLocalInput(draft.salesTo),
    minTierRank: intOrNull(draft.minTierRank) ?? 0,
    requiresVerification: draft.requiresVerification,
    isActive: draft.isActive,
    sortOrder: intOrNull(draft.sortOrder) ?? 100,
    terms: packageTermsToInput(draft.terms),
  };
}
