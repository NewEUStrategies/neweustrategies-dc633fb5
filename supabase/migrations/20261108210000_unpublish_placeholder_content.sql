-- ============================================================================
-- TREŚCI ZASTĘPCZE: ODPUBLIKOWANIE I `noindex` (wpis demo, wydarzenia testowe,
-- martwe strony po WordPressie)
-- ============================================================================
--
-- PRZYCZYNA (2026-11-08, przegląd SEO wyniku marki). Przegląd wszystkich
-- adresów z map strony wykazał opublikowane treści, które nie są treścią
-- think tanku, a trafiały do map, llms.txt, RSS i mapy HTML:
--   * wpis `the-best-islands-for-beaches-from-aruba-to-the-baltics` („The Best
--     Islands for Beaches, From Aruba to the Baltics") - przykładowy wpis motywu
--     z importu WordPressa, tematycznie obcy serwisowi (rozmywa obraz serwisu
--     jako źródła o bezpieczeństwie Europy);
--   * wydarzenia `test-e2e-zakup` i `test-e2e-zakup-2` („TEST E2E - próbny
--     zakup/płatność") - artefakty testów e2e, opublikowane i widoczne na liście
--     wydarzeń (strony wydarzenia zdjęła już migracja 20261011090200, samych
--     wydarzeń nie);
--   * strona `jobs` - surowy shortcode wtyczki `[easyjobs]` zamiast treści,
--     duplikat działającej strony `/zatrudniamy`;
--   * strona `register` - zrzut stanu panelu WordPressa z importu („You are
--     already logged in as Office New European Strategies. Go to Dashboard
--     Logout"), czyli treść, której nikt nie powinien zobaczyć;
--   * strona `edit-your-submission` - martwy ekran wtyczki zgłoszeń („Post Not
--     Found ... does not exist"); zgłoszenia obsługuje dziś `/contribute`.
--
-- CO ROBI. Wpis i strony przechodzą z `published`/`scheduled` do `draft`
-- i dostają `seo_noindex = true` (ta sama reguła co w 20261011090200);
-- wydarzenia testowe przechodzą z `published` do `draft`. Przekierowań NIE
-- zakładamy: adresy mają zniknąć (404), nie przekazywać mocy linków.
--
-- ZAKRES - celowo wąski i odporny na innych najemców:
--   * wpis: dokładny slug ORAZ tytuł z „Aruba" (przykład motywu, nie treść);
--   * strony: dokładny slug ORAZ znacznik zepsutej treści w zapisie strony
--     (`[easyjobs]`, „already logged in", „does not exist") - strona `jobs`
--     albo `register` innego najemcy z prawdziwą treścią zostaje nietknięta;
--   * wydarzenia: slug pasujący do `^(test|e2e)($|[-_])`
--     (`TEST_CONTENT_SLUG_PATTERN`, `src/lib/seo/testContent.ts`) - ten sam
--     wzorzec co w 20261011090100/20261011090200, więc `testy-nato` zostaje.
--
-- SKUTKI UBOCZNE - sprawdzone wyzwalacze:
--   * `events_status_notify` powiadamia uczestników WYŁĄCZNIE przy przejściu
--     `published -> cancelled`; `events_zz_cancelled_closes_paid`
--     i `events_zz_wallet_revoke` też tylko przy `cancelled`. Przejście do
--     `draft` nie wysyła nic i nie zamyka zamówień;
--   * `posts_notify_published_trg` działa tylko przy wejściu w `published`;
--     `trg_posts_emit_events` zapisze wewnętrzne `post.status_changed.v1`;
--   * `posts_workflow_guard` / `pages_workflow_guard` (`enforce_post_workflow`)
--     przy `auth.uid() IS NULL` (migracja) oddają wiersz bez bramki i pilnują
--     wyłącznie WEJŚCIA w `published`/`scheduled`.
-- Idempotentna: ponowne wykonanie nie zmienia już niczego.

UPDATE public.posts p
   SET status = 'draft'::public.post_status,
       publish_at = CASE
                      WHEN p.status = 'scheduled'::public.post_status THEN NULL
                      ELSE p.publish_at
                    END,
       seo_noindex = true
 WHERE p.slug = 'the-best-islands-for-beaches-from-aruba-to-the-baltics'
   AND (COALESCE(p.title_en, '') || ' ' || COALESCE(p.title_pl, '')) ILIKE '%aruba%'
   AND p.deleted_at IS NULL
   AND (
     p.status IN ('published'::public.post_status, 'scheduled'::public.post_status)
     OR p.seo_noindex IS DISTINCT FROM true
   );

UPDATE public.pages p
   SET status = CASE
                  WHEN p.status IN ('published'::public.post_status, 'scheduled'::public.post_status)
                    THEN 'draft'::public.post_status
                  ELSE p.status
                END,
       publish_at = CASE
                      WHEN p.status = 'scheduled'::public.post_status THEN NULL
                      ELSE p.publish_at
                    END,
       seo_noindex = true
 WHERE p.deleted_at IS NULL
   AND (
     (p.slug = 'jobs'
       AND (COALESCE(p.content_pl, '') || COALESCE(p.content_en, '') || COALESCE(p.builder_data::text, ''))
           ILIKE '%[easyjobs]%')
     OR (p.slug = 'register'
       AND (COALESCE(p.content_pl, '') || COALESCE(p.content_en, '') || COALESCE(p.builder_data::text, ''))
           ILIKE '%already logged in%')
     OR (p.slug = 'edit-your-submission'
       AND (COALESCE(p.content_pl, '') || COALESCE(p.content_en, '') || COALESCE(p.builder_data::text, ''))
           ILIKE '%does not exist%')
   )
   AND (
     p.status IN ('published'::public.post_status, 'scheduled'::public.post_status)
     OR p.seo_noindex IS DISTINCT FROM true
   );

UPDATE public.events e
   SET status = 'draft'
 WHERE e.slug ~* '^(test|e2e)($|[-_])'
   AND e.status = 'published';
