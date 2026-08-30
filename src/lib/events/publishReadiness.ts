// Model GOTOWOŚCI WYDARZENIA DO PUBLIKACJI - czysta funkcja, zero React.
//
// DLACZEGO OSOBNO OD „Następnych kroków" NA PULPICIE. Tamta lista jest
// przewodnikiem po pustym wydarzeniu („dodaj okładkę"), ta odpowiada na jedno
// pytanie w jednym momencie: czy wolno wcisnąć „Opublikuj". Dlatego ma stopnie -
// blokada zatrzymuje publikację, ostrzeżenie tylko mówi, że będzie brzydko.
//
// WARUNKIEM JEST DANA, NIE KLIKNIĘCIE. Nie ma tu pola „potwierdzam, że agenda
// jest gotowa": checklista, którą da się odhaczyć bez zrobienia rzeczy, kłamie.
// Każda pozycja liczy się z wierszy, które i tak są w studiu (sesje, kolizje,
// sale), więc odświeża się razem z nimi.
//
// LICZBY WCHODZĄ DO TŁUMACZENIA, NIE DO KLUCZA. `count` jest osobnym polem, a
// nie częścią `key`, żeby PL/EN mogły odmienić „3 sesje" / „3 sessions" bez
// mnożenia kluczy - i żeby test parytetu widział stały, skończony słownik.
import type { EventStudioSection } from "@/lib/events/eventStudioNav";

/** Stopień pozycji: blokada wstrzymuje publikację, ostrzeżenie nie. */
export const READINESS_SEVERITIES = ["blocker", "warning"] as const;
export type ReadinessSeverity = (typeof READINESS_SEVERITIES)[number];

/** Klucze pozycji - słownik domknięty, bo każdy ma tekst PL i EN. */
export const READINESS_CHECK_KEYS = [
  "title",
  "schedule",
  "timezone",
  "venue",
  "onlineUrl",
  "cover",
  "description",
  "sessions",
  "sessionDrafts",
  "sessionSpeakers",
  "sessionRooms",
  "conflicts",
  "rooms",
  "tickets",
] as const;
export type ReadinessCheckKey = (typeof READINESS_CHECK_KEYS)[number];

export interface ReadinessCheck {
  key: ReadinessCheckKey;
  severity: ReadinessSeverity;
  /** `true` = warunek spełniony; pozycja zostaje na liście jako „zrobione". */
  passed: boolean;
  /** Sekcja studia, w której da się to naprawić. */
  section: EventStudioSection;
  /** Ile rzeczy wymaga uwagi (sesje bez prelegenta, kolizje). */
  count: number;
}

export interface ReadinessReport {
  checks: readonly ReadinessCheck[];
  blockers: readonly ReadinessCheck[];
  warnings: readonly ReadinessCheck[];
  /** Publikacja dozwolona = brak niespełnionych blokad. */
  canPublish: boolean;
  /** Ile pozycji spełnionych z ilu - do paska postępu. */
  passedCount: number;
  totalCount: number;
}

/** Format wydarzenia w zakresie, w jakim wpływa na wymagane dane. */
export type ReadinessFormat = "onsite" | "online" | "hybrid";

export interface ReadinessEvent {
  titlePl: string | null;
  titleEn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  format: string | null;
  city: string | null;
  addressLine: string | null;
  onlineUrl: string | null;
  coverUrl: string | null;
  descriptionPl: string | null;
  descriptionEn: string | null;
  status: string | null;
  registrationMode: string | null;
}

/** Sesja w zakresie potrzebnym checkliście - celowo węższa niż wiersz RPC. */
export interface ReadinessSession {
  status: string | null;
  speakers_count: number | null;
  room_id: string | null;
  format: string | null;
}

export interface ReadinessInput {
  event: ReadinessEvent;
  sessions: readonly ReadinessSession[];
  conflictCount: number;
  roomCount: number;
  ticketTypeCount: number;
}

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function readinessFormat(format: string | null): ReadinessFormat {
  return format === "online" || format === "hybrid" ? format : "onsite";
}

function check(
  key: ReadinessCheckKey,
  severity: ReadinessSeverity,
  section: EventStudioSection,
  passed: boolean,
  count = 0,
): ReadinessCheck {
  return { key, severity, section, passed, count };
}

/**
 * Liczy raport gotowości. Funkcja jest czysta i deterministyczna - te same
 * wiersze dają ten sam raport, także po stronie testu.
 */
export function buildPublishReadiness(input: ReadinessInput): ReadinessReport {
  const { event, sessions, conflictCount, roomCount, ticketTypeCount } = input;
  const format = readinessFormat(event.format);
  const onsite = format !== "online";
  const online = format !== "onsite";

  const startsAt = event.startsAt ? Date.parse(event.startsAt) : Number.NaN;
  const endsAt = event.endsAt ? Date.parse(event.endsAt) : Number.NaN;
  const scheduleOk = Number.isFinite(startsAt) && (!Number.isFinite(endsAt) || endsAt > startsAt);

  const liveSessions = sessions.filter((session) => session.status !== "cancelled");
  const draftSessions = liveSessions.filter((session) => session.status !== "published");
  const withoutSpeakers = liveSessions.filter((session) => (session.speakers_count ?? 0) === 0);
  const withoutRoom = liveSessions.filter(
    (session) => session.format !== "online" && !filled(session.room_id),
  );

  const checks: readonly ReadinessCheck[] = [
    check("title", "blocker", "general", filled(event.titlePl) && filled(event.titleEn)),
    check("schedule", "blocker", "general", scheduleOk),
    check("timezone", "blocker", "general", filled(event.timezone)),
    check(
      "venue",
      "blocker",
      "general",
      !onsite || (filled(event.city) && filled(event.addressLine)),
    ),
    check("onlineUrl", "warning", "general", !online || filled(event.onlineUrl)),
    check("cover", "blocker", "branding", filled(event.coverUrl)),
    check(
      "description",
      "warning",
      "general",
      filled(event.descriptionPl) && filled(event.descriptionEn),
    ),
    check("sessions", "warning", "contentTracks", liveSessions.length > 0, liveSessions.length),
    check(
      "sessionDrafts",
      "warning",
      "contentTracks",
      draftSessions.length === 0,
      draftSessions.length,
    ),
    check(
      "sessionSpeakers",
      "warning",
      "contentSpeakers",
      withoutSpeakers.length === 0,
      withoutSpeakers.length,
    ),
    check("sessionRooms", "warning", "contentRooms", withoutRoom.length === 0, withoutRoom.length),
    check("conflicts", "blocker", "contentConflicts", conflictCount === 0, conflictCount),
    check("rooms", "warning", "contentRooms", !onsite || roomCount > 0, roomCount),
    check(
      "tickets",
      "warning",
      "registrationTickets",
      event.registrationMode !== "paid" || ticketTypeCount > 0,
      ticketTypeCount,
    ),
  ];

  const failed = checks.filter((item) => !item.passed);
  const blockers = failed.filter((item) => item.severity === "blocker");
  const warnings = failed.filter((item) => item.severity === "warning");

  return {
    checks,
    blockers,
    warnings,
    canPublish: blockers.length === 0,
    passedCount: checks.length - failed.length,
    totalCount: checks.length,
  };
}
