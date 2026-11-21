// Klucze dopasowania API konwersji Meta dla ZALOGOWANYCH odwiedzających.
//
// Jakość dopasowania zdarzeń rośnie, gdy kopia serwerowa niesie skrót adresu
// e-mail (`em`) i stały identyfikator konta (`external_id`). Oba wysyłamy
// WYŁĄCZNIE jako SHA-256 (Meta wymaga skrótu) i tylko, gdy:
//   - przekaźnik przeszedł już bramki zgody marketingowej, GPC i pochodzenia,
//   - żądanie niesie ważny token sesji (weryfikuje go serwer autoryzacji),
//   - profil konta należy do najemcy hosta, z którego przyszło zdarzenie.
// Gość bez sesji dostaje tylko kraj z nagłówka brzegowego (ten sam, który
// i tak wynika z adresu IP przekazywanego Meta).
const COUNTRY_RE = /^[a-z]{2}$/;
const NON_COUNTRIES = new Set(["xx", "t1"]);

export interface MetaSignedInUser {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
}

export interface MetaMatchDeps {
  verifyUser: (accessToken: string) => Promise<MetaSignedInUser | null>;
  profileTenant: (userId: string) => Promise<string | null>;
}

export interface MetaMatchKeys {
  em?: string;
  externalId?: string;
  country?: string;
}

/** SHA-256 jako 64 znaki hex (format wymagany przez API konwersji). */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Adres e-mail w postaci normalizowanej przez Meta: bez spacji, małymi literami. */
export function normalizeMetaEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  return value.length > 3 && value.length <= 320 && value.includes("@") ? value : null;
}

/** Kod kraju z nagłówka Cloudflare (`cf-ipcountry`) albo null. */
export function countryFromHeaders(headers: Headers): string | null {
  const value = headers.get("cf-ipcountry")?.trim().toLowerCase() ?? "";
  return COUNTRY_RE.test(value) && !NON_COUNTRIES.has(value) ? value : null;
}

function bearerToken(headers: Headers): string | null {
  const raw = headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(raw.trim());
  return match?.[1] ?? null;
}

const defaultDeps: MetaMatchDeps = {
  async verifyUser(accessToken) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !data.user) return null;
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      emailConfirmed: Boolean(data.user.email_confirmed_at),
    };
  },
  async profileTenant(userId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return typeof data.tenant_id === "string" ? data.tenant_id : null;
  },
};

/**
 * Skróty kluczy dopasowania dla tej paczki. Każdy błąd degraduje do samych
 * kluczy gościa - analityka nigdy nie blokuje wysyłki.
 */
export async function resolveMetaMatchKeys(
  headers: Headers,
  tenantId: string,
  deps: MetaMatchDeps = defaultDeps,
): Promise<MetaMatchKeys> {
  const keys: MetaMatchKeys = {};
  const country = countryFromHeaders(headers);
  if (country) keys.country = await sha256Hex(country);

  const token = bearerToken(headers);
  if (!token) return keys;
  try {
    const user = await deps.verifyUser(token);
    if (!user) return keys;
    const userTenant = await deps.profileTenant(user.id);
    if (!userTenant || userTenant !== tenantId) return keys;
    keys.externalId = await sha256Hex(user.id);
    const email = user.emailConfirmed && user.email ? normalizeMetaEmail(user.email) : null;
    if (email) keys.em = await sha256Hex(email);
  } catch {
    return keys;
  }
  return keys;
}
