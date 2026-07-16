# Related Posts: Silnik v2 + Panel Analizy

Rozbudowa modułu `/admin/related-posts` o dwie warstwy: mocniejszy **silnik rekomendacji** (sygnały behawioralne + konfigurowalne wagi) oraz **panel BI "Analiza"** (wizualizacje w stylu ECharts, spójne z Web Vitals / GA4 / GSC). Wszystko izolowane per `tenant_id`.

## 1. Rozszerzenie silnika (`src/lib/relatedPosts.ts`)

Nowe pola w `RelatedPostsConfig` (zapisywane w `related_posts_config`, wszystkie z sensownymi defaultami — kompatybilność wstecz):

- `weight_categories` (0-10, default 3)
- `weight_tags` (0-10, default 2)
- `weight_author` (0-10, default 1; strategia author = 4)
- `weight_recency` (0-10, default 1)
- `weight_popularity` (0-10, default 2) — z `post_views` (28d)
- `weight_dwell` (0-10, default 2) — z `user_read_history` (proxy — więcej wpisów tego samego usera)
- `weight_personalization` (0-10, default 3) — kategorie/tagi wpisów przeczytanych przez zalogowanego usera
- `use_idf` (bool, default true) — rzadkie tagi punktują wyżej (Jaccard + IDF)
- `min_score` (0-100, default 0) — próg widoczności rekomendacji

`scoreRelated()` przyjmuje dodatkowo:
- `signals: { popularityByPost: Map<id, number>, userProfile?: { catAffinity, tagAffinity }, idfCat, idfTag }`
- zwraca `{ total, breakdown: { categories, tags, author, recency, popularity, personalization } }` (rozbicie potrzebne panelowi analitycznemu)

## 2. Migracja bazy

- `ALTER TABLE related_posts_config` — 8 nowych kolumn z defaultami.
- Nowa RPC `related_posts_signals(_tenant, _since_days)` (SECURITY DEFINER, admin-only): zwraca dla tenantu w JSON:
  - top kategorie i tagi (with counts)
  - macierz współwystąpień tagów top-25 (heatmapa)
  - rozkład popularności postów (post_views z 28 dni)
  - avg czytania (proxy z read_history: liczba usera → tenantu)
  - top pary "źródło → cel" (klik z powiązanych — logujemy w kroku 4)
- Nowa tabela `related_post_clicks` (tenant_id, source_post_id, target_post_id, user_id NULL, viewer_hash, clicked_at) + RLS: insert `anon+authenticated` przez publiczne API, select tylko admin tenantu. GRANTS + policies.

## 3. Server function `getRelatedInsights` (per-tenant, admin-gated)

`src/lib/relatedInsights.functions.ts`:
- `.middleware([requireSupabaseAuth])`
- Weryfikuje role admin, rozwiązuje `tenantId` z helpera.
- Woła RPC + doczytuje słownik kategorii/tagów, pakuje DTO.
- Zwraca: KPIs (rec_ctr, top_cats, top_tags, avg_score), co-occurrence heatmapa, ranking postów-hubów, wykres popularności vs. relewancji, sankey `źródło → cel`.

## 4. Beacon "klik na rekomendacji"

- `POST /api/public/related-click` — walidacja Zod, rate-limit per viewer_hash, insert do `related_post_clicks`. Tenant rozwiązywany z `posts.tenant_id`.
- Komponent `RelatedPosts.tsx` woła `navigator.sendBeacon` przy kliknięciu karty (nie blokuje nawigacji).

## 5. Podpięcie silnika v2 do query

`src/lib/queries/relatedPosts.ts`:
- Doczytuje `post_views` (28d, per tenant post ids) → mapa popularności.
- Dla zalogowanego usera: `user_read_history` (top 20) → profil zainteresowań (agreguje kategorie/tagi).
- Liczy IDF na podstawie liczności tag/category (small in-memory).
- Woła `scoreRelated` z pełnym kontekstem, filtruje po `min_score`.

## 6. Panel Admin — zakładki

`/admin/related-posts` dostaje `<Tabs>`:

1. **Konfiguracja** — obecny formularz + nowa sekcja "Wagi silnika" (slidery 0-10 dla każdego sygnału, przełącznik IDF, próg min_score).
2. **Analiza (BI)** — nowa sekcja:
   - `TimeRangeFilter` (ten sam co Web Vitals: 24h/7d/30d/90d + custom).
   - KPI tiles: łączna liczba rekomendowanych klik, CTR rekomendacji, avg score, pokrycie (% wpisów z ≥3 rec).
   - **Heatmapa** współwystępowania tagów (top 25×25, ECharts heatmap).
   - **Treemap** kategorii (rozmiar = liczba wpisów, kolor = avg dwell/popularity).
   - **Sankey** "źródło → cel" (top 30 par klik).
   - **Scatter** popularność vs. dopasowanie (każdy post: X=views, Y=avg_score jako cel).
   - **Bar** top-hub posts (najczęściej rekomendowane).
   - `InsightSection` (ten sam primitive co GSC/GA4/Vitals): interpretacja + rekomendacje algorytmiczne (np. "3 kategorie mają <10 wpisów - podnieś wagę tags", "post X ma 40 klik. rec. ale niski score - promuj").
3. **Podgląd rekomendacji** — wybór wpisu z autocomplete → lista rec z rozbiciem score (stacked bar per kandydat: categories/tags/author/recency/popularity/personalization). Live preview zmian wag.

## 7. Bezpieczeństwo & tenant isolation

- Wszystkie odczyty przez `context.supabase` (RLS) lub RPC SECURITY DEFINER z `_tenant` weryfikowanym przez `resolveUserTenantId`.
- `related_post_clicks`: insert publiczny (rate-limited), select admin-only tenantu.
- Żadnego `supabaseAdmin` w loaderach; jeśli potrzebny do RPC-agregacji, tylko po `has_role admin` w tym samym request.

## 8. Testy

- `src/lib/__tests__/relatedPosts.test.ts` — rozbudowa: nowe wagi, IDF, personalization, breakdown.
- `src/lib/__tests__/relatedInsights.test.ts` — nowy: agregacja co-occurrence, sankey, insighty.

## Technicznie

- Wykresy: `ECharts` przez istniejący `ChartCard` + `chartTheme`.
- Wspólny primitive `InsightSection` dla rekomendacji analitycznych.
- i18n: PL + EN (te same klucze w `src/lib/locale/{pl,en}.ts` pod `admin.relatedPosts.*`).
- Atomic design: `TimeRangeFilter`, `KpiTile`, `ChartCard`, `InsightSection` reużyte.
- Bez `any` / `as any`; wszystkie typy explicit.
- Myślnik `-` zamiast `—`.

## Kolejność wdrożenia

1. Migracja (kolumny + tabela klik + RPC + GRANTs + RLS).
2. `relatedPosts.ts` v2 (typy + scoring + breakdown).
3. Query update (sygnały behawioralne).
4. Beacon route + wywołanie z `RelatedPosts.tsx`.
5. Server fn `getRelatedInsights`.
6. Route `/admin/related-posts` → Tabs + Analiza + Podgląd.
7. Testy + typecheck.
