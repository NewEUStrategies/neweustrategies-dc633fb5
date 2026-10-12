// Alert dla administratorów JEDNEGO najemcy (dzwonek), np. nieudany zwrot
// samoobsługowy albo zwrot do ręcznej obsługi.
//
// DLACZEGO NIE WZORZEC SPORÓW. `alertAdminsAboutDispute` (refunds.server.ts)
// powiadamia administratorów WSZYSTKICH najemców - administrator najemcy B
// dostawał identyfikatory transakcji najemcy A (MS M-9). Tu odbiorcami są
// wyłącznie osoby z rolą `admin` albo `super_admin`, których
// `profiles.tenant_id` jest najemcą zdarzenia (S24).
//
// FILTR NAJEMCY W OBU ZAPYTANIACH. Wiersz `user_roles` też ma `tenant_id`
// (`has_role` i `is_super_admin` sprawdzają rolę w najemcy żądania), więc rola
// administratora najemcy B NIE czyni nikogo administratorem najemcy A tylko
// dlatego, że jego profil wskazuje A. Odbiorca musi mieć rolę W TYM najemcy
// i profil w tym najemcy - każde zapytanie `supabaseAdmin` niesie
// `.eq("tenant_id", …)` (R-TS).
//
// TREŚĆ NIESIE TYLKO IDENTYFIKATORY. Żadnych adresów e-mail, nazwisk ani kwot
// z danymi osobowymi - wołający składa tytuł i treść z identyfikatorów.
// Każdy dzwonek przez `enqueue_notification` (najemca z profilu odbiorcy,
// deduplikacja, push). Nigdy nie rzuca: zwraca liczbę dostarczonych dzwonków.
//
// RAZ NA ZDARZENIE (`once`). Deduplikacja `enqueue_notification` trwa pięć
// minut i klucz ma postać (odbiorca, rodzaj, href): DWA różne spory ze
// wspólnym `/admin/billing` w tym oknie dawały jeden dzwonek, a ponowienie
// tego samego zdarzenia po kwadransie (redelivery operatora, przegląd
// zaległych zdarzeń) - drugi. Wołający, który przekazuje `once`, składa href
// unikalny dla zdarzenia (np. spór + faza), a tu każdy odbiorca, który ma już
// dzwonek z tym href, jest pomijany - po indeksie `(user_id, tenant_id, ...)`.
// Awaria tego odczytu NIE wstrzymuje alertu: lepszy duplikat niż cisza.

export interface TenantAdminAlertInput {
  tenantId: string;
  titlePl: string;
  titleEn: string;
  bodyPl: string;
  bodyEn: string;
  href: string;
  kind?: "billing" | "event";
  icon?: "credit-card" | "calendar-clock";
  /** Pomiń odbiorcę, który już dostał dzwonek z tym `href` (patrz nagłówek). */
  once?: boolean;
}

const ADMIN_ROLES = ["admin", "super_admin"] as const;

export async function notifyTenantAdmins(input: TenantAdminAlertInput): Promise<number> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", input.tenantId)
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

    const kind = input.kind ?? "billing";
    let delivered = 0;
    for (const profile of profiles ?? []) {
      if (input.once) {
        const { data: seen, error: seenError } = await supabaseAdmin
          .from("notifications")
          .select("id")
          .eq("user_id", profile.id)
          .eq("tenant_id", input.tenantId)
          .eq("kind", kind)
          .eq("href", input.href)
          .limit(1);
        if (seenError) {
          console.warn("[tenantAdminAlert] once lookup failed", { error: seenError.message });
        } else if ((seen ?? []).length > 0) {
          // Dzwonek już leży u odbiorcy - liczy się jako dostarczony.
          delivered += 1;
          continue;
        }
      }
      const { data, error } = await supabaseAdmin.rpc("enqueue_notification", {
        p_user_id: profile.id,
        p_kind: kind,
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
