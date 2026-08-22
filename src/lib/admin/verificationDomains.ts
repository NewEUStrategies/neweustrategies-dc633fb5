// Weryfikacja organizacyjna: katalog zaufanych domen e-mail.
// Wszystkie mutacje idą przez RPC SECURITY DEFINER, które wyprowadzają tenant
// z sesji administratora - klient nigdy nie podaje tenant_id.
import { supabase } from "@/integrations/supabase/client";
import { isProfileBadgeKind, type ProfileBadgeKind } from "@/lib/profile/badgeCatalog";

export interface VerificationDomainRow {
  id: string;
  tenant_id: string;
  domain: string;
  badge: ProfileBadgeKind;
  note: string | null;
  active: boolean;
  require_email_confirmed: boolean;
  /** Warstwa członkostwa nadawana automatycznie kontom z tej domeny (np. "vip"). */
  grants_tier_key: string | null;
  /**
   * Domena uczelni. Adres w niej zwalnia z RĘCZNEJ weryfikacji stawki
   * studenckiej i akademickiej - katalog v6.1 opisuje ten proces jako
   * automatyczny tam, gdzie domena jest na liście, i ręczny wyłącznie jako
   * wyjątek (audyt, rozdział 4).
   */
  academic: boolean;
  created_at: string;
  updated_at: string;
}

export interface VerificationSweepResult {
  checked: number;
  granted: number;
  revoked: number;
}

/** Ten sam wzorzec, którego pilnuje CHECK w bazie. */
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Przyjmuje "@Firma.PL", "https://firma.pl/x" oraz "user@firma.pl". */
export function normalizeDomainInput(raw: string): string {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  const at = value.lastIndexOf("@");
  if (at >= 0) value = value.slice(at + 1);
  value = value.split("/")[0] ?? "";
  return value.replace(/\.$/, "");
}

export function isValidVerificationDomain(value: string): boolean {
  return DOMAIN_RE.test(value);
}

function toRow(
  row: Omit<VerificationDomainRow, "badge"> & { badge: string },
): VerificationDomainRow | null {
  if (!isProfileBadgeKind(row.badge)) return null;
  return { ...row, badge: row.badge };
}

export async function fetchVerificationDomains(): Promise<VerificationDomainRow[]> {
  const { data, error } = await supabase.rpc("admin_list_verification_domains");
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const mapped = toRow(row);
    return mapped ? [mapped] : [];
  });
}

export async function upsertVerificationDomain(input: {
  domain: string;
  badge: ProfileBadgeKind;
  note?: string;
  active?: boolean;
  requireEmailConfirmed?: boolean;
  grantsTierKey?: string | null;
  academic?: boolean;
}): Promise<string> {
  const domain = normalizeDomainInput(input.domain);
  if (!isValidVerificationDomain(domain)) {
    throw new Error("invalid-domain");
  }
  const note = input.note?.trim() ?? "";
  if (note.length > 500) throw new Error("note-too-long");

  const { data, error } = await supabase.rpc("admin_upsert_verification_domain", {
    p_domain: domain,
    p_badge: input.badge,
    p_note: note || undefined,
    p_active: input.active ?? true,
    p_require_email_confirmed: input.requireEmailConfirmed ?? true,
    p_grants_tier_key: input.grantsTierKey ?? undefined,
    p_academic: input.academic ?? false,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteVerificationDomain(id: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_verification_domain", { p_id: id });
  if (error) throw error;
}

export function parseSweepResult(value: unknown): VerificationSweepResult {
  const source = (value ?? {}) as Record<string, unknown>;
  const num = (key: string): number => {
    const raw = source[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  };
  return { checked: num("checked"), granted: num("granted"), revoked: num("revoked") };
}

export async function runOrgVerificationSweep(): Promise<VerificationSweepResult> {
  const { data, error } = await supabase.rpc("admin_run_org_verification");
  if (error) throw error;
  return parseSweepResult(data);
}
