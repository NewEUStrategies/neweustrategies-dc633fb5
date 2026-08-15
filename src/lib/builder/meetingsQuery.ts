// Warstwa danych widgetu meeting-booking (networking 1-1). Wszystko przez
// utwardzone RPC z migracji 20260728090000 (rzutowanie rpc przez `unknown` -
// wygenerowane typy nie znaja jeszcze tych funkcji; ustalony idiom).
//
// UWAGA - dane sa ZALEZNE OD ZALOGOWANEGO (booked_by_me / is_mine), dlatego
// ten modul CELOWO:
//  - nie uzywa edgeTtlCache (wspoldzielony cache per-host serwowalby cudze
//    flagi rezerwacji),
//  - nie ma ramienia prefetchu SSR w lib/builder/prefetch.ts (anonimowy
//    prefetch zdehydrowany do klienta klamalby zalogowanym).
// Widget pobiera sloty wylacznie po stronie klienta.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { uiLocale } from "@/lib/i18n/format";

export type Lang = "pl" | "en";

export interface MeetingSlotRow {
  id: string;
  host_user_id: string;
  host_name: string | null;
  host_avatar_url: string | null;
  host_slug: string | null;
  event_id: string | null;
  starts_at: string;
  ends_at: string;
  location: string | null;
  is_booked: boolean;
  booked_by_me: boolean;
  is_mine: boolean;
}

export type MeetingMode = "host" | "event";

export interface MeetingSlotsInput {
  mode: MeetingMode;
  hostUserId: string;
  eventId: string;
  daysAhead: number;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const numOf = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Znormalizowany input zapytania - pochodna wylacznie tresci widgetu. */
export function meetingSlotsInput(c: WidgetContent): MeetingSlotsInput {
  const modeRaw = strOf(c.mode);
  return {
    mode: modeRaw === "event" ? "event" : "host",
    hostUserId: strOf(c.hostUserId),
    eventId: strOf(c.eventId),
    daysAhead: Math.max(1, Math.min(90, Math.round(numOf(c.daysAhead, 14)))),
  };
}

/** Widget jest skonfigurowany, gdy wskazano hosta (tryb host) lub wydarzenie. */
export function meetingSlotsConfigured(input: MeetingSlotsInput): boolean {
  return input.mode === "host" ? !!input.hostUserId : !!input.eventId;
}

type UntypedRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

// Dostep do klienta odroczony do wywolania: klient Supabase jest leniwym
// proxy rzucajacym przy braku env, a ten modul importuja tez czyste testy.
const rpc: UntypedRpc = (fn, args) => (supabase.rpc as unknown as UntypedRpc)(fn, args);

export function mapMeetingSlotRow(raw: Record<string, unknown>): MeetingSlotRow {
  return {
    id: strOf(raw.id),
    host_user_id: strOf(raw.host_user_id),
    host_name: strOf(raw.host_name) || null,
    host_avatar_url: strOf(raw.host_avatar_url) || null,
    host_slug: strOf(raw.host_slug) || null,
    event_id: strOf(raw.event_id) || null,
    starts_at: strOf(raw.starts_at),
    ends_at: strOf(raw.ends_at),
    location: strOf(raw.location) || null,
    is_booked: raw.is_booked === true,
    booked_by_me: raw.booked_by_me === true,
    is_mine: raw.is_mine === true,
  };
}

async function fetchMeetingSlots(input: MeetingSlotsInput): Promise<MeetingSlotRow[]> {
  const { data, error } = await rpc("get_public_meeting_slots", {
    p_host_user_id: input.mode === "host" && input.hostUserId ? input.hostUserId : null,
    p_event_id: input.mode === "event" && input.eventId ? input.eventId : null,
    p_days: input.daysAhead,
    p_limit: 200,
  });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  return rows
    .filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x),
    )
    .map(mapMeetingSlotRow)
    .filter((row) => row.id !== "");
}

/** Sloty widgetu; `viewerId` w kluczu, bo flagi booked_by_me/is_mine sa
 *  per-uzytkownik (wylogowanie/zalogowanie musi zmienic wpis cache). */
export const meetingSlotsQueryOptions = (c: WidgetContent, viewerId: string | null) => {
  const input = meetingSlotsInput(c);
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.meetingSlots, input, viewerId ?? "anon"] as const,
    queryFn: () =>
      meetingSlotsConfigured(input)
        ? fetchMeetingSlots(input)
        : Promise.resolve([] as MeetingSlotRow[]),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
};

// ---------------------------------------------------------------------------
// Mutacje (zawsze przez RPC; bledy zwracane jako Error z komunikatem serwera)
// ---------------------------------------------------------------------------

export async function bookMeetingSlot(slotId: string, note?: string): Promise<void> {
  const { error } = await rpc("book_meeting_slot", {
    p_slot_id: slotId,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function cancelMyMeetingBooking(slotId: string): Promise<void> {
  const { error } = await rpc("cancel_my_meeting_booking", { p_slot_id: slotId });
  if (error) throw new Error(error.message);
}

export interface CreateSlotInput {
  startsAt: string;
  endsAt: string;
  eventId: string | null;
  location: string | null;
}

export async function createMyMeetingSlot(input: CreateSlotInput): Promise<void> {
  const { error } = await rpc("create_my_meeting_slot", {
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_event_id: input.eventId,
    p_location: input.location,
  });
  if (error) throw new Error(error.message);
}

export async function deleteMyMeetingSlot(slotId: string): Promise<void> {
  const { error } = await rpc("delete_my_meeting_slot", { p_slot_id: slotId });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Czysta logika prezentacji (unit-testowalna)
// ---------------------------------------------------------------------------

export interface MeetingDayGroup {
  /** Klucz dnia yyyy-mm-dd (lokalny dla przegladarki). */
  dayKey: string;
  /** Etykieta dnia ("wtorek, 12 pazdziernika" wg locale). */
  label: string;
  slots: MeetingSlotRow[];
}

/** Grupuje sloty po dniu lokalnym, zachowujac kolejnosc chronologiczna. */
export function groupSlotsByDay(slots: MeetingSlotRow[], lang: Lang): MeetingDayGroup[] {
  const locale = uiLocale(lang);
  const groups = new Map<string, MeetingDayGroup>();
  const sorted = [...slots].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
  for (const slot of sorted) {
    const date = new Date(slot.starts_at);
    if (Number.isNaN(date.getTime())) continue;
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;
    let group = groups.get(dayKey);
    if (!group) {
      group = {
        dayKey,
        label: date.toLocaleDateString(locale, {
          weekday: "long",
          day: "numeric",
          month: "long",
        }),
        slots: [],
      };
      groups.set(dayKey, group);
    }
    group.slots.push(slot);
  }
  return [...groups.values()];
}

/** "10:00 - 10:30" w czasie lokalnym przegladarki (sloty sa "na zywo",
 *  wiec lokalny czas widza jest wlasciwym ukladem odniesienia). */
export function formatSlotRange(slot: MeetingSlotRow, lang: Lang): string {
  const locale = uiLocale(lang);
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  const start = new Date(slot.starts_at);
  const end = new Date(slot.ends_at);
  if (Number.isNaN(start.getTime())) return "";
  const startLabel = start.toLocaleTimeString(locale, opts);
  if (Number.isNaN(end.getTime())) return startLabel;
  return `${startLabel} - ${end.toLocaleTimeString(locale, opts)}`;
}
