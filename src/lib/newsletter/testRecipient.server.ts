// Odbiorca wysyłki TESTOWEJ kampanii (server-only).
//
// DLACZEGO OGRANICZENIE. Wysyłka testowa idzie z domeny nadawczej najemcy,
// z treścią kampanii, pod adres wpisany w panelu. Bez granicy każdy członek
// redakcji mógłby nią wysłać dowolną treść pod DOWOLNY adres - z naszej
// reputacji nadawczej i bez listy wykluczeń. Test ma sens tylko dla redakcji,
// więc odbiorcą może być wyłącznie POTWIERDZONY adres konta, które ma rolę
// redakcyjną w TYM najemcy (w tym sam wołający).
//
// Adresy bierzemy z serwera uwierzytelniania (`auth.admin.getUserById`), nie
// z `profiles.email` - tę kolumnę użytkownik może edytować sam.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

/** Role, których potwierdzone adresy mogą dostać wysyłkę testową. */
export const CAMPAIGN_TEST_RECIPIENT_ROLES: readonly AppRole[] = [
  "admin",
  "editor",
  "author",
  "super_admin",
];

/** Górna granica kont redakcji sprawdzanych przy jednym teście. */
export const CAMPAIGN_TEST_STAFF_SCAN = 200;
const LOOKUP_CHUNK = 10;

function normalize(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function confirmedEmailOf(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  const user = data?.user ?? null;
  if (error || user === null || !user.email_confirmed_at) return null;
  const email = normalize(user.email);
  return email === "" ? null : email;
}

/**
 * Czy `toEmail` jest potwierdzonym adresem wołającego albo innego konta
 * z rolą redakcyjną w `tenantId`. Fail-closed: błąd odczytu = odmowa.
 */
export async function isAllowedCampaignTestRecipient(
  admin: SupabaseClient<Database>,
  input: { tenantId: string; callerId: string; toEmail: string },
): Promise<boolean> {
  const target = normalize(input.toEmail);
  if (target === "") return false;

  if ((await confirmedEmailOf(admin, input.callerId)) === target) return true;

  const { data: roles, error } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("tenant_id", input.tenantId)
    .in("role", [...CAMPAIGN_TEST_RECIPIENT_ROLES])
    .limit(CAMPAIGN_TEST_STAFF_SCAN);
  if (error) return false;

  const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id))).filter(
    (id) => id !== input.callerId,
  );
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    const emails = await Promise.all(
      ids.slice(i, i + LOOKUP_CHUNK).map((id) => confirmedEmailOf(admin, id).catch(() => null)),
    );
    if (emails.includes(target)) return true;
  }
  return false;
}
