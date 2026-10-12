// Publiczny zapis na wydarzenie - przez SERWER, nie z przeglądarki (REG-04,
// decyzja D2).
//
// DLACZEGO FUNKCJA SERWEROWA. Do tej zmiany przeglądarka wołała
// `event_register` wprost przez PostgREST: kubełek limitu prób był kluczowany
// adresem e-mail z ładunku (każdy adres = nowy kubełek), a odpowiedź „już
// zapisany" przy wyprzedanym bilecie mówiła o KAŻDYM adresie, czy ma zgłoszenie
// - wyrocznia członkostwa bez licznika. Tylko serwer zna:
//   * najemcę z ZAUFANEGO hosta (`resolveTenantIdForHost`),
//   * konto z ZWERYFIKOWANEJ sesji (`getClaims`, nie z ciała żądania),
//   * solony skrót adresu (`requestRateSubject` - nigdy surowy adres),
// i podaje je bazie jawnymi argumentami `event_register_for_client` (tylko
// `service_role`). Baza liczy kubełek adresu i konta, a odmowy oddaje
// WARTOŚCIĄ, więc żadna próba nie cofa licznika.
//
// PUBLICZNA, BEZ MIDDLEWARE. Gość bez konta też się zapisuje; sesję, gdy jest,
// serwer czyta miękko i tylko po to, żeby rozpoznać właściciela adresu.
//
// POST, bo każde wywołanie liczy się do limitu i zmienia stan.
//
// SCHEMAT Z TYMI SAMYMI SUFITAMI CO BAZA I FORMULARZ
// (`REGISTRATION_FIELD_LIMITS`). Tekst za długi to odmowa całego żądania,
// nigdy przycięcie (AGENTS.md); formularz mówi o tym pod polem, zanim cokolwiek
// wyjdzie. `.strict()`: klucz spoza listy (`ip_hash`, `user_agent`,
// `tenant_id`, `person_id`) nie dochodzi nawet do serwera.
//
// Moduł zawiera WYŁĄCZNIE deklarację server function + importy (wymóg
// tss-serverfn-split). Logika: `eventRegistration.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { REGISTRATION_FIELD_LIMITS as LIMITS } from "@/lib/events/registrationFieldLimits";
import type { EventRegisterClient } from "@/lib/events/registrationPayload";

/** Napis przycięty z białych znaków, ale NIGDY skrócony - za długi to odmowa. */
const text = (max: number) => z.string().trim().max(max);

/**
 * Odpowiedź na pytanie organizatora. Sufity są luźniejsze od ładunku bazy
 * (64 kB, `payload_too_large`) - odpowiedź długa trafia do bazy i dostaje jej
 * zdanie, a tu odpada wyłącznie śmieć, który nie zmieściłby się w żadnym
 * zgłoszeniu.
 */
const answerValue = z.union([
  z.string().max(65_536),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(2_000)).max(200),
]);

/** Dotknięcie kampanii - sufity jak `_event_ads_touch` (20260927000300). */
const touch = z
  .object({
    ts: z.number().finite(),
    landing_path: z.string().max(512).nullable(),
    referrer_host: z.string().max(253).nullable(),
    utm_source: z.string().max(100).nullable(),
    utm_medium: z.string().max(100).nullable(),
    utm_campaign: z.string().max(100).nullable(),
    utm_term: z.string().max(100).nullable(),
    utm_content: z.string().max(100).nullable(),
    gad_source: z.string().max(10).nullable(),
    gad_campaign_id: z.string().max(20).nullable(),
    click_id_type: z.enum(["gclid", "gbraid", "wbraid"]).nullable(),
    click_id: z.string().max(512).nullable(),
  })
  .strict();

const Input = z
  .object({
    eventSlug: z.string().trim().min(1).max(200),
    firstName: text(LIMITS.name),
    lastName: text(LIMITS.name),
    email: text(LIMITS.email),
    phone: text(LIMITS.phoneMax).nullable().optional(),
    jobTitle: text(LIMITS.jobTitle).nullable().optional(),
    companyText: text(LIMITS.companyText).nullable().optional(),
    socialProfileUrl: text(LIMITS.socialProfileUrl).nullable().optional(),
    ticketTypeId: z.string().uuid().nullable().optional(),
    accessCode: text(LIMITS.code).nullable().optional(),
    revealCode: text(LIMITS.code).nullable().optional(),
    answers: z
      .array(z.object({ key: z.string().max(200), value: answerValue }).strict())
      .max(200)
      .optional(),
    acceptedTermIds: z.array(z.string().uuid()).max(100).optional(),
    consentDataProcessing: z.boolean(),
    consentMarketing: z.boolean().optional(),
    consentPartnerSharing: z.boolean().optional(),
    lang: z.enum(["pl", "en"]),
    // ATRYBUCJA JEST DODATKIEM. Zły kształt (stara wersja magazynu, ręczna
    // edycja) zdejmuje WYŁĄCZNIE ją - zapis nie może przepaść przez UTM.
    attribution: z
      .object({ first: touch.nullable(), last: touch.nullable(), ad_consent: z.boolean() })
      .strict()
      .nullable()
      .optional()
      .catch(null),
  })
  .strict();

export const submitEventRegistration = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<EventRegisterClient> => {
    const { submitEventRegistrationForRequest } =
      await import("@/lib/events/eventRegistration.server");
    return submitEventRegistrationForRequest(data);
  });
