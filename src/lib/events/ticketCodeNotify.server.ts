// Bilet z kodem QR - osobny mail do każdej osoby z potwierdzonym miejscem,
// także do gości zapisanych przez prowadzącego grupy.
//
// JAWNY KOD ISTNIEJE TYLKO W CHWILI WYDANIA. Baza trzyma skrót
// (`qr_token_hash`), więc `_event_issue_ticket_codes` zajmuje zgłoszenie,
// wydaje kod i oddaje go tutaj, a ten moduł wkłada go do maila. Wysyłkę
// odnotowujemy DOPIERO po przyjęciu maila do kolejki - nieudana wysyłka
// zwalnia zgłoszenie i kolejna próba (cron) wyda nowy kod. Wysłanego biletu
// nic już nie rotuje: powtórzony webhook nie dostaje wierszy.
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

type SendOutcome = "sent" | "undeliverable" | "retry";

/**
 * Wynik wysyłki -> decyzja o kodzie. `retry` zwalnia zgłoszenie (kolejne
 * zajęcie wyda NOWY kod), a `undeliverable` zamyka je jak wysłane: adres
 * wypisany albo pusty nie ożyje przy następnym ticku, a rotowanie kodu co
 * minutę tylko zapełniałoby dziennik poczty.
 */
async function deliver(row: Record<string, unknown>): Promise<SendOutcome> {
  const notice = buildTicketCodeNotice(row);
  if (notice === null) return "undeliverable";
  try {
    const { sendTxEmail } = await import("@/lib/email/transactional.server");
    const result = await sendTxEmail({
      type: "event_ticket_issued",
      to: notice.to,
      lang: notice.lang,
      subjectName: notice.eventTitle,
      details: notice.details,
      ctaPath: notice.ctaPath,
      metaName: notice.firstName,
      tenantId: notice.tenantId,
      // Klucz per ZAJĘCIE: ponowienie po nieudanej wysyłce niesie nowy kod,
      // więc bramka duplikatów nie może go zatrzymać jako „już wysłany".
      idempotencyKey: `event-ticket-code:${notice.registrationId}:${text(row.claimed_at) ?? ""}`,
    });
    if (result.ok) {
      return result.skipped === "suppressed" || result.skipped === "no_recipient"
        ? "undeliverable"
        : "sent";
    }
    console.error(
      "[events] ticket code email failed",
      notice.registrationId,
      result.reason ?? result.error,
    );
    return "retry";
  } catch (err) {
    console.error("[events] ticket code email failed", notice.registrationId, err);
    return "retry";
  }
}

/**
 * Wydaje bilety zgłoszeniu i jego gościom, wysyła każdemu osobny mail i dopiero
 * wtedy odnotowuje wysyłkę (`_event_ticket_code_confirm`). Zwraca liczbę
 * wysłanych wiadomości. Nigdy nie rzuca.
 */
export async function issueAndSendTicketCodes(registrationId: string): Promise<number> {
  let rows: Record<string, unknown>[] = [];
  let admin: (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
  try {
    ({ supabaseAdmin: admin } = await import("@/integrations/supabase/client.server"));
    const { data, error } = await admin.rpc("_event_issue_ticket_codes", {
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

  let sent = 0;
  for (const row of rows) {
    const outcome = await deliver(row);
    if (outcome === "sent") sent += 1;
    const id = text(row.registration_id);
    const claimedAt = text(row.claimed_at);
    if (id === null || claimedAt === null) continue;
    try {
      const { error } = await admin.rpc("_event_ticket_code_confirm", {
        p_registration_id: id,
        p_claimed_at: claimedAt,
        p_sent: outcome !== "retry",
      });
      // Nieodnotowane zajęcie wygaśnie samo (dzierżawa w bazie) - wtedy cron
      // wyda nowy kod. Gorzej byłoby rzucić i przerwać wysyłkę reszcie grupy.
      if (error) console.error("[events] ticket code confirm failed", id, error.message);
    } catch (err) {
      console.error("[events] ticket code confirm failed", id, err);
    }
  }
  return sent;
}

/**
 * Cron: bilety dla zgłoszeń przyjętych DOWOLNĄ drogą (płatność, decyzja
 * organizatora, awans z rezerwy, zapis bezpłatny) i dla ponowień po nieudanej
 * wysyłce. Ścieżki natychmiastowe (webhook, zapis grupowy) zostają - cron
 * domyka to, czego one nie złapały.
 */
export async function runPendingTicketCodes(
  limit = 50,
): Promise<{ registrations: number; sent: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("_event_ticket_codes_pending", {
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const ids = (Array.isArray(data) ? data : []).filter(
    (id): id is string => typeof id === "string",
  );
  let sent = 0;
  for (const id of ids) sent += await issueAndSendTicketCodes(id);
  return { registrations: ids.length, sent };
}
