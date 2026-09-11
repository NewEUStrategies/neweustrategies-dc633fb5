-- Zwykli uzytkownicy rejestrowali sie z profiles.discoverable = false, przez co nie byli
-- widoczni w wyszukiwarce osob ani nie mozna bylo dodac ich do sieci kontaktow.
-- Domyslnie profil jest teraz widoczny; opt-out pozostaje w ustawieniach prywatnosci profilu.

ALTER TABLE public.profiles
  ALTER COLUMN discoverable SET DEFAULT true;

UPDATE public.profiles
   SET discoverable = true
 WHERE discoverable = false;
