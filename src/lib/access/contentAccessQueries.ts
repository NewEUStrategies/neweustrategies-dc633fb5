// REGUŁA DOSTĘPU TREŚCI (`content_access`) - JEDEN odczyt i JEDEN pisarz dla
// edytora wpisu/strony (`AccessSettingsPane`), podsumowania wpisu
// (`PostGeneralOverview`) i wyjątków meteringu w `/admin/paywall`
// (SPEC §3.2; S1 def. 3).
//
// DLACZEGO WSPÓLNY PISARZ. Wyjątki meteringu to TE SAME wiersze, które edytuje
// panel dostępu w edytorze - ale paywall zapisywał `metering_policy` ślepym
// UPDATE po `id`, bez wersji. Edytor wpisu miał już blokadę optymistyczną
// (INSERT → 23505, UPDATE z `updated_at`), więc wystarczyło, że paywall
// zapisał wyjątek, a edytor z otwartą kartą zgłaszał konflikt - albo
// odwrotnie: paywall cofał regułę ustawioną chwilę wcześniej w edytorze.
// Logika blokady przeniesiona 1:1 z `AccessSettingsPane.tsx` mieszka teraz
// tutaj i obsługuje oba ekrany.
//
// WYJĄTKI BEZ CICHEGO LIMITU. Lista w paywallu czytała `limit(200)` - wyjątek
// numer 201 nie istniał dla admina. Teraz: stronicowanie `range` z liczbą
// `count: "exact"` i wyszukiwanie po tytule.
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { accessKeys } from "@/lib/access/keys";
import { normalizeMeteringPolicy, type MeteringPolicy } from "@/lib/access/metering";
import { invalidateKeys, revenueDomainKeys, staleWriteError } from "@/lib/billing/planQueries";
import type { RevenueDomain } from "@/lib/revenue/keys";
import { useCurrentTenantId } from "@/lib/tenant";

type ContentAccessTable = Database["public"]["Tables"]["content_access"];
export type AccessEntityType = ContentAccessTable["Row"]["entity_type"];

/**
 * Kolumny czytane przez edytor. BEZ `password_hash` i `password_hint_*`:
 * podpowiedzi są odebrane rolom klienckim (REVOKE 20260801121000), więc
 * edytor czyta je przez RPC `get_password_hint`.
 */
const RULE_SELECT =
  "id, entity_type, entity_id, mode, plan_ids, one_time_price_cents, one_time_currency, teaser_pl, teaser_en, min_tier_rank, metering_policy, tenant_id, updated_at" as const;

export type ContentAccessRuleRow = Pick<
  ContentAccessTable["Row"],
  | "id"
  | "entity_type"
  | "entity_id"
  | "mode"
  | "plan_ids"
  | "one_time_price_cents"
  | "one_time_currency"
  | "teaser_pl"
  | "teaser_en"
  | "min_tier_rank"
  | "metering_policy"
  | "tenant_id"
  | "updated_at"
>;

/** Reguła z flagą hasła - podsumowanie wpisu pokazuje „chronione hasłem". */
export type ContentAccessRuleState = ContentAccessRuleRow & { has_password: boolean };

/** Kolumny, które ekrany mogą zapisać. Hash hasła zmieniają wyłącznie RPC. */
export const CONTENT_ACCESS_RULE_COLUMNS = [
  "mode",
  "plan_ids",
  "one_time_price_cents",
  "one_time_currency",
  "teaser_pl",
  "teaser_en",
  "min_tier_rank",
  "metering_policy",
  "password_hint_pl",
  "password_hint_en",
] as const satisfies readonly (keyof ContentAccessTable["Row"])[];

export type ContentAccessRuleFields = Partial<
  Pick<ContentAccessTable["Update"], (typeof CONTENT_ACCESS_RULE_COLUMNS)[number]>
>;

export interface SaveContentAccessRuleInput {
  entityType: AccessEntityType;
  entityId: string;
  fields: ContentAccessRuleFields;
  /**
   * Surowe `updated_at` z odczytu; `null` = reguły nie było → INSERT
   * (istniejący wiersz kończy się 23505 → `40001` zamiast cichego nadpisania).
   */
  expectedUpdatedAt: string | null;
}

/**
 * Reguła jednej encji albo `null` (udany odczyt, reguły nie ma). Klucz
 * `accessKeys.rule(typ, id)` - ten, który unieważnia reguła szyny
 * `content_access.changed.v1` z polami encji.
 */
export function contentAccessRuleQueryOptions(
  entityType: AccessEntityType,
  entityId: string | null,
) {
  return queryOptions({
    queryKey: accessKeys.rule(entityType, entityId ?? ""),
    enabled: Boolean(entityId),
    staleTime: 15_000,
    queryFn: async (): Promise<ContentAccessRuleState | null> => {
      const id = entityId as string;
      const [ruleRes, passwordRes] = await Promise.all([
        supabase
          .from("content_access")
          .select(RULE_SELECT)
          .eq("entity_type", entityType)
          .eq("entity_id", id)
          .maybeSingle(),
        supabase.rpc("content_access_has_password", { _entity_type: entityType, _entity_id: id }),
      ]);
      // Błąd KTÓREGOKOLWIEK odczytu rzuca: „nie udało się przeczytać" nie może
      // wyglądać jak „reguły nie ma" (pierwszy zapis zdjąłby wtedy paywall).
      if (ruleRes.error) throw ruleRes.error;
      if (passwordRes.error) throw passwordRes.error;
      return ruleRes.data ? { ...ruleRes.data, has_password: Boolean(passwordRes.data) } : null;
    },
  });
}

/**
 * Zapis reguły (bez haka - testy i wyjątki). Logika 1:1 z dawnego
 * `AccessSettingsPane.save`:
 *   - reguły nie było → INSERT; istniejący wiersz (inna karta) → 23505 → `40001`;
 *   - reguła była → UPDATE warunkowany WERSJĄ; 0 wierszy = reguła zmieniła
 *     się w międzyczasie, zniknęła albo RLS odciął zapis bez błędu → `40001`.
 * Najemca przy INSERT z domyślnej kolumny (`current_tenant_id()`).
 */
export async function saveContentAccessRule(
  input: SaveContentAccessRuleInput,
): Promise<ContentAccessRuleRow> {
  const fields: ContentAccessTable["Update"] = { ...input.fields };
  const allowed = new Set<string>(CONTENT_ACCESS_RULE_COLUMNS);
  for (const column of Object.keys(fields)) {
    if (!allowed.has(column)) throw new Error(`column_not_owned:${column}`);
  }

  if (input.expectedUpdatedAt === null) {
    const { data, error } = await supabase
      .from("content_access")
      .insert({ ...fields, entity_type: input.entityType, entity_id: input.entityId })
      .select(RULE_SELECT)
      .single();
    if (error?.code === "23505") throw staleWriteError();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("content_access")
    .update(fields)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .eq("updated_at", input.expectedUpdatedAt)
    .select(RULE_SELECT);
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw staleWriteError();
  return row;
}

/** Jedyny pisarz `content_access` z panelu (`syncManifest.ts`). Rzuca, nie pokazuje toastów. */
export function useSaveContentAccessRule() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: (input: SaveContentAccessRuleInput) => saveContentAccessRule(input),
    onSuccess: (_row, input) =>
      invalidateContentAccessQueries(queryClient, input.entityType, input.entityId, tenantId),
  });
}

export interface SetMeteringOverridePolicyInput {
  entityType: AccessEntityType;
  entityId: string;
  policy: MeteringPolicy;
  /** `updated_at` wiersza z listy wyjątków (`null` = encja bez reguły). */
  expectedUpdatedAt: string | null;
}

/** Wyjątek meteringu = ta sama reguła, patch wyłącznie `metering_policy`. */
export function useSetMeteringOverridePolicy() {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: (input: SetMeteringOverridePolicyInput) =>
      saveContentAccessRule({
        entityType: input.entityType,
        entityId: input.entityId,
        fields: { metering_policy: normalizeMeteringPolicy(input.policy) },
        expectedUpdatedAt: input.expectedUpdatedAt,
      }),
    onSuccess: (_row, input) =>
      invalidateContentAccessQueries(queryClient, input.entityType, input.entityId, tenantId),
  });
}

/* ------------------------------------------------------- wyjątki meteringu */

export const METERING_OVERRIDES_PAGE_SIZE = 50;

/** Partia przy pełnym przeglądzie (wyszukiwanie) - limit `max-rows` PostgREST. */
const SCAN_BATCH = 1000;
/** Identyfikatorów w jednym `in()` - adres zapytania zostaje daleko od limitu długości URL. */
const ID_CHUNK = 100;

export interface MeteringOverrideRow {
  id: string;
  entity_type: AccessEntityType;
  entity_id: string;
  mode: string;
  metering_policy: MeteringPolicy;
  /** Token zapisu wyjątku. */
  updated_at: string;
  title: string;
  /** Slug do edytora (wpis, strona); media nie mają edytora pod slugiem. */
  slug: string | null;
}

export interface MeteringOverridesPage {
  rows: MeteringOverrideRow[];
  total: number;
  page: number;
  pageSize: number;
}

type OverrideBase = Pick<
  ContentAccessRuleRow,
  "id" | "entity_type" | "entity_id" | "mode" | "metering_policy" | "updated_at"
>;

const OVERRIDE_SELECT = "id, entity_type, entity_id, mode, metering_policy, updated_at" as const;

interface TitleEntry {
  title: string;
  slug: string | null;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Tytuły encji (wpis, strona, plik) - porcjami, żeby `in()` nie rozsadził adresu. */
async function entityTitles(rows: readonly OverrideBase[]): Promise<Map<string, TitleEntry>> {
  const ids = (type: AccessEntityType) => [
    ...new Set(rows.filter((r) => r.entity_type === type).map((r) => r.entity_id)),
  ];
  const out = new Map<string, TitleEntry>();
  const jobs: PromiseLike<void>[] = [];
  type Titled = {
    id: string;
    title_pl: string | null;
    title_en: string | null;
    slug: string | null;
  };
  const collect = ({ data, error }: { data: Titled[] | null; error: unknown }) => {
    if (error) throw error;
    for (const p of data ?? []) {
      out.set(p.id, { title: p.title_pl || p.title_en || p.slug || p.id, slug: p.slug });
    }
  };
  for (const part of chunks(ids("post"), ID_CHUNK)) {
    jobs.push(
      supabase.from("posts").select("id, title_pl, title_en, slug").in("id", part).then(collect),
    );
  }
  for (const part of chunks(ids("page"), ID_CHUNK)) {
    jobs.push(
      supabase.from("pages").select("id, title_pl, title_en, slug").in("id", part).then(collect),
    );
  }
  for (const part of chunks(ids("media"), ID_CHUNK)) {
    jobs.push(
      supabase
        .from("media")
        .select("id, alt_text, filename")
        .in("id", part)
        .then(({ data, error }) => {
          if (error) throw error;
          for (const m of data ?? [])
            out.set(m.id, { title: m.alt_text || m.filename, slug: null });
        }),
    );
  }
  await Promise.all(jobs);
  return out;
}

function withTitles(
  rows: readonly OverrideBase[],
  titles: Map<string, TitleEntry>,
): MeteringOverrideRow[] {
  return rows.map((r) => ({
    id: r.id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    mode: String(r.mode),
    metering_policy: normalizeMeteringPolicy(r.metering_policy),
    updated_at: r.updated_at,
    title: titles.get(r.entity_id)?.title ?? r.entity_id,
    slug: titles.get(r.entity_id)?.slug ?? null,
  }));
}

/**
 * Strona wyjątków bez wyszukiwania: `range` po stronie bazy, liczba z
 * `count: "exact"`. Drugi klucz sortowania (`id`) sprawia, że wyjątki
 * zapisane w tej samej chwili nie przeskakują między stronami.
 */
async function fetchOverridesPage(page: number): Promise<MeteringOverridesPage> {
  const from = page * METERING_OVERRIDES_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("content_access")
    .select(OVERRIDE_SELECT, { count: "exact" })
    .neq("metering_policy", "inherit")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .range(from, from + METERING_OVERRIDES_PAGE_SIZE - 1);
  if (error) throw error;
  const rows = data ?? [];
  return {
    rows: withTitles(rows, await entityTitles(rows)),
    total: count ?? rows.length,
    page,
    pageSize: METERING_OVERRIDES_PAGE_SIZE,
  };
}

/**
 * Wyszukiwanie po tytule. Tytuł leży w `posts`/`pages`/`media`, a encja
 * reguły jest polimorficzna (brak klucza obcego do złączenia w PostgREST),
 * więc przeglądamy WSZYSTKIE wyjątki partiami `range` (wyjątki to ręczne
 * decyzje admina - setki, nie miliony), dociągamy tytuły porcjami i filtrujemy
 * tu. Fraza nie trafia do filtra PostgREST, więc przecinek czy nawias
 * w tytule nie zepsuje składni zapytania.
 */
async function searchOverrides(needle: string, page: number): Promise<MeteringOverridesPage> {
  const all: OverrideBase[] = [];
  for (let from = 0; ; from += SCAN_BATCH) {
    const { data, error } = await supabase
      .from("content_access")
      .select(OVERRIDE_SELECT)
      .neq("metering_policy", "inherit")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + SCAN_BATCH - 1);
    if (error) throw error;
    all.push(...(data ?? []));
    if ((data ?? []).length < SCAN_BATCH) break;
  }
  const query = needle.toLocaleLowerCase();
  const matched = withTitles(all, await entityTitles(all)).filter(
    (row) =>
      row.title.toLocaleLowerCase().includes(query) ||
      (row.slug ?? "").toLocaleLowerCase().includes(query),
  );
  const from = page * METERING_OVERRIDES_PAGE_SIZE;
  return {
    rows: matched.slice(from, from + METERING_OVERRIDES_PAGE_SIZE),
    total: matched.length,
    page,
    pageSize: METERING_OVERRIDES_PAGE_SIZE,
  };
}

/**
 * Wyjątki meteringu (reguły z `metering_policy ≠ inherit`). Klucz pod
 * prefiksem `accessKeys.overrides()`, więc reguła szyny unieważnia każdą
 * stronę i każde wyszukiwanie; `keepPreviousData` trzyma tabelę na ekranie
 * przy zmianie strony.
 */
export function meteringOverridesQueryOptions({ search, page }: { search: string; page: number }) {
  const needle = search.trim();
  const pageIndex = Number.isSafeInteger(page) && page > 0 ? page : 0;
  return queryOptions({
    queryKey: [...accessKeys.overrides(), needle, pageIndex] as const,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: () => (needle ? searchOverrides(needle, pageIndex) : fetchOverridesPage(pageIndex)),
  });
}

/* ----------------------------------------------------------- unieważnianie */

/** Domeny huba z reguły panelu `content_access.changed.v1`. */
const CONTENT_ACCESS_REVENUE_DOMAINS = [
  "access",
  "diagnostics",
] as const satisfies readonly RevenueDomain[];

/**
 * Klucze czytelników reguły - ten sam zestaw co reguła rdzenia
 * `content_access.changed.v1` (+ dziedziny huba). Bez encji: wszystkie reguły.
 *
 * Dwa klucze stoją literałem jak w regule I0, bo nie mają fabryki-liścia:
 * `["public", "resolved"]` (rozstrzygnięty dostęp treści czytelnika)
 * i `["unlocked-body"]` (odblokowana treść). Bramka literałów ich nie
 * dotyczy (nie są prefiksami fabryk); brak fabryki = zgłoszenie „Do integracji".
 */
export function contentAccessInvalidationKeys(
  entityType?: AccessEntityType,
  entityId?: string,
  tenantId: string | null = null,
): QueryKey[] {
  return [
    entityType && entityId ? accessKeys.rule(entityType, entityId) : accessKeys.ruleAll(),
    accessKeys.overrides(),
    ["public", "resolved"],
    ["unlocked-body"],
    ...revenueDomainKeys(CONTENT_ACCESS_REVENUE_DOMAINS, tenantId),
  ];
}

/**
 * Po zapisie reguły - także przez RPC hasła, które same robią UPDATE wiersza.
 * Najemca nieustalony → dziedziny huba u wszystkich najemców (nadmiarowe,
 * nigdy fałszywie świeże).
 */
export function invalidateContentAccessQueries(
  queryClient: QueryClient,
  entityType?: AccessEntityType,
  entityId?: string,
  tenantId: string | null = null,
): Promise<void> {
  return invalidateKeys(queryClient, contentAccessInvalidationKeys(entityType, entityId, tenantId));
}
