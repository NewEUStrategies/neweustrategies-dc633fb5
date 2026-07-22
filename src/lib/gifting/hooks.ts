// Gift Articles - warstwa danych (react-query + Supabase RPC).
//
// Egzekwowanie jest WYLACZNIE serwerowe (SECURITY DEFINER: create_gift_link /
// redeem_gift_link - patrz migracja 20260722112736): klient nigdy nie widzi
// body inaczej niz przez wazny kod, a generowanie linku wymaga aktywnej
// platnej subskrypcji. Ten modul dostarcza:
//   * odczyt ustawien (gift_article_settings, publiczne; brak wiersza =
//     funkcja wlaczona bez limitow),
//   * stan gifting dla popovera (gift_article_state - czysty odczyt),
//   * mutacje utworzenia linku (idempotentna per wpis/darczynca),
//   * realizacje kodu przez odbiorce (redeem - konsumpcja PO hydracji,
//     zeby boty/prefetch nie zawyzaly licznika odslon).
import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { EMPTY_BODY, hasRenderableBody, type BodyParts } from "@/lib/access/gating";
import {
  DEFAULT_GIFT_SETTINGS,
  mapGiftError,
  parseGiftCode,
  type GiftArticleState,
  type GiftErrorKey,
  type GiftLinkResult,
  type GiftSettings,
} from "@/lib/gifting/model";

export async function fetchGiftSettings(): Promise<GiftSettings> {
  const { data, error } = await supabase
    .from("gift_article_settings")
    .select("enabled, monthly_limit, link_ttl_days")
    .maybeSingle();
  if (error) throw error;
  return (data as GiftSettings | null) ?? DEFAULT_GIFT_SETTINGS;
}

/** Konfiguracja gifting (publiczna, singleton per tenant, cache 5 min). */
export function useGiftSettings(): UseQueryResult<GiftSettings> {
  return useQuery({
    queryKey: ["gift-settings"] as const,
    queryFn: fetchGiftSettings,
    staleTime: 5 * 60_000,
  });
}

interface GiftStateRow {
  enabled: boolean;
  can_gift: boolean;
  requires_auth: boolean;
  requires_subscription: boolean;
  used: number;
  monthly_limit: number;
  remaining: number | null;
  existing_code: string | null;
  expires_at: string | null;
}

function toGiftState(row: GiftStateRow): GiftArticleState {
  return {
    enabled: row.enabled,
    canGift: row.can_gift,
    requiresAuth: row.requires_auth,
    requiresSubscription: row.requires_subscription,
    used: row.used,
    monthlyLimit: row.monthly_limit,
    remaining: row.monthly_limit > 0 ? (row.remaining ?? 0) : null,
    existingCode: row.existing_code,
    expiresAt: row.expires_at,
  };
}

const giftStateKey = (postId: string | null, uid: string | null) =>
  ["gift-article-state", postId, uid] as const;

/**
 * Stan gifting dla popovera. Odpytywany tylko dla ZALOGOWANYCH (faza goscia
 * wynika z samego braku sesji - patrz resolveGiftPhase) i dopiero gdy
 * `enabled` (popover otwarty), zeby widok wpisu nie placil za RPC.
 */
export function useGiftArticleState(
  postId: string | null,
  enabled: boolean,
): UseQueryResult<GiftArticleState | null> {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;

  return useQuery({
    queryKey: giftStateKey(postId, uid),
    enabled: enabled && !!postId && !!uid,
    staleTime: 60_000,
    queryFn: async (): Promise<GiftArticleState | null> => {
      const { data, error } = await supabase.rpc("gift_article_state", {
        _post_id: postId as string,
      });
      if (error) throw error;
      const row = ((data ?? []) as GiftStateRow[])[0];
      return row ? toGiftState(row) : null;
    },
  });
}

interface GiftLinkRow {
  code: string;
  expires_at: string | null;
  used: number;
  monthly_limit: number;
  remaining: number | null;
}

export interface CreateGiftLink {
  mutation: UseMutationResult<GiftLinkResult, Error, void>;
  /** Klucz domenowy ostatniego bledu (dla copy i18n) lub null. */
  errorKey: GiftErrorKey | null;
}

/**
 * Utworzenie (lub idempotentny odczyt) linku podarunkowego dla wpisu.
 * Sukces dopisuje kod do cache stanu, wiec ponowne otwarcie popovera
 * nie strzela juz do create ani nie migocze.
 */
export function useCreateGiftLink(postId: string | null): CreateGiftLink {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (): Promise<GiftLinkResult> => {
      const { data, error } = await supabase.rpc("create_gift_link", {
        _post_id: postId as string,
      });
      if (error) throw error;
      const row = ((data ?? []) as GiftLinkRow[])[0];
      if (!row) throw new Error("gift_post_not_found");
      return {
        code: row.code,
        expiresAt: row.expires_at,
        used: row.used,
        monthlyLimit: row.monthly_limit,
        remaining: row.monthly_limit > 0 ? (row.remaining ?? 0) : null,
      };
    },
    onSuccess: (res) => {
      queryClient.setQueryData<GiftArticleState | null>(
        giftStateKey(postId, uid),
        (prev): GiftArticleState | null =>
          prev
            ? {
                ...prev,
                existingCode: res.code,
                expiresAt: res.expiresAt,
                used: res.used,
                remaining: res.remaining,
              }
            : (prev ?? null),
      );
    },
  });

  const errorKey = mutation.error ? mapGiftError(mutation.error.message) : null;
  return { mutation, errorKey };
}

/**
 * Kod podarunkowy z adresu biezacej strony (reaktywnie wzgledem nawigacji -
 * poddrzewo wpisu jest reuzywane przy przejsciach wpis -> wpis, wiec odczyt
 * "raz na mount" gubilby zmiane URL-a). Nieprawidlowy ksztalt kodu = null.
 */
export function useGiftCodeFromUrl(): string | null {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  return useMemo(() => parseGiftCode(searchStr ?? ""), [searchStr]);
}

/** Wynik realizacji kodu: body (gdy wazny) + werdykt + flaga zakonczenia. */
export interface GiftRedemption {
  body: BodyParts | null;
  /** null = jeszcze nie wiemy; false = kod niewazny/cudzy/wygasly. */
  valid: boolean | null;
  /** true, gdy zapytanie zakonczylo sie (albo bylo wylaczone). */
  settled: boolean;
}

interface RedeemRow {
  valid: boolean;
  content_pl: string | null;
  content_en: string | null;
  builder_data: unknown;
  blocks_data: unknown;
}

/**
 * Realizacja linku podarunkowego przez odbiorce (takze anonimowego).
 * Konsumpcja licznika odslon jest efektem ubocznym - bez retry i bez
 * odswiezania w tle (jak consume_metered_view). Zwykly useQuery nie odpala
 * sie podczas SSR, wiec crawlery nie zawyzaja statystyk.
 */
export function useGiftRedemption(
  postId: string | null,
  code: string | null,
  enabled: boolean,
): GiftRedemption {
  const query = useQuery({
    queryKey: ["gift-redeem", postId, code] as const,
    enabled: enabled && !!postId && !!code,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<{ body: BodyParts | null; valid: boolean }> => {
      const { data, error } = await supabase.rpc("redeem_gift_link", {
        _post_id: postId as string,
        _code: code as string,
      });
      if (error) throw error;
      const row = ((data ?? []) as RedeemRow[])[0];
      if (!row || !row.valid) return { body: null, valid: false };
      const body: BodyParts = {
        content_pl: row.content_pl,
        content_en: row.content_en,
        builder_data: row.builder_data,
        blocks_data: row.blocks_data,
      };
      return hasRenderableBody(body) ? { body, valid: true } : { body: EMPTY_BODY, valid: false };
    },
  });

  return {
    body: query.data?.body ?? null,
    valid: query.data ? query.data.valid : null,
    settled: !enabled || query.isFetched,
  };
}
