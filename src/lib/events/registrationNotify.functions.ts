// Mail o losie zgłoszenia na wydarzenie: przyjęcie, decyzja, awans z rezerwy.
//
// DLACZEGO SERWER, A NIE KLIENT. Treść i wysyłka idą tym samym potokiem, co
// reszta poczty transakcyjnej (kolejka, idempotencja, lista wykluczeń), a panel
// NIE MOŻE znać adresu uczestnika inaczej niż przez RPC z bramką roli.
// Autoryzacja mieszka w bazie: `admin_event_registration_notify_payload` woła
// `assert_editor_tenant()`, więc ta funkcja serwerowa nie jest granicą
// bezpieczeństwa - jest wyłącznie transportem.
//
// STATUS SPRAWDZAMY DWA RAZY. Organizator klika „powiadom" na liście, która
// mogła się zestarzeć; ładunek niesie status Z CHWILI ODCZYTU i jeśli nie
// zgadza się z tym, o czym mamy powiadomić, milczymy. Mail zaprzeczający
// aktualnej decyzji jest gorszy niż brak maila - odbiorca przyjeżdża na
// wydarzenie, na które go nie ma.
//
// KLUCZ IDEMPOTENCJI ZAWIERA STATUS. `event-registration:<id>:approved` nie
// koliduje z `...:rejected`, więc zmiana decyzji wysyła drugi mail (i musi),
// a dwa kliknięcia w ten sam przycisk wysyłają jeden.
//
// PIECZĘĆ „POWIADOMIONO" TYLKO DLA AWANSU. `admin_event_registration_mark_notified`
// stempluje `waitlist_notified_at`, czyli kolumnę o JEDNYM znaczeniu: „osoba
// wie, że weszła z rezerwy". Stemplowanie jej po mailu o odmowie zamieniłoby
// tę kolumnę w bezużyteczny licznik wysyłek.
//
// PO PRZYJĘCIU I AWANSIE IDĄ OD RAZU BILETY. Mail o decyzji nie niesie kodu
// QR - niesie go osobny mail `event_ticket_issued`, jeden na osobę. Wydanie
// od zgłoszenia prowadzącego obejmuje też jego gości, których kaskada
// w bazie (20260926100000) przyjęła razem z nim - bez tego kroku czekaliby
// na crona. Bilety wychodzą NIEZALEŻNIE od losu maila o decyzji: nieudany
// „zatwierdzono" nie może zostawić grupy bez wejściówek. Autoryzacją jest
// ładunek z `admin_event_registration_notify_payload` - dotarliśmy tu tylko
// dla zgłoszenia z najemcy organizatora, a identyfikator przeszedł walidator.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TxEmailType } from "@/lib/email-templates/tx-copy";

/** Momenty cyklu życia zgłoszenia, o których piszemy do uczestnika. */
export const REGISTRATION_NOTICES = ["received", "approved", "rejected", "promoted"] as const;
export type RegistrationNotice = (typeof REGISTRATION_NOTICES)[number];

const TYPE_BY_NOTICE: Readonly<Record<RegistrationNotice, TxEmailType>> = {
  received: "event_registration_received",
  approved: "event_registration_approved",
  rejected: "event_registration_rejected",
  promoted: "event_waitlist_promoted",
};

/** Status zgłoszenia, który musi obowiązywać, żeby dane powiadomienie miało sens. */
const STATUS_BY_NOTICE: Readonly<Record<RegistrationNotice, readonly string[]>> = {
  received: ["pending", "waitlist"],
  approved: ["approved", "attended"],
  rejected: ["rejected"],
  promoted: ["approved", "attended"],
};

export function registrationNoticeType(notice: RegistrationNotice): TxEmailType {
  return TYPE_BY_NOTICE[notice];
}

/** Momenty, po których zgłoszenie (i jego goście) dostają bilet z kodem QR. */
const TICKET_NOTICES: readonly RegistrationNotice[] = ["approved", "promoted"];

/**
 * `ticketsSent` - liczba wysłanych biletów (prowadzący + goście); tylko po
 * przyjęciu i awansie, bo tylko wtedy panel ma o czym powiedzieć.
 */
export type RegistrationNotifyResult =
  | { ok: true; skipped?: "duplicate" | "suppressed" | "status_changed"; ticketsSent?: number }
  | { ok: false; error: string; ticketsSent?: number };

const Input = z.object({
  registrationId: z.string().uuid(),
  notice: z.enum(REGISTRATION_NOTICES),
});

export const notifyEventRegistrationDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<RegistrationNotifyResult> => {
    const { data: payload, error } = await context.supabase.rpc(
      "admin_event_registration_notify_payload",
      { p_payload: { registration_id: data.registrationId } },
    );
    if (error) return { ok: false, error: error.message };

    const row =
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    const email = typeof row?.email === "string" ? row.email.trim() : "";
    if (row === null || email === "") return { ok: false, error: "not_found" };

    const status = typeof row.status === "string" ? row.status : "";
    if (!STATUS_BY_NOTICE[data.notice].includes(status)) {
      return { ok: true, skipped: "status_changed" };
    }

    const { buildRegistrationNotice } = await import("@/lib/events/registrationNotify.server");
    const notice = buildRegistrationNotice(data.notice, row);

    // ZNACZNIK PRZEJSCIA W KLUCZU IDEMPOTENCJI. Zgloszenie moze wrocic do stanu,
    // w ktorym juz bylo: pending -> rejected -> approved -> waitlist -> rejected.
    // Sam `notice` daje dla obu odmow IDENTYCZNY klucz, a `sendTxEmail` traktuje
    // istniejacy wpis jako duplikat - druga decyzja NIE dotarlaby do uczestnika,
    // a przy awansie zostalaby jeszcze ostemplowana jako „powiadomiony".
    // Stempel z bazy rozdziela PRZEJSCIA, zachowujac dedup PONOWIEN w obrebie
    // jednego przejscia (ten sam `decided_at` = to samo klikniecie organizatora).
    const stampRaw = data.notice === "promoted" ? row.promoted_at : row.decided_at;
    const stamp = typeof stampRaw === "string" && stampRaw !== "" ? stampRaw : "0";

    // WYJĄTEK WYSYŁKI TO TYLKO NIEUDANY MAIL. `sendTxEmail` jest fail-soft, ale
    // import modułu albo render potrafi rzucić - a rzut stąd zabrałby ze sobą
    // bilety poniżej. Organizator dostaje ten sam komunikat, co przy odmowie
    // potoku (`ok: false`), a grupa i tak dostaje wejściówki.
    const result: { ok: boolean; skipped?: string; reason?: string; error?: string } =
      await import("@/lib/email/transactional.server")
        .then(({ sendTxEmail }) =>
          sendTxEmail({
            type: TYPE_BY_NOTICE[data.notice],
            to: email,
            lang: notice.lang,
            subjectName: notice.eventTitle,
            details: notice.details,
            ctaPath: notice.ctaPath,
            metaName: notice.firstName,
            tenantId: notice.tenantId,
            idempotencyKey: `event-registration:${data.registrationId}:${data.notice}:${stamp}`,
          }),
        )
        .catch((err: unknown) => {
          console.error("[events] registration notice failed", data.registrationId, err);
          return { ok: false, error: "send_failed" };
        });

    // Bilety PRZED rozstrzygnięciem wyniku maila - patrz nagłówek. Wydanie
    // nigdy nie rzuca, ale import modułu tak, a wyjątek tutaj zgubiłby
    // wynik maila, który już wyszedł.
    let tickets: { ticketsSent: number } | Record<string, never> = {};
    if (TICKET_NOTICES.includes(data.notice)) {
      try {
        const { issueAndSendTicketCodes } = await import("@/lib/events/ticketCodeNotify.server");
        tickets = { ticketsSent: await issueAndSendTicketCodes(data.registrationId) };
      } catch (err) {
        console.error("[events] ticket codes after decision failed", data.registrationId, err);
        tickets = { ticketsSent: 0 };
      }
    }

    if (!result.ok) {
      return { ok: false, error: result.reason ?? result.error ?? "send_failed", ...tickets };
    }

    // Tylko awans z rezerwy ma w bazie swoją pieczęć - patrz nagłówek.
    if (data.notice === "promoted") {
      await context.supabase.rpc("admin_event_registration_mark_notified", {
        p_payload: { registration_ids: [data.registrationId] },
      });
    }

    return result.skipped === "duplicate"
      ? { ok: true, skipped: "duplicate", ...tickets }
      : { ok: true, ...tickets };
  });
