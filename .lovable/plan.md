
## Zakres (4 moduły z Foxiz, wdrażane po kolei)

Adaptacja pod nasz stack: TanStack Start + Lovable Cloud, builder widgets, atomic design, i18n PL/EN, tenant_id, RLS, testy.

---

### Moduł K — Footer

1. **Footer Builder** — wybór szablonu z `builder_templates` (typ `footer`) per tenant. Renderer w `Footer.tsx` używa BuilderRenderer.
2. **Footer Widgets area** — kolumny (1-4) z widgetami: about, menu, contact, social, newsletter, recent posts, tags cloud, instagram feed.
3. **Footer Settings** (Theme Options → Footer):
   - layout: `default | centered | minimal | dark | light`
   - kolumny: 1/2/3/4
   - copyright text (i18n)
   - back-to-top toggle
   - separator między sekcjami
4. **Tabela**: `footer_settings` (tenant singleton) + admin route `/admin/theme-design/footer`.

### Moduł L — Podcast

1. **Custom post type**: rozszerzenie `posts` o `post_type='podcast'` lub osobna tabela `podcasts` (audio_url, duration, episode_number, season, transcript, show_notes).
2. **PodcastPlayer atom** — HTML5 audio + sticky player (kontrolki: play/pause, seek, speed, skip ±15s).
3. **Builder widgets**:
   - `podcast-latest` (grid/list ostatnich odcinków)
   - `podcast-featured` (jeden hero z playerem)
   - `podcast-playlist` (kolejka)
4. **Single podcast page**: `/podcast/$slug` z playerem, show notes, transcript, embed code.
5. **Global options**: domyślny player (mini/full), auto-play next, subscribe links (Spotify/Apple/Google).
6. **Migracja**: tabela `podcasts` (RLS, GRANTS), `podcast_settings` (tenant singleton).

### Moduł M — Newsletter

1. **Subscribe form block** — atom + builder widget (`newsletter-form`).
2. **Tabela** `newsletter_subscribers` (email, tenant_id, status, confirmed_at, locale, consent) z double opt-in.
3. **Server functions**: `subscribeNewsletter`, `confirmSubscription`, `unsubscribe` (token-based).
4. **Newsletter Popup**:
   - Theme Options → Newsletter Popup (cover image, title, description, CTA, trigger: delay/scroll/exit-intent, frequency cookie).
   - `NewsletterPopup` komponent renderowany w root.
5. **Email integration**: na razie zapis w DB + endpoint webhooka; opcjonalnie konektor Mailchimp/Resend (do dyspozycji w przyszłej turze).
6. **Layouty formularza**: inline, stacked, boxed (per użycie).

### Moduł N — Web Stories

1. **Tabela** `web_stories` (tenant_id, title, slug, cover_url, pages JSONB, published_at, status).
2. **Story Viewer** — pełnoekranowy odtwarzacz (swipe/keyboard, progress bar, autoplay 5s per page, tap left/right, media: image/video, text overlay).
3. **Edytor stories** w admin: `/admin/web-stories` (lista) + `/admin/web-stories/$slug` (edytor stron: dodaj/usuń/reorder, layout text, background media).
4. **Public route** `/web-stories/$slug` (AMP-like fullscreen, SEO meta).
5. **Builder widget** `web-stories-carousel` — poziomy carousel kafli z cover + tytuł, klik otwiera viewer.
6. **i18n**: title/description per locale; lazy-load mediów.

---

### Wspólne

- Wszystkie nowe tabele: tenant_id, RLS z `has_role` / tenant scoping, GRANTs (anon read tylko dla publish=true tam gdzie publiczne).
- Builder widgets rejestrowane w `src/lib/builder/registry.tsx` z view + properties editor + Zod schema.
- i18n: nowe klucze w `src/i18n/locales/pl.json` i `en.json`.
- Testy vitest: scoring, walidacja zod, render layoutów, server fn guards.
- Atomic design: atoms (Player, SubscribeInput, StoryProgressBar), molecules (PodcastCard, NewsletterCardForm, StoryCard), organisms (FooterRenderer, PodcastList, StoryCarousel, StoryViewer).

### Kolejność wdrażania (4 osobne tury)

1. **Tura 1 — Footer (K)** — szybkie, dotyka tylko UI + 1 tabela settings.
2. **Tura 2 — Newsletter (M)** — subscribers + popup + form widget.
3. **Tura 3 — Podcast (L)** — najobszerniejsze (CPT + player + widgets + single page).
4. **Tura 4 — Web Stories (N)** — viewer + editor + carousel.

Każdą turę kończę testami (`vitest`) + typecheck.

---

**Czy zatwierdzasz? Zaczynam od Tury 1 (Footer).** Jeśli chcesz zmiany kolejności lub okroić zakres (np. pominąć editor stories / pominąć double opt-in) — napisz przed startem.
