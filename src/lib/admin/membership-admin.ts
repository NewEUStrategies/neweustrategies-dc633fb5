// Panel członkostwa (admin) — warstwa danych dla nadań warstwy poza planem
// oraz organizacji członkowskich (korporacyjnych / partnerskich) z miejscami.
// Nadania i miejsca rozstrzyga potem current_membership_tier() — członkostwo
// to pakiet praw, nie tylko subskrypcja płatna.
import { supabase } from "@/integrations/supabase/client";
import { currentUserIdFromSession } from "@/lib/auth/currentUser";
import type { Database } from "@/integrations/supabase/types";
import { listMembers } from "@/lib/admin/membersDirectory.functions";
import { editConflictError } from "@/lib/content/saveConflict";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";

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

// JEDNA ŚCIEŻKA NADAŃ (S1 def. 6, PLAN S1 §4.4). Dawniej były dwie:
// `admin_grant_membership` (e-mail szukany GLOBALNIE w `auth.users` - bez
// sprawdzenia najemcy, bez wygaszania poprzedniego nadania, bez audytu) i
// `setMemberTier` (klient serwisowy, wygaszał WSZYSTKIE źródła nadań, także
// darowizny i domeny organizacji, poza transakcją). Teraz oba ekrany wołają
// te same RPC: `admin_membership_grant_set` / `admin_membership_grant_revoke`
// - użytkownik z najemcy, warstwa aktywna, wygaszenie wyłącznie nadań
// ręcznych tej osoby, wpis audytu i outbox CRM w JEDNEJ transakcji SQL.
// Sygnatury RPC trafią do `types.ts` w I9 (N19) - do tego czasu wywołanie
// przez `RpcCallable` z nazwą funkcji LITERAŁEM (bramka kontraktu TS⇄SQL).

export interface SetMembershipGrantInput {
  userId: string;
  tierKey: string;
  /** ISO; `null` = bezterminowo. Data z przeszłości → 22023 `expires_in_past`. */
  expiresAt: string | null;
  note: string | null;
}

/**
 * Nadanie warstwy członkowi najemcy. Zwraca id nadania. Błędy niosą kod
 * maszynowy (`user_not_in_tenant`, `tier_inactive`, `expires_in_past`, 42501) -
 * ekran tłumaczy je po kodzie.
 */
export async function setMembershipGrant(input: SetMembershipGrantInput): Promise<string> {
  const { data, error } = await (supabase as unknown as RpcCallable).rpc(
    "admin_membership_grant_set",
    {
      p_user_id: input.userId,
      p_tier_key: input.tierKey,
      p_expires_at: input.expiresAt,
      p_note: input.note,
    },
  );
  if (error) throw error;
  if (typeof data !== "string") throw new Error("invalid_rpc_shape:admin_membership_grant_set");
  return data;
}

/**
 * Cofnięcie nadania - stempel `revoked_at` w SQL (ślad zostaje), audyt
 * z powodem. Nadanie cudze, cofnięte albo nieistniejące → P0002 `grant_not_found`.
 */
export async function revokeMembershipGrant(input: {
  grantId: string;
  reason: string | null;
}): Promise<string> {
  const { data, error } = await (supabase as unknown as RpcCallable).rpc(
    "admin_membership_grant_revoke",
    { p_grant_id: input.grantId, p_reason: input.reason },
  );
  if (error) throw error;
  if (typeof data !== "string") throw new Error("invalid_rpc_shape:admin_membership_grant_revoke");
  return data;
}

export interface TenantMemberMatch {
  userId: string;
  email: string;
  displayName: string | null;
  /** Warstwa rozstrzygnięta dziś (nadanie, subskrypcja albo próg domyślny). */
  tierKey: string;
}

/** Najdłuższa fraza, jaką przyjmuje wyszukiwarka katalogu członków. */
const MEMBER_SEARCH_MAX = 160;
/** Sufit stron katalogu (`listMembers` - walidator `page ≤ 400`). */
const MEMBER_SEARCH_MAX_PAGES = 400;

/**
 * Członek NAJEMCY po adresie e-mail (D-S1-09). Panel nadań ma pole e-mail,
 * a RPC nadania przyjmuje `user_id` - adres rozwiązujemy w katalogu członków
 * (`listMembers`: rola administratora, najemca z sesji), dopasowanie DOKŁADNE
 * bez wielkości liter (wyszukiwarka katalogu dopasowuje fragmentem). `null` =
 * brak konta w tym najemcy: ekran mówi to wprost, zamiast pokazywać wyjątek SQL.
 */
export async function findTenantMemberByEmail(email: string): Promise<TenantMemberMatch | null> {
  const needle = email.trim().toLowerCase();
  if (!needle || needle.length > MEMBER_SEARCH_MAX) return null;
  for (let page = 1; page <= MEMBER_SEARCH_MAX_PAGES; page += 1) {
    const result = await listMembers({ data: { search: needle, page } });
    const hit = result.rows.find((row) => row.email.trim().toLowerCase() === needle);
    if (hit) {
      return {
        userId: hit.userId,
        email: hit.email,
        displayName: hit.displayName,
        tierKey: hit.tierKey,
      };
    }
    if (result.rows.length === 0 || page * result.pageSize >= result.total) return null;
  }
  return null;
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
  const uid = await currentUserIdFromSession();
  const { data, error } = await supabase
    .from("member_organizations")
    .insert({ ...input, created_by: uid })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Zapis karty organizacji z optimistic-lockiem.
 *
 * PO CO WERSJA. Formularz karty wysyła CAŁY obiekt, nie same zmienione pola,
 * więc bez porównania wersji zapis last-write-wins cicho cofa każdą zmianę,
 * która weszła w międzyczasie - także tę zrobioną funkcją serwerową
 * (`org_set_seats_limit`) z sąsiedniej zakładki. Nikt nie dostawał wtedy
 * żadnego sygnału, a jedynym śladem zostawało `updated_at`.
 *
 * `baseUpdatedAt` to `updated_at`, który klient OSTATNIO WIDZIAŁ. Warunek
 * `.eq("updated_at", …)` jest atomowy: albo trafia w ten sam wiersz, albo nie
 * trafia w żaden. Ten sam kontrakt i ten sam kod błędu co przy zapisie postów
 * i stron (`saveConflict.ts`), więc klient rozpoznaje konflikt jedną regułą.
 *
 * Wywołanie BEZ `baseUpdatedAt` zachowuje się jak dotąd (bez guardu) - jest
 * tak celowo, bo ścieżki, które zmieniają pojedynczą kolumnę i nie trzymają
 * draftu, nie mają czym się zderzyć.
 */
export async function updateOrganization(
  id: string,
  patch: Partial<Database["public"]["Tables"]["member_organizations"]["Update"]>,
  baseUpdatedAt?: string | null,
): Promise<string | null> {
  let q = supabase.from("member_organizations").update(patch).eq("id", id);
  if (baseUpdatedAt) q = q.eq("updated_at", baseUpdatedAt);
  // `.select()` odróżnia „zapisano" od „nie trafiono w żaden wiersz":
  // PostgREST oddaje zero wierszy i `error: null`, gdy warunek nie trafił albo
  // gdy polityka RLS odfiltrowała cel. Bez tego odczytu klient pokazywałby
  // „Zapisano", choć nic nie zostało zapisane.
  const { data, error } = await q.select("id, updated_at");
  if (error) throw error;
  if (!data?.length) {
    // Zero wierszy ma DWIE przyczyny: konflikt wersji (wiersz istnieje, ale ma
    // inny `updated_at`) albo odmowa RLS (wiersz niewidoczny dla tej roli).
    // Rozróżniamy je dodatkowym odczytem, żeby komunikat nie mylił „ktoś
    // zapisał przed Tobą" z „nie masz uprawnień".
    if (baseUpdatedAt) {
      const { data: still } = await supabase
        .from("member_organizations")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (still) throw editConflictError("organization");
    }
    throw new Error("Save rejected - you do not have permission to edit this organization");
  }
  // Nowa baza optimistic-locka dla kolejnego zapisu. Bez tego druga zmiana
  // w tej samej sesji zgłaszałaby FAŁSZYWY konflikt z własnym zapisem.
  return data[0].updated_at ?? null;
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
