// Hooki React Query dla zgód użytkownika (RODO). Bazują na server-fn z
// `src/lib/consents.functions.ts` - klient nigdy nie pisze bezpośrednio do
// `user_consents` (zawsze przez `set_user_consent`, żeby audit-log był
// gwarantowany).
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import {
  listMyConsents,
  listMyConsentEvents,
  setMyConsent,
} from "@/lib/consents.functions";
import {
  CONSENT_CATALOG,
  type ConsentDefinition,
} from "@/lib/notifications/consentCatalog";

export interface ConsentStateRow {
  consent_key: string;
  given: boolean;
  version: string;
  lang: string | null;
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
  created_at: string;
}

export interface ConsentView {
  definition: ConsentDefinition;
  state: ConsentStateRow | null;
  /** true, gdy użytkownik podjął decyzję i wersja jest aktualna. */
  isCurrent: boolean;
  /** Efektywna wartość (uwzględnia default i required). */
  effectiveGiven: boolean;
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
  return useMutation({
    mutationFn: async (input: {
      key: string;
      given: boolean;
      version: string;
      lang?: "pl" | "en";
      source?: string;
    }) => fn({ data: input }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["user-consents", user?.id ?? "anon"] });
      const prev = qc.getQueryData<ConsentStateRow[]>([
        "user-consents",
        user?.id ?? "anon",
      ]);
      const now = new Date().toISOString();
      const next: ConsentStateRow[] = (() => {
        const base = prev ?? [];
        const idx = base.findIndex((r) => r.consent_key === input.key);
        const patched: ConsentStateRow = {
          consent_key: input.key,
          given: input.given,
          version: input.version,
          lang: input.lang ?? base[idx]?.lang ?? null,
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
      if (ctx?.prev)
        qc.setQueryData(["user-consents", user?.id ?? "anon"], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["user-consents", user?.id ?? "anon"] });
      void qc.invalidateQueries({
        queryKey: ["user-consent-events", user?.id ?? "anon"],
      });
    },
  });
}

/** Zbuduj widok zgód (definicja + stan) w kolejności katalogu. */
export function buildConsentViews(rows: ConsentStateRow[] | undefined): ConsentView[] {
  const byKey = new Map((rows ?? []).map((r) => [r.consent_key, r]));
  return CONSENT_CATALOG.map((def) => {
    const state = byKey.get(def.key) ?? null;
    const isCurrent = !!state && state.version === def.version;
    const effectiveGiven = def.required
      ? true
      : state
        ? state.given
        : (def.defaultGiven ?? false);
    return { definition: def, state, isCurrent, effectiveGiven };
  });
}

/** Wygodny helper dla podglądu efektywnej wartości pojedynczej zgody. */
export function useIsConsentGiven(key: string): boolean | undefined {
  const q = useMyConsents();
  if (!q.data) return undefined;
  const view = buildConsentViews(q.data).find((v) => v.definition.key === key);
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
