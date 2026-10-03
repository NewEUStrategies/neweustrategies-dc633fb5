-- Indeks okna odsłon najemcy: `post_views (tenant_id, viewed_at DESC)`.
--
-- PO CO TEN INDEKS ISTNIEJE. Panel audytorium (`getAudienceSegments`,
-- src/lib/analytics/audience.functions.ts) czyta odsłony predykatem
-- `tenant_id = ? AND viewed_at >= ? ORDER BY viewed_at DESC LIMIT 50000`.
-- Ten sam kształt - najemca plus okno czasu, czasem domknięte od góry - mają
-- pozostali czytelnicy tabeli: admin_dashboard_content (20260912110000),
-- analytics_semantic_snapshot (20260725162011), COUNT w related_posts_signals
-- (20260812090500) oraz admin_member_funnel/retention/activity_series
-- (20260713190000).
--
-- DLACZEGO ŻADEN ISTNIEJĄCY INDEKS GO NIE OBSŁUGUJE. Tabela ma `(tenant_id)`
-- i `(viewed_at DESC)` osobno (20260624191011), więc planer wybiera między
-- wszystkimi wierszami najemcy (potem filtr okna i sort) a globalnym zakresem
-- czasu WSZYSTKICH najemców (potem filtr najemcy). Jedyny indeks
-- `(tenant_id, viewed_at DESC)` to `post_views_dwell_window_idx`
-- (20261002200000), ale jest CZĘŚCIOWY (`WHERE dwell_ms IS NOT NULL`), więc
-- planer nie może go użyć dla zapytania bez tego warunku. Pozostałe indeksy
-- prowadzą `id` (klucz główny), `post_id` albo `user_id`.
--
-- KSZTAŁT. `viewed_at DESC` odpowiada `ORDER BY viewed_at DESC` audytorium:
-- EXPLAIN pokazuje `Index Cond` na obu kluczach i brak węzła Sort, bo
-- kolejność daje sam indeks. Bez INCLUDE kolumn audytorium (post_id, user_id,
-- viewer_hash): krotka byłaby około trzykrotnie szersza, a płaciłby za to
-- każdy INSERT odsłony i każdy UPDATE czasu czytania (który i tak nie jest
-- HOT, bo `dwell_ms` siedzi w indeksie częściowym). Strony świeżych odsłon
-- nie są all-visible, więc zysk skanu tylko-indeksowego jest niezmierzony.
-- Świadomie JEDEN indeks pod JEDEN predykat.
--
-- `post_views_tenant_idx` ZDEJMOWANY. Jest ścisłym lewym prefiksem nowego
-- klucza, więc każdy plan, który go używał, może użyć indeksu złożonego -
-- także kasowanie kaskadowe z `tenants` (`DELETE ... WHERE tenant_id = ?`
-- idzie przez Bitmap Index Scan na nowym indeksie). Ten sam wzorzec, co przy
-- `media_tenant_folder_idx` w 20261003090000. DROP stoi PO CREATE, więc
-- w obrębie transakcji migracji nie ma chwili bez indeksu prowadzonego
-- najemcą.
--
-- `post_views_viewed_at_idx` ZOSTAJE. Nowy klucz prowadzi `tenant_id`, więc
-- nie obsłuży skanu okna bez najemcy: `search_posts` z sortowaniem `popular`
-- liczy `WHERE v.viewed_at > now() - interval '90 days' GROUP BY v.post_id`
-- (20260720215250).
--
-- Bez CONCURRENTLY, zgodnie z konwencją repozytorium i precedensem na tej
-- samej tabeli (20261002200000). Zapis odsłony czeka przez czas budowy, ale
-- klient rejestruje odsłonę w trybie „wyślij i zapomnij"
-- (useRecordPostView.ts, `.catch`), więc odczyt czytelnika nie jest blokowany.
-- Idempotentna: IF NOT EXISTS / IF EXISTS.
CREATE INDEX IF NOT EXISTS post_views_tenant_viewed_idx
  ON public.post_views (tenant_id, viewed_at DESC);

COMMENT ON INDEX public.post_views_tenant_viewed_idx IS
  'Okno odslon najemcy: tenant_id = ? AND viewed_at >= ? [AND viewed_at <= ?] ORDER BY viewed_at DESC - audytorium (getAudienceSegments), admin_dashboard_content, analytics_semantic_snapshot, related_posts_signals. Przejmuje role post_views_tenant_idx (jego prefiks).';

DROP INDEX IF EXISTS public.post_views_tenant_idx;
