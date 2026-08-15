// Czysta logika widgetu event-schedule: parsowanie tresci widgetu (JSON z
// buildera) do silnie typowanego modelu agendy + formatowanie dat/godzin.
// Zero React/IO - modul jest unit-testowalny i wspoldzielony przez widok,
// edytor i rejestr prefetchu (zbieranie user_id prelegentow do zapytania).
import type { WidgetContent } from "@/lib/builder/types";
import { uiLocale } from "@/lib/i18n/format";

export type Lang = "pl" | "en";

/** Prelegent sesji: wpis reczny (name/role/photo) lub referencja do profilu
 *  (userId -> speaker_profiles/profiles przez RPC get_public_speakers). */
export interface ScheduleSpeakerRef {
  id: string;
  userId: string;
  name: string;
  role_pl: string;
  role_en: string;
  photo: string;
}

export interface ScheduleSponsor {
  id: string;
  name: string;
  logo: string;
  url: string;
}

type ScheduleSessionKind = "session" | "break";

export interface ScheduleSession {
  id: string;
  timeStart: string;
  timeEnd: string;
  kind: ScheduleSessionKind;
  title_pl: string;
  title_en: string;
  description_pl: string;
  description_en: string;
  room: string;
  href: string;
  speakers: ScheduleSpeakerRef[];
  sponsors: ScheduleSponsor[];
}

export interface ScheduleDay {
  id: string;
  label_pl: string;
  label_en: string;
  /** Data dnia w formacie ISO (yyyy-mm-dd); pusta = bez daty. */
  date: string;
  sessions: ScheduleSession[];
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseSpeaker(raw: unknown, index: number): ScheduleSpeakerRef | null {
  if (!isRecord(raw)) return null;
  const speaker: ScheduleSpeakerRef = {
    id: strOf(raw.id) || `sp-${index}`,
    userId: strOf(raw.userId),
    name: strOf(raw.name),
    role_pl: strOf(raw.role_pl),
    role_en: strOf(raw.role_en),
    photo: strOf(raw.photo),
  };
  if (!speaker.userId && !speaker.name) return null;
  return speaker;
}

function parseSponsor(raw: unknown, index: number): ScheduleSponsor | null {
  if (!isRecord(raw)) return null;
  const sponsor: ScheduleSponsor = {
    id: strOf(raw.id) || `spn-${index}`,
    name: strOf(raw.name),
    logo: strOf(raw.logo),
    url: strOf(raw.url),
  };
  if (!sponsor.name && !sponsor.logo) return null;
  return sponsor;
}

function parseSession(raw: unknown, index: number): ScheduleSession | null {
  if (!isRecord(raw)) return null;
  const kindRaw = strOf(raw.kind);
  const speakersRaw = Array.isArray(raw.speakers) ? raw.speakers : [];
  const sponsorsRaw = Array.isArray(raw.sponsors) ? raw.sponsors : [];
  return {
    id: strOf(raw.id) || `ses-${index}`,
    timeStart: strOf(raw.timeStart),
    timeEnd: strOf(raw.timeEnd),
    kind: kindRaw === "break" ? "break" : "session",
    title_pl: strOf(raw.title_pl),
    title_en: strOf(raw.title_en),
    description_pl: strOf(raw.description_pl),
    description_en: strOf(raw.description_en),
    room: strOf(raw.room),
    href: strOf(raw.href),
    speakers: speakersRaw
      .map((s, i) => parseSpeaker(s, i))
      .filter((s): s is ScheduleSpeakerRef => s !== null),
    sponsors: sponsorsRaw
      .map((s, i) => parseSponsor(s, i))
      .filter((s): s is ScheduleSponsor => s !== null),
  };
}

/** Parsuje `content.days` do typowanego modelu; odporne na braki/smieci
 *  (uszkodzone wpisy sa pomijane, nie wysypuja renderu). Kolejnosc sesji =
 *  kolejnosc autorska z edytora (bez auto-sortu po godzinie). */
export function parseScheduleDays(c: WidgetContent): ScheduleDay[] {
  const daysRaw = Array.isArray(c.days) ? c.days : [];
  const out: ScheduleDay[] = [];
  for (let i = 0; i < daysRaw.length; i += 1) {
    const raw = daysRaw[i];
    if (!isRecord(raw)) continue;
    const sessionsRaw = Array.isArray(raw.sessions) ? raw.sessions : [];
    out.push({
      id: strOf(raw.id) || `day-${i + 1}`,
      label_pl: strOf(raw.label_pl),
      label_en: strOf(raw.label_en),
      date: strOf(raw.date),
      sessions: sessionsRaw
        .map((s, j) => parseSession(s, j))
        .filter((s): s is ScheduleSession => s !== null),
    });
  }
  return out;
}

/** user_id wszystkich prelegentow-profili w agendzie (do jednego zapytania
 *  RPC i do rejestru prefetchu SSR). Zdeduplikowane, w kolejnosci wystapien. */
export function collectProfileSpeakerIds(days: ScheduleDay[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const day of days) {
    for (const session of day.sessions) {
      for (const speaker of session.speakers) {
        if (!speaker.userId || seen.has(speaker.userId)) continue;
        seen.add(speaker.userId);
        out.push(speaker.userId);
      }
    }
  }
  return out;
}

/** Etykieta i18n dnia z fallbackiem PL -> EN (i odwrotnie). */
export function dayLabel(day: ScheduleDay, lang: Lang): string {
  const primary = lang === "pl" ? day.label_pl : day.label_en;
  return primary || day.label_pl || day.label_en;
}

/** "09:00 - 10:30" (celowo dywiz, nie polpauza) lub sama godzina startu. */
export function formatTimeRange(timeStart: string, timeEnd: string): string {
  const start = timeStart.trim();
  const end = timeEnd.trim();
  if (!start && !end) return "";
  if (start && end) return `${start} - ${end}`;
  return start || end;
}

/** Data dnia w lokalnym formacie ("sroda, 12 pazdziernika" / "Wednesday,
 *  October 12th"-owate wg locale). Pusta/nieparsowalna data => "". */
export function formatDayDate(date: string, lang: Lang): string {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(uiLocale(lang), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
