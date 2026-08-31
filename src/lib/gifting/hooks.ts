// "Udostepnij pelny artykul" - warstwa danych (react-query + Supabase RPC).
//
// Egzekwowanie jest WYLACZNIE serwerowe (SECURITY DEFINER: create_gift_link /
// redeem_gift_link - migracje 20260722112736 i 20260806170000): klient nigdy
// nie widzi body inaczej niz przez wazny kod, generowanie linku przechodzi
// przez can_share_full_article(), a budzet klikniec zna tylko baza. Ten modul
// dostarcza:
//   * odczyt ustawien (gift_article_settings, publiczne; brak wiersza =
//     funkcja wlaczona z bezpiecznymi domyslnymi - patrz DEFAULT_GIFT_SETTINGS),
//   * stan popovera wraz z budzetem klikniec (gift_article_state - czysty odczyt),
//   * mutacje utworzenia linku (idempotentna per wpis/nadawca),
//   * realizacje kodu przez odbiorce (redeem - konsumpcja slotu PO hydracji,
//     zeby boty/prefetch nie palily klikniec).
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
// Ten sam pseudonim gościa co metering - dzięki temu odświeżenie artykułu
// przez odbiorcę nie pali kolejnego slotu z budżetu kliknięć.
import { getVisitorId } from "@/lib/access/visitor";
import {
  DEFAULT_GIFT_SETTINGS,
  giftClickBudget,
  mapGiftError,
  normalizeGiftEligibility,
  normalizeRedeemReason,
  parseGiftCode,
  type GiftArticleState,
  type GiftErrorKey,
  type GiftLinkResult,
  type GiftRedeemReason,
  type GiftSettings,
} from "@/lib/gifting/model";

const SETTINGS_COLUMNS =
  "enabled, monthly_limit, link_ttl_days, max_redemptions_per_link, eligibility";
/** Kształt sprzed migracji 20260806170000 - patrz fetchGiftSettings. */
const LEGACY_SETTINGS_COLUMNS = "enabled, monthly_limit, link_ttl_days, max_redemptions_per_link";

interface GiftSettingsRow {
  enabled: boolean;
  monthly_limit: number;
  link_ttl_days: number;
  max_redemptions_per_link?: number | null;
  eligibility?: string | null;
}

function toGiftSettings(row: GiftSettingsRow | null): GiftSettings {
  if (!row) return DEFAULT_GIFT_SETTINGS;
  return {
    enabled: row.enabled,
    monthly_limit: row.monthly_limit,
    link_ttl_days: row.link_ttl_days,
    max_redemptions_per_link:
      row.max_redemptions_per_link ?? DEFAULT_GIFT_SETTINGS.max_redemptions_per_link,
    eligibility: normalizeGiftEligibility(row.eligibility),
  };
}

/** Postgres 42703 = undefined_column (kolumna jeszcze niewdrożona). */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

/**
 * Ustawienia gifting. Okno wdrożeniowe (kod na produkcji przed migracją) nie
 * może wygasić przycisku na wszystkich artykułach, więc brak nowych kolumn
 * degraduje się do odczytu starszego kształtu i bezpiecznych domyślnych -
 * ustalony idiom repo dla obiektów wyprzedzających migrację.
 */
export async function fetchGiftSettings(): Promise<GiftSettings> {
  const { data, error } = await supabase
    .from("gift_article_settings")
    .select(SETTINGS_COLUMNS)
    .maybeSingle();
  if (!error) return toGiftSettings(data);
  if (!isMissingColumn(error)) throw error;

  const legacy = await supabase
    .from("gift_article_settings")
    .select(LEGACY_SETTINGS_COLUMNS)
    .maybeSingle();
  if (legacy.error) throw legacy.error;
  return toGiftSettings(legacy.data);
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
  /** Kolumny z migracji 20260806170000 - opcjonalne na czas okna wdrożenia. */
  eligibility?: string | null;
  max_redemptions?: number | null;
  redemption_count?: number | null;
}

function toGiftState(row: GiftStateRow, fallbackCap: number): GiftArticleState {
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
    eligibility: normalizeGiftEligibility(row.eligibility),
    budget: giftClickBudget(row.redemption_count ?? 0, row.max_redemptions ?? fallbackCap),
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
  /** Domyślny budżet tenanta - używany, gdy RPC nie zna jeszcze kolumn budżetu. */
  fallbackCap: number = DEFAULT_GIFT_SETTINGS.max_redemptions_per_link,
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
      return row ? toGiftState(row, fallbackCap) : null;
    },
  });
}

interface GiftLinkRow {
  code: string;
  expires_at: string | null;
  used: number;
  monthly_limit: number;
  remaining: number | null;
  /** Kolumny z migracji 20260806170000 - opcjonalne na czas okna wdrożenia. */
  max_redemptions?: number | null;
  redemption_count?: number | null;
}

export interface CreateGiftLink {
  mutation: UseMutationResult<GiftLinkResult, Error, void>;
  /** Klucz domenowy ostatniego bledu (dla copy i18n) lub null. */
  errorKey: GiftErrorKey | null;
}

/**
 * Utworzenie (lub idempotentny odczyt) linku podarunkowego dla wpisu.
 * Sukces dopisuje kod ORAZ budżet kliknięć do cache stanu, więc ponowne
 * otwarcie popovera nie strzela już do create, nie migocze i od razu pokazuje
 * prawdziwy licznik "zostało N otwarć".
 */
export function useCreateGiftLink(
  postId: string | null,
  fallbackCap: number = DEFAULT_GIFT_SETTINGS.max_redemptions_per_link,
): CreateGiftLink {
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
        budget: giftClickBudget(row.redemption_count ?? 0, row.max_redemptions ?? fallbackCap),
      };
    },
    onSuccess: (res) => {
      // `prev` (czyli `undefined`) przy BRAKU wpisu w pamieci, nigdy `null`:
      // zwrocenie `undefined` z funkcji aktualizujacej react-query znaczy "nie
      // ruszaj pamieci", a `null` ZAKLADA wpis o wartosci `null` i stempluje go
      // swiezym `dataUpdatedAt`. Przy `staleTime: 60_000` odczytu stanu taki
      // wpis-widmo przez minute uchodzi za swiezy, wiec popover otwarty po
      // mutacji nie odpytuje bazy i pokazuje wskaznik ladowania
      // (`resolveGiftPhase`: `!state` => "loading") mimo gotowego kodu.
      queryClient.setQueryData<GiftArticleState | null>(
        giftStateKey(postId, uid),
        (prev): GiftArticleState | null | undefined =>
          prev
            ? {
                ...prev,
                existingCode: res.code,
                expiresAt: res.expiresAt,
                used: res.used,
                remaining: res.remaining,
                budget: res.budget,
              }
            : prev,
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
  /** null = jeszcze nie wiemy; false = kod niewazny/wygasly/wyczerpany. */
  valid: boolean | null;
  /** Powod werdyktu - decyduje o wariancie banera odbiorcy. */
  reason: GiftRedeemReason | null;
  /** true, gdy zapytanie zakonczylo sie (albo bylo wylaczone). */
  settled: boolean;
}

interface RedeemRow {
  valid: boolean;
  content_pl: string | null;
  content_en: string | null;
  builder_data: unknown;
  blocks_data: unknown;
  /** Kolumna z migracji 20260806170000 - opcjonalna na czas okna wdrożenia. */
  reason?: string | null;
}

interface RedeemResult {
  body: BodyParts | null;
  valid: boolean;
  reason: GiftRedeemReason;
}

/**
 * Realizacja linku podarunkowego przez odbiorce (takze anonimowego).
 * Konsumpcja slotu budzetu jest efektem ubocznym - bez retry i bez
 * odswiezania w tle (jak consume_metered_view). Zwykly useQuery nie odpala
 * sie podczas SSR, wiec crawlery nie pala klikniec.
 *
 * Tozsamosc odbiorcy (konto albo pseudonim goscia) jedzie do RPC, zeby
 * powrot na ten sam artykul z tej samej przegladarki NIE zuzywal kolejnego
 * slotu - dlatego klucz zapytania tez ja zawiera (logowanie w trakcie czytania
 * przelacza tozsamosc, a nie doklada zuzycia po cichu).
 */
export function useGiftRedemption(
  postId: string | null,
  code: string | null,
  enabled: boolean,
): GiftRedemption {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const visitorId = uid ? null : getVisitorId();

  const query = useQuery({
    queryKey: ["gift-redeem", postId, code, uid ?? visitorId ?? "anon"] as const,
    enabled: enabled && !!postId && !!code,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<RedeemResult> => {
      const { data, error } = await supabase.rpc("redeem_gift_link", {
        _post_id: postId as string,
        _code: code as string,
        ...(visitorId ? { _visitor_id: visitorId } : {}),
      });
      if (error) throw error;
      const row = ((data ?? []) as RedeemRow[])[0];
      // Brak wiersza = wpis nieopublikowany / nie ten tenant: traktujemy jak
      // niewazny kod (serwer swiadomie nie rozroznia tych przypadkow).
      if (!row) return { body: null, valid: false, reason: "invalid" };

      const reason = normalizeRedeemReason(row.reason ?? (row.valid ? "ok" : "invalid"));
      if (!row.valid) return { body: null, valid: false, reason };

      const body: BodyParts = {
        content_pl: row.content_pl,
        content_en: row.content_en,
        builder_data: row.builder_data,
        blocks_data: row.blocks_data,
      };
      return hasRenderableBody(body)
        ? { body, valid: true, reason }
        : { body: EMPTY_BODY, valid: false, reason: "invalid" };
    },
  });

  return {
    body: query.data?.body ?? null,
    valid: query.data ? query.data.valid : null,
    reason: query.data?.reason ?? null,
    settled: !enabled || query.isFetched,
  };
}
