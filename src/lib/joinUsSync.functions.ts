// Server fns spinające formularz "Dołącz do nas" / newsletter z kontem zalogowanego
// użytkownika:
//  - getJoinUsPrefill  → zwraca wartości z profiles do prefill'u (imię, nazwisko,
//    kraj/lokalizacja, LinkedIn, telefon, firma, stanowisko)
//  - linkJoinUsAndBackfill → po udanym subscribe wiąże newsletter_subscribers.user_id
//    z auth.uid() oraz uzupełnia w profiles WYŁĄCZNIE puste pola (nie nadpisuje
//    istniejących) - przez RPC public.join_us_link_and_backfill.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type JoinUsPrefill = {
  firstName: string;
  lastName: string;
  country: string;
  linkedin: string;
  phone: string;
  company: string;
  position: string;
};

const EMPTY: JoinUsPrefill = {
  firstName: "",
  lastName: "",
  country: "",
  linkedin: "",
  phone: "",
  company: "",
  position: "",
};

// GET (auth): najbezpieczniejsze - user czyta własny profil pod RLS.
export const getJoinUsPrefill = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JoinUsPrefill> => {
    const { supabase } = context;
    // Own-row read via SECURITY DEFINER RPC (scoped to auth.uid()): location /
    // phone are PII no longer granted to `authenticated` role-wide.
    const { data: rows, error } = await supabase.rpc("get_own_profile");
    const data = rows?.[0];
    if (error || !data) return EMPTY;
    return {
      firstName: data.first_name ?? "",
      lastName: data.last_name ?? "",
      country: data.location ?? "",
      linkedin: data.linkedin_url ?? "",
      phone: data.phone ?? "",
      company: data.current_company ?? "",
      position: data.job_title ?? "",
    };
  });

const LinkInput = z.object({
  email: z.string().trim().email().max(254),
  firstName: z.string().trim().max(100).optional().default(""),
  lastName: z.string().trim().max(100).optional().default(""),
  country: z.string().trim().max(200).optional().default(""),
  linkedin: z.string().trim().max(500).optional().default(""),
  phone: z.string().trim().max(60).optional().default(""),
  company: z.string().trim().max(200).optional().default(""),
  position: z.string().trim().max(200).optional().default(""),
});

// POST (auth): wywołuje RPC pod service_role (RPC ma REVOKE FROM PUBLIC, więc
// wymaga admin clienta; sama funkcja RPC waliduje przez zestaw parametrów).
export const linkJoinUsAndBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LinkInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { userId } = context;

    // Tenant per-host: subskrypcja jest per-tenant, więc powiązanie też.
    const [{ resolveTenantIdForHost }, { currentTenantHost }] = await Promise.all([
      import("@/lib/server/tenant.server"),
      import("@/lib/http/requestHost"),
    ]);
    const tenantId = await resolveTenantIdForHost(await currentTenantHost());
    if (!tenantId) return { ok: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("join_us_link_and_backfill", {
      _user_id: userId,
      _tenant_id: tenantId,
      _email: data.email,
      _first_name: data.firstName,
      _last_name: data.lastName,
      _country: data.country,
      _linkedin: data.linkedin,
      _phone: data.phone,
      _company: data.company,
      _position: data.position,
    });
    if (error) {
      console.error("[join-us] link+backfill failed", error);
      return { ok: false };
    }
    return { ok: true };
  });
