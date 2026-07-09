# Metabox „Foxiz-style” w edytorze wpisów i stron

## Cel
W szczegółach wpisu i strony pojawia się **jednolity metabox** z zakładkami po lewej i panelem po prawej — dokładnie tak jak w Foxiz („Single Page Settings"). Każda zakładka to nadpisanie globalnej opcji z Theme Options dla tego jednego wpisu/strony. Trzy funkcjonalne zakładki na start:

1. **Ogólne** — header, breadcrumbs, szerokość, wyłączenie „Featured area"
2. **Spis treści (ToC)** — enable/disable per wpis + layout + pozycja wyświetlenia
3. **Ochrona treści (Membership)** — reguła dostępu wybrana z `access_plans` (już jest osobno — przeniesiemy do zakładki)
4. **Kluczowe punkty** — edytor punktów PL/EN z podpowiedzią długości („max 1 zdanie na punkt, ok. 90-160 znaków, jedna myśl")

## Zakres — pliki

### DB (jedna migracja)
- Dodać `posts.toc_override jsonb` (nullable): `{ enabled: bool, layout: "boxed" | "inline" | "sticky", position: number }`. `null` = użyj globalnej konfiguracji.
- Dodać `pages.toc_override jsonb` (analogicznie).
- Kolumny `takeaways_pl/en`, `content_access`, `access_plans` już istnieją — nic nie ruszamy.

### Globalne ustawienia ToC (nowe)
- `site_settings.toc_defaults` — schemat Zod, hook `useTocDefaults`, zapisywanie. Pola: `enabledDefault`, `layout`, `position`, `minHeadings`, `maxLevel`, `sticky`, `title_pl`, `title_en`, kolory (tło, akcent, tekst — light + dark).
- Nowa strona admina `/admin/toc` z formularzem po lewej i live-preview po prawej. Wpisujemy do menu w grupie *Design*.

### UI metaboxa (współdzielony komponent)
- Nowy `src/components/admin/PostSettingsMetabox.tsx` — układ 2-kolumnowy:
  - lewa kolumna: pionowy switcher zakładek (Foxiz-style — ikona + label, aktywna zielona)
  - prawa kolumna: panel z aktywną zakładką
  - variant `entity: "post" | "page"` kontroluje, które zakładki są dostępne (strony nie mają takeaways / membership per default; ale można włączyć)
- Zakładki jako sub-komponenty:
  - `MetaboxGeneralTab` — layout/breadcrumb/header (nadpisania globalnych — reużywamy istniejące pola `layout_overrides`)
  - `MetaboxTocTab` — per-post override (`enabled`, `layout`, `position`, `sticky`) + link do globalnej strony admina
  - `MetaboxMembershipTab` — opakowanie istniejącego `AccessSettingsPane`
  - `MetaboxTakeawaysTab` — istniejący `TakeawaysEditor` + **inline hint** z zalecaną długością (licznik znaków per punkt, kolor ostrzeżenia gdy > 200)

### Integracja w edytorach
- `src/routes/admin.posts.$slug.tsx`: usuwamy oddzielny `TakeawaysEditor`, `AccessSettingsPane` z sidebara i zastępujemy jednym `<PostSettingsMetabox entityType="post" ... />` w sekcji „Szczegóły wpisu". Sygnatura wywołania: przekazuje bieżący form snapshot + settery.
- `src/routes/admin.pages.$slug.tsx`: analogicznie, ale bez zakładki Takeaways.

### Auto-ToC w renderze publicznym
- `src/routes/$.tsx`: jeżeli `toc_override.enabled` (lub globalny default) i wpis ma ≥ N nagłówków — wstrzykiwać `<TocBlockView>` we wskazanej pozycji (po N akapicie / na górze / w sticky w sidebarze) z tytułem PL/EN i stylami z tokenów.
- Fallback: jeżeli w treści już jest ręczny widget ToC, auto-ToC się nie duplikuje.

### Zalecana długość takeaways
- `KeyTakeawaysHint` — komponent z licznikiem PL/EN, ostrzeżenie: „Rekomendacja: jedno zdanie, 90-160 znaków, jedna myśl na punkt" + kolor:
  - < 40 znaków: żółte („zbyt krótkie")
  - 40-200: zielone
  - > 200: pomarańczowe („rozbij na kilka punktów")
- Ograniczenie miękkie, nie blokuje zapisu.

### i18n
- Nowe klucze: `admin.metabox.*` (tabs: general/toc/membership/takeaways), `admin.toc.*`, `post.takeaways.lengthHint`.

### Testy
- `PostSettingsMetabox.test.tsx` — renderuje wszystkie zakładki dla `post`, ukrywa Takeaways dla `page`.
- `manualToc.test.ts` — dopisujemy scenariusz auto-injection na podstawie `toc_override`.

## Poza zakresem (na później)
- Header override per-post/page (screen 5 Foxiz) — obecny system `post_layout_settings` już to obsługuje w innym miejscu; nie duplikujemy.
- Overrides dla Site Footer / SEO Optimized / Ads per-post — już są w innych panelach; można zlinkować z metaboxa w kolejnym kroku.
- Analytics ilu użytkowników scrolluje ToC — feature request.

## Migracja — SQL (skrót)
```sql
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS toc_override jsonb;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS toc_override jsonb;
COMMENT ON COLUMN public.posts.toc_override IS 'Per-post override for global ToC settings; null = inherit.';
COMMENT ON COLUMN public.pages.toc_override IS 'Per-page override for global ToC settings; null = inherit.';
```
Bez GRANT-ów — istniejące polityki i uprawnienia na tabelach zostają nietknięte (tylko dodajemy kolumnę).

## Kolejność wdrożenia
1. Migracja DB (kolumny `toc_override`).
2. `toc_defaults` w `site_settings` + `/admin/toc` z live preview.
3. `PostSettingsMetabox` + zakładki + integracja w obu edytorach.
4. Auto-ToC injection w rendererze publicznym.
5. Hint długości + licznik w Takeaways.
6. i18n + testy.
