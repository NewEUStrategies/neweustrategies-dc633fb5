// Alert dla administratorów JEDNEGO najemcy (dzwonek), np. nieudany zwrot
// samoobsługowy albo zwrot do ręcznej obsługi.
//
// DLACZEGO NIE WZORZEC SPORÓW. `alertAdminsAboutDispute` (refunds.server.ts)
// powiadamia administratorów WSZYSTKICH najemców - administrator najemcy B
// dostawał identyfikatory transakcji najemcy A (MS M-9). Tu odbiorcami są
// wyłącznie osoby z rolą `admin` albo `super_admin`, których
// `profiles.tenant_id` jest najemcą zdarzenia (S24). Rola jest globalna
// (`user_roles`), przynależność do najemcy rozstrzyga profil - i to drugie
// zapytanie niesie filtr `tenant_id`.
//
// TREŚĆ NIESIE TYLKO IDENTYFIKATORY. Żadnych adresów e-mail, nazwisk ani kwot
// z danymi osobowymi - wołający składa tytuł i treść z identyfikatorów.
// Każdy dzwonek przez `enqueue_notification` (najemca z profilu odbiorcy,
// deduplikacja, push). Nigdy nie rzuca: zwraca liczbę dostarczonych dzwonków.

export interface TenantAdminAlertInput {
  tenantId: string;
  titlePl: string;
  titleEn: string;
  bodyPl: string;
  bodyEn: string;
  href: string;
  kind?: "billing" | "event";
  icon?: "credit-card" | "calendar-clock";
}

const ADMIN_ROLES = ["admin", "super_admin"] as const;

export async function notifyTenantAdmins(input: TenantAdminAlertInput): Promise<number> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", [...ADMIN_ROLES]);
    if (rolesError) throw rolesError;
    const ids = [...new Set((roles ?? []).map((row) => row.user_id))];
    if (ids.length === 0) return 0;

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .in("id", ids);
    if (profilesError) throw profilesError;

    let delivered = 0;
    for (const profile of profiles ?? []) {
      const { data, error } = await supabaseAdmin.rpc("enqueue_notification", {
        p_user_id: profile.id,
        p_kind: input.kind ?? "billing",
        p_title_pl: input.titlePl,
        p_title_en: input.titleEn,
        p_body_pl: input.bodyPl,
        p_body_en: input.bodyEn,
        p_href: input.href,
        p_icon: input.icon ?? "credit-card",
      });
      if (error) {
        console.warn("[tenantAdminAlert] bell failed", { error: error.message });
        continue;
      }
      if (typeof data === "string" && data !== "") delivered += 1;
    }
    return delivered;
  } catch (err) {
    console.error("[tenantAdminAlert] alert failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
