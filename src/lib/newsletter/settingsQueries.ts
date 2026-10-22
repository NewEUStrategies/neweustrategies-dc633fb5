// USTAWIENIA NEWSLETTERA - zapis GRUPAMI kolumn przez RPC z CAS (S1 def. 9,
// D-S1-03, PLAN S1 §4.2).
//
// CO NAPRAWIA. Pięciu pisarzy `newsletter_settings` (przegląd newslettera,
// treść popupu, przełącznik popupu, pola rejestracji, kreator formularzy)
// zapisywało CAŁY wiersz - edytor popupu z otwartą kartą cofał zmianę nadawcy
// zrobioną chwilę wcześniej w przeglądzie, a przełącznik popupu odsyłał całe
// ustawienia sprzed minuty. Teraz:
//
//   * GRUPA = biała lista kolumn JEDNEGO edytora (`NEWSLETTER_SETTINGS_GROUPS`,
//     ta sama lista co w SQL między znacznikami `newsletter-groups` -
//     pilnuje test parytetu);
//   * PATCH = tylko kolumny grupy, które edytor faktycznie zmienił względem
//     stanu, od którego zaczął (`diffNewsletterSettings`);
//   * SERWER = `admin_newsletter_settings_patch` z tokenem `updated_at`
//     wiersza (`40001` przy nieaktualnym) i zapisem wyłącznie zmienionych kolumn;
//   * SCALENIE: wiersz ma JEDEN token, więc dwie karty edytujące RÓŻNE grupy
//     zderzyłyby się, choć nie dotykają tych samych kolumn. Przy `40001`
//     mutator czyta świeży wiersz i jeśli KAŻDA kolumna patchu ma w nim wciąż
//     wartość z bazy szkicu (nikt jej nie ruszył), ponawia raz z nowym
//     tokenem - obie zmiany przetrwały. Inaczej to prawdziwy konflikt
//     i ekran pokazuje „zmienione w innym miejscu".
//
// Moduł PANELU: `useNewsletterSettings.ts` (chunk wejściowy) NIE importuje
// stąd niczego - także dynamicznie (szew zgodności `useSaveNewsletterSettings`
// mieszka tutaj, patrz niżej).
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { fetchNewsletterSettings } from "@/hooks/newsletterSettingsData";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import {
  invalidateKeys,
  isStaleWriteError,
  revenueDomainKeys,
  staleWriteError,
} from "@/lib/billing/planQueries";
import { crmKeys } from "@/lib/crm/keys";
import { newsletterKeys } from "@/lib/newsletter/keys";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import { useCurrentTenantId } from "@/lib/tenant";

/**
 * Grupy kolumn per edytor (PLAN S1 §4.2 ⇔ blok `newsletter-groups` w migracji
 * `20261020100100_newsletter_settings_patch.sql`). Grupy MOGĄ się nakładać
 * (przełącznik popupu jest i w przeglądzie, i w edytorze popupu; pola
 * rejestracji edytuje i popup, i ustawienia logowania) - nakładanie nie jest
 * błędem, bo patch niesie wyłącznie kolumny zmienione.
 */
export const NEWSLETTER_SETTINGS_GROUPS = {
  overview: [
    "enabled",
    "mode",
    "double_opt_in",
    "sender_name",
    "sender_email",
    "popup_enabled",
    "popup_trigger",
    "popup_delay_seconds",
    "popup_scroll_percent",
    "popup_frequency_days",
  ],
  popup: [
    "popup_enabled",
    "popup_trigger",
    "popup_delay_seconds",
    "popup_scroll_percent",
    "popup_frequency_days",
    "popup_cover_url",
    "popup_title_pl",
    "popup_title_en",
    "popup_description_pl",
    "popup_description_en",
    "popup_cta_pl",
    "popup_cta_en",
    "popup_layout",
    "popup_side_image_url",
    "popup_extended_fields",
    "popup_require_terms",
    "popup_terms_html_pl",
    "popup_terms_html_en",
    "popup_mailing_lists",
    "popup_showcase_images",
    "popup_showcase_brand_pl",
    "popup_showcase_brand_en",
    "popup_showcase_tagline_pl",
    "popup_showcase_tagline_en",
    "popup_showcase_rotate_ms",
    "popup_showcase_side",
    "popup_showcase_grad_from",
    "popup_showcase_grad_to",
    "popup_showcase_show_brand",
    "popup_showcase_show_caption",
    "popup_showcase_show_dots",
    "popup_fields",
    "popup_design",
    "popup_note_pl",
    "popup_note_en",
    "popup_require_privacy",
    "popup_privacy_html_pl",
    "popup_privacy_html_en",
    "popup_bg_color",
    "popup_text_color",
    "popup_muted_color",
    "popup_accent_color",
    "popup_accent_text_color",
    "popup_overlay_color",
    "popup_border_radius_px",
    "popup_eyebrow_pl",
    "popup_eyebrow_en",
  ],
  registration: ["popup_fields"],
  builder: ["inline_doc", "popup_doc"],
  inline: [
    "heading_pl",
    "heading_en",
    "description_pl",
    "description_en",
    "policy_html_pl",
    "policy_html_en",
    "success_message_pl",
    "success_message_en",
  ],
} as const satisfies Record<string, readonly (keyof NewsletterSettings)[]>;

export type NewsletterSettingsGroup = keyof typeof NEWSLETTER_SETTINGS_GROUPS;
export type NewsletterSettingsColumn =
  (typeof NEWSLETTER_SETTINGS_GROUPS)[NewsletterSettingsGroup][number];
export type NewsletterSettingsPatch = Partial<Pick<NewsletterSettings, NewsletterSettingsColumn>>;

/** Kolejność grup (stała - wynik szwu zgodności nie zależy od kolejności kluczy obiektu). */
export const NEWSLETTER_SETTINGS_GROUP_IDS = [
  "overview",
  "popup",
  "registration",
  "builder",
  "inline",
] as const satisfies readonly NewsletterSettingsGroup[];

/**
 * JSON z posortowanymi kluczami. Kolumny `jsonb` (pola formularza, projekt
 * popupu, dokumenty kreatora) wracają z bazy z kluczami w kolejności jsonb,
 * a z formularza - w kolejności edycji; zwykłe `JSON.stringify` uznałoby te
 * same dane za zmianę i wysłało kolumnę, której nikt nie ruszył.
 */
function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

/** Ta sama wartość ustawienia (głębokie porównanie, `undefined` ≡ `null`). */
export function sameSettingValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

/**
 * Patch grupy: kolumny grupy, których wartość w szkicu różni się od bazy
 * szkicu. Czysta funkcja - kolumna spoza grupy nie trafi do patchu nigdy,
 * nawet gdy szkic jest pełnym wierszem.
 */
export function diffNewsletterSettings(
  base: NewsletterSettings,
  draft: NewsletterSettings,
  group: NewsletterSettingsGroup,
): NewsletterSettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const column of NEWSLETTER_SETTINGS_GROUPS[group]) {
    const next = draft[column];
    if (next === undefined) continue;
    if (!sameSettingValue(base[column], next)) patch[column] = next;
  }
  return patch as NewsletterSettingsPatch;
}

export interface PatchNewsletterSettingsInput {
  /** Wiersz, od którego edytor zaczął (z tokenem `updated_at`). */
  base: NewsletterSettings;
  draft: NewsletterSettings;
  /** Surowe `base.updated_at`; `null` = wiersza nie było (pierwszy zapis najemcy). */
  expectedUpdatedAt: string | null;
}

export interface PatchNewsletterSettingsResult {
  /** Nowy token (do następnego zapisu z tej karty). */
  updatedAt: string | null;
  /** Kolumny faktycznie zmienione przez serwer (posortowane). */
  changed: string[];
  /** Zapis przeszedł po scaleniu z cudzą zmianą innych kolumn (D-S1-03). */
  merged: boolean;
}

interface PatchRpcResult {
  updated_at: string | null;
  changed: string[];
}

function parsePatchRpcResult(raw: unknown): PatchRpcResult {
  const value = raw as { updated_at?: unknown; changed?: unknown } | null;
  const updatedAt = value?.updated_at;
  const changed = value?.changed;
  if (
    !value ||
    (updatedAt !== null && typeof updatedAt !== "string") ||
    !Array.isArray(changed) ||
    !changed.every((c) => typeof c === "string")
  ) {
    throw new Error("invalid_rpc_shape:admin_newsletter_settings_patch");
  }
  return { updated_at: updatedAt, changed };
}

async function callPatchRpc(
  group: NewsletterSettingsGroup,
  patch: NewsletterSettingsPatch,
  expectedUpdatedAt: string | null,
): Promise<PatchRpcResult> {
  // Sygnatura RPC trafi do `types.ts` w I9 (N19) - do tego czasu wywołanie
  // przez `RpcCallable`, z nazwą funkcji LITERAŁEM (bramka kontraktu TS⇄SQL).
  const { data, error } = await (supabase as unknown as RpcCallable).rpc(
    "admin_newsletter_settings_patch",
    { p_group: group, p_patch: patch, p_expected_updated_at: expectedUpdatedAt },
  );
  if (error) throw error;
  return parsePatchRpcResult(data);
}

/**
 * Świeży wiersz po konflikcie. Odczyt w przeglądarce dzieli lot z innymi
 * (dedup w `newsletterSettingsData.ts`), a lot rozpoczęty PRZED cudzym
 * zapisem oddałby stan sprzed niego - pierwsze wywołanie domyka taki lot,
 * drugie czyta na pewno po konflikcie. Dwa odczyty wyłącznie na ścieżce
 * konfliktu.
 */
async function readFreshSettings(): Promise<NewsletterSettings> {
  await fetchNewsletterSettings().catch(() => undefined);
  return fetchNewsletterSettings();
}

/**
 * Zapis grupy (bez haka - testy, szew zgodności, naprawy huba). Patch pusty
 * nie wychodzi do bazy. Konflikt (`40001`) z cudzą zmianą INNYCH kolumn
 * scala się sam (jedno ponowienie z nowym tokenem); zmiana którejś z NASZYCH
 * kolumn w międzyczasie zgłasza `40001` ekranowi.
 */
export async function patchNewsletterSettings(
  group: NewsletterSettingsGroup,
  input: PatchNewsletterSettingsInput,
): Promise<PatchNewsletterSettingsResult> {
  const patch = diffNewsletterSettings(input.base, input.draft, group);
  const columns = Object.keys(patch) as NewsletterSettingsColumn[];
  if (columns.length === 0) {
    return { updatedAt: input.expectedUpdatedAt, changed: [], merged: false };
  }

  try {
    const result = await callPatchRpc(group, patch, input.expectedUpdatedAt);
    return { updatedAt: result.updated_at, changed: result.changed, merged: false };
  } catch (err) {
    if (!isStaleWriteError(err)) throw err;
  }

  const fresh = await readFreshSettings();
  const untouched = columns.every((column) => sameSettingValue(fresh[column], input.base[column]));
  if (!untouched) throw staleWriteError();
  // Jedno ponowienie: drugi `40001` (kolejna karta w tej samej chwili) leci
  // do ekranu jako konflikt - pętla mogłaby nigdy się nie skończyć.
  const result = await callPatchRpc(group, patch, fresh.updated_at ?? null);
  return { updatedAt: result.updated_at, changed: result.changed, merged: true };
}

/** Domeny huba z reguły panelu `newsletter_settings.changed.v1`. */
const SETTINGS_REVENUE_DOMAINS = ["diagnostics"] as const;

/**
 * Czytelnicy ustawień: reguła rdzenia `newsletter_settings.changed.v1`
 * (`settings()` jest prefiksem projekcji formularzy inline) + diagnostyka huba.
 */
export function newsletterSettingsInvalidationKeys(tenantId: string | null = null): QueryKey[] {
  return [newsletterKeys.settings(), ...revenueDomainKeys(SETTINGS_REVENUE_DOMAINS, tenantId)];
}

/**
 * Po zapisie: nowy token i wartości od razu w pełnym wpisie cache (następny
 * zapis z tej karty nie zderzy się z własną zmianą), potem odświeżenie
 * wszystkich czytelników. Odczyt w locie sprzed zapisu domykamy przed
 * unieważnieniem - inaczej odświeżenie dołączyłoby do niego (dedup lotu)
 * i zapisało w cache stan sprzed zapisu na cały `staleTime`.
 */
async function afterSettingsWrite(
  queryClient: QueryClient,
  patch: NewsletterSettingsPatch,
  updatedAt: string | null,
  tenantId: string | null,
): Promise<void> {
  queryClient.setQueryData<NewsletterSettings>(newsletterKeys.settings(), (old) =>
    old ? { ...old, ...patch, updated_at: updatedAt ?? old.updated_at } : old,
  );
  if (queryClient.isFetching({ queryKey: newsletterKeys.settings() }) > 0) {
    await fetchNewsletterSettings().catch(() => undefined);
  }
  await invalidateKeys(queryClient, newsletterSettingsInvalidationKeys(tenantId));
}

/** Zapis grupy ustawień z edytora - jedyna droga zapisu `newsletter_settings` z panelu. */
export function usePatchNewsletterSettings(group: NewsletterSettingsGroup) {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();
  return useMutation({
    mutationFn: (input: PatchNewsletterSettingsInput) => patchNewsletterSettings(group, input),
    onSuccess: (result, input) =>
      result.changed.length === 0 && !result.merged
        ? undefined
        : afterSettingsWrite(
            queryClient,
            diffNewsletterSettings(input.base, input.draft, group),
            result.updatedAt,
            tenantId,
          ),
  });
}

/* ------------------------------------------------------ szew zgodności */

/**
 * Grupy pokrywające zmienione kolumny: zachłannie grupa, która bierze
 * najwięcej pozostałych kolumn; przy remisie WĘŻSZA (mniej kolumn - mniejsze
 * uprawnienie zapisu), potem kolejność `NEWSLETTER_SETTINGS_GROUP_IDS`. Pola
 * rejestracji idą więc grupą `registration`, a nie całym popupem.
 */
export function planNewsletterSettingsGroups(
  columns: readonly NewsletterSettingsColumn[],
): [NewsletterSettingsGroup, NewsletterSettingsColumn[]][] {
  const remaining = new Set(columns);
  const plan: [NewsletterSettingsGroup, NewsletterSettingsColumn[]][] = [];
  while (remaining.size > 0) {
    let best: [NewsletterSettingsGroup, NewsletterSettingsColumn[]] | null = null;
    for (const group of NEWSLETTER_SETTINGS_GROUP_IDS) {
      const covered = (
        NEWSLETTER_SETTINGS_GROUPS[group] as readonly NewsletterSettingsColumn[]
      ).filter((column) => remaining.has(column));
      const bestCovered = best?.[1].length ?? 0;
      const narrower =
        best !== null &&
        covered.length === bestCovered &&
        NEWSLETTER_SETTINGS_GROUPS[group].length < NEWSLETTER_SETTINGS_GROUPS[best[0]].length;
      if (covered.length > bestCovered || narrower) best = [group, covered];
    }
    if (!best) break;
    plan.push(best);
    for (const column of best[1]) remaining.delete(column);
  }
  return plan;
}

const ALL_GROUP_COLUMNS: ReadonlySet<string> = new Set(
  Object.values(NEWSLETTER_SETTINGS_GROUPS).flat(),
);

/**
 * SZEW ZGODNOŚCI (D-S1-04) dla pisarzy spoza manifestu S1
 * (`RegistrationFieldsSection`, `NewsletterBuilder`), którzy wołają dawny
 * `useSaveNewsletterSettings(patch)` - często pełnym wierszem. Patch liczymy
 * względem wiersza w cache (`newsletterKeys.settings()`), rozkładamy na grupy
 * i zapisujemy RPC per grupa z tokenem tego wiersza. Ryzyko szczątkowe:
 * edytor ze szkicem starszym niż cache może odesłać starą wartość kolumny,
 * którą w międzyczasie zmieniła inna karta - zgłoszenie do I9 (przepięcie
 * tych edytorów na `usePatchNewsletterSettings` z własną bazą szkicu).
 */
export async function saveNewsletterSettingsByGroups(
  queryClient: QueryClient,
  patch: Partial<NewsletterSettings>,
): Promise<void> {
  const base =
    queryClient.getQueryData<NewsletterSettings>(newsletterKeys.settings()) ??
    (await fetchNewsletterSettings());
  const draft: NewsletterSettings = { ...base, ...patch };
  const columns = (Object.keys(patch) as NewsletterSettingsColumn[]).filter(
    (column) => ALL_GROUP_COLUMNS.has(column) && !sameSettingValue(base[column], draft[column]),
  );
  if (columns.length === 0) return;

  let current = base;
  let token = base.updated_at ?? null;
  const written: NewsletterSettingsPatch = {};
  for (const [group, groupColumns] of planNewsletterSettingsGroups(columns)) {
    const groupDraft: NewsletterSettings = { ...current };
    for (const column of groupColumns) Object.assign(groupDraft, { [column]: draft[column] });
    const result = await patchNewsletterSettings(group, {
      base: current,
      draft: groupDraft,
      expectedUpdatedAt: token,
    });
    Object.assign(written, diffNewsletterSettings(current, groupDraft, group));
    token = result.updatedAt;
    current = { ...groupDraft, updated_at: token ?? undefined };
  }
  await afterSettingsWrite(queryClient, written, token, null);
}

/**
 * Hak szwu zgodności dla `RegistrationFieldsSection` i `NewsletterBuilder`.
 * Mieszka w module PANELU, nie w `hooks/useNewsletterSettings.ts`: tamten
 * plik jedzie w chunku wejściowym (rejestr prefetchu widgetów), a nawet
 * dynamiczny import zapisu stamtąd liczył ten moduł - razem z
 * `planQueries.ts` i fabrykami kluczy huba - do paczki PUBLICZNEJ (budżet
 * `public`, SPEC §8.6), choć zapis istnieje wyłącznie w panelu.
 */
export function useSaveNewsletterSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<NewsletterSettings>) =>
      saveNewsletterSettingsByGroups(queryClient, patch),
  });
}

/* ---------------------------------------------------- odbiorcy (def. 17) */

/**
 * Domeny huba z reguły panelu `newsletter_subscriber.*`: lejek, kokpit i (od
 * I9, tryb ścisły `metrics` manifestu) zdrowie poczty - przyrost listy,
 * potwierdzenia DOI i wypisy. Lustro reguły szyny, pilnowane testem
 * `settingsQueries.test.ts` (odbiorcy, def. 17).
 */
const AUDIENCE_REVENUE_DOMAINS = ["funnel", "snapshot", "email"] as const;

/**
 * Subskrybenci newslettera i leady CRM to DWA interfejsy tych samych ludzi
 * (def. 17): zmiana subskrybenta (import, wypis, zmiana listy) odświeża listę
 * i kafle newslettera ORAZ listę leadów i lejek CRM - ten sam zestaw co reguła
 * rdzenia `newsletter_subscriber.*` - plus lejek i kokpit huba.
 */
export function audienceInvalidationKeys(tenantId: string | null = null): QueryKey[] {
  return [
    newsletterKeys.subscribersAll(),
    newsletterKeys.kpis(),
    crmKeys.leadsAll(),
    crmKeys.funnelAll(),
    crmKeys.funnelStats(),
    ...revenueDomainKeys(AUDIENCE_REVENUE_DOMAINS, tenantId),
  ];
}

export function invalidateAudienceQueries(
  queryClient: QueryClient,
  tenantId: string | null = null,
): Promise<void> {
  return invalidateKeys(queryClient, audienceInvalidationKeys(tenantId));
}
