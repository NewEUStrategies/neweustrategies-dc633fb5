// Bilet do portfela - neutralny model przepustki z odpowiedzi
// `event_ticket_wallet_payload` (migracja 20260926160000).
//
// JEDEN MODEL DLA DWÓCH PORTFELI. Apple (`pass.json`) i Google
// (`eventTicketObject`) mają różne kształty, ale te same fakty: kto, na co,
// kiedy, gdzie, z jakim kodem i w jakich kolorach. Mapowanie wiersza bazy
// żyje tu raz, a oba konstruktory przepustek czytają już wyłącznie model.
//
// ODPOWIEDŹ BAZY TO `jsonb`, więc ją WALIDUJEMY, a nie rzutujemy: brak
// identyfikatora zgłoszenia, najemcy, wydarzenia albo terminu to `null`
// (trasa odpowiada wtedy błędem), a pola opcjonalne (miejsce, okładka, bilet,
// grupa) zamieniają się na `null`, zamiast udawać pusty napis.
//
// DATY W STREFIE WYDARZENIA przez `timezone.ts` - ten sam tekst terminu co na
// stronie biletu i w mailu, z etykietą strefy („CEST”), bo przepustkę ogląda
// się także w innej strefie niż ta, w której dzieje się wydarzenie.
//
// KOLORY Z BRANDINGU z bezpiecznymi domyślnymi: tło = nawigacja albo główna
// akcja wydarzenia (inaczej grafit skanera #141414), tekst = biały albo grafit,
// co da wyższy kontrast z tłem, etykiety = kolor akcji albo grupy, jeśli ma
// z tłem kontrast co najmniej 3:1 (WCAG dla dużego tekstu), inaczej kolor tekstu.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero sieci.
import type { Json } from "@/integrations/supabase/types";
import { contrastRatio } from "@/lib/charts/palette";
import { eventBrandingFromJson } from "@/lib/events/eventBrandingDraft";
import {
  eventDayKey,
  eventTimeZone,
  eventTimeZoneLabel,
  formatEventDateTime,
  formatEventTime,
} from "@/lib/events/timezone";

import { walletLang, type WalletLang } from "./walletCopy";

/** Tekst w obu językach przepustki. */
export type WalletText = Record<WalletLang, string>;

export interface WalletColors {
  /** `#RRGGBB` */
  readonly background: string;
  readonly foreground: string;
  readonly label: string;
}

export interface WalletTicket {
  readonly registrationId: string;
  readonly tenantId: string;
  readonly organizationName: string;
  /** Język, w którym uczestnik dodaje przepustkę (literały `pass.json`). */
  readonly lang: WalletLang;
  readonly holderName: string | null;
  /** Jawny kod QR - ten sam, który czyta skaner. */
  readonly qrToken: string;
  readonly event: {
    readonly id: string;
    readonly slug: string;
    readonly title: WalletText;
    readonly startsAt: string;
    readonly endsAt: string | null;
    readonly timezone: string;
    readonly location: string | null;
    readonly coverUrl: string | null;
    /** Termin do wyświetlenia, w strefie wydarzenia, w obu językach. */
    readonly when: WalletText;
  };
  readonly ticketName: WalletText | null;
  readonly groupName: WalletText | null;
  readonly colors: WalletColors;
}

export const WALLET_DEFAULT_BACKGROUND = "#141414";
const WHITE = "#FFFFFF";
const HEX = /^#[0-9A-Fa-f]{6}$/;

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function text(row: Bag, key: string): string | null {
  const value = row[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Para PL/EN; brakujący język bierze drugi, brak obu -> `null`. */
function bilingual(row: Bag, base: string): WalletText | null {
  const pl = text(row, `${base}_pl`);
  const en = text(row, `${base}_en`);
  const fallback = pl ?? en;
  if (fallback === null) return null;
  return { pl: pl ?? fallback, en: en ?? fallback };
}

function hexOrNull(value: string | null): string | null {
  return value !== null && HEX.test(value) ? value.toUpperCase() : null;
}

/** Kolory przepustki z brandingu wydarzenia i koloru grupy. */
export function walletColors(branding: unknown, groupColor: string | null): WalletColors {
  // `eventBrandingFromJson` zwraca już wyłącznie poprawny `#RRGGBB` albo "".
  const slots = eventBrandingFromJson(branding).colors;
  const action = slots.main_action || null;
  const background = slots.navigation || action || WALLET_DEFAULT_BACKGROUND;
  const foreground =
    contrastRatio(WHITE, background) >= contrastRatio(WALLET_DEFAULT_BACKGROUND, background)
      ? WHITE
      : WALLET_DEFAULT_BACKGROUND;
  const label =
    [action, hexOrNull(groupColor)].find(
      (candidate): candidate is string =>
        candidate !== null && contrastRatio(candidate, background) >= 3,
    ) ?? foreground;
  return { background, foreground, label };
}

/** Termin „start – koniec (strefa)” w strefie wydarzenia. */
export function walletWhen(
  startsAt: string,
  endsAt: string | null,
  timezone: string,
  lang: WalletLang,
): string {
  const start = formatEventDateTime(startsAt, timezone, lang);
  const zone = eventTimeZoneLabel(startsAt, timezone, lang);
  if (endsAt === null) return `${start} (${zone})`;
  const sameDay = eventDayKey(startsAt, timezone) === eventDayKey(endsAt, timezone);
  const end = sameDay
    ? formatEventTime(endsAt, timezone, lang)
    : formatEventDateTime(endsAt, timezone, lang);
  return `${start} – ${end} (${zone})`;
}

/**
 * Odpowiedź `event_ticket_wallet_payload` -> model przepustki albo `null`,
 * gdy brakuje pól, bez których przepustki nie da się złożyć.
 *
 * `requestedLang` to język interfejsu, z którego uczestnik kliknął „Dodaj”;
 * bez niego - język zapisany przy zgłoszeniu.
 */
export function walletTicketFromPayload(
  payload: Json,
  qrToken: string,
  requestedLang: unknown,
): WalletTicket | null {
  const row = bag(payload);
  if (row === null) return null;
  const registrationId = text(row, "registration_id");
  const tenantId = text(row, "tenant_id");
  const eventId = text(row, "event_id");
  const slug = text(row, "event_slug");
  const startsAt = text(row, "event_starts_at");
  const title = bilingual(row, "event_title");
  if (
    registrationId === null ||
    tenantId === null ||
    eventId === null ||
    slug === null ||
    startsAt === null ||
    title === null
  ) {
    return null;
  }
  const endsAt = text(row, "event_ends_at");
  const timezone = eventTimeZone({ timezone: text(row, "event_timezone") });
  const holder = [text(row, "first_name"), text(row, "last_name")]
    .filter((part): part is string => part !== null)
    .join(" ");
  const cover = text(row, "event_cover_url");
  const when: WalletText = {
    pl: walletWhen(startsAt, endsAt, timezone, "pl"),
    en: walletWhen(startsAt, endsAt, timezone, "en"),
  };

  return {
    registrationId,
    tenantId,
    organizationName: text(row, "tenant_name") ?? title.pl,
    lang: walletLang(requestedLang) ?? walletLang(row.lang) ?? "pl",
    holderName: holder === "" ? null : holder,
    qrToken,
    event: {
      id: eventId,
      slug,
      title,
      startsAt,
      endsAt,
      timezone,
      location: text(row, "event_location"),
      coverUrl: cover !== null && /^https:\/\/\S+$/.test(cover) ? cover : null,
      when,
    },
    ticketName: bilingual(row, "ticket_name"),
    groupName: bilingual(row, "group_name"),
    colors: walletColors(row.event_branding, text(row, "group_color")),
  };
}

/** Adres publicznej strony wydarzenia na hoście najemcy albo `null`, gdy hosta brak. */
export function eventPageUrl(publicOrigin: string | null, slug: string): string | null {
  return publicOrigin === null ? null : `${publicOrigin}/events/${encodeURIComponent(slug)}`;
}
