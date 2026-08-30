-- ============================================================================
-- STOPKA: IKONY SOCIAL PROWADZĄ DO PROFILI FUNDACJI, A NIE NA STRONY GŁÓWNE
-- SERWISÓW.
--
-- CO BYŁO ZŁE
--
-- Seed stopki (20260727075644, widget `ftr-social`) zapisał w `site_settings`
-- pod kluczem `footer` pięć adresów, które adresami PROFILU nie są:
--
--     "twitter":   "https://twitter.com/"
--     "youtube":   "https://youtube.com/"
--     "instagram": "https://instagram.com/"
--     "linkedin":  "https://linkedin.com/"
--     "spotify":   "https://spotify.com/"
--
-- To NIE są puste pola - to poprawne URL-e, które przechodzą przez `safeUrl`
-- (`lib/sanitizePure.ts`) i renderują się jako w pełni żywe ikony. Czytelnik,
-- który klika „LinkedIn" w stopce, ląduje na stronie głównej LinkedIna. Puste
-- pole byłoby lepsze: widget `social-icons` przy domyślnym `showEmpty` w ogóle
-- nie rysuje kafelka bez linku (`SimpleWidgets.tsx`: `if (!active &&
-- !showEmpty) return null`), więc brak adresu = brak ikony, a nie ikona
-- prowadząca donikąd.
--
-- DLACZEGO NIE DA SIĘ TEGO NAPRAWIĆ W PANELU
--
-- Dwa powody, oba wymagają zapisu do JSON-a, a nie kliknięcia w edytorze:
--
--   1. KLUCZ `twitter` JEST NIEUSUWALNY Z PANELU. Widget czyta X pod kluczem
--      kanonicznym `x`, a `twitter` wyłącznie jako alias historyczny
--      (`SimpleWidgets.tsx`: `getStr(c, k) || altKeys...`). Panel zapisuje
--      TYLKO `x` (`SchemaFieldControl`), więc wyczyszczenie pola X w edytorze
--      zostawia `"twitter": "https://twitter.com/"` w dokumencie - i przy
--      pustym `x` alias natychmiast wraca do renderu. Adres da się usunąć
--      jedynie przez skasowanie klucza, czyli tutaj.
--
--   2. GLOBALNE „Ikony social" NIE PRZEBIJĄ TYCH WARTOŚCI. Widget nie ma
--      `linksSource`, więc działa w trybie `auto` = `ownHref || globalHref`
--      (`lib/social/globalSocialLinks.ts`). Dopóki własny klucz jest niepusty,
--      wpis w Admin → Wygląd → Opcje motywu jest ignorowany.
--
-- CO TEN PLIK ROBI
--
-- Uzupełnia adresy profili fundacji i KASUJE te, których nie znamy - zamiast
-- zostawiać w ich miejscu stronę główną serwisu. Adresy są kopią
-- `src/lib/social/nesProfiles.ts` (`NES_PROFILE_URLS`), modułu, który jest ich
-- jedynym źródłem po stronie kodu; parytet obu stron pilnuje
-- `src/lib/social/__tests__/nesProfiles.test.ts`.
--
--     facebook  -> https://www.facebook.com/NewEuropeanStrategies
--     x         -> https://x.com/NewEUStrategies      (klucz `twitter` znika)
--     linkedin  -> https://www.linkedin.com/company/new-european-strategies
--     instagram -> https://www.instagram.com/neweuropeanstrategies
--     youtube   -> ""   (patrz niżej)
--     spotify   -> ""   (patrz niżej)
--
-- YOUTUBE I SPOTIFY ZOSTAJĄ PUSTE ŚWIADOMIE. Jedyny kanał wideo, jaki niesie
-- repozytorium (`youtube.com/c/HistorycznyAmbasador`, seed strony /kontakt),
-- występuje pod INNĄ marką niż fundacja, a profilu Spotify nie ma w repo
-- nigdzie. Ikona prowadząca pod cudzą markę albo na `spotify.com` jest
-- dokładnie tą usterką, którą ten plik naprawia - więc obie znikają ze stopki,
-- dopóki redakcja nie poda adresów (wpisze je w edytorze stopki albo w
-- globalnych „Ikonach social", które od teraz mają czym zadziałać).
--
-- `email` jest w tym widgecie KLUCZEM MARTWYM - nie ma dla niego ani pozycji
-- w rendererze, ani pola w schemacie panelu. Poprawiamy go mimo to, bo
-- `kontakt@neweustrategies.pl` stoi w domenie, której serwis nie używa
-- (`SITE_CANONICAL_ORIGIN = https://neweuropeanstrategies.com`), a martwy
-- klucz z błędnym adresem czeka tylko na dzień, w którym przestanie być
-- martwy.
--
-- CZEGO TEN PLIK NIE ROBI
--   * NIE NADPISUJE PRACY REDAKCJI. Każdy klucz jest zmieniany WYŁĄCZNIE
--     wtedy, gdy dzisiejsza wartość nie jest adresem profilu - czyli gdy za
--     hostem nie stoi ani jeden segment ścieżki
--     (`~ '^https?://[^/]+/[^/?#]'` - ten sam predykat, co `isSocialProfileUrl`
--     w `src/lib/social/nesProfiles.ts`: sam znak zapytania albo kotwica nie
--     robią z hosta profilu).
--     Adres wpisany ręcznie przez redakcję przechodzi ten test i zostaje
--     nietknięty. Stąd też idempotencja: drugi przebieg nie zmienia niczego.
--   * NIE rusza `theme_options.header.socials` (globalnych „Ikon social").
--     Ta ścieżka jest w tej bazie pusta i nikt jej nie seeduje; zapisanie w
--     niej adresów zmieniłoby po cichu KAŻDY widget social z pustym polem,
--     także ten, którego pustka jest decyzją redakcji.
--   * NIE rusza seedu strony /kontakt (20260726221149) - tam adresy profili
--     są od początku poprawne.
--   * NIE zmienia wyglądu widgetu: `size`, `colorMode`, `shape` i reszta
--     ustawień jadą przez `||` bez zmiany.
--
-- Idempotentne: warunkowe podstawienie + `-` na kluczu, który już nie istnieje.
-- ============================================================================

-- KLUCZ GLOWNY `site_settings` TO PARA (tenant_id, key) - od 20260714113000.
-- Dlatego najemca jedzie przez cala te instrukcje i domyka zlaczenie na koncu:
-- zlaczenie po samym `key` sparowaloby wyliczona tresc JEDNEGO najemcy
-- z wierszami WSZYSTKICH pozostalych. Stopka kazdego najemcy jest naprawiana
-- z jego WLASNEJ wartosci.
WITH cur AS (
  SELECT
    s.tenant_id,
    s.key,
    s.value AS doc,
    s.value #> '{builder_data,sections,0,children,0,children,3,content}' AS content
  FROM public.site_settings s
  WHERE s.key = 'footer'
    -- Ścieżka pozycyjna jest zawężona ID-em I typem widgetu (ten sam wzorzec,
    -- co trzy siostrzane migracje stopki z 27.07). Gdyby redakcja przestawiła
    -- widgety, warunek nie trafi i cała migracja jest pustym przebiegiem -
    -- nigdy zapisem w niewłaściwe miejsce.
    AND s.value #>> '{builder_data,sections,0,children,0,children,3,id}' = 'ftr-social'
    AND s.value #>> '{builder_data,sections,0,children,0,children,3,type}' = 'social-icons'
),
fixed AS (
  SELECT
    cur.tenant_id,
    cur.key,
    jsonb_set(
      cur.doc,
      '{builder_data,sections,0,children,0,children,3,content}',
      -- Alias historyczny znika RAZEM z podstawieniem `x`: zostawiony wracałby
      -- do renderu przy każdym wyczyszczeniu pola X w panelu.
      (cur.content - 'twitter')
        || jsonb_build_object(
             'facebook',
             CASE
               WHEN COALESCE(cur.content ->> 'facebook', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'facebook'
               ELSE 'https://www.facebook.com/NewEuropeanStrategies'
             END,
             'x',
             CASE
               WHEN COALESCE(cur.content ->> 'x', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'x'
               -- Redakcja mogła mieć poprawny adres pod aliasem - wtedy
               -- przenosimy go na klucz kanoniczny, zamiast go zgubić.
               WHEN COALESCE(cur.content ->> 'twitter', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'twitter'
               ELSE 'https://x.com/NewEUStrategies'
             END,
             'linkedin',
             CASE
               WHEN COALESCE(cur.content ->> 'linkedin', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'linkedin'
               ELSE 'https://www.linkedin.com/company/new-european-strategies'
             END,
             'instagram',
             CASE
               WHEN COALESCE(cur.content ->> 'instagram', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'instagram'
               ELSE 'https://www.instagram.com/neweuropeanstrategies'
             END,
             -- Nie znamy profilu: pusty napis, czyli BRAK IKONY. Adres wpisany
             -- przez redakcję (prawdziwy profil) przechodzi test i zostaje.
             'youtube',
             CASE
               WHEN COALESCE(cur.content ->> 'youtube', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'youtube'
               ELSE ''
             END,
             'spotify',
             CASE
               WHEN COALESCE(cur.content ->> 'spotify', '') ~ '^https?://[^/]+/[^/?#]'
                 THEN cur.content ->> 'spotify'
               ELSE ''
             END,
             'email', 'office@neweuropeanstrategies.com'
           ),
      true
    ) AS doc
  FROM cur
)
UPDATE public.site_settings s
SET value = fixed.doc,
    updated_at = now()
FROM fixed
WHERE s.tenant_id = fixed.tenant_id
  AND s.key = fixed.key;
