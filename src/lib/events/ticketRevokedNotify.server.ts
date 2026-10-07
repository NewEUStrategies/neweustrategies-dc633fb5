// Zawiadomienie gościa grupy, że jego bilet stracił ważność razem z grupą.
//
// KOMU PISZEMY. Baza stempluje `ticket_revoked_at` w TEJ SAMEJ instrukcji,
// która zamyka gościa: kaskada statusu prowadzącego (odrzucenie albo
// anulowanie przez organizatora, samodzielne wycofanie prowadzącego, zwrot)
// i gałąź zwrotu wyniku płatności grupy. Stempel dostaje wyłącznie gość, do
// którego bilet DOTARŁ albo był w drodze (`_event_guest_ticket_reached`) -
// gość, który jeszcze czekał, nie dostał od nas żadnego maila i nie ma czego
// odwoływać. Gość przywrócony na miejsce czeka na nowy bilet, więc
// zawiadomienie go omija; przywrócony do kolejki - dostaje je.
//
// JEDNO ZAJĘCIE, JEDNO ROZLICZENIE NA PARTIĘ. `_event_ticket_revoked_notices_claim`
// zajmuje do `limit` wierszy (SKIP LOCKED, dzierżawa 15 minut - minutowy tick
// i `community-cron` niczego nie dublują) i oddaje gotową treść.
// `_event_ticket_revoked_notices_settle` zamyka wysłane i zwalnia resztę jednym
// wywołaniem - dwa RPC na partię zamiast jednego plus dwóch na każdego gościa.
//
// KLUCZ IDEMPOTENCJI PER ODWOŁANIE, NIE PER ZAJĘCIE. Mail nie niesie sekretu
// (w odróżnieniu od biletu, którego każde zajęcie rotuje kod), więc ponowne
// zajęcie po padnięciu procesu między kolejką poczty a rozliczeniem trafia
// w `email_send_log` jako duplikat i zamyka się bez drugiego maila.
//
// MIGRACJA PRZED KODEM. Produkcja dostaje migracje ręcznie (panel Lovable), a kod
// wychodzi sam. Brak funkcji w bazie to „nic do zrobienia" (bez migracji nie ma
// też stempli), a nie awaria - krok nie może zaczerwienić całego ticku i zestarzeć
// harmonogramu w panelu.
//
// FAIL-SOFT. Wyjątek wysyłki zwalnia wiersz do ponowienia; błąd rozliczenia
// wygasa z dzierżawą.
//
// Moduł server-only (klient service_role).
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { TxDetail } from "@/lib/email-templates/transactional";
import { txCopy } from "@/lib/email-templates/tx-copy";
import { formatEventMoment } from "@/lib/events/registrationNotify.server";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

export interface TicketRevokedNotice {
  registrationId: string;
  to: string;
  lang: EmailLang;
  eventTitle: string;
  firstName: string | null;
  tenantId: string | null;
  details: TxDetail[];
  ctaPath: string;
  idempotencyKey: string;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Wiersz z `_event_ticket_revoked_notices_claim` -> treść maila albo `null`,
 * gdy nie ma dokąd albo o czym pisać (brak zgłoszenia, adresu, stempla).
 *
 * BEZ KODU WEJŚCIA I BEZ UZASADNIENIA ORGANIZATORA. Kod już nie działa,
 * a notatka decyzji dotyczy prowadzącego - w cudzej skrzynce byłaby wyciekiem.
 */
export function buildTicketRevokedNotice(row: Record<string, unknown>): TicketRevokedNotice | null {
  const registrationId = text(row.registration_id);
  const to = text(row.email);
  const revokedAt = text(row.revoked_at);
  if (registrationId === null || to === null || revokedAt === null) return null;

  const lang: EmailLang = row.lang === "en" ? "en" : "pl";
  const labels = txCopy("event_ticket_revoked", lang).labels;
  const titlePl = text(row.event_title_pl);
  const titleEn = text(row.event_title_en);
  const eventTitle = (lang === "en" ? (titleEn ?? titlePl) : (titlePl ?? titleEn)) ?? "";
  const when = formatEventMoment(text(row.event_starts_at), text(row.event_timezone), lang);
  const ticket = lang === "en" ? text(row.ticket_name_en) : text(row.ticket_name_pl);
  const lead = [text(row.lead_first_name), text(row.lead_last_name)]
    .filter((part): part is string => part !== null)
    .join(" ");
  const slug = text(row.event_slug);

  const details: TxDetail[] = [];
  if (eventTitle !== "") details.push({ label: labels.event, value: eventTitle });
  if (when !== "") details.push({ label: labels.date, value: when });
  if (ticket !== null) details.push({ label: labels.ticketType, value: ticket });
  // Gość nie składał zgłoszenia sam - musi wiedzieć, czyje zgłoszenie odwołano.
  if (lead !== "") details.push({ label: labels.registeredBy, value: lead });

  return {
    registrationId,
    to,
    lang,
    eventTitle,
    firstName: text(row.first_name),
    tenantId: text(row.tenant_id),
    details,
    // Strona wydarzenia, nie katalog: gość może zapisać się sam.
    ctaPath: slug === null ? "/events" : `/events/${slug}`,
    idempotencyKey: `event-ticket-revoked:${registrationId}:${revokedAt}`,
  };
}

/** `closed` = sprawa zamknięta bez nowego maila (adres wykluczony, pusty, duplikat). */
type SendOutcome = "sent" | "closed" | "retry";

async function deliver(row: Record<string, unknown>): Promise<SendOutcome> {
  const notice = buildTicketRevokedNotice(row);
  if (notice === null) return "closed";
  try {
    const { sendTxEmail } = await import("@/lib/email/transactional.server");
    const result = await sendTxEmail({
      type: "event_ticket_revoked",
      to: notice.to,
      lang: notice.lang,
      subjectName: notice.eventTitle,
      details: notice.details,
      ctaPath: notice.ctaPath,
      metaName: notice.firstName,
      tenantId: notice.tenantId,
      idempotencyKey: notice.idempotencyKey,
    });
    // Pominięcie sprawdzamy PRZED `ok` - lista wykluczeń oddaje `ok: false`.
    if (result.skipped !== undefined) return "closed";
    if (result.ok) return "sent";
    console.error(
      "[events] ticket revoked email failed",
      notice.registrationId,
      result.reason ?? result.error,
    );
    return "retry";
  } catch (err) {
    console.error("[events] ticket revoked email failed", notice.registrationId, err);
    return "retry";
  }
}

/** Budżet partii, gdy wołający nie poda terminu (`community-cron`). */
const TICKET_REVOCATIONS_BUDGET_MS = 10_000;

export interface PendingTicketRevocationsResult {
  /** Zawiadomienia zajęte w tej partii. */
  notices: number;
  sent: number;
  /** Nieudane wysyłki - wracają do kolejki od razu. */
  failed: number;
  /** Odłożone przez termin - wracają do kolejki od razu. */
  deferred: number;
  skipped?: "migration_pending";
}

/**
 * Cron: zawiadomienia o biletach odwołanych razem z grupą. Termin sprawdzamy
 * PRZED zajęciem (miniony termin nie zajmuje niczego) i przed każdym mailem.
 * Rzuca tylko przy błędzie zajęcia - krok crona świeci wtedy na czerwono.
 */
export async function runPendingTicketRevocations(
  limit = 20,
  deadlineAt: number = Date.now() + TICKET_REVOCATIONS_BUDGET_MS,
): Promise<PendingTicketRevocationsResult> {
  const result: PendingTicketRevocationsResult = { notices: 0, sent: 0, failed: 0, deferred: 0 };
  if (Date.now() > deadlineAt) return result;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("_event_ticket_revoked_notices_claim", {
    p_limit: limit,
  });
  if (error) {
    if (isMigrationPending(error)) return { ...result, skipped: "migration_pending" };
    throw new Error(error.message);
  }

  const payload = isRecord(data) ? data : {};
  const claimedAt = text(payload.claimed_at);
  const list: unknown[] = Array.isArray(payload.notices) ? payload.notices : [];
  const rows = list.filter(isRecord);
  const done: string[] = [];
  const retry: string[] = [];
  for (const row of rows) {
    const id = text(row.registration_id);
    if (id === null) continue;
    result.notices += 1;
    if (Date.now() > deadlineAt) {
      result.deferred += 1;
      retry.push(id);
      continue;
    }
    const outcome = await deliver(row);
    if (outcome === "retry") {
      result.failed += 1;
      retry.push(id);
    } else {
      if (outcome === "sent") result.sent += 1;
      done.push(id);
    }
  }

  if (claimedAt !== null && result.notices > 0) {
    try {
      const { error: settleError } = await supabaseAdmin.rpc(
        "_event_ticket_revoked_notices_settle",
        { p_claimed_at: claimedAt, p_done: done, p_retry: retry },
      );
      // Nierozliczone zajęcie wygaśnie samo; ponowienie trafi w duplikat.
      if (settleError) console.error("[events] ticket revoked settle failed", settleError.message);
    } catch (err) {
      console.error("[events] ticket revoked settle failed", err);
    }
  }
  return result;
}
