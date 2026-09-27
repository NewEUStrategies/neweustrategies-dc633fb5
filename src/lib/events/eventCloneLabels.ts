// Etykiety KLONU EDYCJI: mapy `wartosc z bazy -> PELNY klucz i18n`.
//
// DLACZEGO MAPY, A NIE KLUCZE SKLEJANE Z SZABLONU. Bramki i18n (`eventsI18nKeys`,
// `check:i18n-overlay-imports`) widza wylacznie literaly. Klucz zbudowany
// z `\`adminEventClone.warnings.${code}\`` przechodzi przez kazda z nich, a pusty
// wpis w slowniku wychodzi dopiero na ekranie. Tutaj kazdy klucz jest literalem
// w korzeniu `adminEventClone` (wpisanym do `REFERENCE_PREFIXES`), wiec brak
// tlumaczenia czerwieni bramke.
//
// NIEZNANY KOD NIE ZNIKA. Ostrzezenie albo blokada o kodzie, ktorego ten bundle
// nie zna (nowszy backend), dostaje zdanie ogolne z liczba - organizator widzi,
// ze cos jest do sprawdzenia, zamiast nie widziec nic.
import type { CloneFlagKey, CloneIncludeKey, CloneNotice } from "@/lib/events/eventCloneApi";

export const CLONE_INCLUDE_LABEL_KEYS: Record<CloneIncludeKey, string> = {
  agenda: "adminEventClone.include.labels.agenda",
  speakers: "adminEventClone.include.labels.speakers",
  registration: "adminEventClone.include.labels.registration",
  tickets: "adminEventClone.include.labels.tickets",
  sponsors: "adminEventClone.include.labels.sponsors",
  sponsorMaterials: "adminEventClone.include.labels.sponsorMaterials",
  homeAds: "adminEventClone.include.labels.homeAds",
  pages: "adminEventClone.include.labels.pages",
  onsite: "adminEventClone.include.labels.onsite",
  meetings: "adminEventClone.include.labels.meetings",
  cfp: "adminEventClone.include.labels.cfp",
  seating: "adminEventClone.include.labels.seating",
  adCampaigns: "adminEventClone.include.labels.adCampaigns",
  codes: "adminEventClone.include.labels.codes",
};

export const CLONE_INCLUDE_HINT_KEYS: Record<CloneIncludeKey, string> = {
  agenda: "adminEventClone.include.hints.agenda",
  speakers: "adminEventClone.include.hints.speakers",
  registration: "adminEventClone.include.hints.registration",
  tickets: "adminEventClone.include.hints.tickets",
  sponsors: "adminEventClone.include.hints.sponsors",
  sponsorMaterials: "adminEventClone.include.hints.sponsorMaterials",
  homeAds: "adminEventClone.include.hints.homeAds",
  pages: "adminEventClone.include.hints.pages",
  onsite: "adminEventClone.include.hints.onsite",
  meetings: "adminEventClone.include.hints.meetings",
  cfp: "adminEventClone.include.hints.cfp",
  seating: "adminEventClone.include.hints.seating",
  adCampaigns: "adminEventClone.include.hints.adCampaigns",
  codes: "adminEventClone.include.hints.codes",
};

/** Liczniki zrodla (klucze `counts` podgladu) pokazywane przy przelaczniku. */
export const CLONE_INCLUDE_COUNT_KEYS: Record<CloneIncludeKey, readonly string[]> = {
  agenda: ["rooms", "tracks", "sessions"],
  speakers: ["speakers", "session_speakers"],
  registration: ["fields", "terms"],
  tickets: ["ticket_types", "packages"],
  sponsors: ["sponsors", "sponsor_contacts"],
  sponsorMaterials: ["sponsor_materials"],
  homeAds: ["home_ads"],
  pages: ["pages", "page_sections"],
  onsite: ["checkpoints", "badge_templates"],
  meetings: ["meeting_tables"],
  cfp: ["cfp_fields", "cfp_reviewers"],
  seating: ["seat_maps", "seats"],
  adCampaigns: ["ad_campaigns"],
  codes: ["codes"],
};

/** Opcje pokazywane w sekcji "Opcje kopiowania" (dwie opcje CRM maja wlasna sekcje). */
export const CLONE_OPTION_FLAGS = [
  "includeCancelledSessions",
  "sessionsAsDraft",
  "sponsorsUnpublished",
  "keepAccessCodes",
  "cfpReviewers",
] as const satisfies readonly CloneFlagKey[];
export type CloneOptionFlag = (typeof CLONE_OPTION_FLAGS)[number];

/**
 * Sekcja, bez ktorej opcja nie ma znaczenia - formularz chowa opcje wylaczonej
 * sekcji (np. "sesje jako szkice" bez kopiowania agendy), zamiast pokazywac
 * przelacznik, ktory niczego nie zmieni.
 */
export const CLONE_OPTION_REQUIRES: Record<CloneOptionFlag, CloneIncludeKey> = {
  includeCancelledSessions: "agenda",
  sessionsAsDraft: "agenda",
  sponsorsUnpublished: "sponsors",
  keepAccessCodes: "tickets",
  cfpReviewers: "cfp",
};

export const CLONE_OPTION_LABEL_KEYS: Record<CloneOptionFlag, string> = {
  includeCancelledSessions: "adminEventClone.options.labels.includeCancelledSessions",
  sessionsAsDraft: "adminEventClone.options.labels.sessionsAsDraft",
  sponsorsUnpublished: "adminEventClone.options.labels.sponsorsUnpublished",
  keepAccessCodes: "adminEventClone.options.labels.keepAccessCodes",
  cfpReviewers: "adminEventClone.options.labels.cfpReviewers",
};

export const CLONE_OPTION_HINT_KEYS: Record<CloneOptionFlag, string> = {
  includeCancelledSessions: "adminEventClone.options.hints.includeCancelledSessions",
  sessionsAsDraft: "adminEventClone.options.hints.sessionsAsDraft",
  sponsorsUnpublished: "adminEventClone.options.hints.sponsorsUnpublished",
  keepAccessCodes: "adminEventClone.options.hints.keepAccessCodes",
  cfpReviewers: "adminEventClone.options.hints.cfpReviewers",
};

/**
 * Rzeczowniki licznikow z bazy (`counts`, `copied`, `skipped`, `not_copied`),
 * w kolejnosci wyswietlania. Klucz spoza mapy nie jest rysowany - kolejnosc
 * i komplet etykiet sa decyzja interfejsu, nie przypadkiem kolejnosci `jsonb`.
 */
export const CLONE_ITEM_LABEL_KEYS: Record<string, string> = {
  groups: "adminEventClone.items.groups",
  participant_settings: "adminEventClone.items.participantSettings",
  rooms: "adminEventClone.items.rooms",
  tracks: "adminEventClone.items.tracks",
  sessions: "adminEventClone.items.sessions",
  cancelled_sessions: "adminEventClone.items.cancelledSessions",
  session_speakers: "adminEventClone.items.sessionSpeakers",
  speakers: "adminEventClone.items.speakers",
  legacy_speakers: "adminEventClone.items.legacySpeakers",
  ticket_types: "adminEventClone.items.ticketTypes",
  packages: "adminEventClone.items.packages",
  fields: "adminEventClone.items.fields",
  terms: "adminEventClone.items.terms",
  sponsor_tiers: "adminEventClone.items.sponsorTiers",
  sponsor_benefits: "adminEventClone.items.sponsorBenefits",
  sponsors: "adminEventClone.items.sponsors",
  sponsor_snapshots_refreshed: "adminEventClone.items.sponsorSnapshotsRefreshed",
  sponsor_contacts: "adminEventClone.items.sponsorContacts",
  sponsor_materials: "adminEventClone.items.sponsorMaterials",
  home_ads: "adminEventClone.items.homeAds",
  pages: "adminEventClone.items.pages",
  module_pages: "adminEventClone.items.modulePages",
  page_links: "adminEventClone.items.pageLinks",
  page_sections: "adminEventClone.items.pageSections",
  checkpoints: "adminEventClone.items.checkpoints",
  badge_templates: "adminEventClone.items.badgeTemplates",
  meeting_settings: "adminEventClone.items.meetingSettings",
  meeting_tables: "adminEventClone.items.meetingTables",
  meeting_rules: "adminEventClone.items.meetingRules",
  codes: "adminEventClone.items.codes",
  cfp_settings: "adminEventClone.items.cfpSettings",
  cfp_fields: "adminEventClone.items.cfpFields",
  cfp_reviewers: "adminEventClone.items.cfpReviewers",
  seat_categories: "adminEventClone.items.seatCategories",
  seat_category_tickets: "adminEventClone.items.seatCategoryTickets",
  seat_maps: "adminEventClone.items.seatMaps",
  seat_sections: "adminEventClone.items.seatSections",
  seats: "adminEventClone.items.seats",
  ad_campaigns: "adminEventClone.items.adCampaigns",
  crm_tasks: "adminEventClone.items.crmTasks",
  crm_timeline_entries: "adminEventClone.items.crmTimelineEntries",
  registrations: "adminEventClone.items.registrations",
  package_orders: "adminEventClone.items.packageOrders",
  checkins: "adminEventClone.items.checkins",
  lead_scans: "adminEventClone.items.leadScans",
  meetings: "adminEventClone.items.meetings",
  scanner_devices: "adminEventClone.items.scannerDevices",
  cfp_submissions: "adminEventClone.items.cfpSubmissions",
  seat_assignments: "adminEventClone.items.seatAssignments",
  invoices: "adminEventClone.items.invoices",
  session_saves: "adminEventClone.items.sessionSaves",
  session_signups: "adminEventClone.items.sessionSignups",
  wallet_passes: "adminEventClone.items.walletPasses",
};

export interface CloneItemEntry {
  /** Klucz z bazy - stabilny `key` w liscie Reacta. */
  id: string;
  labelKey: string;
  count: number;
}

/**
 * Niezerowe liczniki w kolejnosci `CLONE_ITEM_LABEL_KEYS` (albo podanej
 * listy). Zero nie jest pozycja - lista "skopiowane: sale 0" niczego nie mowi.
 */
export function cloneItemEntries(
  values: Record<string, number>,
  only?: readonly string[],
): CloneItemEntry[] {
  const keys = only ?? Object.keys(CLONE_ITEM_LABEL_KEYS);
  const out: CloneItemEntry[] = [];
  for (const id of keys) {
    const labelKey = CLONE_ITEM_LABEL_KEYS[id];
    const value = values[id] ?? 0;
    if (labelKey === undefined || value <= 0) continue;
    out.push({ id, labelKey, count: value });
  }
  return out;
}

const WARNING_LABEL_KEYS: Record<string, string> = {
  starts_in_past: "adminEventClone.warnings.startsInPast",
  external_url_copied: "adminEventClone.warnings.externalUrlCopied",
  type_inactive: "adminEventClone.warnings.typeInactive",
  rsvp_opens_in_past: "adminEventClone.warnings.rsvpOpensInPast",
  cancelled_sessions_skipped: "adminEventClone.warnings.cancelledSessionsSkipped",
  cast_needs_agenda: "adminEventClone.warnings.castNeedsAgenda",
  sales_closed: "adminEventClone.warnings.salesClosed",
  access_codes_dropped: "adminEventClone.warnings.accessCodesDropped",
  codes_not_copied: "adminEventClone.warnings.codesNotCopied",
  codes_need_tickets: "adminEventClone.warnings.codesNeedTickets",
  checkpoints_without_target: "adminEventClone.warnings.checkpointsWithoutTarget",
  pages_copied_as_draft: "adminEventClone.warnings.pagesCopiedAsDraft",
  sponsors_unpublished: "adminEventClone.warnings.sponsorsUnpublished",
  seat_holds_cleared: "adminEventClone.warnings.seatHoldsCleared",
  cfp_window_in_past: "adminEventClone.warnings.cfpWindowInPast",
  cfp_reviewers_not_copied: "adminEventClone.warnings.cfpReviewersNotCopied",
};

const BLOCKER_LABEL_KEYS: Record<string, string> = {
  sessions_outside_window: "adminEventClone.blockers.sessionsOutsideWindow",
  invalid_slug: "adminEventClone.blockers.invalidSlug",
  slug_taken: "adminEventClone.blockers.slugTaken",
};

/** Klucz zdania ostrzezenia; nieznany kod -> zdanie ogolne z liczba. */
export function cloneWarningKey(notice: CloneNotice): string {
  return WARNING_LABEL_KEYS[notice.code] ?? "adminEventClone.warnings.unknown";
}

/** Klucz zdania blokady; nieznany kod -> zdanie ogolne z liczba. */
export function cloneBlockerKey(notice: CloneNotice): string {
  return BLOCKER_LABEL_KEYS[notice.code] ?? "adminEventClone.blockers.unknown";
}

export const CLONE_STATUS_LABEL_KEYS: Record<string, string> = {
  draft: "adminEventClone.status.draft",
  published: "adminEventClone.status.published",
  cancelled: "adminEventClone.status.cancelled",
};

/** Etykieta stanu wydarzenia; stan spoza CHECK-a (nowszy backend) jako szkic. */
export function cloneStatusKey(status: string): string {
  return CLONE_STATUS_LABEL_KEYS[status] ?? CLONE_STATUS_LABEL_KEYS.draft;
}
