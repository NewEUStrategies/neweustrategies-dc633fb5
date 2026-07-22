// Warstwy członkostwa (membership_tiers) - warstwa danych + hooki.
// Warstwa wołającego jest rozstrzygana WYŁĄCZNIE serwerowo (RPC SECURITY
// DEFINER current_membership_tier) - klient dostaje gotowy klucz/rangę do
// wyświetlania i miękkiego gatingu UI; twarde bramki (join_url wydarzeń itd.)
// i tak egzekwuje baza.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database, Json } from "@/integrations/supabase/types";

export type MembershipTierRow = Database["public"]["Tables"]["membership_tiers"]["Row"];

/**
 * Pojedynczy benefit warstwy. Rdzeń to para pl/en; pola opcjonalne rozszerzają
 * prezentację na /pricing (wzorce prasy cyfrowej):
 *  - detail_*  jednozdaniowe rozwinięcie pod benefitem (styl NYT),
 *  - group_*   nagłówek sekcji grupujący kolejne benefity (styl FT).
 * Format w bazie pozostaje jsonb [{pl,en,...}] - starsi konsumenci ignorują
 * dodatkowe pola, a serializacja (serializeTierBenefits) nigdy ich nie gubi.
 */
export interface TierBenefit {
  pl: string;
  en: string;
  detail_pl?: string;
  detail_en?: string;
  group_pl?: string;
  group_en?: string;
}

export interface CurrentTier {
  key: string;
  rank: number;
  name_pl: string;
  name_en: string;
  features: Json;
}

/**
 * Rangi kanoniczne (seed DB, katalog v3): Essential=0, wspierający=5,
 * Plus=10 (student/kadra akademicka również 10), Pro=20 (NGO=20), VIP=25
 * (zespół=25), Enterprise=30, Strategic Partner=40, Partner Generalny=50,
 * President's Circle=60.
 */
export const TIER_RANKS = {
  reader: 0,
  supporter: 5,
  member: 10,
  student: 10,
  educator: 10,
  pro: 20,
  ngo: 20,
  vip: 25,
  team: 25,
  corporate: 30,
  partner: 40,
  partner_general: 50,
  presidents_circle: 60,
} as const;

export function parseTierBenefits(benefits: Json): TierBenefit[] {
  if (!Array.isArray(benefits)) return [];
  const str = (rec: Record<string, unknown>, key: string): string =>
    typeof rec[key] === "string" ? (rec[key] as string) : "";
  return benefits.flatMap((b) => {
    if (b && typeof b === "object" && !Array.isArray(b)) {
      const rec = b as Record<string, unknown>;
      const pl = str(rec, "pl");
      const en = str(rec, "en");
      if (!pl && !en) return [];
      const out: TierBenefit = { pl: pl || en, en: en || pl };
      const detailPl = str(rec, "detail_pl");
      const detailEn = str(rec, "detail_en");
      const groupPl = str(rec, "group_pl");
      const groupEn = str(rec, "group_en");
      if (detailPl || detailEn) {
        out.detail_pl = detailPl || detailEn;
        out.detail_en = detailEn || detailPl;
      }
      if (groupPl || groupEn) {
        out.group_pl = groupPl || groupEn;
        out.group_en = groupEn || groupPl;
      }
      return [out];
    }
    return [];
  });
}

/**
 * Serializacja benefitów do jsonb - jedyne miejsce zapisu (panel membership
 * i panel cennika), żeby żaden edytor nie gubił pól drugiego. Puste wiersze
 * odpadają, brakująca wersja językowa dziedziczy z drugiej, pola opcjonalne
 * trafiają do JSON-a tylko gdy niepuste.
 */
export function serializeTierBenefits(list: TierBenefit[]): Json {
  const out: Record<string, string>[] = [];
  for (const b of list) {
    const pl = b.pl.trim();
    const en = b.en.trim();
    if (!pl && !en) continue;
    const rec: Record<string, string> = { pl: pl || en, en: en || pl };
    const detailPl = (b.detail_pl ?? "").trim();
    const detailEn = (b.detail_en ?? "").trim();
    if (detailPl || detailEn) {
      rec.detail_pl = detailPl || detailEn;
      rec.detail_en = detailEn || detailPl;
    }
    const groupPl = (b.group_pl ?? "").trim();
    const groupEn = (b.group_en ?? "").trim();
    if (groupPl || groupEn) {
      rec.group_pl = groupPl || groupEn;
      rec.group_en = groupEn || groupPl;
    }
    out.push(rec);
  }
  return out;
}

export function tierName(
  tier: Pick<MembershipTierRow, "name_pl" | "name_en">,
  lang: string,
): string {
  return lang === "en" ? tier.name_en || tier.name_pl : tier.name_pl || tier.name_en;
}

/** Czy zestaw flag features (JSON) ma daną flagę ustawioną na true. */
export function tierHasFeature(features: Json, key: string): boolean {
  if (!features || typeof features !== "object" || Array.isArray(features)) return false;
  return (features as Record<string, unknown>)[key] === true;
}

export async function fetchMembershipTiers(): Promise<MembershipTierRow[]> {
  const { data, error } = await supabase
    .from("membership_tiers")
    .select("*")
    .eq("active", true)
    .order("rank", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export function useMembershipTiers(): UseQueryResult<MembershipTierRow[]> {
  return useQuery({ queryKey: ["membership-tiers"], queryFn: fetchMembershipTiers });
}

export async function fetchCurrentTier(): Promise<CurrentTier | null> {
  const { data, error } = await supabase.rpc("current_membership_tier");
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Warstwa bieżącego użytkownika (dla anonów: warstwa domyślna tenantu). */
export function useCurrentTier(): UseQueryResult<CurrentTier | null> {
  const { user } = useAuth();
  return useQuery({
    // Klucz zawiera uid, żeby zmiana konta nie serwowała cudzej warstwy z cache.
    queryKey: ["current-tier", user?.id ?? "anon"],
    queryFn: fetchCurrentTier,
    staleTime: 60_000,
  });
}
