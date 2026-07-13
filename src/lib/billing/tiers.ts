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

export interface TierBenefit {
  pl: string;
  en: string;
}

export interface CurrentTier {
  key: string;
  rank: number;
  name_pl: string;
  name_en: string;
  features: Json;
}

/**
 * Rangi kanoniczne (seed DB): konto bezpłatne=0, wspierający=5, członek=10,
 * ekspercki=20, korporacyjny=30, partner strategiczny=40.
 */
export const TIER_RANKS = {
  reader: 0,
  supporter: 5,
  member: 10,
  pro: 20,
  corporate: 30,
  partner: 40,
} as const;

export function parseTierBenefits(benefits: Json): TierBenefit[] {
  if (!Array.isArray(benefits)) return [];
  return benefits.flatMap((b) => {
    if (b && typeof b === "object" && !Array.isArray(b)) {
      const rec = b as Record<string, unknown>;
      const pl = typeof rec.pl === "string" ? rec.pl : "";
      const en = typeof rec.en === "string" ? rec.en : "";
      if (pl || en) return [{ pl: pl || en, en: en || pl }];
    }
    return [];
  });
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
