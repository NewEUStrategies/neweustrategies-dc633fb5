// Reguly PREZENTACJI wiersza spotkania uczestnika - czysta logika, bez React-a.
//
// DLACZEGO NIE W KOMPONENCIE. "Czy pokazac przyciski Przyjmij/Odrzuc" to nie
// styl, to uprawnienie: RPC `event_meeting_respond` przyjmuje odpowiedz tylko
// od ZAPROSZONEJ strony, tylko dla stanu `invited` i tylko przed wygasnieciem.
// Warunek wpisany w JSX rozjezdza sie z baza po pierwszej zmianie i objawia sie
// przyciskiem, ktory zawsze konczy sie bledem. Tutaj da sie go przetestowac.
//
// `is_expired` LICZY BAZA. Zaproszenie wygasa wedlug `expires_at` w strefie
// serwera; porownanie z `Date.now()` w przegladarce z przesunietym zegarem
// pokazywaloby aktywne zaproszenia jako martwe (albo odwrotnie).
import type { MyMeetingRow } from "@/lib/events/meetingsApi";

/** Stany, w ktorych spotkanie jest jeszcze "w grze" - reszta to archiwum. */
const ACTIVE_STATUSES = new Set(["invited", "accepted"]);

export function isIncoming(row: MyMeetingRow): boolean {
  return row.side === "invitee";
}

/** Odpowiedziec moze WYLACZNIE zaproszony, na otwarte i niewygasle zaproszenie. */
export function canRespond(row: MyMeetingRow): boolean {
  return isIncoming(row) && row.status === "invited" && row.is_expired !== true;
}

/** Odwolac moze kazda strona, ale tylko spotkanie zywe (zaproszenie lub potwierdzone). */
export function canCancel(row: MyMeetingRow): boolean {
  return ACTIVE_STATUSES.has(row.status) && row.is_expired !== true;
}

/** Przelozyc da sie to samo, co odwolac - RPC wymaga stanu `invited`/`accepted`. */
export function canReschedule(row: MyMeetingRow): boolean {
  return canCancel(row);
}

/** Klucz i18n statusu; wygasle zaproszenie ma WLASNY komunikat, nie "wyslane". */
export function meetingStatusI18nKey(row: MyMeetingRow): string {
  if (row.status === "invited" && row.is_expired === true) {
    return "eventMeetings.status.expired";
  }
  return `eventMeetings.status.${row.status}`;
}

export function meetingStatusTone(row: MyMeetingRow): "default" | "secondary" | "destructive" {
  if (row.status === "accepted" || row.status === "held") return "default";
  if (row.status === "declined" || row.status === "no_show") return "destructive";
  return "secondary";
}

/**
 * Podpis rozmowcy. Brak nazwiska nie moze dac napisu "undefined undefined" ani
 * pustego wiersza - w takim wypadku zostaje stanowisko/firma, a na koncu
 * przekazany napis awaryjny.
 */
export function counterpartLabel(row: MyMeetingRow, fallback: string): string {
  const name = [row.counterpart_first_name, row.counterpart_last_name]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join(" ");
  if (name.length > 0) return name;
  const company = typeof row.counterpart_company === "string" ? row.counterpart_company.trim() : "";
  if (company.length > 0) return company;
  return fallback;
}

/** Druga linia karty: stanowisko i firma, sklejone tylko gdy oba istnieja. */
export function counterpartRole(row: MyMeetingRow): string | null {
  const parts = [row.counterpart_job_title, row.counterpart_company]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Opis stolika; `null` znaczy "stolik jeszcze nieprzydzielony", nie "brak stolika". */
export function tableLabel(row: MyMeetingRow): string | null {
  const label = typeof row.table_label === "string" ? row.table_label.trim() : "";
  if (label.length === 0) return null;
  const zone = typeof row.table_zone === "string" ? row.table_zone.trim() : "";
  return zone.length > 0 ? `${label} · ${zone}` : label;
}

export interface MeetingBuckets {
  incoming: MyMeetingRow[];
  outgoing: MyMeetingRow[];
  archive: MyMeetingRow[];
}

/**
 * Rozdzial na trzy kolejki. Spotkanie POTWIERDZONE trafia do obu stron tak samo
 * (do `incoming` albo `outgoing` wedlug tego, kto zaprosil), bo dla uczestnika
 * liczy sie termin, nie kierunek. Do archiwum ida stany zamkniete oraz
 * zaproszenia wygasle - inaczej wygasly wiersz siedzialby na gorze listy
 * z przyciskami, ktore baza odrzuci.
 */
export function bucketMeetings(rows: readonly MyMeetingRow[]): MeetingBuckets {
  const buckets: MeetingBuckets = { incoming: [], outgoing: [], archive: [] };
  for (const row of rows) {
    if (!ACTIVE_STATUSES.has(row.status) || row.is_expired === true) {
      buckets.archive.push(row);
      continue;
    }
    if (isIncoming(row)) buckets.incoming.push(row);
    else buckets.outgoing.push(row);
  }
  return buckets;
}
