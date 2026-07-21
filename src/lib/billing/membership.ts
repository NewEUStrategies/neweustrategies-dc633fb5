// Warstwa danych huba członkostwa (/profile/membership). Członkostwo to pakiet
// PRAW, nie badge - ten moduł czyta te prawa i historię ich użycia:
//   * nadania warstwy poza planem (membership_grants: manualne / z darowizny),
//   * darowizny wołającego (status wspierającego),
//   * organizacja członkowska wołającego + jej miejsca (członkostwo korporacyjne),
//   * historia uczestnictwa: wydarzenia (RSVP) i pobrania z biblioteki.
// Twarde bramki i tak egzekwuje baza (RPC SECURITY DEFINER / RLS); tu dane do
// wyświetlenia i miękkiego zarządzania.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { currentUserIdFromSession } from "@/lib/auth/currentUser";
import { useAuth } from "@/hooks/useAuth";

export interface MembershipGrantRow {
  id: string;
  tier_key: string;
  source: "manual" | "donation" | "import" | string;
  note: string | null;
  starts_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export async function fetchMyGrants(): Promise<MembershipGrantRow[]> {
  const uid = await currentUserIdFromSession();
  if (!uid) return [];
  const { data, error } = await supabase
    .from("membership_grants")
    .select("id, tier_key, source, note, starts_at, expires_at, revoked_at, created_at")
    .eq("user_id", uid)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MembershipGrantRow[];
}

export function useMyGrants(): UseQueryResult<MembershipGrantRow[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-grants", user?.id ?? "anon"],
    queryFn: fetchMyGrants,
    enabled: !!user,
  });
}

export interface MyDonationRow {
  id: string;
  amount_cents: number;
  currency: string;
  status: "paid" | "refunded" | string;
  created_at: string;
}

export async function fetchMyDonations(): Promise<MyDonationRow[]> {
  const uid = await currentUserIdFromSession();
  if (!uid) return [];
  const { data, error } = await supabase
    .from("donations")
    .select("id, amount_cents, currency, status, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as MyDonationRow[];
}

export function useMyDonations(): UseQueryResult<MyDonationRow[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-donations", user?.id ?? "anon"],
    queryFn: fetchMyDonations,
    enabled: !!user,
  });
}

export interface MyOrganization {
  org_id: string;
  name: string;
  tier_key: string;
  my_role: "owner" | "member" | string;
  status: "active" | "suspended" | string;
  seats_limit: number;
  seats_used: number;
  starts_at: string;
  expires_at: string | null;
}

export async function fetchMyOrganization(): Promise<MyOrganization | null> {
  const uid = await currentUserIdFromSession();
  if (!uid) return null;
  const { data, error } = await supabase.rpc("my_organization");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as MyOrganization | null;
}

export function useMyOrganization(): UseQueryResult<MyOrganization | null> {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-organization", user?.id ?? "anon"],
    queryFn: fetchMyOrganization,
    enabled: !!user,
  });
}

export interface OrgSeatRow {
  id: string;
  invited_email: string;
  role: "owner" | "member" | string;
  claimed_at: string | null;
  created_at: string;
  last_invited_at: string | null;
}

/** Miejsca organizacji - widoczne dla właściciela (RLS: is_org_owner). */
export async function fetchOrgSeats(orgId: string): Promise<OrgSeatRow[]> {
  const { data, error } = await supabase
    .from("organization_seats")
    .select("id, invited_email, role, claimed_at, created_at, last_invited_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as OrgSeatRow[];
}

export function useOrgSeats(orgId: string | null | undefined): UseQueryResult<OrgSeatRow[]> {
  return useQuery({
    queryKey: ["org-seats", orgId ?? "none"],
    queryFn: () => fetchOrgSeats(orgId as string),
    enabled: !!orgId,
  });
}

/** Właściciel dodaje miejsce (RPC egzekwuje limit i rolę). */
export function useAddSeat(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await supabase.rpc("org_add_seat", {
        p_org: orgId as string,
        p_email: email,
        p_role: "member",
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["org-seats", orgId ?? "none"] });
      void qc.invalidateQueries({ queryKey: ["my-organization"] });
    },
  });
}

export function useRemoveSeat(orgId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (seatId: string) => {
      const { error } = await supabase.from("organization_seats").delete().eq("id", seatId);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["org-seats", orgId ?? "none"] });
      void qc.invalidateQueries({ queryKey: ["my-organization"] });
    },
  });
}

export interface EventParticipation {
  event_id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  kind: string;
  starts_at: string;
  ends_at: string | null;
  event_status: string;
  rsvp_status: string;
  rsvp_updated_at: string;
}

export async function fetchMyEventParticipation(): Promise<EventParticipation[]> {
  const uid = await currentUserIdFromSession();
  if (!uid) return [];
  const { data, error } = await supabase.rpc("my_event_participation");
  if (error) throw error;
  return (data ?? []) as EventParticipation[];
}

export function useMyEventParticipation(): UseQueryResult<EventParticipation[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-event-participation", user?.id ?? "anon"],
    queryFn: fetchMyEventParticipation,
    enabled: !!user,
  });
}

export interface ResourceDownloadHistory {
  resource_id: string;
  title_pl: string;
  title_en: string;
  category: string;
  downloaded_at: string;
}

export async function fetchMyResourceDownloads(): Promise<ResourceDownloadHistory[]> {
  const uid = await currentUserIdFromSession();
  if (!uid) return [];
  const { data, error } = await supabase.rpc("my_resource_downloads");
  if (error) throw error;
  return (data ?? []) as ResourceDownloadHistory[];
}

export function useMyResourceDownloads(): UseQueryResult<ResourceDownloadHistory[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-resource-downloads", user?.id ?? "anon"],
    queryFn: fetchMyResourceDownloads,
    enabled: !!user,
  });
}

/**
 * Odbiór zaproszonych miejsc w organizacjach po zalogowaniu (dopasowanie po
 * e-mailu konta). Idempotentne; odświeża warstwę i organizację, gdy coś odebrano.
 */
export function useClaimOrgSeats(): void {
  const { user } = useAuth();
  const qc = useQueryClient();
  useQuery({
    queryKey: ["claim-org-seats", user?.id ?? "anon"],
    enabled: !!user,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("claim_my_org_seats");
      if (error) throw error;
      const claimed = (data as number) ?? 0;
      if (claimed > 0) {
        void qc.invalidateQueries({ queryKey: ["current-tier"] });
        void qc.invalidateQueries({ queryKey: ["my-organization"] });
      }
      return claimed;
    },
  });
}
