## Cel

Widget w CMS przestaje być statyczną kopią treści. Każdy "treściowy" widget (Slider, Karta wyróżniona, Lista, Hot topic, News ticker, Karuzela, Hero) wskazuje wpis/stronę/kategorię/tag - obraz, tytuł, excerpt, autor, data, link i nazwa kategorii zawsze pobierane są na żywo z bazy. Edycja wpisu od razu propaguje się do wszystkich widgetów na wszystkich stronach.

## Stan obecny (audyt)

Już zsynchronizowane (czytają live z Supabase):
- `PostListView` - lista/grid/karuzela wpisów (filtry kategoria/tag/autor/data/popularność)
- `NewsTickerView` - poziomy pasek najnowszych
- `RatedListView`, `PostsSliderWidget` (gdy `source = "posts"`)
- `CategoriesView`, `TagsView`, `WebStoriesCarouselView`, `PodcastLatestView`

Trzymają zduplikowane dane (źródło problemu z preview):
- Slider w trybie `manual` - per-slajd zapisany `image`, `title_*`, `subtitle_*`, `href` (gdy plik znika ze storage → 404, gdy zmienisz tytuł posta → nie aktualizuje się)
- Widget `image` - zapisany URL bez referencji do posta
- Widget `featured-card` / kafelek "hot" - statyczny tytuł/obraz

Brakuje też globalnej invalidacji cache po zapisie wpisu/strony - widget cache (`builder-slider-posts`, `post-list-*` itd.) odświeża się dopiero na `staleTime` lub po reload.

## Co wdrożymy

### 1. Wspólny "content reference" model

Dodajemy lekki helper `useResolvedPostRef({ postId, fallback })` zwracający `{ id, slug, title, excerpt, cover, href, publishedAt, author, categories[] }` w aktywnym języku, z `useQuery` + wspólnym kluczem `["post-ref", id, lang]` (5 min stale, 30 min gc). Resolwer mapuje też URL covera przez nasze custom crop sizes.

Plus `useResolvedPageRef`, `useResolvedCategoryRef`, `useResolvedTagRef` - ten sam wzorzec dla pozostałych encji.

### 2. Slider - per-slajd referencja do wpisu

W `SliderEditor` (tryb manual) każdy slajd dostaje pole `Powiąż z wpisem` (Combobox z wyszukiwarką po `posts.slug/title`). Gdy ustawione:
- `image` → `post.cover_image_url` (z lazy fallbackiem na zapisany URL)
- `title_pl/en`, `subtitle_pl/en` (excerpt), `href` (wyliczony z parent_page + slug), `cta_*`
- Wciąż można nadpisać ręcznie każde pole (zapisane wartości mają priorytet nad live)

`SliderRender` w trybie manual uruchamia `useResolvedPostRef` dla każdego slajdu z `postId` i miksuje wynik z lokalnymi nadpisaniami. Brak postId = czysty manual jak dziś (z dodatkowym `onError` na `<img>` pokazującym placeholder zamiast 404).

### 3. Widget `image` - opcjonalna referencja do covera wpisu

Dodajemy w `ImageWidget` przełącznik `Źródło: Upload | Cover wpisu`. W trybie "cover wpisu" picker postId; live URL + alt z tytułu posta.

### 4. Featured-card / hot-topic / hero

Te widgety (`SimpleWidgets.tsx` cases) dziś trzymają tytuł/obraz w `c.title_*`/`c.image`. Dodajemy ten sam pattern: `postId` → live data, lokalne pola jako override.

### 5. Auto-invalidacja po zapisie

W mutacjach `updatePost` / `updatePage` / `publishPost` (admin) po success: `queryClient.invalidateQueries({ predicate: q => q.queryKey[0] in {"post-ref","page-ref","builder-slider-posts","post-list","news-ticker","trending"} })`. Plus Supabase realtime subskrypcja na frontendzie (`postgres_changes` na `posts/pages/categories/tags`) invaliduje te same klucze - aktualizacja widoczna bez przeładowania na innych otwartych kartach.

### 6. Placeholder dla zniszczonych URL-i

`OptimizedImage` + bezpośrednie `<img>` w `SliderRender` dostają `onError` → placeholder (neutralne tło + ikona) + `console.warn` z URL-em. Brak 404 wybielającego layout.

### 7. i18n + testy

- Nowe stringi PL/EN w `src/lib/i18n.ts` (Powiąż z wpisem, Źródło, Nadpisz tytuł itp.).
- Testy jednostkowe dla `useResolvedPostRef` (override > live > fallback) i smoke test rendererów Slider/Image z `postId`.

## Pliki

```text
src/lib/builder/contentRefs.ts                                   NEW - useResolvedPostRef/PageRef/CategoryRef/TagRef
src/lib/builder/types.ts                                          + pola postId/pageId per slajd
src/components/admin/builder/ui/organisms/widget-properties/
  SliderEditor.tsx                                                + picker postId per item
  ImageWidget editor (w SimpleWidgets / dedicated)                + przelacznik source
  FeaturedCardEditor.tsx (jesli istnieje, inaczej w SimpleWidgets)+ picker postId
src/components/admin/builder/ui/organisms/widget-view/
  SimpleWidgets.tsx                                               miks live+override w slider/image/featured
  SliderRender (sliderVariants.ts)                                onError placeholder
src/components/atoms/OptimizedImage.tsx                           onError fallback
src/lib/builder/widgetCacheInvalidation.ts                        NEW - helper invalidate + realtime hook
src/routes/admin.posts.$slug.tsx, admin.pages.$slug.tsx           podlacz invalidate po mutation
src/lib/i18n.ts                                                   nowe klucze
src/components/admin/builder/__tests__/contentRefs.test.tsx       NEW
```

## Co się nie zmienia

- Schema bazy bez zmian (`postId` to pole w JSON `content`).
- RLS, polityki, edge functions - nic.
- Istniejące widgety czytające live (PostList, NewsTicker itp.) - tylko dostają wspólną invalidację.

## Akceptacja

1. Otwieram istniejący Slider manual, klikam slajd, wybieram wpis → obraz/tytuł podmienione na żywo.
2. Edytuję tytuł wpisu w `/admin/posts/$slug` → po zapisie wszystkie widgety na innych otwartych zakładkach pokazują nowy tytuł bez F5.
3. Usuwam plik z Media → slider pokazuje placeholder zamiast pustej białej dziury.
4. Build zielony, lint zielony, nowe testy zielone.
