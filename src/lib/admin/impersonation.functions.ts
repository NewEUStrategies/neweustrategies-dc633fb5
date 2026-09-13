// Super-admin "Zaloguj jako" / impersonation server functions.
// Bezpieczeństwo: dostępne wyłącznie dla użytkownika z rolą super_admin
// (weryfikacja przez is_super_admin RPC). Każde użycie jest audytowane w
// public.impersonation_sessions (RLS: read tylko super_admin, zapis przez
// service_role z tego pliku).
// Autoryzacja: super_admin w tenancie wołającego (RPC is_super_admin) ORAZ
// jawne potwierdzenie, że konto docelowe należy do tego samego tenanta - klucz
// serwisowy omija RLS, więc granica najemcy musi być sprawdzona jawnie.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
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

/**
 * Adres i klient wywołania do wiersza audytu. Best-effort i CELOWO bez wpływu
 * na decyzję: dziennik podszyć ma odpowiadać na pytanie "skąd", ale brak
 * nagłówków nie jest powodem odmowy - powodem odmowy jest brak granicy
 * najemcy, nie brak metadanych.
 */
function requestOrigin(): { ip: string | null; userAgent: string | null } {
  try {
    const request = getRequest();
    const headers = request?.headers;
    if (!headers) return { ip: null, userAgent: null };
    const forwarded = headers.get("x-forwarded-for");
    const forwardedFirst = forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : null;
    const ip =
      headers.get("cf-connecting-ip") ?? forwardedFirst ?? headers.get("x-real-ip") ?? null;
    const userAgent = headers.get("user-agent");
    return { ip: ip || null, userAgent: userAgent ? userAgent.slice(0, 500) : null };
  } catch {
    // Brak kontekstu żądania - wiersz audytu powstanie bez tych pól.
    return { ip: null, userAgent: null };
  }
}

export const startImpersonation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: StartImpersonationInput): StartImpersonationInput => {
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

    // GRANICA NAJEMCY - sprawdzana JAWNIE, bo dalej pracuje klucz serwisowy,
    // który omija RLS. `is_super_admin()` odpowiada WYŁĄCZNIE o tenancie aktora
    // (`tenant_id = current_tenant_id()`, a `current_tenant_id()` to
    // `profiles.tenant_id` wołającego), więc sama ta bramka nie mówi NIC o celu.
    // Bez porównania poniżej super admin tenanta A wystawiałby sobie token
    // logowania do dowolnego konta w tenancie B. Wzorzec jak w
    // `accountAdmin.functions.ts` i w bazie (`change_user_role`:
    // `target_not_in_tenant`).
    const { data: actorProfile, error: actorErr } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    // Fail closed: odkąd tenant jest PREDYKATEM BEZPIECZEŃSTWA, a nie etykietą
    // wiersza audytu, brak odpowiedzi bazy musi znaczyć odmowę.
    if (actorErr || !actorProfile?.tenant_id) {
      throw new Error("Forbidden: could not verify tenant");
    }
    // Jedno źródło prawdy: to samo `tenantId` służy porównaniu i wierszowi audytu.
    const tenantId = actorProfile.tenant_id;

    // Profil CELU czytamy kluczem serwisowym CELOWO: przez RLS cudzy wiersz jest
    // niewidoczny, więc "inny tenant" i "nie ma wiersza" wyglądałyby tak samo,
    // a odmowa ma być zamknięta, nie przypadkowa.
    const { data: targetProfile, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", data.targetUserId)
      .maybeSingle();
    if (targetErr) {
      throw new Error("Forbidden: could not verify tenant");
    }
    // Jeden komunikat dla braku profilu i dla obcego tenanta - inaczej funkcja
    // staje się wyrocznią potwierdzającą istnienie identyfikatora w innym tenancie.
    if (!targetProfile || targetProfile.tenant_id !== tenantId) {
      throw new Error("Forbidden: target user is outside your tenant");
    }

    const { data: target, error: getErr } = await supabaseAdmin.auth.admin.getUserById(
      data.targetUserId,
    );
    if (getErr || !target?.user?.email) {
      throw new Error("Target user not found or has no email");
    }
    const email = target.user.email;

    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link?.properties?.hashed_token) {
      throw new Error(linkErr?.message ?? "Could not generate impersonation token");
    }

    const { ip, userAgent } = requestOrigin();

    const { data: session, error: insErr } = await supabaseAdmin
      .from("impersonation_sessions")
      .insert({
        actor_user_id: context.userId,
        target_user_id: data.targetUserId,
        tenant_id: tenantId,
        reason: data.reason ?? null,
        ip,
        user_agent: userAgent,
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
  .validator((input: EndImpersonationInput): EndImpersonationInput => {
    if (!input || typeof input.sessionId !== "string") {
      throw new Error("sessionId required");
    }
    return { sessionId: input.sessionId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Only the actor who started the session may end it - otherwise any
    // authenticated user could mark arbitrary impersonation audit rows ended
    // (startImpersonation is super_admin-gated, but this end path was not).
    await supabaseAdmin
      .from("impersonation_sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", data.sessionId)
      .eq("actor_user_id", context.userId)
      .is("ended_at", null);
    return { ok: true } as const;
  });
