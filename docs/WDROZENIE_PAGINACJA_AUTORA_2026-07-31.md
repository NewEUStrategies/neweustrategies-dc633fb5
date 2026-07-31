# Wdrożenie: paginacja serwerowa archiwum autora (2026-07-31)

Domyka rekomendację audytu `OCENA_FUNKCJI_TABELE_2026-07-30.md` (MODUŁ 5,
"Archiwum autora", ocena 6): _"Paginacja **po stronie klienta** na pobranym
zbiorze → Paginacja serwerowa z URL"_. Role-gating profilu (mocna strona z
audytu) pozostaje nienaruszony i nadrzędny.

## Stan przed

Eksplorator materiałów na `/author/$slug` (`ExpertMaterialsExplorer`) trzymał
stronę i filtry w `useState`, kroił pobrany KOMPLET materiałów po stronie
klienta i renderował po jednym przycisku na każdą stronę. Skutki: brak
deep-linków i działającego "wstecz", SSR zawsze renderował stronę 1,
stan ginął przy każdej nawigacji.

## Stan po

### Kontrakt URL (`lib/experts/materialsSearch.ts`)

`/author/$slug?page=2&kind=report&topic=energia&region=cee&program=defence&year=2025`

- `validateSearch` trasy = `parseAuthorHubSearch` (czysty parser, testowany):
  niepoprawne wartości odrzucane po cichu, klucze emitowane tylko dla wartości
  poprawnych - kanoniczny URL profilu zostaje czysty, bez redirect-churnu.
- Filtry niosą SLUGI taksonomii (czytelne, stabilne URL-e), nie UUID-y.

### RPC `get_expert_materials` (migracja `20260731193000`)

- SECURITY INVOKER + STABLE: pełny RLS wołającego, tenant scoping jak przy
  zapytaniach bezpośrednich (parytet z `get_expert_hub`).
- Zunifikowany zbiór kandydatów (posty autora + współautorstwa z dedupe
  "autor główny wygrywa", podcasty, wydarzenia host/prelegent) filtrowany
  AND w SQL (kind / program / region / kategoria / tag / rok UTC), liczony
  (`total`) i cięty oknem LIMIT/OFFSET w porządku deterministycznym
  (`data DESC NULLS LAST, id ASC` - stabilna paginacja bez duplikatów).
- Zwraca pozycje strony W KOLEJNOŚCI OKNA + pivoty taksonomii tylko dla
  postów strony; mapowanie wierszy zostaje w TS (`normalize.ts`) - RPC, hub
  i legacy dzielą jedną asemblację `ExpertMaterial`.
- Nieznany slug filtra / kind → `total=0` (nigdy wyjątek); brak profilu →
  `found=false` (TS mapuje na 404); wejścia klamrowane (page ≥ 1, size ≤ 60).
- Dołożony indeks częściowy `idx_posts_author_published`
  (`author_id, published_at DESC` dla published/nieusuniętych).

### Warstwa TS

- `lib/experts/materialsPage.ts` (czysta, testowana): mapowanie ładunku RPC,
  `paginateMaterials` i `filterMaterialsBySlugs` o semantyce parytetnej do SQL
  (strona poza zakresem = pusta lista + prawdziwy total).
- `lib/experts/materials.ts`: `expertMaterialsQueryOptions` z kluczem niosącym
  pełną parametryzację strony wyników, `edgeTtlCache` per tenant-host (60 s,
  jak archiwa taksonomii) i `placeholderData: keepPreviousData`.
- Odporność wdrożeniowa: brak funkcji (okno deploy → migracja) spada na
  ścieżkę legacy - hub przez WSPÓLNY klucz edge-cache + filtr + slice.

### Trasa `/author/$slug`

- `loaderDeps` + loader: strona materiałów jedzie RÓWNOLEGLE z hubem
  (RPC sam rezolwuje slug) - SSR renderuje dokładnie żądaną stronę N bez
  dodatkowej fali na ścieżce TTFB.
- SEO: canonical bez parametrów eksploratora; tytuł stron >1 z sufiksem
  "(strona N)"; robots: widok spaginowany/filtrowany indeksowalnego profilu →
  `noindex, follow`, a profil nieindeksowalny zachowuje twardsze
  `noindex, nofollow` z `profileRobots` (role-gating nadrzędny).

### Eksplorator (`ExpertMaterialsExplorer`)

- Stan w URL przez `getRouteApi("/author/$slug")` (typowane search params),
  zmiana filtra wraca na stronę 1, `resetScroll: false` + własny scroll do
  sekcji przy zmianie strony (z poszanowaniem `prefers-reduced-motion`).
- Współdzielona molekuła `ArchivePagination` (numeracja z wielokropkiem) -
  spójność z archiwami taksonomii zamiast N przycisków.
- Fasety/liczniki/lata nadal z huba (zawężone w SQL); lista z paginacji
  serwerowej; `aria-busy`/`aria-live`, skeleton, stan błędu z retry;
  URL poza zakresem stron sam koryguje się na ostatnią stronę (`replace`).
- i18n PL/EN: nowe klucze `expert.pageIndicator`, `expert.materialsError`,
  `expert.retry`.

## Testy

- `materialsSearch.test.ts` - parser URL (walidacja, klamrowanie, idempotencja).
- `materialsPage.test.ts` - mapowanie ładunku RPC (kolejność okna, pivoty,
  flaga współautora), parytet filtrów slug↔id, semantyka strony poza zakresem.
- `materials.smoke.test.ts` - klucz zapytania, argumenty RPC, fallback legacy.
- `expert_materials_pagination_test.sql` (pgTAP, 22 asercje) - INVOKER+grant,
  total/okna/porządek, filtry AND, dedupe współautorstwa, pivoty per strona,
  rezolucja slug/UUID, klamrowanie wejść.

## Pliki

- `supabase/migrations/20260731193000_get_expert_materials.sql` (nowy)
- `supabase/tests/expert_materials_pagination_test.sql` (nowy)
- `src/lib/experts/{materialsSearch,materialsPage,materials}.ts` (nowe)
- `src/lib/experts/{types,normalize,queries,rpcHub}.ts` (rozszerzone)
- `src/routes/author.$slug.tsx`, `src/components/experts/ExpertMaterialsExplorer.tsx`
- `src/lib/i18n-experts.ts` (klucze PL/EN)
