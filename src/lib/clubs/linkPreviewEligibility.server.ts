// Kto może zlecić serwerowi pobranie podglądu linku (server-only).
//
// Podgląd to WYJŚCIE NA SIEĆ pod adres podany przez użytkownika. Bramka egress
// (DNS, https, brak przekierowań) pilnuje, DOKĄD wolno wyjść; ta funkcja
// pilnuje, KTO w ogóle może o to prosić. Podgląd istnieje wyłącznie dla
// kompozytora treści klubowej, więc prawo do niego ma tylko AKTYWNY członek
// klubu w najemcy wołającego - nie każde zalogowane konto.
//
// Odczyt idzie klientem serwisowym, bo `club_members` nie jest wystawione do
// Data API dla `authenticated`; zapytanie jest zawężone do `userId` z sesji
// i najemcy z jego profilu, więc niczego cudzego nie zwraca. Fail-closed:
// każdy błąd = brak prawa do podglądu.
export async function canRequestClubLinkPreview(userId: string): Promise<boolean> {
  try {
    const [{ supabaseAdmin }, { readUserTenantId }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/server/userTenant.server"),
    ]);
    const tenantId = await readUserTenantId(supabaseAdmin, userId);
    if (!tenantId) return false;
    const { data, error } = await supabaseAdmin
      .from("club_members")
      .select("id")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .is("ended_at", null)
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}
