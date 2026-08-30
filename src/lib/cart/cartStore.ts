// KOSZYK UCZESTNIKA - czysty model + trwałość w przeglądarce.
//
// DLACZEGO PRZEGLĄDARKA, A NIE BAZA. Koszyk nie jest zobowiązaniem: nie
// rezerwuje miejsca, nie blokuje puli i nie zmienia ceny. Cena, faza sprzedaży
// i dostępność są liczone od nowa przez bazę w momencie płatności
// (`event_ticket_checkout_quote`), więc wpis w koszyku jest wyłącznie NOTATKĄ
// „chcę to kupić". Trzymanie takiej notatki w bazie znaczyłoby tabelę, RLS
// i sprzątanie porzuconych wierszy - bez ani jednej nowej gwarancji.
//
// KWOTA W KOSZYKU JEST PODGLĄDEM, NIE OBIETNICĄ. Zapisujemy ją tylko po to,
// żeby lista nie była pusta wizualnie; przy przejściu do kasy autorytetem jest
// zawsze odpowiedź serwera (patrz `CartPanel`).
//
// MODUŁ JEST CZYSTY (poza dwiema funkcjami I/O na końcu) - dzięki temu reguły
// scalania i sum są testowalne bez DOM.

/** Rodzaj pozycji. Dziś jeden; enum zostawia miejsce na kolejne (np. plan). */
export type CartItemKind = "event_ticket";

export interface CartItem {
  /** Stabilna tożsamość pozycji - patrz `cartItemId`. */
  id: string;
  kind: CartItemKind;
  eventId: string;
  /** Slug wydarzenia - potrzebny do adresów powrotu Stripe i odnośników. */
  slug: string;
  titlePl: string;
  titleEn: string;
  /** `null` = wydarzenie bez cennika (cena z wiersza wydarzenia). */
  ticketTypeId: string | null;
  ticketNamePl: string;
  ticketNameEn: string;
  /** Podgląd ceny w groszach z chwili dodania. */
  priceCents: number;
  currency: string;
  /** ISO 8601 - kolejność listy i podstawa czyszczenia starych pozycji. */
  addedAt: string;
}

export const CART_STORAGE_KEY = "nes:cart:v1";

/** Po tylu dniach notatka zakupowa przestaje być aktualna i znika po cichu. */
export const CART_MAX_AGE_DAYS = 30;

/**
 * Tożsamość pozycji: wydarzenie + rodzaj wejściówki. Dwa razy ten sam bilet to
 * ta sama pozycja - zapisu na wydarzenie i tak nie da się mieć podwójnie
 * (`event_registrations` trzyma jeden wiersz na osobę).
 */
export function cartItemId(eventId: string, ticketTypeId: string | null): string {
  return `${eventId}:${ticketTypeId ?? "default"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function parseItem(raw: unknown): CartItem | null {
  if (!isRecord(raw)) return null;
  const eventId = str(raw, "eventId");
  const slug = str(raw, "slug");
  if (eventId === "" || slug === "") return null;
  const ticketTypeIdRaw = raw["ticketTypeId"];
  const ticketTypeId =
    typeof ticketTypeIdRaw === "string" && ticketTypeIdRaw !== "" ? ticketTypeIdRaw : null;
  const price = raw["priceCents"];
  return {
    id: cartItemId(eventId, ticketTypeId),
    kind: "event_ticket",
    eventId,
    slug,
    titlePl: str(raw, "titlePl"),
    titleEn: str(raw, "titleEn"),
    ticketTypeId,
    ticketNamePl: str(raw, "ticketNamePl"),
    ticketNameEn: str(raw, "ticketNameEn"),
    priceCents:
      typeof price === "number" && Number.isFinite(price) ? Math.max(0, Math.trunc(price)) : 0,
    currency: (str(raw, "currency") || "PLN").toUpperCase(),
    addedAt: str(raw, "addedAt") || new Date(0).toISOString(),
  };
}

/** Odczyt odporny na uszkodzony wpis: zły JSON = pusty koszyk, nie wyjątek. */
export function parseCart(raw: string | null): CartItem[] {
  if (raw === null || raw.trim() === "") return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(decoded)) return [];
  const out: CartItem[] = [];
  for (const entry of decoded) {
    const item = parseItem(entry);
    if (item !== null && !out.some((existing) => existing.id === item.id)) out.push(item);
  }
  return out;
}

/** Usuwa notatki starsze niż `CART_MAX_AGE_DAYS` względem podanej chwili. */
export function pruneCart(items: CartItem[], now: Date): CartItem[] {
  const cutoff = now.getTime() - CART_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    const stamp = Date.parse(item.addedAt);
    return Number.isNaN(stamp) ? false : stamp >= cutoff;
  });
}

/** Dodanie jest idempotentne - powtórka odświeża podgląd ceny, nie duplikuje. */
export function addCartItem(items: CartItem[], item: CartItem): CartItem[] {
  const normalized: CartItem = { ...item, id: cartItemId(item.eventId, item.ticketTypeId) };
  const without = items.filter((existing) => existing.id !== normalized.id);
  return [...without, normalized];
}

export function removeCartItem(items: CartItem[], id: string): CartItem[] {
  return items.filter((item) => item.id !== id);
}

export interface CartTotals {
  count: number;
  /** Sumy rozbite po walucie - koszyk może mieszać PLN i EUR. */
  byCurrency: Array<{ currency: string; amountCents: number }>;
}

export function cartTotals(items: CartItem[]): CartTotals {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item.currency, (map.get(item.currency) ?? 0) + item.priceCents);
  }
  return {
    count: items.length,
    byCurrency: [...map.entries()]
      .map(([currency, amountCents]) => ({ currency, amountCents }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

/** Nazwa pozycji w języku interfejsu, z zapasem na drugi język i slug. */
export function cartItemLabel(item: CartItem, lang: "pl" | "en"): string {
  const title =
    (lang === "en" ? item.titleEn : item.titlePl) || item.titlePl || item.titleEn || item.slug;
  const ticket = (lang === "en" ? item.ticketNameEn : item.ticketNamePl) || "";
  return ticket === "" ? title : `${title} - ${ticket}`;
}

export function readCartStorage(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    return pruneCart(parseCart(window.localStorage.getItem(CART_STORAGE_KEY)), new Date());
  } catch {
    return [];
  }
}

export function writeCartStorage(items: CartItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* tryb prywatny / brak miejsca - koszyk zostaje wtedy tylko w pamięci */
  }
}
