-- Sciezka pliku w bibliotece materialow: wzorzec w granicach silnika wyrazen.
--
-- OBJAW. Ograniczenie `member_resources.file_path` (migracje
-- `20260713174428_942e2f33-a4c6-4d4d-a209-ce9bdaf9a7dd` i
-- `20260714130000_expert_hub`) uzywa wzorca `'^[A-Za-z0-9][A-Za-z0-9/._-]{2,299}$'`.
-- Silnik wyrazen regularnych PostgreSQL dopuszcza w `{m,n}` najwyzej 255
-- powtorzen, wiec porownanie konczy sie bledem `invalid regular expression:
-- invalid repetition count(s)`. Zmierzone na PostgreSQL 16.13: `{2,299}` - blad,
-- `{2,255}` - dziala. Kolumna jest NOT NULL, wiec ograniczenie sprawdza wzorzec
-- przy KAZDYM wstawieniu - `createResource` w `src/lib/admin/library.ts` nie
-- mogl zapisac zadnego materialu od chwili powstania tabeli.
--
-- NAPRAWA. Gorna granica przechodzi do `char_length`: znak alfanumeryczny, potem
-- co najmniej dwa znaki ze zbioru `[A-Za-z0-9/._-]`, razem najwyzej 300 znakow -
-- dokladnie ta sama regula, co w oryginale. Zadna istniejaca wartosc nie mogla
-- przejsc starego ograniczenia, wiec nowe nie ma czego odrzucic. `DROP ... IF
-- EXISTS`, bo plik jedzie na produkcje dwoma pasami i musi byc odporny na drugie
-- wykonanie. Nazwa ograniczenia sprawdzona empirycznie
-- (`<tabela>_<kolumna>_check`).

ALTER TABLE public.member_resources DROP CONSTRAINT IF EXISTS member_resources_file_path_check;
ALTER TABLE public.member_resources ADD CONSTRAINT member_resources_file_path_check
  CHECK (file_path ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{2,}$' AND char_length(file_path) <= 300);
