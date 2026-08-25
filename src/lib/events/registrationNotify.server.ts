// Składanie treści maila o zgłoszeniu na wydarzenie.
//
// LOGIKA STOI OSOBNO OD DEKLARACJI SERVER FUNCTION (wymóg tss-serverfn-split),
// ale też dlatego, że to jest CZYSTY rachunek: ładunek z bazy plus język
// odbiorcy dają zestaw wierszy szczegółów i adres przycisku. Da się go
// przetestować bez atrapy poczty i bez atrapy bazy.
//
// GODZINA W STREFIE WYDARZENIA, NIE SERWERA. Mail o kongresie w Brukseli musi
// podawać godzinę brukselską, także wtedy, gdy wysyła go proces w innej
// strefie - inaczej uczestnik przelicza ją sam i myli się o godzinę dwa razy
// w roku. `Intl` z `timeZone` z wiersza wydarzenia jest tu jedynym poprawnym
// źródłem; wspólny `formatEventDateTime` z warstwy front-endowej mówi w języku
// INTERFEJSU, a tutaj liczy się język ODBIORCY.
//
// WIERSZE SZCZEGÓŁÓW SĄ RÓŻNE DLA RÓŻNYCH WIADOMOŚCI. Odmowa niesie
// uzasadnienie organizatora (i nic o miejscu), awans z rezerwy niesie miejsce
// w kolejce, przyjęcie i akceptacja niosą termin i lokalizację. Jeden wspólny
// zestaw wierszy albo obiecywałby miejsce w mailu odmownym, albo milczał
// o powodzie.
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { TxDetail } from "@/lib/email-templates/transactional";
import { txCopy } from "@/lib/email-templates/tx-copy";
import type { RegistrationNotice } from "@/lib/events/registrationNotify.functions";
import { manageLinkPath } from "@/lib/events/manageToken";

const LOCALE: Record<EmailLang, string> = { pl: "pl-PL", en: "en-GB" };

export interface RegistrationNoticeContent {
  lang: EmailLang;
  eventTitle: string;
  firstName: string | null;
  tenantId: string | null;
  details: TxDetail[];
  ctaPath: string;
  /**
   * Napis przycisku albo `null`, gdy ma zostać domyślny z `tx-copy`.
   *
   * Niepusty WYŁĄCZNIE wtedy, gdy przycisk prowadzi do samoobsługi zgłoszenia -
   * inaczej „Szczegóły wydarzenia" wskazywałoby stronę rezygnacji.
   */
  ctaLabel: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function langOf(value: unknown): EmailLang {
  return value === "en" ? "en" : "pl";
}

/** Termin wydarzenia w JEGO strefie, w języku odbiorcy. */
export function formatEventMoment(
  startsAt: string | null,
  timezone: string | null,
  lang: EmailLang,
): string {
  if (startsAt === null) return "";
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat(LOCALE[lang], {
      ...options,
      timeZone: timezone ?? "Europe/Warsaw",
    }).format(date);
  } catch {
    // Nieznana strefa z bazy nie może zablokować maila - godzina w strefie
    // domyślnej serwisu jest gorsza od właściwej, ale nieporównanie lepsza
    // od braku terminu w potwierdzeniu udziału.
    return new Intl.DateTimeFormat(LOCALE[lang], { ...options, timeZone: "Europe/Warsaw" }).format(
      date,
    );
  }
}

/** Ładunek RPC + rodzaj wiadomości -> gotowa treść dla `sendTxEmail`. */
export function buildRegistrationNotice(
  notice: RegistrationNotice,
  row: Record<string, unknown>,
  /**
   * Surowy `manage_token` - TYLKO ze ścieżki samoobsługowej.
   *
   * Ścieżka administracyjna go NIE MA i mieć nie może: baza trzyma wyłącznie
   * `manage_token_hash`, a klucz jawny istnieje jedynie w odpowiedzi
   * `event_register`, czyli w przeglądarce zgłaszającego. Dlatego domyślnie
   * `null` - a mail wysyłany przez organizatora zachowuje przycisk do
   * wydarzenia.
   */
  manageToken: string | null = null,
): RegistrationNoticeContent {
  const lang = langOf(row.lang);
  const labels = txCopy("event_registration_received", lang).labels;

  const titlePl = text(row.event_title_pl);
  const titleEn = text(row.event_title_en);
  const eventTitle = (lang === "en" ? (titleEn ?? titlePl) : (titlePl ?? titleEn)) ?? "";
  const slug = text(row.event_slug);
  const when = formatEventMoment(text(row.event_starts_at), text(row.event_timezone), lang);
  const location = text(row.event_location);
  const ticket = lang === "en" ? text(row.ticket_name_en) : text(row.ticket_name_pl);

  const details: TxDetail[] = [];
  if (eventTitle !== "") details.push({ label: labels.event, value: eventTitle });
  if (when !== "") details.push({ label: labels.date, value: when });

  if (notice === "rejected") {
    const note = text(row.decision_note);
    if (note !== null) details.push({ label: labels.decisionNote, value: note });
  } else {
    if (location !== null) details.push({ label: labels.place, value: location });
    if (ticket !== null) details.push({ label: labels.ticketType, value: ticket });
    if (notice === "promoted") {
      const position = int(row.waitlist_position);
      if (position !== null) {
        details.push({ label: labels.waitlistPosition, value: String(position) });
      }
    }
  }

  const fallbackPath = notice === "rejected" || slug === null ? "/events" : `/events/${slug}`;
  // Odmowa nie dostaje samoobsługi: nie ma czego odwoływać, a link do zgłoszenia
  // pod komunikatem odmownym tylko podtrzymywałby nadzieję.
  const manage =
    manageToken === null || slug === null || notice === "rejected"
      ? null
      : manageLinkPath(slug, manageToken);

  return {
    lang,
    eventTitle,
    firstName: text(row.first_name),
    tenantId: text(row.tenant_id),
    details,
    // Odmowa prowadzi do KATALOGU, nie do wydarzenia, na które nie ma wstępu -
    // przycisk „szczegóły" pod komunikatem odmownym byłby okrucieństwem.
    //
    // POTWIERDZENIE PROWADZI DO SAMOOBSŁUGI, NIE DO OPISU WYDARZENIA. Treść
    // maila obiecuje wprost: „możesz wycofać zgłoszenie odnośnikiem z tej
    // wiadomości". Bez tego adresu obietnica była pusta - gość bez konta ma
    // klucz `manage_token` wyłącznie w tej jednej wiadomości, a po zamknięciu
    // strony potwierdzenia nie odtworzy go z niczego. Wejście na stronę samo
    // w sobie NICZEGO nie odwołuje (skanery bezpieczeństwa odwiedzają każdy
    // adres z maila), więc przycisk jest bezpieczny.
    ctaPath: manage === null ? fallbackPath : manage,
    ctaLabel: manage === null ? null : labels.manageCta,
  };
}
