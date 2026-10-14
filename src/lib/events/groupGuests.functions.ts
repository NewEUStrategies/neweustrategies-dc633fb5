// Dopisanie gości do zgłoszenia prowadzącego - przez SERWER, nie z przeglądarki
// (przegląd R38, REG-04).
//
// DLACZEGO FUNKCJA SERWEROWA. Do tej zmiany przeglądarka wołała
// `event_register_group_guests` wprost (GRANT authenticated): baza znała tylko
// konto, więc N tanich kont za jednym adresem IP miało N kubełków prób, a gość
// z zapisem na wydarzenie wracał jako `already_registered: <adres>` -
// wyrocznia członkostwa. Tylko serwer zna:
//   * najemcę z ZAUFANEGO hosta (`resolveTenantIdForHost`),
//   * konto z ZWERYFIKOWANEJ sesji (`getClaims`, nie z ciała żądania),
//   * solony skrót adresu (`requestRateSubject` - nigdy surowy adres),
// i podaje je bazie jawnymi argumentami `event_register_group_guests_for_client`
// (tylko `service_role`). Baza liczy kubełek adresu i konta, waliduje CAŁĄ listę
// przed sprawdzeniem gości, a gościa z zapisem pomija bez śladu w odpowiedzi -
// jego adres wraca wyłącznie do serwera, który wysyła mu wiadomość.
//
// POST, bo każde wywołanie liczy się do limitu i zmienia stan. Sufity pól to
// te same liczby co baza i formularz (`REGISTRATION_FIELD_LIMITS`); znaczenie
// (pusty napis, zły adres, znak sterujący) ocenia baza i odpowiada kodem.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split). Logika: `groupGuests.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { REGISTRATION_FIELD_LIMITS as LIMITS } from "@/lib/events/registrationFieldLimits";
import type { GroupGuestsClient } from "@/lib/events/groupGuests.server";

export type { GroupGuestsClient } from "@/lib/events/groupGuests.server";

/**
 * Grupa ma najwyżej 50 osób (CHECK `event_ticket_types_group_max_size_range`),
 * więc gości - najwyżej 49. Dłuższa lista nie powstaje w edytorze.
 */
const GUESTS_MAX = 49;

const Guest = z
  .object({
    first_name: z.string().max(LIMITS.name),
    last_name: z.string().max(LIMITS.name),
    email: z.string().max(LIMITS.email),
  })
  .strict();

const Input = z
  .object({
    leadRegistrationId: z.string().uuid(),
    guests: z.array(Guest).max(GUESTS_MAX),
  })
  .strict();

export const registerEventGroupGuests = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<GroupGuestsClient> => {
    const { registerEventGroupGuestsForRequest } = await import("@/lib/events/groupGuests.server");
    return registerEventGroupGuestsForRequest(data);
  });
