// Hooki React Query dla zgód użytkownika (RODO). Bazują na server-fn z
// `src/lib/consents.functions.ts` - klient nigdy nie pisze bezpośrednio do
// `user_consents` (zawsze przez `set_user_consent`, żeby audit-log był
// gwarantowany).
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { useGpcHonored, useGpcSignal } from "@/lib/ads/consent";
import { clampRegistryValueForGpc } from "@/lib/consent/gpc";
import { listMyConsents, listMyConsentEvents, setMyConsent } from "@/lib/consents.functions";
import { CONSENT_CATALOG, type ConsentDefinition } from "@/lib/notifications/consentCatalog";

export interface ConsentStateRow {
  consent_key: string;
  given: boolean;
  version: string;
  lang: string | null;
  /** Czy przy ostatniej decyzji aktywny był sygnał Global Privacy Control. */
  gpc: boolean;
  given_at: string | null;
  withdrawn_at: string | null;
  updated_at: string;
}

export interface ConsentEventRow {
  id: string;
  consent_key: string;
  given: boolean;
  version: string;
  lang: string | null;
  source: string | null;
  /** Czy w momencie tego zdarzenia aktywny był sygnał GPC. */
  gpc: boolean;
  created_at: string;
}

export interface ConsentView {
  definition: ConsentDefinition;
  state: ConsentStateRow | null;
  /** true, gdy użytkownik podjął decyzję i wersja jest aktualna. */
  isCurrent: boolean;
  /** Efektywna wartość (default, required ORAZ klamra GPC). */
  effectiveGiven: boolean;
  /** true, gdy wartość została ściągnięta do „nie" sygnałem GPC. */
  gpcClamped: boolean;
}

export function useMyConsents() {
  const { user } = useAuth();
  const fn = useServerFn(listMyConsents);
  return useQuery({
    queryKey: ["user-consents", user?.id ?? "anon"],
    enabled: !!user,
    queryFn: async () => {
      const rows = (await fn()) as ConsentStateRow[];
      return rows;
    },
    staleTime: 30_000,
  });
}

export function useMyConsentEvents(limit = 100) {
  const { user } = useAuth();
  const fn = useServerFn(listMyConsentEvents);
  return useQuery({
    queryKey: ["user-consent-events", user?.id ?? "anon", limit],
    enabled: !!user,
    queryFn: async () => {
      const rows = (await fn({ data: { limit } })) as ConsentEventRow[];
      return rows;
    },
    staleTime: 15_000,
  });
}

export function useSetMyConsent() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const fn = useServerFn(setMyConsent);
  // Sygnał GPC dołączany do KAŻDEGO zapisu: serwer i tak OR-uje go z własnym
  // odczytem (`resolveGpcForWrite`), ale przeglądarka nie dokłada `Sec-GPC` do
  // wywołań RPC, więc bez tej deklaracji sygnał widziany tylko przez
  // `navigator.globalPrivacyControl` nie trafiłby do rejestru.
  //
  // Świadomie AKTYWNOŚĆ sygnału, nie jego honorowanie: kolumna `gpc` odpowiada
  // na pytanie „czy przeglądarka wysyłała opt-out, gdy to zapisywano" - zgoda
  // udzielona jako świadomy override MUSI być w audycie oznaczona `gpc = true`,
  // bo właśnie ona jest wyjątkiem wymagającym uzasadnienia.
  const gpc = useGpcSignal().active;
  return useMutation({
    mutationFn: async (input: {
      key: string;
      given: boolean;
      version: string;
      lang?: "pl" | "en";
      source?: string;
    }) => fn({ data: { ...input, gpc } }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["user-consents", user?.id ?? "anon"] });
      const prev = qc.getQueryData<ConsentStateRow[]>(["user-consents", user?.id ?? "anon"]);
      const now = new Date().toISOString();
      const next: ConsentStateRow[] = (() => {
        const base = prev ?? [];
        const idx = base.findIndex((r) => r.consent_key === input.key);
        const patched: ConsentStateRow = {
          consent_key: input.key,
          given: input.given,
          version: input.version,
          lang: input.lang ?? base[idx]?.lang ?? null,
          gpc,
          given_at: input.given ? now : (base[idx]?.given_at ?? null),
          withdrawn_at: input.given ? null : now,
          updated_at: now,
        };
        if (idx === -1) return [...base, patched];
        const clone = base.slice();
        clone[idx] = patched;
        return clone;
      })();
      qc.setQueryData(["user-consents", user?.id ?? "anon"], next);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["user-consents", user?.id ?? "anon"], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["user-consents", user?.id ?? "anon"] });
      void qc.invalidateQueries({
        queryKey: ["user-consent-events", user?.id ?? "anon"],
      });
    },
  });
}

/**
 * Zbuduj widok zgód (definicja + stan) w kolejności katalogu.
 *
 * @param gpcHonored czy sygnał GPC jest honorowany - klamruje klucze
 *   `cookies_analytics` / `cookies_marketing` / `personalization` na „nie".
 *   Klamra działa na EFEKTYWNEJ wartości, nie na zapisanym stanie: rejestr
 *   pozostaje wiernym śladem decyzji, a UI pokazuje, co realnie obowiązuje.
 */
export function buildConsentViews(
  rows: ConsentStateRow[] | undefined,
  gpcHonored = false,
): ConsentView[] {
  const byKey = new Map((rows ?? []).map((r) => [r.consent_key, r]));
  return CONSENT_CATALOG.map((def) => {
    const state = byKey.get(def.key) ?? null;
    const isCurrent = !!state && state.version === def.version;
    const declared = def.required ? true : state ? state.given : (def.defaultGiven ?? false);
    const effectiveGiven = clampRegistryValueForGpc(def.key, declared, gpcHonored);
    return {
      definition: def,
      state,
      isCurrent,
      effectiveGiven,
      gpcClamped: declared && !effectiveGiven,
    };
  });
}

/**
 * Wygodny helper dla podglądu efektywnej wartości pojedynczej zgody. Uwzględnia
 * klamrę GPC, więc konsumenci personalizacji dostają „nie", gdy przeglądarka
 * wysyła sygnał opt-outu - bez pamiętania o tym w każdym miejscu wywołania.
 */
export function useIsConsentGiven(key: string): boolean | undefined {
  const q = useMyConsents();
  const gpcHonored = useGpcHonored();
  if (!q.data) return undefined;
  const view = buildConsentViews(q.data, gpcHonored).find((v) => v.definition.key === key);
  return view?.effectiveGiven;
}

/** Zwięzły wrapper - patch zgody bez ręcznego przekazywania wersji. */
export function useToggleConsent() {
  const mutate = useSetMyConsent();
  return useCallback(
    (key: string, given: boolean, lang?: "pl" | "en") => {
      const def = CONSENT_CATALOG.find((c) => c.key === key);
      if (!def) throw new Error(`Unknown consent key: ${key}`);
      if (def.required && !given) return Promise.resolve(null);
      return mutate.mutateAsync({ key, given, version: def.version, lang });
    },
    [mutate],
  );
}
