// Układ SIATKI CZASU agendy - czysta arytmetyka, zero DOM-u.
//
// PO CO OSOBNY MODUŁ. Kafel sesji na siatce ma dwie współrzędne: kolumnę (sala)
// i przedział pionowy (minuty od początku doby wydarzenia). Obie liczą się z
// dat w STREFIE WYDARZENIA, a nie w strefie przeglądarki - kongres o 09:00 w
// Warszawie musi stać na 09:00 także wtedy, gdy organizator siedzi w Lizbonie.
// Trzymanie tego w komponencie znaczyłoby, że jedyną drogą do sprawdzenia
// przeliczeń jest render; tu jest to zwykła funkcja z testem.
//
// SALA „BEZ PRZYPISANIA" JEST KOLUMNĄ, nie brakiem danych. Sesja bez sali musi
// być widoczna na siatce, bo to najczęstsza rzecz do poprawienia przed
// publikacją - schowanie jej znaczyłoby, że siatka kłamie o zawartości dnia.
import { eventDayKey, eventTimeZone } from "@/lib/events/timezone";
import type { AgendaConflictRow, EventRoomRow, EventSessionRow } from "@/lib/events/sessionsApi";

/** Kolumna „sesje bez sali" - wartownik, bo `room_id` bywa pusty. */
export const TIMELINE_NO_ROOM = "__no_room__";

/** Wysokość jednej minuty w pikselach - siatka i kafle muszą użyć tej samej. */
export const TIMELINE_MINUTE_PX = 1.6;

/** Najkrótszy kafel, jaki da się jeszcze przeczytać (w minutach). */
const MIN_BLOCK_MINUTES = 20;

export interface TimelineColumn {
  id: string;
  name: string;
  capacity: number | null;
}

export interface TimelineBlock {
  sessionId: string;
  columnId: string;
  title: string;
  /** Minuty od północy dnia wydarzenia. */
  startMinute: number;
  endMinute: number;
  /** Wysokość kafla w minutach - nigdy mniejsza niż czytelne minimum. */
  spanMinutes: number;
  status: string;
  trackName: string;
  accentColor: string | null;
  /** Podział poziomy wewnątrz kolumny, gdy sesje na siebie zachodzą. */
  lane: number;
  lanes: number;
  hasConflict: boolean;
}

export interface TimelineDay {
  /** `YYYY-MM-DD` w strefie wydarzenia. */
  dayKey: string;
  /** Pierwsza pełna godzina osi (0-23). */
  fromHour: number;
  /** Ostatnia pełna godzina osi, wyłącznie (1-24). */
  toHour: number;
  columns: readonly TimelineColumn[];
  blocks: readonly TimelineBlock[];
  /** Sesje dnia, których nie da się umieścić (brak godzin). */
  undated: readonly { sessionId: string; title: string }[];
}

export interface TimelineInput {
  sessions: readonly EventSessionRow[];
  rooms: readonly EventRoomRow[];
  conflicts: readonly AgendaConflictRow[];
  timezone: string | null | undefined;
  /** `pl` albo `en` - decyduje, którą wersję tytułu pokazuje kafel. */
  lang: "pl" | "en";
}

/** Minuty od północy DANEJ DOBY w strefie wydarzenia (może przekroczyć 1440). */
export function minutesInEventDay(
  iso: string | null | undefined,
  timezone: string | null | undefined,
  dayKey: string,
): number | null {
  if (iso === null || iso === undefined || iso === "") return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: eventTimeZone({ timezone }),
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(date);
  } catch {
    return null;
  }
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const own = `${get("year")}-${get("month")}-${get("day")}`;
  // `hour` bywa oddawane jako „24" o północy - wtedy doba jest już następna.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  const minutes = hour * 60 + minute;
  if (own === dayKey) return minutes;
  // Koniec sesji może wypaść po północy: doliczamy pełne doby różnicy.
  const diffDays = Math.round(
    (Date.parse(`${own}T00:00:00Z`) - Date.parse(`${dayKey}T00:00:00Z`)) / 86_400_000,
  );
  if (Number.isNaN(diffDays)) return null;
  return minutes + diffDays * 1440;
}

function pickTitle(session: EventSessionRow, lang: "pl" | "en"): string {
  const pl = session.title_pl ?? "";
  const en = session.title_en ?? "";
  return lang === "en" ? en || pl : pl || en;
}

function pickTrack(session: EventSessionRow, lang: "pl" | "en"): string {
  const pl = session.track_name_pl ?? "";
  const en = session.track_name_en ?? "";
  return lang === "en" ? en || pl : pl || en;
}

/**
 * Podział zachodzących na siebie kafli na PASY wewnątrz jednej kolumny.
 *
 * Algorytm jest zachłanny po czasie rozpoczęcia: kafel ląduje w pierwszym
 * pasie, który jest już wolny. To daje minimalną liczbę pasów dla przedziałów
 * (kolorowanie grafu interwałowego), więc kolumna nie rozjeżdża się bardziej,
 * niż wymusza to sama agenda.
 */
function assignLanes(blocks: TimelineBlock[]): void {
  const laneEnds: number[] = [];
  const ordered = [...blocks].sort((a, b) => a.startMinute - b.startMinute);
  for (const block of ordered) {
    let lane = laneEnds.findIndex((end) => end <= block.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = block.startMinute + block.spanMinutes;
    block.lane = lane;
  }
  const lanes = Math.max(1, laneEnds.length);
  for (const block of blocks) block.lanes = lanes;
}

/**
 * Dni agendy gotowe do wyrysowania.
 *
 * KOLUMNY LICZĄ SIĘ Z DNIA, nie z pełnej listy sal: sala nieużywana danego dnia
 * dokładałaby pustą kolumnę na każdym ekranie i zwężała te, w których coś się
 * dzieje.
 */
export function buildAgendaTimeline(input: TimelineInput): readonly TimelineDay[] {
  const { sessions, rooms, conflicts, timezone, lang } = input;
  const conflicted = new Set<string>();
  for (const conflict of conflicts) {
    if (typeof conflict.session_id === "string") conflicted.add(conflict.session_id);
  }
  const roomName = new Map<string, EventRoomRow>();
  for (const room of rooms) roomName.set(String(room.id), room);

  const byDay = new Map<string, EventSessionRow[]>();
  const undatedByDay = new Map<string, { sessionId: string; title: string }[]>();
  for (const session of sessions) {
    const dayKey = eventDayKey(session.starts_at, timezone);
    if (dayKey === "") continue;
    const bucket = byDay.get(dayKey) ?? [];
    bucket.push(session);
    byDay.set(dayKey, bucket);
  }

  const days: TimelineDay[] = [];
  for (const dayKey of [...byDay.keys()].sort()) {
    const daySessions = byDay.get(dayKey) ?? [];
    const blocks: TimelineBlock[] = [];
    const usedColumns = new Set<string>();

    for (const session of daySessions) {
      const start = minutesInEventDay(session.starts_at, timezone, dayKey);
      const rawEnd = minutesInEventDay(session.ends_at, timezone, dayKey);
      const title = pickTitle(session, lang);
      if (start === null) {
        const bucket = undatedByDay.get(dayKey) ?? [];
        bucket.push({ sessionId: String(session.id), title });
        undatedByDay.set(dayKey, bucket);
        continue;
      }
      const fallbackEnd = start + Math.max(MIN_BLOCK_MINUTES, session.duration_minutes ?? 0);
      const end = rawEnd === null || rawEnd <= start ? fallbackEnd : rawEnd;
      const columnId =
        typeof session.room_id === "string" && session.room_id !== ""
          ? session.room_id
          : TIMELINE_NO_ROOM;
      usedColumns.add(columnId);
      blocks.push({
        sessionId: String(session.id),
        columnId,
        title,
        startMinute: start,
        endMinute: end,
        spanMinutes: Math.max(MIN_BLOCK_MINUTES, end - start),
        status: session.status ?? "draft",
        trackName: pickTrack(session, lang),
        accentColor:
          typeof session.track_accent_color === "string" && session.track_accent_color !== ""
            ? session.track_accent_color
            : null,
        lane: 0,
        lanes: 1,
        hasConflict: conflicted.has(String(session.id)),
      });
    }

    const columns: TimelineColumn[] = [];
    for (const room of rooms) {
      const id = String(room.id);
      if (!usedColumns.has(id)) continue;
      columns.push({ id, name: room.name ?? id, capacity: room.capacity ?? null });
    }
    // Sale spoza listy (usunięte, ale wciąż wpięte w sesję) nie mogą zniknąć.
    for (const columnId of usedColumns) {
      if (columnId === TIMELINE_NO_ROOM) continue;
      if (columns.some((column) => column.id === columnId)) continue;
      columns.push({
        id: columnId,
        name: roomName.get(columnId)?.name ?? columnId,
        capacity: null,
      });
    }
    if (usedColumns.has(TIMELINE_NO_ROOM)) {
      columns.push({ id: TIMELINE_NO_ROOM, name: "", capacity: null });
    }

    for (const column of columns) {
      assignLanes(blocks.filter((block) => block.columnId === column.id));
    }

    const starts = blocks.map((block) => block.startMinute);
    const ends = blocks.map((block) => block.startMinute + block.spanMinutes);
    const fromHour = starts.length === 0 ? 8 : Math.max(0, Math.floor(Math.min(...starts) / 60));
    const toHour = ends.length === 0 ? 18 : Math.min(48, Math.ceil(Math.max(...ends) / 60));

    days.push({
      dayKey,
      fromHour,
      toHour: Math.max(fromHour + 1, toHour),
      columns,
      blocks,
      undated: undatedByDay.get(dayKey) ?? [],
    });
  }

  return days;
}

/** `540` -> `09:00`. Oś czasu jest techniczna, więc format jest stały. */
export function formatMinuteLabel(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
