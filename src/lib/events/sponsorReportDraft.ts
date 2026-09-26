// Stan formularzy raportu dla sponsorów - czyste funkcje (filtry raportu
// i wersja robocza linku dla sponsora) z walidacją.
//
// FILTRY SĄ NAPISAMI Z FORMULARZA, zapytanie jest typowane. Pusty dzień to
// „bez granicy", `"all"` w selektorze to „bez filtra" - do bazy idzie `null`,
// więc argument wypada z wywołania RPC. Odwrócony zakres zatrzymujemy tutaj,
// zanim baza odpowie `invalid_range`.
//
// WAŻNOŚĆ LINKU TO DZIEŃ, NIE CHWILA. Organizator wybiera „do kiedy", a baza
// dostaje koniec tego dnia (UTC) - przycięty do 180 dni od TERAZ minus minuta,
// bo baza odrzuca `expires_at > now() + 180 days`, a formularz nie wie, ile
// sekund minie do kliknięcia. Zegar jest argumentem (`nowMs`), nie `Date.now()`
// w środku - funkcje zostają czyste i testowalne bez podmiany zegara.
import { isSponsorPlacement } from "@/lib/events/sponsorExposure";
import type { SponsorReportLinkInput, SponsorReportQuery } from "@/lib/events/sponsorReportApi";

export const ALL = "all";

export interface SponsorReportFilters {
  from: string;
  to: string;
  sponsorId: string;
  placement: string;
}

export const EMPTY_SPONSOR_REPORT_FILTERS: SponsorReportFilters = {
  from: "",
  to: "",
  sponsorId: ALL,
  placement: ALL,
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
export const SPONSOR_LINK_MAX_DAYS = 180;
export const SPONSOR_LINK_DEFAULT_DAYS_AFTER_EVENT = 60;

function day(value: string): string | null {
  return DAY_PATTERN.test(value) ? value : null;
}

/** Czy zakres jest odwrócony (oba dni podane i `from` po `to`). */
export function isInvalidRange(filters: SponsorReportFilters): boolean {
  const from = day(filters.from);
  const to = day(filters.to);
  return from !== null && to !== null && from > to;
}

/** Filtry z formularza -> zapytanie RPC (dla odwróconego zakresu - bez dni). */
export function sponsorReportQuery(
  eventId: string,
  filters: SponsorReportFilters,
): SponsorReportQuery {
  const invalid = isInvalidRange(filters);
  return {
    eventId,
    from: invalid ? null : day(filters.from),
    to: invalid ? null : day(filters.to),
    placement: isSponsorPlacement(filters.placement) ? filters.placement : null,
    sponsorId: filters.sponsorId === ALL || filters.sponsorId === "" ? null : filters.sponsorId,
  };
}

export interface SponsorLinkDraft {
  sponsorId: string;
  label: string;
  /** Dzień wygaśnięcia YYYY-MM-DD. */
  expiresOn: string;
  includeLeads: boolean;
}

export type SponsorLinkField = "sponsorId" | "label" | "expiresOn";

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Domyślna wersja robocza: sponsor (jeśli wskazany), pusta etykieta, ważność
 * do 60 dni po końcu wydarzenia - ale najdłużej 180 dni od dziś i nie krócej
 * niż tydzień od dziś (wydarzenie sprzed roku).
 */
export function defaultSponsorLinkDraft(
  sponsorId: string,
  eventEndsAt: string | null,
  nowMs: number,
): SponsorLinkDraft {
  const ends = eventEndsAt === null ? Number.NaN : Date.parse(eventEndsAt);
  const base = Number.isFinite(ends) ? ends : nowMs;
  const target = Math.min(
    Math.max(base + SPONSOR_LINK_DEFAULT_DAYS_AFTER_EVENT * DAY_MS, nowMs + 7 * DAY_MS),
    nowMs + (SPONSOR_LINK_MAX_DAYS - 1) * DAY_MS,
  );
  return { sponsorId, label: "", expiresOn: isoDay(target), includeLeads: false };
}

/** Najwcześniejszy i najpóźniejszy dozwolony dzień wygaśnięcia. */
export function sponsorLinkExpiryBounds(nowMs: number): { min: string; max: string } {
  return {
    min: isoDay(nowMs + DAY_MS),
    max: isoDay(nowMs + (SPONSOR_LINK_MAX_DAYS - 1) * DAY_MS),
  };
}

export function validateSponsorLinkDraft(
  draft: SponsorLinkDraft,
  nowMs: number,
): SponsorLinkField[] {
  const errors: SponsorLinkField[] = [];
  if (draft.sponsorId === "" || draft.sponsorId === ALL) errors.push("sponsorId");
  const label = draft.label.trim().length;
  if (label < 2 || label > 120) errors.push("label");
  const bounds = sponsorLinkExpiryBounds(nowMs);
  const expires = day(draft.expiresOn);
  if (expires === null || expires < bounds.min || expires > bounds.max) errors.push("expiresOn");
  return errors;
}

/** Wersja robocza -> wejście RPC; koniec dnia UTC, przycięty do limitu bazy. */
export function sponsorLinkInput(draft: SponsorLinkDraft, nowMs: number): SponsorReportLinkInput {
  const endOfDay = Date.parse(`${draft.expiresOn}T23:59:59Z`);
  const limit = nowMs + SPONSOR_LINK_MAX_DAYS * DAY_MS - 60_000;
  return {
    sponsorId: draft.sponsorId,
    label: draft.label.trim(),
    expiresAt: new Date(Math.min(endOfDay, limit)).toISOString(),
    includeLeads: draft.includeLeads,
  };
}
