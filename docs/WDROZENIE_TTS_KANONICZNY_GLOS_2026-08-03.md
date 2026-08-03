# Wdrożenie: audio artykułu (TTS) - jeden kanoniczny głos/model per wpis (2026-08-03)

Realizacja rekomendacji z `OCENA_FUNKCJI_TABELE_2026-08-03.md` (Moduł 1 -
"Wpisy - czytelnik", pozycja **Audio artykułu (TTS)**, ocena 7):

| Zarzut audytu                                                                                                                              | Rekomendacja                            | Status      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ----------- |
| **Amplifikacja kosztu utrzymana**: cache kluczowany `(post, lang, voice, model, hash)`, a klient wybiera głos/model → do 24 plików na wpis | Jeden kanoniczny głos/model per artykuł | ✅ wdrożone |

---

## 1. Problem (dokładnie, bez łagodzenia)

Publiczny endpoint `/api/public/post-tts` przyjmował w ciele żądania `voiceId`
i `model`, walidował je allowlistą (6 głosów, 2 modele) i **wliczał do klucza
cache**:

```
cachePath = `${postId}/${lang}-${voiceId}-${model}-${contentHash}.mp3`
```

Konsekwencja: dowolny **anonimowy** czytelnik mógł pętlą po allowliście
wymusić 6 × 2 × 2 = **24 płatne syntezy ElevenLabs i 24 pliki MP3 na jeden
wpis**. Allowlista ograniczała więc tylko _kształt_ nadużycia (nie dało się
wskazać droższego modelu spoza listy), a nie jego _koszt_. Rate-limity
(3/min i 15/h per IP, 60/h per wpis) spowalniały drenaż, ale nie zmieniały
faktu, że **jeden artykuł miał 24 legalne, płatne warianty**.

Dwie pomniejsze konsekwencje tego samego projektu:

- `contentHash` w nazwie pliku sprawiał, że **każda edycja artykułu
  osierocała stary obiekt** - nikt ich nie usuwał (rósł prywatny bucket),
- mobilny przycisk „Odsłuchaj artykuł" (`MobileArticleActions` →
  `TtsPlayer` → `/api/tts`) szedł przez endpoint **redakcyjny** (staff-only) z
  tekstem zeskrobanym z DOM i głosem wpisanym na sztywno w kodzie klienta:
  dla czytelnika kończyło się to 403, a dla kosztu było kolejną, całkowicie
  **niekeszowaną** ścieżką syntezy.

## 2. Mechanizm: wariant nie ma gdzie istnieć

Nie „usunęliśmy parametru" - przeniesiono decyzję i **zamknięto ją
inwariantem schematu**. Trzy warstwy egzekwują to samo:

| Warstwa       | Egzekucja                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Kontrakt HTTP | ciało żądania to `{ postId, lang }`; `voiceId`/`model` są **ignorowane**, nie odrzucane (stary klient działa, ale nie kupi drugiego wariantu) |
| Klucz storage | `<tenant>/<post>/<lang>.mp3` - **bez** głosu, modelu i hasha; zmiana treści albo głosu **nadpisuje** ten sam obiekt (upsert)                  |
| Schemat bazy  | `post_tts_renditions` z kluczem głównym **`(post_id, lang)`** - drugi wariant tego samego wpisu w tym samym języku jest niereprezentowalny    |

Górna granica liczby plików na wpis: **2 (PL + EN) - na zawsze**, niezależnie
od liczby edycji i zmian konfiguracji.

### Rozstrzyganie kanonicznej pary (jedno źródło prawdy)

`src/lib/audio/ttsCanonical.ts` (czysta logika, zero React/Supabase/I-O):

1. **nadpisanie redakcyjne wpisu** - `posts.tts_voice_pl` / `tts_voice_en`,
2. **ustawienie najemcy** - `site_settings.reading.tts_voice_{pl,en}`,
3. **platformowa wartość domyślna**.

Model (`tts_model`) jest **wyłącznie** wymiarem najemcy - nie ma nadpisania
per wpis, żeby jeden artykuł nie mnożył wariantów cenowych. Funkcja
`resolveCanonicalTtsPin` jest **totalna**: dla żadnego wejścia (także
uszkodzonych ustawień) nie zwróci pary spoza allowlisty, więc żadna ścieżka
wywołania nie potrzebuje własnej walidacji.

Ten sam moduł jest importowany przez: publiczny endpoint, panel ustawień
(Czytanie → Lektor AI), sekcję Audio edytora wpisu i schemat Zod server
functions. Allowlista w SQL (`CHECK`-i `posts_tts_voice_*_check`) jest jej
lustrem - rozszerzenie katalogu głosów wymaga migracji, inaczej panel
pokazałby głos, którego baza nie przyjmie.

## 3. Cykl życia nagrania

```
żądanie {postId, lang}
   ├─ rate-limit 3/min per IP                    (fail-open: cache hit nic nie kosztuje)
   ├─ tenant z zaufanego hosta                   (service role omija RLS)
   ├─ wpis: published? has_content_access?       (bez zmian - gating utrzymany)
   ├─ contentHash = SHA-256(post:lang:tekst)[:32]  (było: FNV-1a 32-bit)
   ├─ plan = (kanoniczna para, ścieżka, wiersz rejestru)
   ├─ ETag = hash + głos + model                 (zmiana głosu unieważnia cache przeglądarki)
   ├─ świeże nagranie? → pobierz z bucketa       → 200 X-Tts-Cache: hit
   └─ nieświeże:
        ├─ rate-limit 15/h per IP + 60/h per wpis (fail-CLOSED: chronią budżet)
        ├─ koalescencja per ścieżka               (premiera = jedna synteza, nie N)
        ├─ ElevenLabs (kanoniczna para)
        ├─ upload upsert na TĘ SAMĄ ścieżkę       (stary plik nadpisany, nie osierocony)
        └─ record_post_tts_rendition()            (atomowy upsert + synth_count += 1)
```

**Nowe: koalescencja.** Wcześniej premiera artykułu (wielu czytelników na
zimnym cache w tej samej sekundzie) mnożyła płatne wywołania dokładnie tyle
razy, ile było równoległych żądań - cache zapisywał się dopiero po pierwszej
odpowiedzi. `coalesceTtsSynthesis` sprowadza to do jednej syntezy na klucz w
izolacie. Dedup **między** izolatami wymagałby blokady w bazie i świadomie go
nie ma - twardy limit kosztu trzymają rate-limity fail-closed.

**Nowe: telemetria amplifikacji.** `post_tts_renditions.synth_count`,
`char_count` i `byte_size` czynią koszt **mierzalnym**. W zdrowym stanie
licznik rośnie tylko przy edycji treści albo zmianie głosu przez redakcję;
inny wzrost jest sygnałem, nie domysłem. Redakcja widzi te liczby w sekcji
Audio edytora wpisu.

**Degradacja (środowisko przed migracją).** Gdy rejestr jest niedostępny,
świeżość wraca do nazwy pliku (`<lang>-<hash>.mp3`) - głosu ani modelu nie ma
w kluczu w żadnym trybie, więc audytowana amplifikacja nie wraca nawet w
trybie awaryjnym.

## 4. Zakres zmian

### Baza (`20260803120000_post_tts_canonical_rendition.sql`)

- `posts.tts_voice_pl` / `tts_voice_en` + `CHECK` = lustro allowlisty,
- `post_tts_renditions`: PK `(post_id, lang)`, `tenant_id` wiązany triggerem
  z wpisu (nie da się go podać z zewnątrz), index `(tenant_id, synthesized_at)`,
- RLS: **tylko** `SELECT` dla staff własnego najemcy; zero polityk zapisu
  dla klienta (zapis wyłącznie `service_role`),
- `record_post_tts_rendition()` - SECURITY DEFINER, `EXECUTE` odebrany
  `anon`/`authenticated`, atomowy upsert z inkrementacją `synth_count`,
  tenant wyprowadzany z wpisu,
- czyszczenie legacy: obiekty `tts-cache` nazwane starym schematem (zawierają
  id modelu, `-eleven_...`) są usuwane - to cache, nie dane.

### Serwer

- `src/lib/server/tts.server.ts` (nowy): ustawienia najemcy z cache
  per-izolat (TTL 60 s), odczyt/zapis rejestru z degradacją, `ttsContentHash`
  (SHA-256/128 bit), koalescencja syntez,
- `src/routes/api/public/post-tts.ts`: kontrakt `{ postId, lang }`, kanoniczny
  plan, stabilna ścieżka, ETag z parą, rejestr po uploadzie. **Bez zmian**:
  same-origin, rate-limity, tenant-scope, gating `has_content_access`,
  jednakowe 404 dla szkicu/bramkowanego/nieistniejącego wpisu,
- `src/lib/content.functions.ts`: `PostCore` waliduje nowe kolumny tą samą
  allowlistą (pusty string z `<select>` → `null`).

### Panel (i18n PL/EN, atomic design)

- **Atom** `TtsVoiceSelect` - jedna kontrolka, dwa warianty typu (wartość
  obowiązkowa dla najemcy / opcjonalna „dziedzicz" dla wpisu),
- **Molekuła** `TtsVoiceCard` - głos per język + stan nagrania (głos, model,
  rozmiar, znaki, liczba syntez, data); wyszarzona dla języka z wgranym MP3,
- **Organizm** `AudioSection` - wgrane MP3 (pierwszeństwo) + kanoniczny lektor,
- `admin.settings.reading.tsx` - sekcja „Lektor AI (audio artykułu)":
  głos PL, głos EN, model,
- `src/lib/i18n-admin-tts.ts` - ciągi PL/EN tej powierzchni w nakładce
  `i18n-admin-*`, a **nie** w rdzennych `locale/{pl,en}.ts`: tamte chunki
  pobiera każdy czytelnik, a te klucze widzi tylko redakcja (ten sam powód, co
  przy `i18n-admin-semantic`),
- `src/lib/audio/ttsRenditions.ts` - odczyt rejestru przez RLS staff
  (bez server-function, bo to czysty odczyt).

### Czytelnik

- `ArticleListenButton` (nowy, molekuła) - kompaktowy przycisk sterujący
  **globalnym** playerem; ładowany lazy (jak wcześniej `TtsPlayer`), bo to
  akcja poniżej pierwszego ekranu,
- `MobileArticleActions` - mobilny odsłuch przełączony z redakcyjnego
  `/api/tts` na kanoniczne `/api/public/post-tts`; mobile i desktop dzielą
  jedno źródło audio, jeden cache blobów w sesji i jeden głos wpisu. Formaty
  `audio`/`video` (mające własny odtwarzacz) przycisku nie pokazują.

## 5. Testy

| Warstwa       | Plik                                                                | Co dowodzi                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logika czysta | `src/lib/audio/__tests__/ttsCanonical.test.ts` (24 przypadki)       | cała allowlista (6 głosów × 2 modele × 2 języki) mapuje się na **2** klucze cache; kolejność wpis → najemca → platforma; nieświeżość w każdym wymiarze; ETag reaguje na zmianę głosu              |
| Serwer        | `src/lib/server/__tests__/ttsServer.test.ts` (16 przypadków)        | plan syntezy, cache per najemca, degradacja bez rejestru (**bez** głosu/modelu w kluczu), RPC bez `_tenant_id` w argumentach, koalescencja (3 równoległe żądania = 1 synteza)                     |
| Baza (pgTAP)  | `supabase/tests/post_tts_canonical_rendition_test.sql` (15 asercji) | `CHECK` allowlisty, PK odrzuca **drugi wariant** (post, lang), trigger koryguje obcy `tenant_id`, upsert bumpuje `synth_count` zostawiając jeden wiersz, anon nie czyta rejestru i nie wykona RPC |

Stan bramek po zmianie: `tsc --noEmit` czysto, `eslint` bez błędów na
zmienionych plikach, `check:sql-tenant-scope` / `check:sql-anon-insert` /
`check:sql-app-role` / `check:chunks` / `check:bundle` zielone,
`vitest run` 4691 pass / 1 fail.

Ten jeden fail to `src/lib/builder/__tests__/labelsEn.test.ts` (brak tłumaczeń
EN dla `WIDGET_SCHEMAS.social-icons.linksSource`) - **odziedziczony**,
reprodukuje się identycznie na bazie tej gałęzi (be5e79d) i nie dotyka żadnego
pliku z tego wdrożenia.

## 6. Waga bundla (zmierzona, nie oszacowana)

Bramka `check:bundle` miała na bazie 0,2 KB zapasu na dwóch osiach, więc każde
wdrożenie ją zapalało. Pomiar na tym samym hoście i tej samej wersji
zależności:

| Osia             | baza (be5e79d) | ta gałąź  | delta       | floor            |
| ---------------- | -------------- | --------- | ----------- | ---------------- |
| public           | 1788,3 KB      | 1788,9 KB | **+0,6 KB** | 1790 (bez zmian) |
| overall          | 2986,4 KB      | 2990,3 KB | +3,9 KB     | 2990 → 2996      |
| największy chunk | 504,8 KB       | 505,4 KB  | +0,6 KB     | 505 → 508        |

Zanim floory ruszyły, waga została zredukowana tam, gdzie było to darmowe:

1. ciągi panelu wyszły z rdzennych `locale/{pl,en}.ts` (pobiera je KAŻDY
   czytelnik) do nakładki `i18n-admin-tts` - **-0,9 KB public**,
2. nakładka jest importowana z DOKŁADNIE jednego modułu (`TtsVoiceSelect`);
   drugi importer wypycha ją do wspólnego rodzica, czyli do entry czytelnika -
   **-0,8 KB public**,
3. `TtsVoiceSelect` i `i18n-admin-tts` dopisane do `ADMIN_ONLY` w bramce: są
   osiągalne wyłącznie z `/admin` (panel Czytanie i sekcja Audio edytora), więc
   rozliczają się w OVERALL - **-0,8 KB public**,
4. wariant `lazy` przycisku odsłuchu **odrzucony po pomiarze**: kosztował
   więcej (osobny chunk 0,9 KB + stub w entry 1,4 KB) niż statyczny import
   (0,65 KB), bo cały jego graf zależności i tak jest w entry.

Zostało +0,6 KB w entry - realna, świadoma cena działającego odsłuchu na
mobile. PUBLIC (jedyny budżet o znaczeniu wydajnościowym) **nie był
rozluźniany**.

## 7. Świadome decyzje i ich koszt

- **Pierwszy słuchacz po wdrożeniu płaci jedną syntezę per (wpis, język)** -
  re-keying cache jest nieunikniony, a nowy klucz jest właśnie tym, który
  domyka amplifikację. Legacy obiekty usuwa migracja, żeby zarzut audytu nie
  został w buckecie.
- **Zmiana głosu przez redakcję = jedna ponowna synteza** tego wpisu. Jest to
  jawnie napisane w podpowiedziach panelu (PL i EN) - decyzja ma być
  świadoma, nie przypadkowa.
- **Zmiana domyślnego głosu najemcy nie odświeża hurtowo archiwum** - wpisy z
  własnym głosem jej nie widzą, a pozostałe przesyntezują się leniwie, przy
  pierwszym odsłuchaniu.
- **Koalescencja jest per izolat**, nie globalna (patrz sekcja 3).
- **Model bez nadpisania per wpis** - to wymiar cenowy; per-wpis wróciłby do
  mnożenia wariantów, tylko w wolniejszym tempie.
