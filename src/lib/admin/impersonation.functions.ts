// Super-admin "Zaloguj jako" / impersonation server functions.
// Bezpieczeństwo: dostępne wyłącznie dla użytkownika z rolą super_admin
// (weryfikacja przez is_super_admin RPC). Każde użycie jest audytowane w
// public.impersonation_sessions (RLS: read tylko super_admin, zapis przez
// service_role z tego pliku).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface StartImpersonationInput {
  targetUserId: string;
  reason?: string;
}

interface StartImpersonationResult {
  ok: true;
  tokenHash: string;
  email: string;
  targetUserId: string;
  sessionId: string;
}

export const startImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: StartImpersonationInput): StartImpersonationInput => {
    if (!input || typeof input.targetUserId !== "string" || input.targetUserId.length < 8) {
      throw new Error("targetUserId required");
    }
    return {
      targetUserId: input.targetUserId,
      reason: typeof input.reason === "string" ? input.reason.slice(0, 500) : undefined,
    };
  })
  .handler(async ({ data, context }): Promise<StartImpersonationResult> => {
    const { data: isSuper, error: roleError } = await context.supabase.rpc("is_super_admin");
    if (roleError || !isSuper) {
      throw new Error("Forbidden: super_admin required");
    }
    if (data.targetUserId === context.userId) {
      throw new Error("Cannot impersonate yourself");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target, error: getErr } = await supabaseAdmin.auth.admin.getUserById(
      data.targetUserId,
    );
    if (getErr || !target?.user?.email) {
      throw new Error("Target user not found or has no email");
    }
    const email = target.user.email;

    const { data: actorProfile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();

    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link?.properties?.hashed_token) {
      throw new Error(linkErr?.message ?? "Could not generate impersonation token");
    }

    const { data: session, error: insErr } = await supabaseAdmin
      .from("impersonation_sessions")
      .insert({
        actor_user_id: context.userId,
        target_user_id: data.targetUserId,
        tenant_id: actorProfile?.tenant_id ?? null,
        reason: data.reason ?? null,
      })
      .select("id")
      .single();
    if (insErr || !session) {
      throw new Error("Could not record impersonation session");
    }

    return {
      ok: true,
      tokenHash: link.properties.hashed_token,
      email,
      targetUserId: data.targetUserId,
      sessionId: session.id,
    };
  });

interface EndImpersonationInput {
  sessionId: string;
}

export const endImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EndImpersonationInput): EndImpersonationInput => {
    if (!input || typeof input.sessionId !== "string") {
      throw new Error("sessionId required");
    }
    return { sessionId: input.sessionId };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("impersonation_sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", data.sessionId)
      .is("ended_at", null);
    return { ok: true } as const;
  });
