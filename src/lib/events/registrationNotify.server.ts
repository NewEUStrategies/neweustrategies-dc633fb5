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

const LOCALE: Record<EmailLang, string> = { pl: "pl-PL", en: "en-GB" };

export interface RegistrationNoticeContent {
  lang: EmailLang;
  eventTitle: string;
  firstName: string | null;
  tenantId: string | null;
  details: TxDetail[];
  ctaPath: string;
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

  return {
    lang,
    eventTitle,
    firstName: text(row.first_name),
    tenantId: text(row.tenant_id),
    details,
    // Odmowa prowadzi do KATALOGU, nie do wydarzenia, na które nie ma wstępu -
    // przycisk „szczegóły" pod komunikatem odmownym byłby okrucieństwem.
    ctaPath: notice === "rejected" || slug === null ? "/events" : `/events/${slug}`,
  };
}
