-- Idempotencja `/platform/email/transactional/send`: jedno zajęcie klucza na
-- wiadomość, rozstrzygane przez bazę, a nie przez kolejność zapytań.
--
-- PRZYCZYNA ŹRÓDŁOWA (audyt modułu 11). Trasa przyjmowała `idempotencyKey`, ale
-- `message_id` był losowy per żądanie i nic nie sprawdzało, czy klucz już był.
-- Ponowienie z tym samym kluczem było dla drenu nową wiadomością, a odbiorca
-- dostawał drugi mail. Trasa liczy teraz `message_id` deterministycznie z klucza
-- i przed pracą szuka wiersza, który klucz zajął - ale SELECT przed INSERT nie
-- jest gwarancją: dwa równoległe żądania przechodzą sprawdzenie razem i oba
-- wkładają wiadomość do kolejki. Ostatnią linią obrony drenu jest dziś
-- `idx_email_send_log_message_sent_unique` (20260728154925:80-81), który zapala
-- się dopiero przy zapisie DRUGIEGO wiersza 'sent' - czyli PO drugiej wysyłce.
-- Ten indeks przenosi rozstrzygnięcie przed kolejkę: z dwóch wierszy 'pending'
-- z kluczem dla tego samego `message_id` baza przyjmuje jeden, a trasa
-- obsługuje 23505 jak powtórzenie (wzorzec `introduction_requests_active_uidx`
-- z 20260913171000: indeks częściowy, a przegrana w wyścigu zwraca istniejący
-- wynik, nie wyjątek).
--
-- DLACZEGO KLUCZEM JEST `message_id`, A NIE (najemca, klucz). `message_id` tej
-- trasy to SHA-256 z (przestrzeń trasy, id wywołującego, klucz klienta), więc
-- unikalność `message_id` w populacji indeksu JEST unikalnością pary
-- (wywołujący, klucz). Zakres wywołującego jest tu właściwy, a zakres najemcy
-- nie: `tenant_id` wiersza to najemca ODBIORCY z bramki wykluczeń (bywa NULL -
-- a NULL w indeksie unikalnym niczego nie blokuje), a nie konto, które wybrało
-- klucz. Dwa konta tego samego najemcy z kluczem `order-1` to dwie różne
-- wiadomości. Indeks na `message_id` jest przy tym tą samą tożsamością, którą
-- dren deduplikuje wysyłkę - jedna definicja „tej samej wiadomości" na całym
-- potoku, bez nowej kolumny.
--
-- DLACZEGO `metadata ->> 'idempotency_key'`, A NIE NOWA KOLUMNA. Kolumna
-- `metadata jsonb` istnieje od 20260728154925 i do tej zmiany nie pisał do niej
-- żaden producent w repozytorium. Trasa stempluje nią swoje wiersze, gdy klient
-- podał klucz. Nowa kolumna dawałaby to samo kosztem ręcznej zmiany
-- generowanych typów (`types.ts`) albo wpisu w zamrożonym długu
-- `check:types-freshness`, który ma tylko maleć.
--
-- DLACZEGO PREDYKAT JEST TAK WĄSKI. `status = 'pending'`: zajęcie trzyma tylko
-- wiadomość w obiegu - wiersze 'failed'/'suppressed' z tym samym kluczem NIE
-- mogą blokować ponowienia (trasa przy porażce kolejki zmienia własny 'pending'
-- w 'failed', co zwalnia klucz). Wymóg klucza w `metadata`: pozostali
-- producenci 'pending' (`sendTxEmail`, `enqueueRawEmail`, webhook auth) piszą
-- bez niego i zostają poza indeksem - zmiana nie dotyka ich zachowania.
--
-- ODPORNOŚĆ NA DANE ZASTANE. Populacja predykatu to z definicji wyłącznie
-- wiersze tej trasy po wdrożeniu, więc przy budowie indeks jest pusty i nie ma
-- czego naruszyć. Gdyby jednak spoza repozytorium (funkcja brzegowa platformy)
-- trafiły tu wiersze z takim kluczem, zachowujemy NAJSTARSZY 'pending' na
-- `message_id`, a nadmiarowym zdejmujemy sam klucz z `metadata` - wiersz
-- dziennika zostaje nietknięty jako historia, wypada tylko z populacji indeksu.
-- Wycofanie znacznika, a nie skasowanie wiersza: to dziennik dostarczalności.
--
-- Bez CONCURRENTLY, zgodnie z konwencją repozytorium (żadna migracja nie
-- używa CONCURRENTLY; 20260913101000 buduje indeksy tej samej tabeli tak samo).
-- Predykat jest częściowy, więc indeks jest pusty i jego utrzymanie przy zapisie
-- wierszy spoza populacji kosztuje jedynie ocenę predykatu.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY message_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM public.email_send_log
   WHERE status = 'pending'
     AND message_id IS NOT NULL
     AND (metadata ->> 'idempotency_key') IS NOT NULL
)
UPDATE public.email_send_log AS l
   SET metadata = l.metadata - 'idempotency_key'
  FROM ranked
 WHERE l.id = ranked.id
   AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS email_send_log_idempotent_pending_uidx
  ON public.email_send_log (message_id)
  WHERE status = 'pending' AND (metadata ->> 'idempotency_key') IS NOT NULL;

COMMENT ON INDEX public.email_send_log_idempotent_pending_uidx IS
  'Zajęcie klucza idempotencji /platform/email/transactional/send: jeden wiersz pending z kluczem (metadata.idempotency_key) na message_id. message_id = SHA-256(przestrzeń trasy, wywołujący, klucz), więc unikalność obejmuje parę (wywołujący, klucz). Przegrana w wyścigu (23505) jest obsługiwana w trasie jak powtórzenie.';
