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
  PACKAGE_AUDIENCES,
  type EventPackageInput,
  type EventPackageRow,
  type PackageAudience,
} from "@/lib/events/packagesApi";

export const PACKAGE_MAX_SEATS = 1_000;

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
  priceCents: string;
  currency: TicketCurrency;
  /** Pusty tekst = bez limitu sprzedanych pakietów. */
  quota: string;
  salesFrom: string;
  salesTo: string;
  minTierRank: string;
  requiresVerification: boolean;
  isActive: boolean;
  sortOrder: string;
}

export type PackageDraftField = keyof PackageDraft;

export interface PackageDraftIssue {
  field: PackageDraftField;
  errorKey: string;
}

export function emptyPackageDraft(sortOrder: number): PackageDraft {
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
    priceCents: "0",
    currency: "PLN",
    quota: "",
    salesFrom: "",
    salesTo: "",
    minTierRank: "0",
    requiresVerification: false,
    isActive: true,
    sortOrder: String(sortOrder),
  };
}

export function packageDraftFromRow(row: EventPackageRow): PackageDraft {
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
    priceCents: String(row.price_cents ?? 0),
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

  const price = intOrNull(draft.priceCents);
  if (price === null || price < 0 || price > TICKET_MAX_PRICE_CENTS) {
    return { field: "priceCents", errorKey: "packagePriceRange" };
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

  return null;
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
    priceCents: intOrNull(draft.priceCents) ?? 0,
    currency: draft.currency,
    quota: draft.quota.trim() === "" ? null : (intOrNull(draft.quota) ?? null),
    salesFrom: fromLocalInput(draft.salesFrom),
    salesTo: fromLocalInput(draft.salesTo),
    minTierRank: intOrNull(draft.minTierRank) ?? 0,
    requiresVerification: draft.requiresVerification,
    isActive: draft.isActive,
    sortOrder: intOrNull(draft.sortOrder) ?? 100,
  };
}
