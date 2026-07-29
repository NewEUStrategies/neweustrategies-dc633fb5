// Edytowalne treści maili cyklu miejsc zespołowych (karencja + wygaśnięcie
// dostępu), przechowywane w site_settings pod kluczem `tx_email_overrides`.
//
// Jedno źródło prawdy dla:
//  - sendera (`src/lib/email/transactional.server.ts`),
//  - podglądu w panelu (`src/lib/email/tx-preview.server.ts`),
//  - edytora w adminie (`AuthEmailContentPanel`).
//
// Puste pole = brak nadpisania, czyli wraca domyślna treść z `tx-copy` /
// `tx-body`. Dzięki temu edycja jest addytywna i zawsze odwracalna.
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toJson } from "@/lib/builder/types";
import { useSiteSetting } from "@/lib/useSiteSetting";
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { TxEmailType } from "@/lib/email-templates/tx-copy";

export const TX_OVERRIDES_SETTING_KEY = "tx_email_overrides";

/** Typy maili, których treść można edytować w panelu. */
export const EDITABLE_TX_TYPES = [
  "team_seat_grace",
  "team_seat_grace_reminder",
  "team_seat_access_ended",
] as const;

export type EditableTxType = (typeof EDITABLE_TX_TYPES)[number];

export const isEditableTxType = (t: TxEmailType): t is EditableTxType =>
  (EDITABLE_TX_TYPES as readonly string[]).includes(t);

const field = z.string().max(2000).default("");

export const TxCopyOverrideSchema = z
  .object({
    /** Temat wiadomości (bez sufiksu marki - dopisujemy go automatycznie). */
    subject: field,
    /** Tekst preheader widoczny na liście wiadomości. */
    preview: field,
    /** Etykieta nad nagłówkiem. */
    eyebrow: field,
    heading: field,
    /** Akapit wstępny - zastępuje treść personalizowaną. */
    intro: field,
    /** Dodatkowy akapit pod szczegółami. */
    extra: field,
    /** Etykieta przycisku CTA. */
    cta: field,
    /** Ramka "co dalej". */
    note: field,
  })
  .default({});

export type TxCopyOverride = z.infer<typeof TxCopyOverrideSchema>;

export const TxLangOverrideSchema = z
  .object({ pl: TxCopyOverrideSchema, en: TxCopyOverrideSchema })
  .default({});

export type TxLangOverride = z.infer<typeof TxLangOverrideSchema>;

export const TxOverridesSchema = z
  .object({
    team_seat_grace: TxLangOverrideSchema,
    team_seat_grace_reminder: TxLangOverrideSchema,
    team_seat_access_ended: TxLangOverrideSchema,
  })
  .default({});

export type TxOverrides = z.infer<typeof TxOverridesSchema>;

export const TX_OVERRIDES_DEFAULTS: TxOverrides = TxOverridesSchema.parse({});

export const EMPTY_TX_COPY_OVERRIDE: TxCopyOverride = TxCopyOverrideSchema.parse({});

/** Bezpieczny parse - nieznany kształt nigdy nie może wywrócić wysyłki. */
export function parseTxOverrides(raw: unknown): TxOverrides {
  const parsed = TxOverridesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : TX_OVERRIDES_DEFAULTS;
}

/** Zmienne dostępne w treści jako `{token}`. */
export interface TxOverrideTokens {
  planName?: string | null;
  orgName?: string | null;
  accessUntil?: string | null;
  daysLeft?: number | null;
  subject?: string | null;
  firstName?: string | null;
}

export const TX_OVERRIDE_TOKENS: readonly (keyof TxOverrideTokens)[] = [
  "planName",
  "orgName",
  "accessUntil",
  "daysLeft",
  "subject",
  "firstName",
];

/** Podstawia `{token}` wartościami zdarzenia; nieznane tokeny znikają. */
export function interpolate(input: string, tokens: TxOverrideTokens): string {
  return input
    .replace(/\{(\w+)\}/g, (_m, key: string) => {
      const value = tokens[key as keyof TxOverrideTokens];
      return value === null || value === undefined ? "" : String(value);
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Zwraca nadpisanie dla typu i języka (zawsze pełny kształt). */
export function overrideFor(
  overrides: TxOverrides,
  type: TxEmailType,
  lang: EmailLang,
): TxCopyOverride {
  if (!isEditableTxType(type)) return EMPTY_TX_COPY_OVERRIDE;
  return overrides[type][lang] ?? EMPTY_TX_COPY_OVERRIDE;
}

/** Pojedyncze pole po interpolacji lub `null`, gdy admin go nie ustawił. */
export function resolvedField(
  override: TxCopyOverride,
  key: keyof TxCopyOverride,
  tokens: TxOverrideTokens,
): string | null {
  const raw = (override[key] ?? "").trim();
  if (!raw) return null;
  const out = interpolate(raw, tokens);
  return out ? out : null;
}

/* -------------------------------------------------------------------------- */
/*  Klient (admin)                                                            */
/* -------------------------------------------------------------------------- */

/** Hook: bieżące nadpisania treści z site_settings. */
export function useTxOverrides(): TxOverrides {
  const raw = useSiteSetting<TxOverrides>(TX_OVERRIDES_SETTING_KEY, TX_OVERRIDES_DEFAULTS);
  return parseTxOverrides(raw);
}

/** Zapis nadpisań treści. */
export function useSaveTxOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: TxOverrides) => {
      const value = TxOverridesSchema.parse(next);
      const { error } = await supabase
        .from("site_settings")
        .upsert(
          { key: TX_OVERRIDES_SETTING_KEY, value: toJson(value) },
          { onConflict: "tenant_id,key" },
        );
      if (error) throw error;
      return value;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
      qc.invalidateQueries({ queryKey: ["email-previews"] });
      toast.success("Zapisano treści maili");
    },
    onError: (e: Error) => toast.error(e.message || "Błąd zapisu"),
  });
}
