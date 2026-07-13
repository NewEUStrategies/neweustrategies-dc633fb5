// Panel członkostwa (admin) — warstwa danych dla nadań warstwy poza planem
// oraz organizacji członkowskich (korporacyjnych / partnerskich) z miejscami.
// Nadania i miejsca rozstrzyga potem current_membership_tier() — członkostwo
// to pakiet praw, nie tylko subskrypcja płatna.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

// ------- Nadania warstwy (membership_grants) --------

export interface AdminGrantRow {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  tier_key: string;
  source: string;
  note: string | null;
  starts_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export async function fetchMembershipGrants(): Promise<AdminGrantRow[]> {
  const { data, error } = await supabase.rpc("admin_list_membership_grants");
  if (error) throw error;
  return (data ?? []) as AdminGrantRow[];
}

/** Nadanie po e-mailu; p_months=null => bezterminowo. Zwraca id nadania. */
export async function grantMembership(input: {
  email: string;
  tierKey: string;
  months: number | null;
  note: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("admin_grant_membership", {
    p_email: input.email,
    p_tier_key: input.tierKey,
    p_months: input.months ?? undefined,
    p_note: input.note ?? undefined,
  });
  if (error) throw error;
  return data as string;
}

export async function revokeGrant(id: string): Promise<void> {
  const { error } = await supabase
    .from("membership_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ------- Organizacje członkowskie --------

export type OrganizationRow = Database["public"]["Tables"]["member_organizations"]["Row"];
export type OrgSeatRow = Database["public"]["Tables"]["organization_seats"]["Row"];

export async function fetchOrganizations(): Promise<OrganizationRow[]> {
  const { data, error } = await supabase
    .from("member_organizations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export interface OrgInput {
  name: string;
  tier_key: string;
  seats_limit: number;
  contact_email: string | null;
  note: string | null;
  slug?: string | null;
  description?: string | null;
  website_url?: string | null;
  sector?: string | null;
  city?: string | null;
  country?: string | null;
  brand_primary?: string | null;
  brand_accent?: string | null;
  brand_ink?: string | null;
  logo_h_light?: string | null;
  logo_h_dark?: string | null;
  logo_v_light?: string | null;
  logo_v_dark?: string | null;
  logo_favicon?: string | null;
}

export async function fetchOrganizationById(id: string): Promise<OrganizationRow | null> {
  const { data, error } = await supabase
    .from("member_organizations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createOrganization(input: OrgInput): Promise<OrganizationRow> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("member_organizations")
    .insert({ ...input, created_by: auth.user?.id ?? null })
    .select()
    .single();
  if (error) throw error;
  return data;
}


export async function updateOrganization(
  id: string,
  patch: Partial<Database["public"]["Tables"]["member_organizations"]["Update"]>,
): Promise<void> {
  const { error } = await supabase.from("member_organizations").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteOrganization(id: string): Promise<void> {
  const { error } = await supabase.from("member_organizations").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchAdminOrgSeats(orgId: string): Promise<OrgSeatRow[]> {
  const { data, error } = await supabase
    .from("organization_seats")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Miejsce dodawane przez RPC (limit i rola egzekwowane serwerowo). */
export async function addOrgSeat(
  orgId: string,
  email: string,
  role: "owner" | "member",
): Promise<string> {
  const { data, error } = await supabase.rpc("org_add_seat", {
    p_org: orgId,
    p_email: email,
    p_role: role,
  });
  if (error) throw error;
  return data as string;
}

export async function removeOrgSeat(seatId: string): Promise<void> {
  const { error } = await supabase.from("organization_seats").delete().eq("id", seatId);
  if (error) throw error;
}
