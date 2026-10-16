// Zgody uczestnika wydarzeń - potwierdzenie linku double opt-in, wycofanie
// i stan zgód (REG-02 / REG-14).
//
// DLACZEGO FUNKCJE SERWEROWE. RPC bazy (`event_consent_*_for_request`) są
// wykonywalne wyłącznie dla `service_role`: najemcę z ZAUFANEGO hosta, konto
// ze ZWERYFIKOWANEJ sesji, solony skrót adresu i przeglądarkę (dowód zgody
// i kubełek prób) zna tylko serwer. Przeglądarka podaje token z maila, klucz
// samoobsługi i cele - nic więcej (`.strict()` odrzuca każdy inny klucz, więc
// identyfikator osoby albo adres nie dojdą nawet do serwera).
//
// POST WSZĘDZIE. Token i klucz to poświadczenia: w POST jadą w ciele, nigdy
// w adresie (logi dostępu, `Referer`). Potwierdzenie i wycofanie dodatkowo
// zmieniają stan i liczą się do limitu - nie mogą leżeć w żadnym cache.
// Samo OTWARCIE linku z maila (GET strony) woła wyłącznie podgląd; zgodę
// udziela dopiero przycisk.
//
// Moduł zawiera WYŁĄCZNIE deklaracje server functions + importy (wymóg
// tss-serverfn-split). Logika: `eventConsent.server.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  EventConsentConfirmResult,
  EventConsentPreviewResult,
  EventConsentWithdrawResult,
  MyEventConsentStateResult,
} from "@/lib/events/eventConsent";

/** 24 losowe bajty w base64url - kształt tokenu DOI i klucza samoobsługi. */
const token = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

const TokenInput = z.object({ token }).strict();

const WithdrawInput = z
  .object({
    purposes: z.enum(["marketing", "partner_sharing", "all"]),
    manageToken: token.nullable().optional(),
  })
  .strict();

export const previewEventConsent = createServerFn({ method: "POST" })
  .validator((data: unknown) => TokenInput.parse(data))
  .handler(async ({ data }): Promise<EventConsentPreviewResult> => {
    const { previewEventConsentForRequest } = await import("@/lib/events/eventConsent.server");
    return previewEventConsentForRequest(data.token);
  });

export const confirmEventConsent = createServerFn({ method: "POST" })
  .validator((data: unknown) => TokenInput.parse(data))
  .handler(async ({ data }): Promise<EventConsentConfirmResult> => {
    const { confirmEventConsentForRequest } = await import("@/lib/events/eventConsent.server");
    return confirmEventConsentForRequest(data.token);
  });

export const withdrawEventConsents = createServerFn({ method: "POST" })
  .validator((data: unknown) => WithdrawInput.parse(data))
  .handler(async ({ data }): Promise<EventConsentWithdrawResult> => {
    const { withdrawEventConsentsForRequest } = await import("@/lib/events/eventConsent.server");
    return withdrawEventConsentsForRequest(data);
  });

export const listMyEventConsents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<MyEventConsentStateResult> => {
    const { listMyEventConsentsForCaller } = await import("@/lib/events/eventConsent.server");
    return listMyEventConsentsForCaller();
  });
