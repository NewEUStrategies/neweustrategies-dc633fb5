// Ponowna wysyłka biletu z kodem QR z panelu organizatora.
//
// PO CO. Gość, któremu mail z biletem nie doszedł (spam, literówka poprawiona
// po fakcie, wiersz ostemplowany przez backfill 0044), nie miał dotąd żadnej
// drogi do biletu - znacznik `ticket_code_sent_at` wykluczał go z wydania
// i z crona na zawsze.
//
// TRZY KROKI, DWIE GRANICE. `admin_event_ticket_resend_scope`
// i `admin_event_ticket_resend` idą klientem ORGANIZATORA (bramka roli
// i najemcy w bazie). Zakres oddaje wiersze, którym ponowna wysyłka skasuje
// znacznik, razem z adresem; każdy adres przechodzi bramkę listy wykluczeń
// (`ticketResend.server.ts`, klucz serwisowy). Dopiero potem
// `admin_event_ticket_resend` kasuje znacznik - z pominięciem zablokowanych
// wierszy - i oddaje identyfikator do wydania. Ten identyfikator, już po
// autoryzacji, trafia do `issueAndSendTicketCodes` na kluczu serwisowym, który
// zajmuje zgłoszenie, rotuje kod i wysyła mail. Z `includeGroup`
// identyfikatorem jest prowadzący, więc bilet dostaje cała przyjęta grupa.
//
// ADRES Z LISTY WYKLUCZEŃ NIE TRACI BILETU. Wydanie rotuje kod PRZED
// wysyłką, a mail na zablokowany adres nie wyjdzie - bez tej bramki ponowna
// wysyłka unieważniała działający bilet bez zastępstwa. Pojedynczy wiersz
// z zablokowanym adresem kończy się odmową `ticket_address_suppressed` (bez
// wywołania ponownej wysyłki), a z grupy zablokowane wiersze wypadają
// i wracają jako `skippedSuppressed` - panel mówi, ile osób pominął i dlaczego.
//
// `attempted` ODRÓŻNIA POMINIĘCIE OD AWARII. `sent: 0` znaczy dwie różne
// rzeczy: poczta zawiodła (błąd dla organizatora) albo nie było komu wysłać,
// bo CAŁA grupa jest na liście wykluczeń (nic nie zawiodło - serwer chronił
// działające bilety). Sam `skippedSuppressed` tego nie rozstrzyga: grupa
// z dwoma wykluczonymi i jednym gościem, którego mail padł, też daje `sent: 0`
// i `skippedSuppressed: 2`, a tę awarię trzeba pokazać.
//
// ODMOWA BAZY WRACA JAKO TEKST (`ticket_not_issuable: ...`, `not_found: ...`)
// - panel tłumaczy ją tym samym słownikiem, co pozostałe odmowy zapisów.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * `sent` - liczba wysłanych maili z biletem (0 = nic nie wyszło),
 * `attempted` - wiersze zakresu przekazane do wysyłki (zakres bez pominiętych;
 * 0 = nie było komu wysłać),
 * `skippedSuppressed` - osoby z grupy pominięte, bo ich adres jest na liście
 * wykluczeń (ich dotychczasowy bilet nadal działa).
 */
export type TicketResendResult =
  | { ok: true; sent: number; attempted: number; skippedSuppressed: number }
  | { ok: false; error: string };

const Input = z.object({
  registrationId: z.string().uuid(),
  includeGroup: z.boolean().default(true),
});

export const resendEventTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }): Promise<TicketResendResult> => {
    const scope = await context.supabase.rpc("admin_event_ticket_resend_scope", {
      p_registration_id: data.registrationId,
      p_include_group: data.includeGroup,
    });
    if (scope.error) return { ok: false, error: scope.error.message };

    const { suppressedTicketRecipients } = await import("@/lib/events/ticketResend.server");
    const rows = scope.data ?? [];
    const skipped = await suppressedTicketRecipients(rows);
    // Bez grupy zakres to najwyżej ten jeden wiersz - pominąć go znaczy nie
    // zrobić nic, więc organizator dostaje powód zamiast „wysłano 0".
    if (!data.includeGroup && skipped.length > 0) {
      return {
        ok: false,
        error: "ticket_address_suppressed: the address is on the suppression list",
      };
    }

    const { data: rootId, error } = await context.supabase.rpc("admin_event_ticket_resend", {
      p_registration_id: data.registrationId,
      p_include_group: data.includeGroup,
      p_exclude_ids: skipped,
    });
    if (error) return { ok: false, error: error.message };
    if (typeof rootId !== "string" || rootId === "") return { ok: false, error: "not_found" };

    const { issueAndSendTicketCodes } = await import("@/lib/events/ticketCodeNotify.server");
    return {
      ok: true,
      sent: await issueAndSendTicketCodes(rootId),
      attempted: rows.length - skipped.length,
      skippedSuppressed: skipped.length,
    };
  });
