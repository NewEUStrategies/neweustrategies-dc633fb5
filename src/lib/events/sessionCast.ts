// OBSADA SESJI w panelu - czysta warstwa edytora obsady (`SessionSpeakersEditor`).
//
// SKAD DANE. Obsada przychodzi z `admin_event_session_detail(...).speakers`
// (od 20260924140000 takze osoby BEZ konta - wczesniej JOIN po `profiles`
// gubil je bez bledu), a kandydaci z rejestru prelegentow wydarzenia
// (`admin_event_speakers_list`). Zapis to podmiana CALEJ obsady
// (`admin_event_session_speakers_set`), wiec edytor trzyma stan docelowy.
//
// SCIEZKA NIE JEST TU POLEM. Przypisanie do sesji w sciezce samo dopisuje
// prelegentowi te sciezke (karta prelegenta, program, obsada pasma) - edytor
// o niej tylko informuje.
import type { EventSpeakerEntry } from "@/lib/admin/community";
import {
  SESSION_SPEAKER_ROLES,
  type SessionSpeakerInput,
  type SessionSpeakerRole,
} from "@/lib/events/sessionsApi";

export interface SessionCastMember {
  speakerProfileId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Linia roli po polsku: naglowek sceniczny PL, a w jego braku stanowisko. */
  jobTitle: string | null;
  /** To samo po angielsku - panel w EN nie moze pokazywac polskiego naglowka. */
  jobTitleEn: string | null;
  /** Nakladka niepubliczna nie wchodzi do publicznego programu. */
  isPublic: boolean;
  role: SessionSpeakerRole;
  allowOverlap: boolean;
}

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

export function sessionSpeakerRole(value: unknown): SessionSpeakerRole {
  return (SESSION_SPEAKER_ROLES as readonly unknown[]).includes(value)
    ? (value as SessionSpeakerRole)
    : "speaker";
}

/** `speakers jsonb` szczegolu sesji -> obsada w kolejnosci z bazy. */
export function parseSessionCast(raw: unknown): SessionCastMember[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: { member: SessionCastMember; sortOrder: number }[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = textOrNull(row.speaker_profile_id);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    const sort = typeof row.sort_order === "number" ? row.sort_order : Number(row.sort_order);
    out.push({
      member: {
        speakerProfileId: id,
        displayName: textOrNull(row.display_name) ?? "",
        avatarUrl: textOrNull(row.avatar_url),
        jobTitle: textOrNull(row.headline_pl) ?? textOrNull(row.job_title),
        jobTitleEn: textOrNull(row.headline_en) ?? textOrNull(row.job_title),
        isPublic: row.is_public !== false,
        role: sessionSpeakerRole(row.role),
        allowOverlap: row.allow_overlap === true,
      },
      sortOrder: Number.isFinite(sort) ? sort : 0,
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder).map((entry) => entry.member);
}

/** Wpis rejestru prelegentow -> nowy czlonek obsady (rola domyslna: prelegent). */
export function castMemberFromEntry(entry: EventSpeakerEntry): SessionCastMember {
  return {
    speakerProfileId: entry.speaker_profile_id,
    displayName: entry.display_name ?? "",
    avatarUrl: entry.avatar_url,
    jobTitle: textOrNull(entry.headline_pl) ?? textOrNull(entry.job_title),
    jobTitleEn: textOrNull(entry.headline_en) ?? textOrNull(entry.job_title),
    isPublic: entry.is_public,
    role: "speaker",
    allowOverlap: false,
  };
}

/** Linia roli w jezyku panelu. */
export function sessionCastRoleLine(member: SessionCastMember, lang: "pl" | "en"): string | null {
  return lang === "en" ? member.jobTitleEn : member.jobTitle;
}

/**
 * Kandydaci do obsady: prelegenci wydarzenia z nakladka sceniczna, ktorych
 * jeszcze w obsadzie nie ma. Rzad legacy bez nakladki (`speaker_profile_id`
 * pusty) nie moze stanac w sesji - baza przyjmuje wylacznie nakladke.
 */
export function castCandidates(
  entries: readonly EventSpeakerEntry[] | undefined,
  cast: readonly SessionCastMember[],
): EventSpeakerEntry[] {
  const taken = new Set(cast.map((member) => member.speakerProfileId));
  return (entries ?? []).filter(
    (entry) => entry.speaker_profile_id !== "" && !taken.has(entry.speaker_profile_id),
  );
}

/**
 * Stan docelowy do zapisu. Kolejnosc = pozycja na liscie (co 10, jak domyslna
 * numeracja RPC), wiec przestawienie w edytorze jest przestawieniem w programie.
 */
export function sessionCastToInput(cast: readonly SessionCastMember[]): SessionSpeakerInput[] {
  return cast.map((member, index) => ({
    speakerProfileId: member.speakerProfileId,
    role: member.role,
    sortOrder: (index + 1) * 10,
    allowOverlap: member.allowOverlap,
  }));
}

/** Podpis obsady do porownania „czy sa niezapisane zmiany". */
export function sessionCastSignature(cast: readonly SessionCastMember[]): string {
  return cast.map((member) => `${member.speakerProfileId}:${member.role}`).join("|");
}

/** Przestawienie o jedna pozycje; indeks poza lista = bez zmian. */
export function moveCastMember(
  cast: readonly SessionCastMember[],
  index: number,
  direction: -1 | 1,
): SessionCastMember[] {
  const target = index + direction;
  if (index < 0 || index >= cast.length || target < 0 || target >= cast.length) {
    return [...cast];
  }
  const next = [...cast];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
