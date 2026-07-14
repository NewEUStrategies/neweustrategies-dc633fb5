# Import stron WP (Elementor) → CMS Elementor Builder

## Wymagana decyzja: dostęp do neweustrategies.com

Aktualnie w projekcie jest **jeden** konektor WordPress: `wordpress_com` (WordPress.com REST API).  
Zapytania testowe zwracają `unknown_blog` dla `neweustrategies.com`, `www.neweustrategies.com`, `neweustrategies.wordpress.com` — czyli **ta strona nie jest zarejestrowana pod tym kontem WordPress.com / nie jest podłączona przez Jetpack**. Sandbox również nie ma DNS-a do tej domeny (może być za Cloudflare/geo-blokada), więc bezpośredni `fetch` też nie zadziała.

Do wyboru:

**A. Podłączyć konektor `wordpress` (self-hosted)** — jeśli neweustrategies.com to własny hosting WP. Wymaga: URL + username + Application Password (Users → Profile → Application Passwords w wp-admin). Konektor gateway będzie proxował REST API. Po podłączeniu implementacja rusza od razu.

**B. Podłączyć stronę do Jetpacka** — jeśli chcemy zostać na `wordpress_com`. Wtedy WP.com "zobaczy" domenę.

**C. Eksport XML (WXR)** — user wgrywa plik `WordPress eXtended RSS` z wp-admin (Tools → Export → Pages). Parsujemy lokalnie, obrazki pobieramy z URL-i wewnątrz eksportu (jeżeli media też są dostępne publicznie/CDN). Zero zależności od connectora.

Bez jednej z tych ścieżek nie mam skąd pobrać zawartości. **Zdecyduj A/B/C**, potem lecę.

---

## Zakres funkcjonalny (po odblokowaniu dostępu)

- Import **tylko stron** (`/wp/v2/pages` lub `wp:post_type=page` w WXR), zostawiamy `/` (home) w spokoju — slug `home`/`/` i `is_front_page` pomijamy.
- Statusy: `publish`, `draft`, `private` (mapowanie 1:1 do naszych statusów w `pages`).
- Media: pobieramy do bucketu `media` (Supabase Storage), rejestrujemy w tabeli `media`, przepisujemy każde `<img src>` / `background-image` / `attachment_id` na nasze URL-e.
- Konflikt slug: **nadpisujemy** istniejącą stronę (zachowujemy `id`, tworzymy `content_revisions` z poprzednim stanem — audyt + rollback).

## Mapowanie widgetów Elementor → nasz CMS Builder

Elementor przechowuje strukturę jako JSON w meta `_elementor_data`. Parsujemy drzewo `section > column > widget` i mapujemy na nasze bloki.

Pełne mapowanie (wybrane przez usera):

| Elementor widget      | CMS block                              | Uwagi |
|-----------------------|----------------------------------------|-------|
| `section` / `container` | `builder.section`                    | tło, padding, background-image (media rewrite) |
| `column`              | `builder.column`                       | width_size % → grid cols |
| `heading`             | `builder.heading` (h1-h6)              | typografia z Theme Design (`--td-*`) |
| `text-editor`         | `builder.rich-text`                    | sanitize HTML, konwersja `<img>` na block |
| `image`               | `builder.image`                        | + alt, caption, link |
| `button`              | `builder.button`                       | wariant z `button_type` / `size` |
| `video`               | `builder.video` (YT/Vimeo/self)        | detect provider |
| `spacer` / `divider`  | `builder.spacer` / `builder.divider`   | — |
| `icon-box`            | `builder.icon-box`                     | icon → nasza `icon_library` (fallback text) |
| `image-box`           | `builder.image-box`                    | — |
| `tabs`                | `builder.tabs`                         | ARIA-compliant tabs |
| `accordion`/`toggle`  | `builder.accordion`                    | — |
| `testimonial`         | `builder.testimonial`                  | — |
| `counter`             | `builder.counter`                      | animowany licznik |
| `progress`            | `builder.progress`                     | — |
| `form`                | `builder.form` (readonly display + link do `/contact`) | nie kopiujemy backendu formy WP |
| `image-gallery` / `image-carousel` | `builder.gallery`         | — |
| **nieznane widgety**  | `builder.raw-html` (fallback)          | log warning + zachowujemy `original_type` w settings |

Style (kolory, typografia, padding, margin, responsive) mapujemy na nasze design tokens `--td-*` gdzie się da; hardkodowane wartości → block-level style props (nie zaśmiecamy globalnych tokenów). i18n: kopiujemy `pl` do `content_pl`; `en` zostaje puste (do ręcznego wypełnienia lub przyszłej auto-translacji).

## Techniczna implementacja

1. **Server function** `src/lib/wp-import.functions.ts` (protected `requireSupabaseAuth` + role check `has_role(admin|super_admin)`), która:
   - Paginowanie `per_page=100` przez wszystkie strony.
   - Dla każdej strony: pobierz `_elementor_data` z `meta` (lub `content.rendered` fallback).
   - Odpal `mapElementorTree(nodes)` → nasze bloki.
   - Ściągnij media (Set<url>) → upload do Supabase Storage → mapa `wpUrl → cdnUrl`.
   - Upsert do `pages` (po slug, w tenancie usera), zapis rewizji.
   - Zwraca raport: created/updated/skipped, warnings (unknown widgets), błędy.

2. **Parser Elementor** `src/lib/wp-import/elementor.ts` — czysta funkcja + pełne testy jednostkowe (per widget type + drzewo zagnieżdżeń + fallback).

3. **UI admin**: `/admin/pages` → dodać przycisk **"Importuj z WordPress"** → modal z podglądem raportu, progress bar (SSE lub polling), lista ostrzeżeń per strona.

4. **Bezpieczeństwo**:
   - Server-side rola check + tenant_id.
   - Sanityzacja HTML (DOMPurify server-side).
   - Rate limit na media (batch 5 równolegle, max 200 MB/run).
   - Idempotencja: hash contentu → skip jeśli identyczny.

5. **Testy**: `src/lib/wp-import/__tests__/elementor.test.ts` — fixtures dla każdego widgetu (mini JSON-y).

## Zakres poza tym importem

- Home page (`/`) — nie ruszamy.
- Wpisy (`posts`) — nie w tym imporcie.
- Formularze WP (kontakt) — display-only, backend zostaje nasz.
- CSS niestandardowy z Elementor Pro (theme_style) — pomijamy, konwertujemy tylko inline.

## Deliverables

- `src/lib/wp-import/elementor.ts` + testy
- `src/lib/wp-import.functions.ts` (server fn)
- `src/components/admin/WordPressImportDialog.tsx`
- Wpięcie w `/admin/pages`
- Ewentualna migracja: `wp_import_jobs` już istnieje ✓ (użyjemy) — dopiszemy potrzebne kolumny jeśli trzeba.

---

**Czekam na wybór A/B/C** (dostęp do WP) zanim zacznę pisać kod.
