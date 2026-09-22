// Bilet z kodem QR - osobny mail do każdej osoby z potwierdzonym miejscem,
// także do gości zapisanych przez prowadzącego grupy.
//
// JAWNY KOD ISTNIEJE TYLKO W CHWILI WYDANIA. Baza trzyma skrót
// (`qr_token_hash`), więc `_event_issue_ticket_codes` wydaje kod i oddaje go
// tutaj, a ten moduł od razu wkłada go do maila. Funkcja bazy wydaje kod RAZ
// na zgłoszenie (`ticket_code_sent_at`) - powtórzony webhook albo podwójne
// kliknięcie nie rotują kodu, który ktoś już ma w skrzynce.
//
// KOD JEDZIE WE FRAGMENCIE ADRESU (`ticketLinkPath`), nie w zapytaniu: strona
// biletu rysuje QR w przeglądarce, a fragment nie trafia do logów serwera.
// W treści maila stoi też sam kod - obsługa wpisze go ręcznie, gdy skaner
// nie odczyta obrazka.
//
// FAIL-SOFT, jak reszta powiadomień po płatności: miejsce jest już
// zaksięgowane, a wyjątek tutaj skazywałby webhook na ponowienia.
//
// Moduł server-only (klient service_role).
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { TxDetail } from "@/lib/email-templates/transactional";
import { txCopy } from "@/lib/email-templates/tx-copy";
import { ticketLinkPath } from "@/lib/events/manageToken";
import { formatEventMoment } from "@/lib/events/registrationNotify.server";

export interface TicketCodeNotice {
  registrationId: string;
  to: string;
  lang: EmailLang;
  eventTitle: string;
  firstName: string | null;
  tenantId: string | null;
  details: TxDetail[];
  ctaPath: string;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Wiersz z `_event_issue_ticket_codes` -> treść maila albo `null`, gdy nie ma
 * dokąd ani czego wysłać (brak adresu, kodu, zgłoszenia lub wydarzenia).
 */
export function buildTicketCodeNotice(row: Record<string, unknown>): TicketCodeNotice | null {
  const registrationId = text(row.registration_id);
  const to = text(row.email);
  const qrToken = text(row.qr_token);
  const slug = text(row.event_slug);
  if (registrationId === null || to === null || qrToken === null || slug === null) return null;

  const lang: EmailLang = row.lang === "en" ? "en" : "pl";
  const labels = txCopy("event_ticket_issued", lang).labels;
  const titlePl = text(row.event_title_pl);
  const titleEn = text(row.event_title_en);
  const eventTitle = (lang === "en" ? (titleEn ?? titlePl) : (titlePl ?? titleEn)) ?? "";
  const when = formatEventMoment(text(row.event_starts_at), text(row.event_timezone), lang);
  const location = text(row.event_location);
  const ticket = lang === "en" ? text(row.ticket_name_en) : text(row.ticket_name_pl);
  const lead = [text(row.lead_first_name), text(row.lead_last_name)]
    .filter((part): part is string => part !== null)
    .join(" ");

  const details: TxDetail[] = [];
  if (eventTitle !== "") details.push({ label: labels.event, value: eventTitle });
  if (when !== "") details.push({ label: labels.date, value: when });
  if (location !== null) details.push({ label: labels.place, value: location });
  if (ticket !== null) details.push({ label: labels.ticketType, value: ticket });
  // Gość dostaje mail o zapisie, którego sam nie robił - musi wiedzieć od kogo.
  if (row.is_guest === true && lead !== "") {
    details.push({ label: labels.registeredBy, value: lead });
  }
  details.push({ label: labels.entryCode, value: qrToken });

  return {
    registrationId,
    to,
    lang,
    eventTitle,
    firstName: text(row.first_name),
    tenantId: text(row.tenant_id),
    details,
    ctaPath: ticketLinkPath(slug, qrToken, text(row.manage_token)),
  };
}

/**
 * Wydaje bilety zgłoszeniu i jego gościom, po czym wysyła każdemu osobny mail.
 * Zwraca liczbę wysłanych wiadomości. Nigdy nie rzuca.
 */
export async function issueAndSendTicketCodes(registrationId: string): Promise<number> {
  let rows: Record<string, unknown>[] = [];
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("_event_issue_ticket_codes", {
      p_registration_id: registrationId,
    });
    if (error) {
      console.error("[events] ticket code issue failed", registrationId, error.message);
      return 0;
    }
    const list: unknown[] = Array.isArray(data) ? data : [];
    rows = list.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry),
    );
  } catch (err) {
    console.error("[events] ticket code issue failed", registrationId, err);
    return 0;
  }
  if (rows.length === 0) return 0;

  const { sendTxEmail } = await import("@/lib/email/transactional.server");
  let sent = 0;
  for (const row of rows) {
    const notice = buildTicketCodeNotice(row);
    if (notice === null) continue;
    try {
      const result = await sendTxEmail({
        type: "event_ticket_issued",
        to: notice.to,
        lang: notice.lang,
        subjectName: notice.eventTitle,
        details: notice.details,
        ctaPath: notice.ctaPath,
        metaName: notice.firstName,
        tenantId: notice.tenantId,
        // Kod wydaje się raz na zgłoszenie, więc i klucz jest jeden.
        idempotencyKey: `event-ticket-code:${notice.registrationId}`,
      });
      if (result.ok && !result.skipped) sent += 1;
      else if (!result.ok) {
        console.error(
          "[events] ticket code email failed",
          notice.registrationId,
          result.reason ?? result.error,
        );
      }
    } catch (err) {
      console.error("[events] ticket code email failed", notice.registrationId, err);
    }
  }
  return sent;
}
