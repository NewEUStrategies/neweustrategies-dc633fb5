// Model KATALOGU UCZESTNIKÓW giełdy spotkań (RPC `event_meeting_directory`).
//
// TA LISTA ISTNIEJE PO TO, ŻEBY DAŁO SIĘ ZAPROSIĆ KOGOŚ NOWEGO.
// `event_meeting_invite` przyjmuje `counterpart_registration_id`, a plaszczyzna
// uczestnika nie miała skąd go wziąć - można było przełożyć rozmowę z kimś,
// kogo się już zna, i nie można było zacząć żadnej nowej.
//
// BLOKADY SĄ STOPNIOWANE, NIE BINARNE. Każdy powód ma inne następne działanie:
// „giełda wyłączona" znaczy czekaj, „nie jesteś zapisany" znaczy zapisz się,
// „twoja grupa nie widzi listy" znaczy napisz do organizatora. Jeden komunikat
// „brak dostępu" kasowałby tę różnicę.
//
// STAN ROZMOWY ZMIENIA PRZYCISK. Kto ma z nami żywe zaproszenie albo przyjęte
// spotkanie, nie dostaje „Zaproś" - dostaje odnośnik do terminarza. Bez tego
// uczestnik wysyłałby drugie zaproszenie do tej samej osoby i dostawał odmowę
// z bazy.
import type { Json } from "@/integrations/supabase/types";

/** Powody, dla których katalog nie ma czego pokazać. */
export const DIRECTORY_BLOCKS = [
  "meetings_disabled",
  "exchange_rule_closed",
  "requester_not_participating",
  "directory_hidden",
] as const;
export type DirectoryBlock = (typeof DIRECTORY_BLOCKS)[number];

/** Zakres widoczności wyliczony z grup wolającego. */
export const DIRECTORY_SCOPES = ["none", "own_group", "registered", "everyone"] as const;
export type DirectoryScope = (typeof DIRECTORY_SCOPES)[number];

export interface DirectoryGroup {
  id: string;
  namePl: string | null;
  nameEn: string | null;
  color: string | null;
}

export interface DirectoryEntry {
  registrationId: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  company: string | null;
  groups: DirectoryGroup[];
  /** Czy ta osoba zgłosiła choć jedno otwarte okno dostępności. */
  hasAvailability: boolean;
  /** `invited` albo `accepted`, gdy coś już nas łączy; inaczej `null`. */
  meetingStatus: "invited" | "accepted" | null;
}

export interface MeetingDirectory {
  blocked: DirectoryBlock | null;
  scope: DirectoryScope;
  myRegistrationId: string | null;
  /** Uczestnik wypisał się z katalogu - jego własna decyzja, nie organizatora. */
  optedOut: boolean;
  totalCount: number;
  rows: DirectoryEntry[];
  /** Grupy, które w ogóle mogą się umawiać - do filtra listy. */
  groups: DirectoryGroup[];
}

export const EMPTY_DIRECTORY: MeetingDirectory = {
  blocked: null,
  scope: "none",
  myRegistrationId: null,
  optedOut: false,
  totalCount: 0,
  rows: [],
  groups: [],
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseGroups(value: unknown): DirectoryGroup[] {
  if (!Array.isArray(value)) return [];
  const out: DirectoryGroup[] = [];
  for (const item of value) {
    const row = record(item);
    const id = text(row.id);
    if (id === null) continue;
    out.push({
      id,
      namePl: text(row.name_pl),
      nameEn: text(row.name_en),
      color: text(row.color),
    });
  }
  return out;
}

function blockOf(value: unknown): DirectoryBlock | null {
  const raw = text(value);
  return raw !== null && (DIRECTORY_BLOCKS as readonly string[]).includes(raw)
    ? (raw as DirectoryBlock)
    : null;
}

function scopeOf(value: unknown): DirectoryScope {
  const raw = text(value);
  return raw !== null && (DIRECTORY_SCOPES as readonly string[]).includes(raw)
    ? (raw as DirectoryScope)
    : "none";
}

export function parseMeetingDirectory(value: Json | null): MeetingDirectory {
  const row = record(value);
  const rows = Array.isArray(row.rows) ? row.rows : [];
  return {
    blocked: blockOf(row.blocked),
    scope: scopeOf(row.scope),
    myRegistrationId: text(row.my_registration_id),
    optedOut: row.directory_opt_out === true,
    totalCount:
      typeof row.total_count === "number" && Number.isFinite(row.total_count)
        ? Math.trunc(row.total_count)
        : 0,
    groups: parseGroups(row.groups),
    rows: rows.flatMap((item): DirectoryEntry[] => {
      const entry = record(item);
      const registrationId = text(entry.registration_id);
      if (registrationId === null) return [];
      const status = text(entry.meeting_status);
      return [
        {
          registrationId,
          firstName: text(entry.first_name) ?? "",
          lastName: text(entry.last_name) ?? "",
          jobTitle: text(entry.job_title),
          company: text(entry.company),
          groups: parseGroups(entry.groups),
          hasAvailability: entry.has_availability === true,
          meetingStatus: status === "invited" || status === "accepted" ? status : null,
        },
      ];
    }),
  };
}

/** `Imię Nazwisko` albo pusty napis - etykietę składa jeden rachunek. */
export function directoryEntryName(entry: DirectoryEntry): string {
  return [entry.firstName, entry.lastName].filter((part) => part.trim() !== "").join(" ");
}

/** Drugi wiersz karty: stanowisko i firma, bez pustych separatorów. */
export function directoryEntrySubtitle(entry: DirectoryEntry): string {
  return [entry.jobTitle, entry.company]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(" · ");
}

/** Klucz i18n powodu blokady - jeden na powód, bez składania zdań w JSX. */
export function directoryBlockKey(block: DirectoryBlock): string {
  const camel = block.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
  return `eventMeetings.participant.directory.blocks.${camel}`;
}
