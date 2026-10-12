// Konflikty i odrzucone skany po synchronizacji - reguła czysta plus eksport.
//
// PO CO. Decyzja offline jest TYMCZASOWA: po powrocie sieci baza liczy swój
// wynik i ma prawo się nie zgodzić (zapis anulowany po pobraniu listy, limit
// zajęty przez inne bramki, bilet dopisany po pobraniu listy). Wcześniej
// wynik synchronizacji był wyrzucany, więc rozbieżność była niewidzialna.
// Teraz każda rozbieżność trafia na listę konfliktów, a każda trwała odmowa
// (unieważnione poświadczenie, skan sprzed tygodnia) na listę odrzuconych -
// obie przeżywają zamknięcie karty i dają się oddać organizatorowi w pliku.
//
// DWA RODZAJE KONFLIKTU. `admitted_offline` - urządzenie wpuściło, baza
// odmawia: to jest przypadek, którym organizator musi się zająć (ten sam
// warunek liczy `conflict` w `admin_event_checkins_list`). `denied_offline` -
// urządzenie odmówiło, a baza by wpuściła: człowiek został odesłany od bramki,
// więc operator powinien go odnaleźć (np. w recepcji).
//
// EKSPORT BEZ SERWERA. Plik powstaje w przeglądarce (Blob), bo odrzucone skany
// z definicji NIE dotarły do bazy - nie ma ich skąd pobrać później. Komórki
// przechodzą przez wspólny escaper CSV z neutralizacją formuł.
//
// EKSPORT BEZ JAWNEGO KODU (OPS-06). Plik krąży pocztą, więc nie może nieść
// poświadczeń wejścia: kolumna kodu ma tylko prefiks, a obok stoi skrót
// SHA-256 - ten sam co `qr_token_hash` w bazie, po którym organizator odnajdzie
// zgłoszenie. JSON idzie tą samą drogą (`toRejectedItem`).
import { csvDocument } from "@/lib/crm/csv";
import type { CheckinDirection, OfflineOutcome } from "@/lib/events/onsiteEnums";
import { isCheckinDirection, isOfflineOutcome } from "@/lib/events/onsiteEnums";
import type { CheckinScanResult } from "@/lib/events/scannerApi";
import {
  parseRejectedItem,
  toRejectedItem,
  type OutboxItem,
  type RejectedItem,
  type RejectedScan,
} from "@/lib/events/scannerOutbox";
import { downloadBlob } from "@/lib/files/downloadBlob";

export type ConflictKind = "admitted_offline" | "denied_offline";

export interface ScanConflict {
  /** `client_scan_uid` skanu - klucz, po którym konflikt się nie dubluje. */
  id: string;
  kind: ConflictKind;
  checkinId: string | null;
  checkpointId: string | null;
  direction: CheckinDirection | null;
  deviceScannedAt: string;
  offlineOutcome: OfflineOutcome;
  serverOutcome: string;
  personName: string | null;
  registrationId: string | null;
  detectedAt: string;
}

export const CONFLICTS_CAPACITY = 500;

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Wynik synchronizacji skanu z decyzją offline -> konflikt albo `null`. */
export function detectConflict(
  item: OutboxItem,
  result: CheckinScanResult,
  nowIso: string,
): ScanConflict | null {
  const offlineOutcome = item.offlineOutcome ?? null;
  if (offlineOutcome === null) return null;
  const admittedOffline = item.offlineAdmitted === true;
  // `serverAdmit`, nie `admit`: przy odmowie offline baza zapisuje odmowę
  // bramki (`admit` = false), a o ważnym bilecie mówi właśnie `serverAdmit`.
  if (admittedOffline === result.serverAdmit) return null;
  const name = [result.person?.firstName, result.person?.lastName]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(" ");
  return {
    id: item.id,
    kind: admittedOffline ? "admitted_offline" : "denied_offline",
    checkinId: result.checkinId,
    checkpointId: item.checkpointId,
    direction: item.direction,
    deviceScannedAt: item.deviceScannedAt,
    offlineOutcome,
    serverOutcome: result.outcome,
    personName: name === "" ? null : name,
    registrationId: result.person?.registrationId ?? null,
    detectedAt: nowIso,
  };
}

/** Dopisuje konflikt (bez duplikatu po `id`); przepełnienie zjada najstarsze. */
export function appendConflict(
  list: readonly ScanConflict[],
  conflict: ScanConflict,
): ScanConflict[] {
  const next = [...list.filter((row) => row.id !== conflict.id), conflict];
  return next.length > CONFLICTS_CAPACITY ? next.slice(next.length - CONFLICTS_CAPACITY) : next;
}

/** Rekord z IndexedDB -> konflikty; wiersz niepełny wypada, reszta zostaje. */
export function parseConflicts(value: unknown): ScanConflict[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ScanConflict[] => {
    const row = record(item);
    const id = text(row.id);
    const deviceScannedAt = text(row.deviceScannedAt);
    const serverOutcome = text(row.serverOutcome);
    const detectedAt = text(row.detectedAt);
    const kind = row.kind === "admitted_offline" || row.kind === "denied_offline" ? row.kind : null;
    const offlineOutcome = typeof row.offlineOutcome === "string" ? row.offlineOutcome : "";
    if (id === null || deviceScannedAt === null || serverOutcome === null || detectedAt === null) {
      return [];
    }
    if (kind === null || !isOfflineOutcome(offlineOutcome)) return [];
    const direction = typeof row.direction === "string" ? row.direction : "";
    return [
      {
        id,
        kind,
        checkinId: text(row.checkinId),
        checkpointId: text(row.checkpointId),
        direction: isCheckinDirection(direction) ? direction : null,
        deviceScannedAt,
        offlineOutcome,
        serverOutcome,
        personName: text(row.personName),
        registrationId: text(row.registrationId),
        detectedAt,
      },
    ];
  });
}

/**
 * Rekord z IndexedDB -> odrzucone; pozycja bez identyfikatora albo rodzaju
 * wypada. Jawny kod wpisu sprzed OPS-06 nie przechodzi - zostaje prefiks.
 */
export function parseRejected(value: unknown): RejectedScan[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): RejectedScan[] => {
    const row = record(entry);
    const item = parseRejectedItem(row.item);
    const error = text(row.error);
    const rejectedAt = text(row.rejectedAt);
    if (item === null || error === null || rejectedAt === null) return [];
    return [{ item, error, rejectedAt }];
  });
}

/* --------------------------------------------------------------- eksport --- */

/** Nagłówki kolumn - w języku operatora, podaje je ekran. */
export interface SyncIssuesCsvLabels {
  type: string;
  kind: string;
  scannedAt: string;
  checkpoint: string;
  direction: string;
  offlineOutcome: string;
  serverResult: string;
  person: string;
  registrationId: string;
  /** Kolumna z PREFIKSEM kodu - nigdy z całym kodem. */
  code: string;
  /** Skrót SHA-256 kodu (ten sam co `qr_token_hash` w bazie). */
  codeHash: string;
  reference: string;
  conflict: string;
  rejected: string;
}

/** Prefiks kodu z wielokropkiem - jedyna postać kodu, jaką widzi człowiek i plik. */
export function codeDisplay(item: Pick<RejectedItem, "codePrefix">): string | null {
  const prefix = item.codePrefix ?? null;
  return prefix === null || prefix === "" ? null : `${prefix}…`;
}

export function syncIssuesCsv(
  conflicts: readonly ScanConflict[],
  rejected: readonly RejectedScan[],
  labels: SyncIssuesCsvLabels,
): string {
  const header = [
    labels.type,
    labels.kind,
    labels.scannedAt,
    labels.checkpoint,
    labels.direction,
    labels.offlineOutcome,
    labels.serverResult,
    labels.person,
    labels.registrationId,
    labels.code,
    labels.codeHash,
    labels.reference,
  ];
  const rows = [
    ...conflicts.map((row) => [
      labels.conflict,
      row.kind,
      row.deviceScannedAt,
      row.checkpointId,
      row.direction,
      row.offlineOutcome,
      row.serverOutcome,
      row.personName,
      row.registrationId,
      null,
      null,
      row.checkinId ?? row.id,
    ]),
    ...rejected.map(({ item: raw, error }) => {
      // Obrona na granicy: wpis z pami\u0119ci karty m\u00F3g\u0142 jeszcze nie\u015B\u0107 kod.
      const item = toRejectedItem(raw);
      return [
        labels.rejected,
        item.kind,
        item.deviceScannedAt,
        item.checkpointId,
        item.direction,
        item.offlineOutcome ?? null,
        error,
        null,
        null,
        codeDisplay(item),
        item.codeHash ?? null,
        item.id,
      ];
    }),
  ];
  return `\uFEFF${csvDocument(header, rows)}`;
}

export function syncIssuesJson(
  conflicts: readonly ScanConflict[],
  rejected: readonly RejectedScan[],
  meta: { deviceLabel: string; eventSlug: string | null; exportedAt: string },
): string {
  const safe = rejected.map((entry) => ({ ...entry, item: toRejectedItem(entry.item) }));
  return JSON.stringify({ ...meta, conflicts, rejected: safe }, null, 2);
}

/** Nazwa pliku: `skaner-<wydarzenie>-<dzień>.<rozszerzenie>`. */
export function syncIssuesFileName(
  eventSlug: string | null,
  nowIso: string,
  extension: "csv" | "json",
): string {
  const slug = (eventSlug ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `skaner-${slug === "" ? "wydarzenie" : slug}-${nowIso.slice(0, 10)}.${extension}`;
}

/**
 * Zrzuca plik na dysk urządzenia - jedyny fragment zależny od przeglądarki.
 * Wspólny `downloadBlob` zwalnia adres dopiero po chwili (iOS Safari i Chrome
 * na Androidzie gubią plik, gdy adres znika w tym samym albo następnym takcie).
 */
export function downloadTextFile(fileName: string, mimeType: string, data: string): void {
  downloadBlob(new Blob([data], { type: mimeType }), fileName);
}
