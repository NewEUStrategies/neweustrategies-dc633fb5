// Server functions dla administracyjnego podsumowania zgód (audyt RODO).
//
// Czytamy WYŁĄCZNIE przez utwardzone RPC SECURITY DEFINER
// (`admin_consent_decisions`, `admin_consent_stats`), które same sprawdzają
// rolę admina i zawężają wynik do bieżącego najemcy - dzięki temu tabela
// `user_consent_events` pozostaje zamknięta polityką „tylko własne wpisy”,
// a panel i tak widzi pełny obraz swojego tenanta.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ConsentDecisionsQuerySchema,
  ConsentStatsQuerySchema,
  type ConsentDecisionRow,
  type ConsentStatRow,
} from "@/lib/admin/consentAudit.server";

export const listConsentDecisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ConsentDecisionsQuerySchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ConsentDecisionRow[]> => {
    const { data: rows, error } = await context.supabase.rpc("admin_consent_decisions", {
      p_limit: data.limit,
      p_offset: data.offset,
      p_source: data.source ?? undefined,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as ConsentDecisionRow[];
  });

export const listConsentStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ConsentStatsQuerySchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ConsentStatRow[]> => {
    const { data: rows, error } = await context.supabase.rpc("admin_consent_stats", {
      p_days: data.days,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as ConsentStatRow[];
  });
