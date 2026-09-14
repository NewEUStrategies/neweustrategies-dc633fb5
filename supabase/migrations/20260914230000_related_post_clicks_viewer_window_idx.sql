-- Indeks pod rate-limit beacona rekomendacji (`/api/public/related-click`).
--
-- PO CO TEN INDEKS ISTNIEJE. Trasa odsiewa nadużycia zapytaniem
-- `count(*)` po oknie pięciu minut. Do 2026-09-14 predykat brzmiał
-- `viewer_hash = ? AND clicked_at >= ?` i NIE MIAŁ pasującego indeksu:
-- wszystkie trzy dotychczasowe indeksy tej tabeli prowadzą `tenant_id`
-- jako pierwszą kolumnę, więc `viewer_hash` nie był kolumną wiodącą
-- żadnego z nich. Zliczanie schodziło do przeglądu całej, stale rosnącej
-- tabeli klików - i robiło to przy KAŻDYM kliknięciu w rekomendację,
-- czyli na gorącej ścieżce czytelniczej.
--
-- KOLEJNOŚĆ KOLUMN NIE JEST DOWOLNA. W tym samym wydaniu zapytanie trasy
-- zostało zawężone do najemcy wpisu źródłowego (osobny defekt: licznik
-- sumował ruch WSZYSTKICH najemców, więc aktywny najemca wyczerpywał limit
-- czytelnikom cudzego serwisu). Finalny predykat brzmi więc
-- `tenant_id = ? AND viewer_hash = ? AND clicked_at >= ?` i to pod NIEGO
-- budowany jest ten indeks, a nie pod kształt sprzed naprawy.
--
-- Indeks prowadzony samym `viewer_hash` też by zadziałał, ale zostawiłby
-- `tenant_id` poza kluczem i rozjechałby się z konwencją pozostałych trzech
-- indeksów tej tabeli, które wszystkie prowadzą najemcę. Świadomie JEDEN
-- indeks pod JEDEN predykat - dołożenie obu dawałoby drugi zestaw stron
-- do utrzymania przy każdym zapisie, bez zysku odczytowego.
--
-- Bez CONCURRENTLY, zgodnie z konwencją tego repozytorium (259 migracji
-- tworzy indeksy zwykłym CREATE INDEX; żadna nie używa CONCURRENTLY).
-- `related_post_clicks` to log kliknięć bez odczytów blokujących wdrożenie,
-- więc krótka blokada zapisu przy budowie indeksu jest akceptowalna.
CREATE INDEX IF NOT EXISTS related_post_clicks_tenant_viewer_window_idx
  ON public.related_post_clicks (tenant_id, viewer_hash, clicked_at DESC);

COMMENT ON INDEX public.related_post_clicks_tenant_viewer_window_idx IS
  'Rate-limit beacona rekomendacji: tenant_id + viewer_hash + okno czasu. Dokładne odwzorowanie predykatu z /api/public/related-click.';
