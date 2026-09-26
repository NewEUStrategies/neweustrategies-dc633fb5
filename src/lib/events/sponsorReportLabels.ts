// Klucze i18n dla wartości z bazy w raporcie sponsorów - jako LITERAŁY.
//
// DLACZEGO MAPA, A NIE `t(\`...${placement}\`)`. Klucz sklejony szablonem jest
// niewidzialny dla bramek i18n (`eventsI18nKeys.gate`, `check:i18n-overlay-
// imports`): nowa wartość CHECK-a w bazie dawałaby na ekranie surową ścieżkę
// klucza i żadna bramka by tego nie zauważyła. `Record<Placement, ...>` wymusza
// wpis dla KAŻDEJ wartości już w kompilacji, a literały czyta bramka kluczy.
//
// Dwie mapy miejsc, bo dwie nakładki: panel mówi do organizatora
// (`adminEventSponsorReport.*`), strona dla sponsora - do sponsora
// (`eventSponsorReport.*`). Plik nie importuje nakładek, więc strona publiczna
// nie wciąga słownika panelu.
import type { SponsorPlacement } from "@/lib/events/sponsorExposure";

export const ADMIN_PLACEMENT_LABEL_KEYS = {
  home_strip: "adminEventSponsorReport.placements.homeStrip",
  partners_section: "adminEventSponsorReport.placements.partnersSection",
  partners_tab: "adminEventSponsorReport.placements.partnersTab",
  agenda_session: "adminEventSponsorReport.placements.agendaSession",
  agenda_track: "adminEventSponsorReport.placements.agendaTrack",
  materials: "adminEventSponsorReport.placements.materials",
  home_ad: "adminEventSponsorReport.placements.homeAd",
} as const satisfies Record<SponsorPlacement, string>;

export const PUBLIC_PLACEMENT_LABEL_KEYS = {
  home_strip: "eventSponsorReport.placements.homeStrip",
  partners_section: "eventSponsorReport.placements.partnersSection",
  partners_tab: "eventSponsorReport.placements.partnersTab",
  agenda_session: "eventSponsorReport.placements.agendaSession",
  agenda_track: "eventSponsorReport.placements.agendaTrack",
  materials: "eventSponsorReport.placements.materials",
  home_ad: "eventSponsorReport.placements.homeAd",
} as const satisfies Record<SponsorPlacement, string>;

/** Role przypięcia (`event_sponsors.role`) w słowniku panelu. */
export const ADMIN_SPONSOR_ROLE_LABEL_KEYS = {
  sponsor: "adminEventSponsorReport.roles.sponsor",
  partner: "adminEventSponsorReport.roles.partner",
  media_partner: "adminEventSponsorReport.roles.mediaPartner",
  exhibitor: "adminEventSponsorReport.roles.exhibitor",
} as const;

export type AdminSponsorRoleKey = keyof typeof ADMIN_SPONSOR_ROLE_LABEL_KEYS;

/** Klucz roli; rola spoza listy (stary wiersz) czyta się jak sponsor. */
export function adminSponsorRoleLabelKey(role: string): string {
  return Object.prototype.hasOwnProperty.call(ADMIN_SPONSOR_ROLE_LABEL_KEYS, role)
    ? ADMIN_SPONSOR_ROLE_LABEL_KEYS[role as AdminSponsorRoleKey]
    : ADMIN_SPONSOR_ROLE_LABEL_KEYS.sponsor;
}
