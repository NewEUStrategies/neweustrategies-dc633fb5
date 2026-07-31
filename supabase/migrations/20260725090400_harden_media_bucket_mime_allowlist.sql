-- ============================================================================
-- BUCKET `media`: allowlista MIME + limit rozmiaru na poziomie STORAGE.
--
-- Dlaczego to jest potrzebne mimo serwerowej allowlisty w `registerMediaUpload`:
-- upload jest DWUFAZOWY. Przegladarka wrzuca bajty PROSTO do storage (zeby nie
-- przepychac duzych plikow przez workera), a serwer waliduje je dopiero przy
-- REJESTRACJI wiersza w tabeli `media`. Odrzucenie rejestracji nie usuwalo
-- obiektu - a bucket jest publiczny (`public = true`), wiec plik zyl dalej pod
-- znanym wgrywajacemu publicznym URL-em.
--
-- Bucket zalozono w 20260531180217 BEZ `allowed_mime_types` i BEZ
-- `file_size_limit`, a polityka `storage.objects` bramkuje wylacznie ROLE
-- (admin/editor/author). Czyli kazdy czlonek redakcji mogl wgrac
-- `image/svg+xml` z osadzonym `<script>`, dostac czerwony toast „Disallowed
-- mime type" i mimo to zostawic zywy, serwowany bezposrednio z bajtow adres:
-- stored XSS w kontekscie domeny (SVG wykonuje skrypt, `Content-Type` z bajtow,
-- brak `Content-Disposition: attachment`).
--
-- Klient zostal zunifikowany (`src/lib/media/upload.ts` - jedna sciezka, ktora
-- sprzata storage po odrzuconej rejestracji), ale to jest tylko higiena UI.
-- Autorytetem MUSI byc warstwa, ktora bajty przyjmuje: storage odrzuca teraz
-- niedozwolony typ ZANIM cokolwiek wyladuje w publicznym buckecie, wiec recznie
-- skrojony klient (curl z tokenem redakcyjnym) tez nie ma wektora.
--
-- Lista jest lustrzana do `ALLOWED_MIME` w `src/lib/media.functions.ts` oraz
-- `UPLOADABLE_MIME` w `src/lib/media/upload.ts`. `image/svg+xml` swiadomie
-- POZA lista - wektory wektorowe wstawiamy jako komponenty ikon, nie jako pliki
-- serwowane z publicznego bucketu.
--
-- Limit rozmiaru = najwyzszy sensowny (300 MB, odcinek podcastu); ostrzejsze
-- limity per typ (10 MB obrazy/PDF, 200 MB wideo) egzekwuje `registerMediaUpload`.
-- ============================================================================

UPDATE storage.buckets
   SET file_size_limit = 314572800,
       allowed_mime_types = ARRAY[
         -- obrazy
         'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/apng',
         -- dokumenty
         'application/pdf',
         -- audio (odcinki podcastu; alternatywne pisownie MIME z przegladarek)
         'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac',
         'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac',
         'audio/webm', 'audio/ogg',
         -- wideo (tla sekcji/widgetow)
         'video/mp4', 'video/webm'
       ]
 WHERE id = 'media';

-- Naprawa łańcucha migracji: COMMENT ON wymaga WŁASNOŚCI obiektu, a nie tylko
-- uprawnień. storage.buckets należy do supabase_storage_admin, więc na świeżej
-- bazie (supabase db start, CI) migracje lecące jako `postgres` wywracały się
-- tu na 42501 „must be owner of table buckets" - mimo że UPDATE wyżej przechodzi
-- (ten potrzebuje uprawnienia, nie własności). To czysta dokumentacja, więc brak
-- prawa do jej zapisania nie może zatrzymywać całego łańcucha: notujemy i lecimy
-- dalej. Tam, gdzie migracja biegnie jako właściciel, komentarz powstaje jak dotąd.
DO $bucket_doc$
BEGIN
  EXECUTE $c$
    COMMENT ON TABLE storage.buckets IS
      'Bucket `media` jest publiczny i serwuje bajty bezposrednio - dlatego ma allowlista MIME BEZ image/svg+xml (wektor stored-XSS). Zmiana listy wymaga zmiany ALLOWED_MIME w src/lib/media.functions.ts i UPLOADABLE_MIME w src/lib/media/upload.ts.'
  $c$;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Brak wlasnosci storage.buckets - pomijam COMMENT (dokumentacja)';
END $bucket_doc$;
