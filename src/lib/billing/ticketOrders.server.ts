// Zamówienia biletowe w panelu admina - logika odczytu.
//
// Wszystko idzie przez klienta z sesją admina (`context.supabase`), więc RLS
// jest jedyną bramką: polityka `orders owner read` przepuszcza wiersze tenanta
// dopiero dla `has_role(auth.uid(),'admin')`. Świadomie NIE używamy tu klienta
// serwisowego - panel nie może widzieć więcej niż baza przyzna adminowi.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json, Tables } from "@/integrations/supabase/types";

/** Zamówienie biletu = one_time z `metadata.event_id`. */
export interface TicketOrderRow {
  id: string;
  createdAt: string;
  paidAt: string | null;
  status: string;
  provider: string;
  /** Identyfikator transakcji u operatora (Paddle) - klucz do historii. */
  transactionId: string | null;
  amountCents: number;
  currency: string;
  /** Liczba biletów w zamówieniu (domyślnie 1 - jeden RSVP na konto). */
  tickets: number;
  couponCode: string | null;
  /** `null` = konto kupującego usunięte; zamówienie żyje jako dowód księgowy. */
  buyerId: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  /** Zamówienie po anonimizacji (RODO) - panel pokazuje etykietę zamiast danych. */
  buyerAnonymized: boolean;
  eventId: string;
  eventTitlePl: string | null;
  eventTitleEn: string | null;
  eventSlug: string | null;
  eventStartsAt: string | null;
}

export interface TicketOrderHistoryEntry {
  id: string;
  /** Znormalizowany typ wpisu - panel mapuje go na etykietę i kolor. */
  kind: "order_created" | "order_paid" | "webhook";
  label: string;
  status: string | null;
  at: string;
  error: string | null;
  environment: string | null;
}

/**
 * Kolumny WYPROWADZONE z wygenerowanych typów - patrz bliźniaczy komentarz
 * w `paymentOrders.server.ts`. Ręczna kopia deklarowała `status: string`
 * przy kolumnie ENUM i `metadata: Record<string, unknown> | null` przy `Json`
 * NOT NULL, a `as unknown as` kasowało obie różnice.
 */
type OrderRecord = Pick<
  Tables<"payment_orders">,
  | "id"
  | "user_id"
  | "anonymized_at"
  | "status"
  | "provider"
  | "provider_intent_id"
  | "amount_cents"
  | "currency"
  | "paid_at"
  | "created_at"
  | "metadata"
>;

/**
 * `metadata` jest w bazie kolumną `jsonb`, więc jej typem jest `Json` - a `Json`
 * to także tablica, liczba i napis, nie tylko obiekt. Poprzedni kształt
 * (`Record<string, unknown> | null`) był wygodnym kłamstwem, które trzymało się
 * wyłącznie dzięki `as unknown as`: odczyt `source?.[key]` na tablicy albo
 * liczbie nie wybucha, tylko po cichu daje `undefined`, więc zamówienie
 * z nietypowym ładunkiem gubiło `event_id` i wypadało z listy bez śladu.
 * Zawężamy JAWNIE, w jednym miejscu.
 */
function asObject(source: Json): Record<string, unknown> | null {
  return typeof source === "object" && source !== null && !Array.isArray(source)
    ? (source as Record<string, unknown>)
    : null;
}

function str(source: Json, key: string): string | null {
  const value = asObject(source)?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Identyfikator wydarzenia z metadanych - JEDYNE pole, po którym zapytanie
 * rozpoznaje bilet, więc czytamy je dokładnie tak, jak czyta je baza.
 *
 * Filtr zapytania (`metadata->>'event_id' IS NOT NULL`) używa operatora `->>`,
 * który rzutuje wartość NA TEKST: `{"event_id": 42}` daje w SQL `'42'`, więc
 * taki wiersz PRZECHODZI filtr i dojeżdża do tej warstwy. Wcześniejsze
 * czytanie przez `str()` (twarde `typeof === "string"`) oddawało wtedy `null`,
 * a `flatMap` wyrzucał całe zamówienie - filtr bazy i zawężenie w TypeScripcie
 * mówiły DWIE RÓŻNE RZECZY o tym samym wierszu, a zamówienie znikało z
 * jedynego ekranu, na którym ktokolwiek je zobaczy: bez wyjątku, bez
 * ostrzeżenia, bez pozycji w logu. Kupujący miał potwierdzenie zapłaty, panel
 * nie miał zamówienia, a uzgodnienie księgowe pokazywało różnicę nie do
 * wytłumaczenia.
 *
 * Liczbę zamieniamy więc na tekst tak samo jak `->>`. Taki identyfikator nie
 * dopasuje się do żadnego wydarzenia (klucze są UUID-ami), więc wiersz pojawia
 * się na liście BEZ nazwy wydarzenia - czyli widoczny i możliwy do wyjaśnienia,
 * zamiast cicho zniknąć. Pozostałe kształty (`null`, tablica, obiekt, wartość
 * logiczna) nie są identyfikatorem i dalej są odmową.
 */
function eventIdOf(source: Json): string | null {
  const value = asObject(source)?.["event_id"];
  if (typeof value === "string") return value.trim() ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function positiveInt(source: Json, key: string): number {
  const value = asObject(source)?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

/**
 * Lista zamówień biletowych tenanta, najnowsze pierwsze, wraz z danymi
 * wydarzenia i kupującego. Braki w słownikach (usunięte wydarzenie, profil bez
 * nazwy) degradują się do `null` zamiast wywalać całą listę.
 */
export async function loadTicketOrders(
  supabase: SupabaseClient,
  limit: number,
): Promise<TicketOrderRow[]> {
  const { data, error } = await supabase
    .from("payment_orders")
    .select(
      "id,user_id,anonymized_at,status,provider,provider_intent_id,amount_cents,currency,paid_at,created_at,metadata",
    )
    .eq("kind", "one_time")
    // Bilet rozpoznajemy po metadanych - te same, które czyta webhook.
    .not("metadata->>event_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const orders = (data ?? []) as OrderRecord[];
  if (orders.length === 0) return [];

  const eventIds = [
    ...new Set(orders.map((o) => eventIdOf(o.metadata)).filter((v): v is string => !!v)),
  ];
  // Zamówienia zanonimizowane (konto usunięte) nie mają kogo szukać w
  // profilach - wypadają z zapytania, żeby `.in()` nie dostał NULL-a.
  const buyerIds = [...new Set(orders.map((o) => o.user_id).filter((v): v is string => !!v))];

  const [eventsRes, profilesRes] = await Promise.all([
    supabase.from("events").select("id,slug,title_pl,title_en,starts_at").in("id", eventIds),
    supabase
      .from("profiles")
      .select("id,display_name,first_name,last_name,email")
      .in("id", buyerIds),
  ]);

  const eventById = new Map(
    (eventsRes.data ?? []).map((e) => [
      e.id as string,
      e as {
        id: string;
        slug: string | null;
        title_pl: string | null;
        title_en: string | null;
        starts_at: string | null;
      },
    ]),
  );
  const profileById = new Map(
    (profilesRes.data ?? []).map((p) => [
      p.id as string,
      p as {
        id: string;
        display_name: string | null;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
      },
    ]),
  );

  return orders.flatMap((order) => {
    const eventId = eventIdOf(order.metadata);
    if (!eventId) return [];
    const event = eventById.get(eventId) ?? null;
    const profile = order.user_id ? (profileById.get(order.user_id) ?? null) : null;
    const buyerName =
      profile?.display_name?.trim() ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
      null;

    return [
      {
        id: order.id,
        createdAt: order.created_at,
        paidAt: order.paid_at,
        status: order.status,
        provider: order.provider,
        transactionId: order.provider_intent_id,
        amountCents: order.amount_cents,
        currency: (order.currency || "PLN").toUpperCase(),
        tickets: positiveInt(order.metadata, "quantity"),
        couponCode: str(order.metadata, "coupon_code"),
        buyerId: order.user_id,
        buyerName,
        buyerEmail: profile?.email ?? null,
        buyerAnonymized: order.anonymized_at !== null,
        eventId,
        eventTitlePl: event?.title_pl ?? null,
        eventTitleEn: event?.title_en ?? null,
        eventSlug: event?.slug ?? null,
        eventStartsAt: event?.starts_at ?? null,
      } satisfies TicketOrderRow,
    ];
  });
}

/**
 * Historia zmian jednego zamówienia: własne znaczniki cyklu życia (utworzenie,
 * zaksięgowanie) plus zdarzenia operatora dopasowane po identyfikatorze
 * transakcji zapisanym na zamówieniu. Rosnąco - czyta się jak oś czasu.
 */
export async function loadTicketOrderHistory(
  supabase: SupabaseClient,
  orderId: string,
): Promise<TicketOrderHistoryEntry[]> {
  const { data: order, error } = await supabase
    .from("payment_orders")
    .select("id,status,created_at,paid_at,provider_intent_id")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) return [];

  const entries: TicketOrderHistoryEntry[] = [
    {
      id: `${order.id}:created`,
      kind: "order_created",
      label: "order_created",
      status: "pending",
      at: order.created_at as string,
      error: null,
      environment: null,
    },
  ];
  if (order.paid_at) {
    entries.push({
      id: `${order.id}:paid`,
      kind: "order_paid",
      label: "order_paid",
      status: "paid",
      at: order.paid_at as string,
      error: null,
      environment: null,
    });
  }

  const transactionId = order.provider_intent_id as string | null;
  if (transactionId) {
    // Zdarzenia operatora dotyczące tej transakcji - dopasowanie po polu
    // `data.id` w surowym payloadzie (webhook nie zna id naszego zamówienia).
    const { data: events, error: eventsError } = await supabase
      .from("payment_webhook_events")
      .select("id,event_type,status,error,environment,occurred_at,created_at")
      .eq("payload->data->>id", transactionId)
      .order("created_at", { ascending: true })
      .limit(50);
    // ODMOWA ODCZYTU DZIENNIKA NIE MOŻE BYĆ CICHA. Wcześniej `error` był
    // pomijany (`const { data: events } = ...`), więc przy odmowie polityki,
    // literówce w kolumnie albo awarii baza oddawała `null`, a oś czasu
    // składała się z samych naszych znaczników i wyglądała na KOMPLETNĄ.
    // A ta oś jest narzędziem diagnostycznym: człowiek patrzy na nią dokładnie
    // wtedy, gdy pyta „czy webhook w ogóle przyszedł?". Pusta lista zdarzeń
    // operatora odpowiadała wtedy „nie przyszedł" - nieprawdziwie, a na tej
    // podstawie obsługa zwraca pieniądze albo wystawia bilet drugi raz.
    // Zgłaszamy tak samo jak odczyt samego zamówienia wyżej: ekran ma pokazać
    // awarię, a nie zmyśloną kompletność.
    if (eventsError) throw new Error(eventsError.message);
    for (const ev of events ?? []) {
      entries.push({
        id: ev.id as string,
        kind: "webhook",
        label: ev.event_type as string,
        status: ev.status as string,
        at: (ev.occurred_at as string | null) ?? (ev.created_at as string),
        error: (ev.error as string | null) ?? null,
        environment: (ev.environment as string | null) ?? null,
      });
    }
  }

  return entries.sort((a, b) => a.at.localeCompare(b.at));
}
