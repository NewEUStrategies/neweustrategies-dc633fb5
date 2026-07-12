-- ============================================================================
-- Bio - dokończenie unifikacji (kontynuacja 20260713140000).
--
-- Tamta migracja skonsolidowała bio WEWNĄTRZ tabeli profiles (bio_pl/bio_en
-- kanoniczne, profiles.bio jako lustro). Zostało jednak CZWARTE miejsce zapisu:
-- author_profiles.bio_pl/bio_en - edytowane na /profile/author i renderowane
-- niezależnie w widgecie BIO autora we wpisach. Efekt: bio członka na wpisie
-- mogło rozjechać się z bio na /author/$slug i /people.
--
-- Od teraz frontend: (a) widget BIO autora czyta profiles.bio_pl/bio_en
-- (fallback na author_profiles tylko dla kont bez bio w profiles),
-- (b) /profile/author edytuje profiles.bio_pl/bio_en i NIE zapisuje już
-- bio w author_profiles.
--
-- Backfill poniżej przenosi istniejące treści autorskie do profiles tam,
-- gdzie profiles nie ma własnego bio - nic nie nadpisuje (świadome edycje
-- w profiles wygrywają). Idempotentne.
-- ============================================================================

UPDATE public.profiles p
   SET bio_pl = COALESCE(NULLIF(btrim(p.bio_pl), ''), NULLIF(btrim(ap.bio_pl), '')),
       bio_en = COALESCE(NULLIF(btrim(p.bio_en), ''), NULLIF(btrim(ap.bio_en), ''))
  FROM public.author_profiles ap
 WHERE ap.user_id = p.id
   AND (
        (NULLIF(btrim(p.bio_pl), '') IS NULL AND NULLIF(btrim(ap.bio_pl), '') IS NOT NULL)
     OR (NULLIF(btrim(p.bio_en), '') IS NULL AND NULLIF(btrim(ap.bio_en), '') IS NOT NULL)
   );
