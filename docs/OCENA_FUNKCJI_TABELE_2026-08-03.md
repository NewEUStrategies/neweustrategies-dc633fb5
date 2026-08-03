# Tabele modułów — funkcja po funkcji: ocena, argumenty, rekomendacje + szczegółowa ocena konkurencji (PL / UE / Świat) — 2026-08-03

**Data:** 2026-08-03 · **HEAD:** `c4de8a2` (main po PR #127–#142 + commity Lovable prosto na main) ·
**Gałąź:** `claude/modules-audit-competition-analysis-lzudv2`

Dokument rozbija platformę na **20 modułów × pojedyncze funkcje**. Każda funkcja ma: ocenę 0–10,
argument **✅ dobry**, argument **⚠️ słaby** i **🔧 rekomendację**. To **wydanie 2026-08-03** dokumentu
`OCENA_FUNKCJI_TABELE_2026-08-01.md` (tamten pozostaje nietknięty jako migawka stanu 01.08). Druga część
dokumentu — **znacznie rozbudowana wobec wydania 01.08** — to szczegółowa ocena konkurencji w trzech
geografiach (PL / UE / Świat): pełne macierze per podmiot, rozbicia kryterialne, profile konkurentów,
test kategorii zdolności i ranking wszystkich 38 podmiotów.

> **Zakres wyłączony na życzenie zamawiającego:** dokument **nie ocenia treści artykułów** — ani NES, ani
> konkurencji. Nie ma tu sądów o jakości analiz, doborze tematów, autorytecie marki czy sile redakcji.
> Moduł 1 („Wpisy — czytelnik") mierzy **mechanikę czytania** (typografia, TOC, przypisy, postęp, audio,
> bramka), nie wartość tekstu. Wszystkie oceny dotyczą **zdolności produktowych i inżynierskich**.

## Sygnały na tym HEAD (zmierzone, nie zadeklarowane)

| Sygnał | Wynik 03.08 | 01.08 | Uwaga |
| ------ | ----------- | ----- | ----- |
| `vitest run` | **4625 pass / 0 fail / 50 skip** (507 plików pass, 2 skip) | 3666 pass | +959 testów w 2 dni |
| `tsc --noEmit` | **czysto** | czysto | — |
| `eslint .` | **czerwono: 146 problemów (10 errors / 136 warnings)** | czerwono: 1440 | wszystkie 10 błędów = `prettier/prettier` (formatowanie) |
| `check:sql-tenant-scope` | ✓ (504 funkcje, 3 uzasadnione ścieżki publiczne) | ✓ | — |
| `check:sql-app-role` | ✓ (870 literałów `has_role`) | ✓ | — |
| `check:sql-anon-insert` | ✓ (**518 polityk** w stanie końcowym, 6 tabel intake) | ✓ (517) | metryka stanu końcowego |
| Migracje / pgTAP | **579 migracji / 65 plików pgTAP** | ~557 / 65 | — |
| Kod | 2405 plików TS/TSX · **509 plików testów** · 225 tras | — | — |
| Bundle publiczny (budżet) | **≤1790 KB gzip** (zmierzone ~1756) | ≤1475 (zmierzone ~1472) | **regres: +284 KB, budżet podniesiony dwukrotnie** |

**Delta kodu od wydania 01.08:** 208 commitów, 584 plików, +35 808 / −7 028 linii. Fala PR #127–#142
plus **duża liczba commitów Lovable pchanych prosto na `main`** (bramki CI weryfikują je post-hoc).

Skala: **9–10** wybitne · **7–8** produkcyjne · **5–6** działa z wyraźną luką · **<5** zepsute/wydmuszka.
Ocena modułu = kompozyt jego funkcji (kompletność + inżynieria + dopracowanie + bezpieczeństwo + testy).
Konwencja: „**X → Y**" = zmiana względem wydania 01.08 · „**(nowa)**" = funkcja dodana po 01.08 ·
„**(nowa w audycie)**" = funkcja istniała, ale **nie była objęta** tabelami 01.08 (luka pokrycia audytu).

---

# KOREKTY DO WYDANIA 01.08 (przed tabelami — bo zmieniają odczyt trzech modułów)

Trzy ustalenia z weryfikacji na kodzie podważają zapisy z 01.08. Zostawiam je na wierzchu, bo
audyt, który nie poprawia własnych błędów, jest tylko marketingiem:

**1. „Tracker: obserwacje nikogo nie powiadamiają" — NIEPRAWDA (błąd audytu 01.08).**
Trigger `tg_eu_policy_update_applied` (migracja `20260713104316`, więc obowiązywał już 01.08) robi
**fan-out do wszystkich obserwujących** opublikowane dossier: pętla po `eu_policy_follows` →
`enqueue_notification(user_id, 'tracker', …)` + `emit_domain_event('policy.updated.v1')`. Gałąź
`'tracker'` jest w mapie preferencji `enqueue_notification` (`WHEN 'tracker' THEN np.enabled_tracker`).
Alerty trackera **nie są** wydmuszką w cenniku. Ocena trackera podniesiona; zarzut „sprzedawane bez
implementacji" **wycofany**.

**1b. Domknięcie tej samej pozycji (weryfikacja 03.08, po pierwszym wydaniu tego dokumentu): także
„brak e-mailowego digestu" było NIEPRAWDĄ.** `lib/notifications/digestEmail.ts` ma **dedykowaną sekcję
`tracker` jako PIERWSZĄ** w `DIGEST_SECTIONS` („żeby digest czytał się jak brief legislacyjny"), a
`dispatchDueDigests` wysyła ją przez `claim_due_digests` z listą wykluczeń i idempotencją. Z listy
braków alertowych została więc **tylko jedna realna pozycja: RSS** — i ta została **wdrożona w tym
PR** (`/tracker/rss.xml`, patrz `WDROZENIE_TRACKER_RSS_TAKEAWAYS_2026-08-03.md`). Otwarte pozostają
wyłącznie **import EUR-Lex/OEIL** i **diff wersji**, czyli zasilanie i porównywanie treści, nie alerty.

**2. „Key takeaways: dla stron gałąź renderu nigdy ich nie pokazuje (martwy przełącznik)" — NIEPRAWDA.**
Tabela `pages` ma kolumny `takeaways_pl/en/variant` z walidacją triggerem (`20260709100809`), loader
stron je selectuje (`lib/queries/public.ts:686`), a `$.tsx:846` renderuje `KeyTakeaways` **bez bramki
`isPost`** — dla stron i wpisów jednakowo. Przełącznik żyje end-to-end.

**3. „Page builder 9,0" mierzył pokrycie rejestru, nie wierność ustawień — i dlatego przeoczył całą klasę defektów.**
PR #141 (7 commitów) pokazał, że dziesiątki ustawień widgetów były **martwe albo kłamliwe**: panel
oferował pola, których renderer nie czytał (autoplay karuzeli, warianty akordeonu, kolumny tablet/telefon,
`showTitle`/`authorDisplay` slidera, ręczne pozycje TOC pisane pod inny klucz, ~28 pól rejestracji bez
odpowiednika w komponencie, 16 z 21 ustawień newslettera widocznych tylko publicznie, przełączniki
commitujące `"0"/"1"` czytane jako boolean). **Najpoważniejsze:** kontekst „bieżącego wpisu" zwracał
**dane przykładowe** („Jan Kowalski", „Tytuł przykładowego wpisu", „Przykładowe archiwum / 12 wpisów",
licznik 1234) **realnym odwiedzającym** wszędzie, gdzie sekcja buildera renderuje się bez providera —
nagłówek, stopka, popupy, szuflada mobilna, strony taksonomii. Metryka „100/100 typów bloków, pełne
pokrycie rejestru" była **odporna na tę klasę błędu**. Efektywna ocena buildera na 01.08 to ~7, nie 9;
na 03.08 (po naprawie + testach) 9 jest uzasadnione, ale **wymaga własnego inwariantu** (patrz M3).

---

# MODUŁ 1 — Wpisy: doświadczenie czytelnika · **8,4/10** (01.08: 8,2)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Paywall / bramka dostępu | **9** | 4 tryby, entitlement dowodzony obecnością body (anon SSR nie wysyła bajtów premium), enforcement kolumnowy REVOKE+RPC; **02.08: domknięta regresja grantów** — `password_hint_pl/en` odebrane też `authenticated` (`20260801121000`), podpowiedzi haseł tylko przez `get_password_hint()` | Lockout hasła **nadal po stronie klienta** (`Paywall.tsx:62` `LOCKOUT_SECONDS`, licznik w stanie React) | Przenieść lockout do RPC (server-side) |
| Metering „N darmowych/mies." | **9** | Serwerowy `consume_metered_view`, konsumpcja po hydracji (boty nie palą limitu), gość=UUID, licznik „zostało N" w warstwie treści z kluczami okresu | — | Utrzymać |
| Podaruj artykuł (gift) | **9** | Idempotentny link, RPC SECURITY DEFINER, cap `max_redemptions_per_link`, testy domeny; **cap edytowalny w adminie** (`/admin/gifting` + `GIFT_ADMIN_BOUNDS`, PR #135) | — | Utrzymać (rekomendacja z 01.08 wdrożona) |
| Spis treści (TOC) | **9** | Jeden kanoniczny `slugifyAnchor` + test parytetu na `ł`, scrollspy, mobile sheet z focus-trap; **ręczne pozycje TOC wreszcie się renderują** — kontrolka pisała `content.items`, widget czytał `items_${lang}` (PR #141, z fallbackiem na stary klucz) | — | Utrzymać |
| Pasek postępu czytania | **8** | `rafThrottle` na najgorętszym handlerze, liczony wg realnych granic `.article-body` | Sticky header bez własnego wskaźnika | Kosmetyka — opcjonalnie |
| Przypisy (footnotes) | **9** | End-to-end: edytor→silnik→SSR, jeden kontrakt wyjścia, 8+ plików testów | — | Utrzymać |
| Key takeaways | **8 → 9** | **Działa też dla stron** (korekta 2 powyżej): kolumny + trigger walidacji na `pages`, loader selectuje (kontrakt kolumn `ENTITY_SELECT_COLS` + test), `$.tsx` renderuje bez bramki `isPost`; **od 03.08 jedno rozstrzygnięcie dla obu encji** (`lib/keyTakeaways/resolve.ts` - koniec dwóch kopii wyrażenia w head() i body) oraz **naprawiony rozjazd limitów**: baza dopuszczała 7, zod odrzucał 7, panel liczył do 6 i obiecywał „max 7" - jedna stała `KEY_TAKEAWAYS_MAX_ITEMS` + kontrakt pgTAP na obu triggerach | — | Utrzymać (zarzut z 01.08 wycofany, limit zunifikowany) |
| Cytowania / eksport bib. | **7** | Realny formatter (Chicago i in.), testy fallbacków | Zakres formatów ograniczony (brak BibTeX/RIS) | Dodać BibTeX/RIS jeśli jest popyt |
| Audio artykułu (TTS) | **7** | Publiczny `post-tts` z cache w prywatnym buckecie, gating `has_content_access`, allowlisty głosów i modeli | **Amplifikacja kosztu utrzymana**: cache kluczowany `(post, lang, voice, model, hash)`, a klient wybiera głos/model → do 24 plików na wpis | Jeden kanoniczny głos/model per artykuł |
| Publiczny licznik odsłon (nowa) | **8** | `post_view_count` SECURITY DEFINER wzorem `popular_post_ids`: wymusza tenant publiczny + `status='published'`, zwraca **sam licznik** bez `viewer_hash`/`user_id`, dla obcego tenanta **0 zamiast NULL** (nie jest wyrocznią istnienia); wcześniej publicznie nie mógł się pokazać nigdy (`post_views` bez polityki SELECT), a kanwa pokazywała próbkę 1234 | Brak dedupu okna czasowego w prezentacji (licznik surowy) | Utrzymać; rozważyć „unikalni czytelnicy" jako druga metryka |

---

# MODUŁ 2 — Edytor wpisów i workflow redakcyjny · **8,5/10** (01.08: 8,4)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Autozapis (wpisy) | **9** | Realny `useAutosave` z ochroną przed utratą, `AutosaveBar` | — | Utrzymać |
| Rewizje wpisów | **8** | Limit 50, throttling 5 min, restore pomija `status` (celowo), `REVISION_FIELDS` jako jedno źródło prawdy + test projekcji | Zero testów **integracyjnych** na restore (jest tylko test czystej domeny) | Dodać test przywracania end-to-end |
| Workflow draft→review→published | **9** | Egzekwowany potrójnie: UI, server fn ×2, trigger DB | — | Utrzymać |
| Publikacja planowana | **8** | pg_cron `publish_due_posts` co minutę + fallback best-effort | — | Utrzymać |
| Kalendarz redakcyjny | **7** | Drag-and-drop, realny (`/admin/posts/calendar`) | Brak testu trasy kalendarza (istnieje test `lib/community/calendar.ts`, ale to kalendarz wydarzeń) | Dodać smoke test |
| Redirecty 301 przy zmianie slug | **8** | Automatyczne, realne; `?lang=` przeżywa twardy reload edytora; degradacja indeksu przekierowań | — | Utrzymać |
| **Parytet z Gutenbergiem (nowa w audycie)** | **8** | PR #132–#134 + `OCENA_GUTENBERG_PARYTET_2026-08-01.md`: matryca zachowań (writing flow, dwustopniowe Ctrl+A, Shift/Ctrl-klik zakresy, markdown, transformacje, appender) — **plus przewagi nad WP core**: wklejanie bloków skopiowanych **w WordPressie** i **do** WordPressa (payload niesie markup `<!-- wp:… -->`), tabele z Worda jako strukturalny blok, zagnieżdżone kanwy bez podwójnej wklejki; **101 typów bloków** (+1: podgląd linku) | Świadome braki: Shift+strzałki nie rozszerzają zaznaczenia blokowego, brak zaznaczania tekstu w poprzek bloków, `/` tylko w pustym akapicie | Domknąć cross-block selection albo udokumentować jako by-design |

---

# MODUŁ 3 — Silniki treści: bloki + page builder · **8,9/10** (01.08: 8,8 — patrz korekta 3)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Silnik bloków (posty) | **9** | **101 typów bloków**, renderer pokrywa 100%, 0 placeholderów, ~25 plików testów widgetów + 20 plików testów bloków | Schemat persystencji celowo luźny (dowolny JSON) | Utrzymać (ryzyko cięte error boundaries) |
| Page builder (widgety) | **9** | **89 widgetów**, pełne pokrycie rejestru, sekcja→kolumna→widget, globalne widgety, layouty | — | Utrzymać |
| **Wierność ustawień widgetów (panel ⇄ renderer) (nowa w audycie)** | **7 → 9** | PR #141 przeorał klasę „panel obiecuje, renderer nie czyta": karuzela z realnym autoplay (pauza na hover/fokus, `prefers-reduced-motion`), warianty akordeonu, responsywne kolumny tablet/telefon, `showTitle`/`authorDisplay`/rozmiary slidera, grubość rozdzielacza z jednej stałej, `cssColor.ts` z whitelistą wzorców (blokuje `url()`/`expression()`), ikony social (gap/bgMode/CTA Spotify), 9 widgetów `post-*` dostało schematy i edytory, ustawienia obrazu odsłonięte, formularze auth z kanonicznymi kluczami + aliasami starych (`authFormSettings.ts` jako czysty, testowalny moduł), placeholdery pól wreszcie widoczne, podgląd newslettera renderuje **ten sam komponent co produkcja** | **Parytet pilnują testy punktowe, nie inwariant**: nie ma bramki „każde pole schematu jest czytane przez renderer i odwrotnie" — klasa może wrócić przy następnym widgecie | **Dodać gate parytetu schemat⇄renderer** (jak `builderI18nKeys` dla i18n) |
| **Dyscyplina danych przykładowych (nowa w audycie)** | **3 → 9** | Próbka kontekstu wpisu **związana z trybem edycji**: poza kanwą brak kontekstu = „nie renderuj", nigdy „zmyśl"; strony taksonomii dostarczają realny kontekst archiwum; próbka licznika odsłon zastąpiona realnym RPC | Wcześniej: zmyślone „Jan Kowalski / Tytuł przykładowego wpisu / 12 wpisów / 1234 odsłon" **na produkcji** w nagłówku, stopce, popupach, szufladzie mobilnej i taksonomiach | Utrzymać; rozważyć e2e „żadna strona publiczna nie zawiera stringów próbki" |
| Interop bloki⇄builder | **7** | Konwersja blocks→builder realna (`blocksToBuilder`, `localizedBlocksToBuilderDoc`) | **Jednokierunkowa** i tylko w imporcie WP; builder→bloki nie istnieje | Dorobić kierunek odwrotny albo udokumentować jako by-design |
| Import z Gutenberga / markdown | **8** | Realne parsery, osobne stosy undo per język, wzmocniony parser wklejania z Worda | — | Utrzymać |
| Undo/redo per język | **8** | Osobne stosy, poprawne | — | Utrzymać |
| Świeżość danych widgetów (nowa w audycie) | **8** | Kanoniczne korzenie kluczy zapytań w jednym miejscu (`WIDGET_QUERY_ROOTS`), klucz zależny od języka tam, gdzie `queryFn` wpieka zlokalizowany tytuł (wcześniej po zmianie języka widget pokazywał poprzedni do wygaśnięcia 5-min `staleTime`), jawny `staleTime` | Brak testu, że każdy widget z lokalizowanym `queryFn` ma język w kluczu | Dodać asercję w teście rejestru |

---

# MODUŁ 4 — Strony, wygląd, motyw, media, import · **6,8/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Builder stron | **7** | Ten sam potężny builder co posty, realny | — | Utrzymać |
| **Autozapis stron** | **3** | — | **Nadal wyłączony i nadal opisany kłamliwie**: `useAutosave` **nie jest importowany** w `admin.pages.$slug.tsx` (jedyne wystąpienia to 3 komentarze), a komentarz w linii 294 wciąż zaczyna się „Autozapis włączony (jak dla wpisów)"; realnie działa tylko `useUnsavedChangesGuard`. Trzecie wydanie audytu z tym samym zapisem | Włączyć `useAutosave`+`AutosaveBar` **albo** usunąć kłamliwy komentarz — dalsze przenoszenie tej pozycji jest kosztem wiarygodności dokumentacji |
| Rewizje stron | **6** | Istnieją (`writeRevisionSnapshot(entityType:"page")`), snapshot przed nadpisaniem w imporcie WP | `REVISION_FIELDS` jest **postowa** — snapshot strony gubi `template_type`/`header_override`/`toc_override` (weryfikacja: lista 19 pól w `lib/content/revisions.ts:7`, bez pól stron) | Rozdzielić `REVISION_FIELDS` post vs page |
| Motyw / design tokens | **8** | Głębia frameworka komercyjnego, tokeny, globalne kolory; **02.08: porządkowanie warstw CSS** (PR #139/#140 — baseline formularzy i atom inputa w `@layer components`, przywrócone reguły placeholdera) | `styles.css` to nadal ~1,2 tys. zmienionych linii w 2 dni — brak testu regresji wizualnej | Rozważyć snapshoty wizualne dla 5 kluczowych powierzchni |
| Media — upload / skan użycia | **7** | Skan użycia przed usunięciem, foldery/rename/bulk, `OptimizedImage` z srcSet | Walidacja na danych **deklarowanych przez klienta** (zero magic-bytes), brak deduplikacji | Sniffing bajtów + kolumna hash |
| Media — SVG stored-XSS | **7** | Allowlista aplikacyjna blokuje SVG + allowlista bucketu; `MediaPickerDialog` tłumaczy to użytkownikowi | Importer WP **nadal ma `image/svg+xml`** na liście (`lib/server/wp-media.server.ts:16` i `:46`) | Usunąć SVG z list importera WP |
| **Import WP** | **4** | Realny potok WP.com API + WXR, snapshot rewizji przed nadpisaniem, `uniquePageSlug` | **Nadal niszczy drugi język**: przy `sync_existing` zapis to `blocks_data = {pl: doc, en: pusty}` (lub odwrotnie) **hurtowo** + `title_en: ""` + `excerpt_en: null` (`wordpress-import.functions.ts:705–760`) — zero merge. **Dwa równoległe stacki** nadal żyją (688 + 924 linie) | Merge per-język zamiast nadpisania; zunifikować stacki |
| Podglądy / import Elementora (nowa w audycie) | **6** | `WordPressPreviewDialog` renderuje wyczyszczony HTML w iframe z własnym `srcDoc` | Podgląd nie jest sandboxowany tak jak slot reklamowy (dziedziczy politykę strony) | Wyrównać do wzorca `SandboxedAdFrame` |

---

# MODUŁ 5 — Strona główna, archiwa, chrome · **8,3/10** (01.08: 8,0)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Strona główna | **8 → 9** | **Tryb „najnowsze wpisy" domknięty** (PR #129 + `WDROZENIE_HOME_LATEST_POSTS_2026-08-01.md`): `homePageQueryOptions` zwraca `null` w tym trybie **z konstrukcji** (koniec 2 zbędnych round-tripów i przeciekania meta/`seo_noindex` ukrytej strony „home"), `head()` spada na defaulty marki, **paginacja `?page=N`** tym samym parserem co `/blog`, `noindex,follow` dla >1, canonical zawsze czysty `/`; tryb statyczny bez regresji (test) | — | Utrzymać (rekomendacja z 01.08 wdrożona) |
| Archiwa kategoria/tag | **8** | Prawdziwa paginacja `?page=N&sort=`, `noindex,follow` dla >1; **realny kontekst archiwum** dla widgetów (koniec próbki „Przykładowe archiwum") | — | Utrzymać |
| Archiwum bloga | **8** | SSR-paginacja `?page=N`, indeksowalne strony, defensywny parser searcha | — | Utrzymać |
| Archiwum autora | **8** | Role-gated, paginacja serwerowa + filtry w URL, RPC `get_expert_materials` (SECURITY INVOKER, deterministyczne okno, indeks częściowy), `noindex,follow` dla widoków filtrowanych | — | Utrzymać |
| Mega menu / ticker / chrome | **8** | 6 layoutów archiwum, mega menu, ticker; **PR #141: nagłówek kolumny mega menu jest wreszcie linkiem** (PagePicker zapisywał `href`, którego żaden renderer nie czytał — jeden wspólny komponent dla desktopu, kolumny kategorii i mobile), **akordeon mobilny pokazuje ten sam ZESTAW treści co desktop** (wcześniej gubił wpisy, „zobacz wszystkie", karty featured i opisy), panel konta ma nagłówek (`panel_pl/en` były w defaultach i typie, nic ich nie czytało) + nazwę dostępnościową; wycięte `triggerVariant` i martwy `variant` przycisku szukania | Zwijanie nagłówka przy scrollu (PR #142) i przeniesienie wyszukiwarki do sidebara mobilnego (02.08, `MobileTopTools`) weszły **bez testu** i bez pomiaru CLS | Dodać test/pomiar dla animacji nagłówka i mobilnego wejścia w wyszukiwarkę |

---

# MODUŁ 6 — Wyszukiwarka · **8,3/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| FTS treści (Postgres) | **9** | Natywna FTS + pgvector, koszt marginalny ~0 vs Algolia, smoke test `search_posts` | — | Utrzymać |
| Fasety / filtry | **8** | Realne fasety (`faceted_search_test`), klasa zbliżona do RAND | — | Utrzymać |
| Paleta ⌘K | **8** | Lazy-mount, realna | — | Utrzymać |
| Wyszukiwanie głosowe (STT) | **7** | `api/stt` z auth + limitami (`MAX_BYTES` 8 MB, pusty plik odrzucany), allowlista języków, fallback Web Speech dla anon | **Brak allowlisty MIME** — `guessFilename()` tylko mapuje rozszerzenie, nie odrzuca nie-audio; dowolny 8 MB blob wchodzi do gatewaya | Dodać allowlistę MIME (odrzucać, nie zgadywać) |
| Alerty zapisanych wyszukiwań | **7** | pg_cron `saved-search-alerts` realny, gałąź `saved_search` w preferencjach powiadomień | Brak testu integracyjnego (trzecie wydanie z tą samą rekomendacją) | Dodać test |
| Wyszukiwanie osób / kontaktów (nowa w audycie) | **8** | RPC `search_chat_contacts` (`20260801124000`) + `NewChatSearch`; **usunięto przeciążenie-zombie** `search_people` (`20260801123000`), które mogło wygrywać rozstrzyganie typów; `people_verification`/`premium_search` w pgTAP | — | Utrzymać |

---

# MODUŁ 7 — Typy treści specjalne · **7,6/10** (01.08: 7,0)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Tracker legislacyjny | **7 → 8** | Pasek etapów, macierz 27 państw, feed „co się zmieniło" (`/tracker/changes`), eksplorator (`/tracker/explorer`), bramka warstw w DB, SSR + ItemList JSON-LD + ISR; **korekta 1: obserwacje REALNIE powiadamiają** (fan-out `enqueue_notification` + `emit_domain_event`, z poszanowaniem `enabled_tracker`) **i mają własną sekcję w digeście e-mail** (korekta 1b); **od 03.08 kanał `/tracker/rss.xml`** - scalony strumień nowych dossier i wpisów osi czasu, stabilne GUID-y (`tracker:item:` / `tracker:update:`), kotwice `#update-<id>` realnie obecne w dokumencie, autodiscovery w `<head>` obu tras, wpis w `llms.txt`, tenant fail-closed + kontrakt pgTAP | **Brak importu** (EUR-Lex/OEIL - wszystko ręcznie) i **brak diffu wersji** - to już jedyne realne braki modułu (alerty: in-app + push + digest + RSS domknięte) | Import EUR-Lex/OEIL + diff wersji |
| Huby ekspertów | **8** | Katalog z filtrami, capability „zapytanie do eksperta" (Pro+) z kwotami, inline editor layoutów per-ekspert, `/admin/expert-requests` jako kolejka obsługi | — | Utrzymać |
| Programy badawcze | **5** | `research-programs` realny hub (members/projects/partners), RSS per program | **Dwie równoległe tabele nadal żyją**: `programs` (czytane przez `usePostEditorData`, `experts/queries`, `profile.follows`) vs `research_programs` (czytane przez `publishedContent.server`, `queries/programs`, sitemap) — zero zmian od 01.08 | Zmigrować na jedną tabelę, usunąć duplikat |
| Wydarzenia | **8 → 9** | Waitlist FIFO serwerowy, RSVP-mail idempotentny, ICS RFC 5545, przypomnienia cron; **SSR loader dodany** (PR #128 + `WDROZENIE_SSR_WYDARZENIA_2026-08-01.md`): bramka modułu rozstrzygana serwerowo i fail-soft, lista fail-loud przez `ensureQueryData`, `edgeTtlCache("public:events-list", 60 s)`, klucz `["public-events"]` identyczny z rejestrem inwalidacji realtime, `fetchPublicEvents` przestał być eksportowany (nie da się ominąć cache) | — | Utrzymać (rekomendacja z 01.08 wdrożona) |
| Q&A | **7** | Moderacja (4 statusy) + odpowiedzi eksperckie, Chatham House, JSON-LD, SSR; 02.08 dokręcone bezpieczeństwo (commit „Fixed newsletter & Q&A security") | — | Utrzymać |
| Ankiety (polls) | **7 → 8** | Realtime głosowanie, zapisy przez utwardzone RPC, pgTAP; **SSR loader dodany** (PR #130), profile prelegentów i ankiety zabezpieczone (`f567498`) | — | Utrzymać (rekomendacja z 01.08 wdrożona) |
| Biblioteka | **7 → 8** | Pliki w prywatnym buckecie, bramka rangi **egzekwowana w DB**, logowanie pobrań; **SSR loader** (PR #130) + **podmiana pliku w edycji** („Edytuj (opcjonalna podmiana)", `admin.library.tsx:279`) | — | Utrzymać (obie rekomendacje z 01.08 wdrożone) |
| Glosariusz | **8** | CRUD + realny odbiorca (tooltipy w treści) | — | Utrzymać |
| Quiz (EuroChallenge) | **7** | Celowa landing-strona promocyjna drugiej platformy NES (`nes-quiz.com`): branded `head()`, `LazyQuizIframe`, tło z preloadem, przyciski udostępniania | `head()` **nadal zahardkodowany po polsku** (`quiz.tsx:33–47`: description i og:description PL, bez `activeLang`), **brak `og:url`/canonical** do `nes-quiz.com` — odwiedzający EN dostaje polski snippet. Trzecie wydanie z tym samym zapisem | Zbilingwalizować meta + `og:url`/canonical |
| Web stories | **7** | AMP + JSON-LD + sitemap + indeks | `rel=amphtml` **tylko gdy `cover_url`** (`web-stories.$slug.tsx:43`); indeks bez `ItemList`/paginacji | Emitować `amphtml` zawsze + paginacja indeksu |
| **Live blog (nowa w audycie)** | **7** | Blok `liveblog` + **publiczny indeks `/live`** z plakietką LIVE dla relacji z wpisem w ostatnich 3 h (wcześniej live blog nie miał żadnego publicznego adresu — nie dało się go podlinkować ani odkryć); admin przestał być konsolą deweloperską (wybór postu z listy + autodetekcja bloków `liveblog`, edycja wpisów, nie tylko przypinanie) | Brak SSR-owego JSON-LD `LiveBlogPosting`, brak RSS relacji, brak testu trasy `/live` | Dodać `LiveBlogPosting` + prosty RSS relacji |

---

# MODUŁ 8 — SEO, feedy, dane strukturalne · **7,8/10** (01.08: 7,5)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| JSON-LD (`safeJsonLd`) | **9** | Escaping `< > & U+2028/9`, ~20 tras (w tym ItemList trackera i listy wydarzeń), test kontraktu w CI (osobny krok „SEO head + schema contract") | — | Utrzymać |
| hreflang PL/EN | **8 → 9** | x-default + pl + en, suppress przy canonical-override; **sitemap emituje pełny, wzajemny klaster hreflang per URL** (`xhtml:link` × 3) — poprawka 01.08 (`86cfc75`) z 110-liniowym testem `sitemapUrls.test.ts` | — | Utrzymać |
| Paywall markup (AEO) | **8** | `isAccessibleForFree:false` + `hasPart/cssSelector`, selektor realnie istnieje | — | Utrzymać |
| Sitemap | **6 → 7** | Wpisy PL i EN osobno z klastrem hreflang, kolekcje: web-stories/tracker/programy/eksperci/Q&A/eventy | **Jednoplikowa bez indeksu** (461 linii logiki, ściana 50k URL przy skali); **`news-sitemap.xml` nadal nieodkrywalny** — `robots[.]txt.ts:47` deklaruje tylko `Sitemap: /sitemap.xml` | Dopisać `Sitemap: news-sitemap.xml` + sitemap-index |
| Podcast RSS | **8** | Ingestowalny (enclosure + length + type, `itunes:*`), panel readiness, feed per show | GUID z prefiksem językowym (PL/EN = 2 kanały); brak autodiscovery w `<head>` | Wspólny GUID + `<link rel=alternate>` |
| OG images | **8** | HMAC-gated webhook refresh, 501 bez sekretu | — | Utrzymać |
| RSS / feedy treści | **8 → 9** | Kategoria/tag/program RSS realne + `/feed`, `rss.xml`; **od 03.08 `/tracker/rss.xml`** (scalony strumień dossier + osi czasu, jawne GUID-y `isPermaLink=false`, autodiscovery, `llms.txt`, 26 asercji jednostkowych) | Brak RSS relacji live (patrz M7) | Dorobić kanał relacji live |
| **Monitor linków wychodzących (nowa w audycie)** | **7** | `/admin/link-monitor`: zepsute linki zewnętrzne w opublikowanych wpisach, **rotacyjny skan w `jobs-tick`** + skan ręczny; komplementarny do monitora 404 | Brak polityki działania (nie proponuje zamiany/archive.org), brak alertu przy progu | Dodać sugestię `web.archive.org` + alert progowy |
| **`llms.txt` (nowa w audycie)** | **7 → 8** | Trasa `llms[.]txt` - deklaracja dla crawlerów LLM/AEO (rzadkość w sektorze); **od 03.08 wystawia kanał trackera PL/EN** jako najgęstsze źródło „co się zmieniło w prawie UE", z testem kontraktu | Brak pełnego testu kontraktu pozostałych sekcji | Rozszerzyć test kontraktu |

---

# MODUŁ 9 — Czat / komunikator · **8,1/10** (01.08: 8,0)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| DM 1:1 | **8** | RLS v2 z helperem SECURITY DEFINER, dedup konwersacji race-safe, okno edycji 5 min | Kursor paginacji bez tiebreakera `id` | Dodać `id` do kursora |
| Motywy / tapety | **8** | 5 motywów + 3 tapety z DB, realne | — | Utrzymać |
| Read receipts | **8** | 4-stanowe, wzajemność wyłączenia testowana pgTAP | — | Utrzymać |
| Wskaźnik pisania | **8** | Stabilny topic `chat-conv:${id}`, odbiorca realny | — | Utrzymać |
| Głosówki (voice notes) | **7** | MediaRecorder, fallback formatów, `durationSeconds` | — | Utrzymać |
| Grupy | **7** | `create_group_conversation`, member picker, info dialog | — | Utrzymać |
| Wyszukiwarka w wiadomościach | **6** | `search_vector` + RPC z powtórzonym RLS | Konfiguracja **`simple` = zero fleksji** (`20260720160000_chat_message_search.sql:40`), wbrew komentarzowi „polska fleksja". Trzecie wydanie z tym zapisem | Zmienić na słownik z fleksją albo poprawić komentarz |
| Załączniki | **8** | Bucket `chat-attachments` (30 MB, allowlist), purge osieroconych; **02.08: ochrona przed usunięciem obiektu w Storage przy purge** (`20260801122000`) | — | Utrzymać |
| Blokowanie / mute / rate limit | **7** | `user_blocks` owner-only, egzekucja serwerowa, mute, limit 20/min | „Zgłoś" istnieje w sieci, **nadal brak w oknie czatu** (zero wystąpień `report` w `MessageBubble.tsx`/`ChatWindow.tsx`) | Dodać wejście „Zgłoś" z `MessageBubble` |
| Prywatność peerów (`get_chat_peers`) | **9** | Filtr tenanta nad obiema gałęziami, REVOKE, ostrzeżenie w `COMMENT`, samodzielny kontrakt pgTAP (178 linii) | — | Utrzymać — kontrakt pilnuje regresji |
| Demo-bot („AI") | **3 → 4** | Uczciwie opisany jako lokalny podgląd bez DB/realtime/Supabase; **przestał duplikować UI** — renderuje **prawdziwy `MessageList`**, więc podgląd pokazuje 1:1 dymki, separatory dni, cykl potwierdzeń, reakcje, cytaty, tombstone | Nadal 562 linie na echo bez backendu; wątek „bot" istnieje tylko po stronie klienta | Wyciąć albo podłączyć realny backend |
| Kompozytor (nowa w audycie) | **7** | 03.08: kompozytor „card-style" — pole pełnej szerokości + pasek narzędzi (emoji/załącznik po lewej, mikrofon/wyślij po prawej), Enter/Shift+Enter/Escape obsłużone, `MAX_BODY_LENGTH` | Zmiana czysto wizualna, wprowadzona commitem Lovable **prosto na main**, bez testu (109/99 linii w jednym pliku) | Dodać test interakcji kompozytora |

---

# MODUŁ 10 — Sieć / networking · **8,1/10** (01.08: 8,0)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Graf połączeń | **9** | Deny-all (`REVOKE ALL FROM PUBLIC, anon, authenticated`), cały dostęp przez granularne RPC | — | Utrzymać (wzorzec) |
| Zaproszenia / wprowadzenia | **8** | `request_introduction`/`respond_introduction`, race-safe, polityki odczytu w zakresie tenanta; **02.08: PR #138 dokręcił `introduction_requests`/`user_connections`/`profiles`** po stronie polityk Data API | — | Utrzymać |
| Rekomendacje | **8** | RPC rzuca na nieznany czasownik, kontrakt pgTAP | — | Utrzymać |
| Zgłaszanie użytkownika | **8** | `report_user` + kolejka admina | Brak wejścia z czatu (patrz M9) | j.w. |
| Katalog osób (`/people`) | **8** | Consent-first (`discoverable`), trgm z escapowaniem LIKE, paginacja, odznaki batchowane jednym zapytaniem | — | Utrzymać |
| Testy warstwy klienta | **4 → 5** | **Pierwszy test istnieje**: `components/network/__tests__/RequestIntroductionButton.matrix.test.tsx` (macierz stanów przycisku) | To nadal **jeden** plik na ~880 linii hooków (`useConnections`, `useIntroductions`, `useMutualConnections` bez testów) | Dodać unit testy pozostałych hooków |

---

# MODUŁ 11 — Newsletter · **7,5/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Double opt-in | **8** | Token serwerowy TTL 48 h, rate limit per-IP i per-adresat, audyt zgód IP/UA | — | Utrzymać |
| Kreator e-maili (EmailDoc) | **8** | Realny builder, PL/EN, podgląd; **02.08: podgląd w kanwie renderuje ten sam komponent co produkcja** (wcześniej atrapa honorowała 5 z 21 ustawień) | HTML kampanii bez sanityzacji (staff-only) | Dodać sanityzację obronną |
| Wysyłka kampanii | **7** | Lease + batching (200/inv, 20/batch), recovery po crashu, idempotencja per odbiorca | `failed_count:0` nadpisywane; `markFailed` wywala całą kampanię | Akumulować liczniki; izolować błąd odbiorcy |
| Runner (scheduler) | **8** | Samozbrojenie + heartbeat, rozjazd `last_invoked_at` vs `last_app_*` jako diagnoza, append-only `job_runner_runs`, `job_scheduler_health()` w 1 RPC, pgTAP 348 linii | — | Utrzymać |
| Open/click tracking | **6** | Przepisywanie linków + piksel, token HMAC per (kampania, subskrybent), weryfikacja przynależności subskrybenta do tenanta kampanii | **Podwójny zapis potwierdzony na kodzie**: `webhooks.resend.ts:122–130` woła `recordCampaignEvent` dla `opened`/`clicked`, a piksel/`nl-click` zapisują to samo; **brak UNIQUE** na `newsletter_campaign_events` (są tylko 2 indeksy nieunikalne) → liczby zawyżone, możliwe >100% | UNIQUE na (campaign, subscriber, kind, dzień) + wyłączyć jedno źródło |
| One-click unsubscribe (RFC 8058) | **8** | `List-Unsubscribe` + `-Post`, GET nie mutuje | — | Utrzymać |
| Suppression / deliverability | **8** | Jedna kanoniczna lista (`email_suppressions` + widok zgodności `INSTEAD OF`), bramka dla 19/19 typów, ślad w `email_send_log`, dren kolejki wpięty w `jobsTick`, pgTAP 265 linii | Dostarczalność produkcyjna nieweryfikowalna z repo | Utrzymać |
| Segmentacja | **6** | Segment `min_tier_rank` działa realnie | `admin.audience` to dashboard retencji, **nie** narzędzie segmentacji mimo nazwy | Dobudować segmenty definiowane przez usera |

---

# MODUŁ 12 — Realtime / powiadomienia / web-push · **8,1/10** (01.08: 8,0)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Szyna zdarzeń domenowych | **9** | Anti-drift, korelacja, optymistyczne mutacje, `emit_domain_event` używany przez tracker/CRM/kupony | — | Utrzymać |
| Powiadomienia in-app | **8** | Producenci w triggerach DB, dedup 5 min, RLS insert-only-definer, realtime dzwonka | — | Utrzymać |
| Paginacja powiadomień | **8** | `useInfiniteQuery` + `.range()`, usuwanie grupy `.in("id", ids)` | — | Utrzymać |
| Preferencje powiadomień | **8** | Respektowane — `enqueue_notification` CASE pokrywa **10 rodzajów** (message, comment, follow, subscription, content, system, tracker, connection, saved_search, crm_task) | **Testy gatingu nadal wybiórcze** — grep po `supabase/tests/*.sql` nie znajduje asercji dla `enabled_tracker`/`enabled_saved_search`/`enabled_crm_task` | Dodać asercje pgTAP dla brakujących rodzajów |
| Krypto web-push (VAPID) | **9** | Własna impl. RFC 8291/8188, ES256, roundtrip test | — | Utrzymać |
| Service worker | **8** | `push-sw.js` push + notificationclick, rejestrowany po opt-in | — | Utrzymać |
| Scheduler push + digest | **9** | Dwóch producentów: pg_cron (`community-cron` co 5 min, `invoke_community_cron` przez pg_net, telemetria) + siatka Actions (`scheduler.yml` co 5 min + dobowy tick 05:25), pierwszy tick sam uzbraja ścieżkę bazową; pgTAP; runbook | — | Utrzymać |
| **Silnik workflow (nowa w audycie)** | **7** | `workflow_definitions` / `workflow_runs` / `workflow_templates` (migracja `20260711204000`) + admin 1447 linii: edytor definicji, panel przebiegów, szablony i **panel śladu korelacji**; RLS: definicje staff-CRUD w tenancie, przebiegi read-only; wpięty w mostek retencji subskrypcji (`20260723140000`) | Brak wglądu w realny użytek (0 dowodów na produkcyjne uruchomienia w repo), brak testów panelu, brak dokumentacji operacyjnej modułu | Runbook + smoke test; zmierzyć, czy moduł jest używany, czy jest to wydmuszka „w budowie" |

---

# MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing · **8,5/10** (01.08: 8,3)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Ceny serwer-autorytatywne | **9** | Klient nie może manipulować kwotą, ceny rozwiązywane serwerowo | Brak testu przypinającego „cena serwerowa" | Dodać test |
| Webhook Paddle | **8 → 9** | Podpis `unmarshal` obowiązkowy, błąd→500 (retry), allowlista IP; **`claimWebhookEvent` jest teraz fail-CLOSED** — każdy błąd insertu/lookupu **rzuca** (`webhookLog.server.ts:58–68`), `processed`/`skipped` nie są przetwarzane ponownie, a `received` można przejąć **tylko po okresie `STUCK_AFTER_MS`** (koniec podwójnego przetwarzania przy błędzie logu) | — | Utrzymać (rekomendacja z 01.08 wdrożona) |
| `grantEntitlement` | **9** | Każdy błąd rzucany, udokumentowany kontrakt, 8 testów regresji | — | Utrzymać |
| Izolacja sandbox/live (one-time) | **9** | Kolumna `payment_orders.environment NOT NULL DEFAULT 'live'` + backfill + indeks, `resolveEnvironment()` w produkcji zawsze `'live'`, `fulfilOrder()` pomija realizację przy niezgodności env, test env-mismatch 4/4 | — | Utrzymać |
| Customer Portal | **8** | `portalLink.server.ts` — overview/karta/anulowanie + mail | — | Utrzymać |
| Faktury / dokumenty | **8** | `invoice.server.ts` z 3-ścieżkową kontrolą własności, zasilane z webhooka, `billing_documents` z `order_id ON DELETE SET NULL` | — | Utrzymać |
| Dunning | **8** | Licznik prób + dedup po `transactionId`, dobowe przypomnienia w `scheduler.yml` | — | Utrzymać |
| Zmiana planu | **8** | Provider-first, `prevent_change` przy odmowie | — | Utrzymać |
| NIP / VAT | **7** | Walidacja `nip.ts`, formularz | **Nie przekazywany do Paddle w części ścieżek** — brak zmian od 01.08 | Ujednolicić przekazywanie NIP |
| Waluty / FX | **8** | Realne API NBP z retry i TTL | — | Utrzymać |
| Mock mode | **8** | Fail-closed w 3 punktach (dostawca skonfigurowany → mock nigdy) | — | Utrzymać |
| **Okres próbny (nowa)** | **7** | `trial_days` w katalogu planów + auto-sync do operatora (`catalogAutoSync`: zmiana kwoty/waluty/nazwy/**triala** propagowana), `trialing` w `OPEN_STATUSES` przy zamykaniu konta; wdrożone 01.08 („Dodał okres próbny 7 dni") | Świeże, brak danych o konwersji; brak testu ścieżki „trial → płatność → entitlement" | Dodać test end-to-end; obserwować konwersję |

---

# MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy · **7,7/10** (01.08: 7,3)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Kupony B2B | **8** | `applied_cents` jedno źródło prawdy, grant tieru fail-closed, rezerwacja limitu atomowa, pgTAP + test niezmiennika, efekty po płatności testowane | — | Utrzymać |
| Prezenty (gift) | **9** | End-to-end, `create/redeem_gift_link`, czysta domena z testami, **cap edytowalny w adminie** | — | Utrzymać |
| Darowizny | **7** | Panel-kłamstwo wycięte; pozycja nawigacji = jawny link zewnętrzny (`SidebarExternalNavLink`: `target=_blank`+`rel`, glif, `sr-only`, i18n, 5 testów); rejestr historyczny + widget CMS czytają z `public.donations` | Model zbiórki poza platformą (AUP Paddle wyklucza darowizny u operatora) | Utrzymać jako link zewnętrzny |
| Partner Biznesowy | **8** | Ekspozycja jako samoobsługowa subskrypcja B2B (2 tyg./mies./kwartał: 590/990/2490 zł) zgodna z AUP, parytet katalogu pilnowany testem `tierCatalogParity`, seed v3 UNION business + idempotentny backfill | Brak danych o konwersji; brak faktur per-org | Obserwować sprzedaż; faktury per-org |
| **Reklamy (house ads)** | **6 → 8** | 7 pozycji, targetowanie, zgody, ochrona CLS, `ad_events`→dashboard; **stored-XSS zneutralizowany**: kreacje html/script montują się w `SandboxedAdFrame` — `sandbox` **bez `allow-same-origin`** (opaque origin: brak dostępu do cookies/localStorage/DOM), `allow-popups-to-escape-sandbox` + `<base target="_blank">` dla linków, pomiar kliknięć heurystyką SafeFrame (test: „mounts an html creative inside a sandboxed iframe instead of dangerouslySetInnerHTML") | Kreacje inline nadal wykonują się w ramce (CSP strony ma `unsafe-inline`) — izolacja, nie eliminacja | Utrzymać; rozważyć nonce po wyjściu z `unsafe-inline` (M19) |
| Popupy | **7** | Triggery (delay/scroll/exit), capping, targetowanie, a11y, testy, `popup-event` beacon | Capping tylko localStorage | Server-side capping opcjonalnie |

---

# MODUŁ 15 — Profil i konto · **8,0/10** (01.08: 7,8)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Logowanie / rejestracja | **7** | Reset hasła działa, brute-force fail-closed, polityka 8 znaków spójna; **PR #141 naprawił formularze auth**: przełączniki commitowały `"0"/"1"` czytane idiomem `!== false` (wyłączenie nie robiło nic), trzy rozjazdy kluczy (`showPasswordConfirm`/`showConfirmPassword`, `newsletterOptIn`/`showNewsletterOptIn`, **`consentText`/`consentLabel` — własna treść RODO nigdy się nie pokazywała**), warianty card/flat/inline realnie różne; 02.08 checkbox zgody RODO + `FormSelect` w formularzu „Dołącz do nas" | **3 ścieżki logowania** — OAuth Google tylko w bloku buildera, tam **bez MFA** (user z TOTP wchodzi na aal1). Bez zmian od 01.08 | Ujednolicić: MFA we wszystkich, OAuth z przełącznikiem |
| MFA (TOTP) | **8** | Realne (`enroll/challenge/verify`), step-up aal2 egzekwowany serwerowo | Brak listy sesji/urządzeń (`profile.security` umie tylko „ubij inne sesje") | Dodać listę aktywnych sesji |
| Eksport danych (RODO) | **8** | 17 sekcji, user-scoped, jawna sekcja `errors`, obejmuje `personality_results` i `eu_policy_follows` | Brak testów integracyjnych | Dodać test |
| Usunięcie konta (RODO) | **6** | Re-auth hasłem, uprzednie anulowanie subskrypcji u operatora | **`payment_orders.user_id` nadal `ON DELETE CASCADE`** (weryfikacja: definicja `20260624172041`, żadna późniejsza migracja tego nie zmienia — `20260731220000` i `20260801135636` dotykają tylko kolumny `environment`) → usunięcie konta niszczy dowody księgowe (art. 74 uor). **Jedyny niedomknięty punkt P1 audytu, trzecie wydanie z rzędu** | `SET NULL` + anonimizacja zamiast `CASCADE` (wzorzec `billing_documents.order_id` już to robi) |
| Bezpieczeństwo konta | **8** | Zmiana hasła/e-maila z re-auth, „wyloguj inne sesje" | Brak listy sesji | j.w. |
| Profil (edytor, CV, dorobek) | **8** | Bio skonsolidowane (`canonicalBio`), optymistyczne edycje z rollbackiem, CV w prywatnym buckecie; 01.08 „Ochroniono dane kontaktowe profili" + `20260801120000_restore_min_profile_grants` | — | Utrzymać |
| Test osobowości (Big Five) | **7** | Furtka zamknięta (odczyt service-rolem, pole wycięte z CRM, `Big5Panel` usunięty z `ProfileSyncCard`), REVOKE w DB | **Wynik nadal nie zasila niczego** — poza eksportem RODO i własnym dashboardem nie ma konsumenta (grep po `src/lib`: tylko `personality.ts`, i18n, export) | Zasilić rekomendacje za jawną zgodą albo pozycjonować jako self-insight |
| Personalizacja / zainteresowania | **7** | 4–5 powierzchni, tryb anon z merge po zalogowaniu | Żywa słabsza z 2 implementacji RPC (pełny skan) | Ujednolicić RPC rekomendacji |
| Organizacje (seaty) | **7** | Realny moduł: seaty, grace, przypomnienia cron, zaproszenia | Brak faktur per-org i ról poza owner/member | Dodać role + faktury org |
| **Zgody / prywatność** | **6 → 8** | **Rozjazd CMP↔rejestr zamknięty**: `lib/consent/registryBridge.ts` mapuje kategorie CMP na katalog zgód (`cookies_functional/analytics/marketing`) i dopisuje każdą decyzję do `user_consents`/`user_consent_events` przez SECURITY DEFINER `set_user_consent` (IP/UA czytane serwerowo, tabele intake **nadal zamknięte dla klienta** — inwariant `check-sql-anon-insert` nietknięty), z jawną zasadą jednego pisarza (runtime = CMP, rejestr = ślad audytowy) i źródłem decyzji (`cmp_banner`/`profile_privacy`/`notifications_center`/`login_sync`) | Brak **GPC / „do not sell"** (zero wystąpień `Sec-GPC`); kategoria `personalization` nadal niczego nie bramkuje | Dodać obsługę `Sec-GPC`; zbramkować `personalization` |

---

# MODUŁ 16 — Zarządzanie społecznością · **7,5/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Moderacja Q&A / ankiet | **8** | Statusy, odpowiedzi eksperckie, zapisy przez utwardzone RPC | — | Utrzymać |
| Reputacja | **7** | Leaderboard, poziomy, RPC, testy; typy akcji zawierają `badge_expert`/`badge_contributor`/`badge_verified` | Akcje „badge_*" istnieją w typie, ale nic ich nie emituje automatycznie | Podłączyć auto-grant |
| **Odznaki** | **4** | Emiter domain-eventu przy nadaniu; `lib/profile/badges.ts` (warstwa publiczna) ma **dokładnie 4 rodzaje zgodne z DB** | **Katalog admina nadal rozjechany z DB CHECK**: `BADGE_CATALOG` (`lib/admin/community.ts:705`) ma 6 kluczy, w tym `moderator`, `early_adopter`, `supporter` — CHECK dopuszcza `('verified','expert','contributor','staff')`, więc te trzy **zawsze** kończą się błędem 23514; `staff` **nienadawalny** z UI; **zero auto-przyznawania** mimo silnika reputacji. Bez zmian na 03.08 | Zunifikować `BADGE_CATALOG` z DB (albo rozszerzyć CHECK migracją) + auto-grant z reputacji |
| Powitania | **7** | Wołaczowe, szablony maili | — | Utrzymać |
| Engagement dashboard | **7** | Jeden RPC `get_engagement_overview` | — | Utrzymać |
| Contribute → review | **8** | Pełna pętla zgłoszenie→moderacja z RLS | — | Utrzymać |

---

# MODUŁ 17 — Analityka i BI · **7,5/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| GA4 (import + export) | **8** | Realny Data API (JWT RS256 service account) + Measurement Protocol | **Klucze `GA4_*` nadal nieudokumentowane** w `.env.example` (0 wystąpień); zero cache (2× API na odświeżenie) | Dodać cache + docs env |
| Search Console | **6** | Realne API przez gateway Lovable | Vendor lock + SPOF; status „zbiera dane" to tylko test obecności env, bez pingu | Ping API + własny OAuth jako alternatywa |
| First-party tracking | **7** | Pełny łańcuch track→tabela→dashboard, consent gate, rate limit, `related-click`/`popup-event`/`ad-event` jako osobne beacony | Sessionization per karta (przeszacowuje); **zero bot-filtering** (brak jakiejkolwiek heurystyki UA/known-bots w `lib/analytics`) | Dodać filtr botów + sessionization cross-tab |
| Warstwa semantyczna | **9** | Reconciliation, authoritative vs corroborating, `safeRatio`, rozróżnia `not_configured`/`no_data`, słownik metryk z formułami (`metrics.ts`), rejestr strumieni (`streams.ts`), testy + pgTAP | Adopcja nadal częściowa — dashboardy GA4/GSC/Vitals/Audience mają własne moduły insightów (`ga4Insights.ts`, `gscInsights.ts`) obok słownika | Przepiąć pozostałe zakładki na słownik |
| „Silnik insightów" | **5** | Data-driven insighty GA4/GSC/semantic realne | Overview to hardkodowane stringi z flag env, nie z liczb; „silnik" semantic = 3 reguły | Generować Overview z liczb |
| RUM (web vitals) | **8** | Pełny łańcuch beacon→tabela→dashboard; `/admin/performance` jako centrum obserwowalności (Web Vitals + błędy klienta w stylu BI) | Typy Supabase niezregenerowane w części ścieżek (`as never`) | Zregenerować typy |
| Eksperymenty A/B | **6** | Przydział FNV-1a deterministyczny (`assignVariant`), ekspozycje przez beacon `/api/public/experiment-event` (bezpośrednie anon INSERT-y zablokowane), z-test | **Nadal client-side** (flash B, SSR zawsze A), brak korekty na peeking, brak min. próby, `z=0→winner=A` | Przydział server-side + bramka istotności |

---

# MODUŁ 18 — CRM · **8,4/10** (01.08: 8,0)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Lead scoring | **9** | 10 realnych triggerów, parytet TS↔SQL pilnowany testem + pgTAP, decay 30 dni, capy | — | Utrzymać |
| **Pipeline / funnel** | **6 → 8** | **Agregacja przeniesiona do SQL** (PR #136, migracja `20260802130000`): RPC `crm_funnel_stats()` liczy `COUNT(*) FILTER` jednym skanem, SECURITY INVOKER nad widokiem `security_invoker=on` (RLS obowiązuje; brak roli staff = komplet zer, nie błąd) — koniec ściągania całej tabeli i pętli w JS | 8 stage'ów nadal bez testu przejść | Dodać test przejść stage'ów |
| Zadania / follow-upy | **8** | pg_cron co 10 min, `SKIP LOCKED`, deep-linki, szyna zdarzeń, gałąź `crm_task` w preferencjach | — | Utrzymać |
| Firmy ↔ leady | **8** | FK + indeks, propagacja `company_id`, aktywność firmy, zapisane widoki firm | — | Utrzymać |
| Import / eksport CSV | **8** | Chunk 500, dedup po `email_norm` w transakcji, obrona przed CSV-injection | — | Utrzymać |
| **Lista leadów** | **6 → 8** | **Paginacja serwerowa z totalem**: `page`/`pageSize` (25/50/100/200) w kluczu zapytania, filtry i sort liczone w SQL, `total` z zapytania (`admin.crm.index.tsx:538–566, 910–918`) — admin nie widzi już uciętego zbioru 500 | — | Utrzymać (rekomendacja z 01.08 wdrożona) |
| **Saved views** | **5 → 8** | **Podłączone dla leadów**: `LeadViewTabs` (widoki wbudowane `BUILTIN_LEAD_VIEWS` + użytkownika z `saved_views`, entity `"lead"`), `LeadFilterChips` odtwarzają filtr po obu stronach (SQL liczy serwerowo), „+" zapisuje bieżącą konfigurację | — | Utrzymać (rekomendacja z 01.08 wdrożona) |
| **Integracje wychodzące** | **6 → 8** | **Koniec jednego sztywnego partnera** (migracja `20260802131000`): `crm_webhook_endpoints` jako **profil partnera nad `integration_endpoints`** (1:1) — transport (url, sekret w Vault, `event_types`, `enabled`) osobno od semantyki CRM (`auth_kind` hmac/bearer, `forward_stages`, `consent_mapping`, `workspace_id`); dowolna liczba partnerów per tenant = INSERT, **zero migracji**; dostawy przez **istniejący outbox** `integration_deliveries` (claim `SKIP LOCKED`, backoff wykładniczy, `dead` po 8 próbach); filtr etapów **przed** kolejką; ręczny push (`crm_enqueue_lead_push`, event `crm_lead.pushed.v1`) świadomie poza filtrem; panel `CrmPartnerEndpointsPanel` | Migracja danych z kolumn `merydian_*` do nowego modelu wymaga weryfikacji operacyjnej | Zweryfikować backfill i wyłączyć starą ścieżkę |

---

# MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO · **8,5/10** (01.08: 8,2)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Multi-tenant (host→tenant) | **8 → 9** | 2 płaszczyzny (treść fallback / crawler fail-closed), `profiles.tenant_id` przypięty triggerem, gate CI; **`x-tenant-host` przestał być spoofowalny** — `pickTrustedHost()`/`resolveTrustedRequestHost()` (`lib/server/tenant.server.ts:163,191`) walidują parę `Host`/`X-Forwarded-Host` vs `tenants.domain` na krawędzi: zarejestrowany `Host` wygrywa ze spoofowanym XFH, nieznany host = brak wskazówki tenanta (`WDROZENIE_TRUSTED_HOST_2026-08-02.md`); PR #137 dokręcił RLS multi-tenant | — | Utrzymać |
| RLS coverage | **9** | 0 tabel bez RLS; parser stanu końcowego liczy **518 realnych polityk** (metryka odporna na churn); 3 gate'y statyczne zielone na tym HEAD | Stare metryki („915", „408") opatrzone korektami w dokumentach historycznych | Używać metryki stanu końcowego |
| Sekrety (Vault) | **9** | Sekrety CRM/integracji w Vault, service-role tylko w `*.server.ts`, nowy model endpointów trzyma sekret partnera w Vault | Klucze Merydian historycznie plaintext | Zweryfikować migrację do Vault |
| Impersonacja | **8** | Gate `is_super_admin`, audytowana, ścieżka `end` domknięta | — | Utrzymać |
| Anonimowe INSERT-y | **8 → 9** | Gate `check-sql-anon-insert.ts` z self-testem: inwariant A (żadna permisywna polityka INSERT dla `anon`/`public`) + B (6 tabel intake bez klienckiego INSERT); ✓ na tym HEAD (**518 polityk**); PR #138 domknął zgody RODO, `f80cd8f` dodał polityki Data API | Commity pchane prosto na `main` weryfikuje dopiero post-hoc | Ochrona gałęzi `main` |
| CSP / nagłówki | **6 → 7** | CSP + XFO + Referrer + Permissions + HSTS + nosniff; **`script-src-attr 'none'` zamyka realny wektor stored-XSS** (inline `onerror=`/`onclick=` w treści redakcyjnej są martwe niezależnie od `unsafe-inline`), `connect-src` zawężony do `'self'` + origin Supabase (+ wss), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`; rozluźnienie tylko dla hostów podglądu Lovable | `script-src 'unsafe-inline'` zostaje (TanStack Start nie wspiera nonce dla własnych skryptów); `frame-src https:` szeroki | Plan wyjścia z `unsafe-inline` (nonce), zawężyć `frame-src` do allowlisty osadzeń |
| Consent RODO | **7 → 8** | Rejestr z IP/UA/wersją/źródłem + **most z CMP** (patrz M15) | Brak GPC | Dodać `Sec-GPC` |
| **Audyt tłumaczeń widgetów (nowa w audycie)** | **8** | `/admin/i18n` (`WidgetI18nAuditPane`) — audyt PL→EN treści widgetów; w CI **blokująca bramka i18n parity** (`check:i18n-parity`, artefakt `reports/i18n-parity.json`), bramka `builderI18nKeys` złapała brak kluczy karuzeli (klucz bez wpisu degraduje cicho do polskiego `defaultValue`) | Audyt pokrywa widgety; treść wpisów/stron poza zakresem | Rozszerzyć na `custom_meta`/etykiety taksonomii |
| **Macierz uprawnień (nowa w audycie)** | **6** | `/admin/permissions` — zakres możliwości 5 ról systemowych i 4 poziomów subskrybenta, PL/EN, atomic design | **Strona referencyjna (read-only)** — nie jest generowana z kodu/DB, więc może się rozjechać z rzeczywistością bez żadnego sygnału | Generować z katalogu capability (`lib/billing/capabilities.ts`) + test parytetu |
| **Wersjonowanie polityk i elementów (nowa w audycie)** | **7** | `/admin/versions` — wersje polityk, bannera zgód i elementów buildera z podglądem każdej wersji (spina się z `user_consent_events.version`) | Brak dowodu na wymuszanie ponownej zgody przy zmianie wersji polityki | Dodać przepływ „nowa wersja → re-consent" |

---

# MODUŁ 20 — Platforma / backend / infrastruktura / SSR · **7,9/10** (01.08: 7,8)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| SSR render treści | **9** | Post/home/archiwa/eksperci/autor/tracker + **od 01.08 wydarzenia, ankiety i biblioteka** renderują treść serwerowo (defensywne loadery `allSettled`, budżety czasowe, `pendingComponent`/`errorComponent` zamiast migających komunikatów); SSR-paginacja `/`, `/blog`, archiwum autora | Pozostałe listy społecznościowe (np. `/contributors`) nieaudytowane pod SSR | Przejrzeć resztę tras publicznych |
| Edge cache dokumentów | **7** | L1 per-isolate + L2 per-colo, kill-switch, ISR trackera, `edgeTtlCache` dla listy wydarzeń; **audyt jest jedynym punktem inwalidacji** (`recordAudit` → `purgeDocumentCacheForCurrentHost`), więc nowe mutacje treści dziedziczą purge automatycznie | Regex `DOCUMENT_PURGE_ACTIONS` (`post.` \| `page.` \| `category.` \| `tag.` \| `redirect.` \| `revision.`) **nie pokrywa** podcastów, programów, web-stories, wydarzeń ani trackera; `reader.cancel` nie ubija upstreamu | Rozszerzyć `DOCUMENT_PURGE_ACTIONS`; naprawić kolejność tee/guard |
| Bramka kompletności SSR (e2e) | **3 → 4** | Do asercji „dokument się domyka" doszły: `status < 400`, budżet 20 s, oraz **test hydracji strony głównej** (`h1` widoczny + zero `pageerror`) | **Nadal pozorna w rdzeniu**: `documentStreamGuard.server.ts` dopisuje `FORCED_CLOSE_TAIL = "\n</body></html>"` przy zawieszeniu strumienia, więc asercja „kończy się `</html>`" **nie może zafailować**; 5 ścieżek, zero asercji treści poza `h1` na `/` | Wyłączyć guard w teście (flaga env) + asercje treściowe per trasa |
| **Bundle publiczny** | **5 → 4** | Gate `check:bundle` + `check:chunks` (Tarjan) blokujące w CI; klasyfikacja błędów importu chunka per przeglądarka | **Regres zmierzony**: budżet publiczny podniesiony **1475 → 1790 KB** gzip (zmierzone 1472 → ~1756), największy chunk **350 → 505 KB** (zmierzone ~492) — dwa „re-floory" w 3 dni. Czytelnik płaci ~1,76 MB gzip JS: 5–6× ponad rozsądny budżet | **Zatrzymać re-floory**: zamrozić budżet, code-split agresywnie (edytor/builder/admin poza ścieżkę publiczną), rozliczyć wzrost z PR #141/#132 |
| Prerender | **3** | — | **Nie istnieje** (0 stron); `prerender.ts` to Speculation Rules, nie build | Rozważyć prerender kluczowych stron |
| Testy jednostkowe | **7 → 8** | **4625 pass / 0 fail / 50 skip** (509 plików, +959 testów w 2 dni), gate coverage w CI, CI samo przepina lockfile na publiczny rejestr, osobne nazwane kroki dla SEO i i18n | Progi coverage nadal niskie (statements 19,5 / lines 20 / branches 15,75 / functions 13); **knip poza CI**; **lint czerwony na main** (146 problemów, 10 błędów formatowania) przez commity prosto na main | Podnieść progi; wpiąć knip; chronić `main` |
| pgTAP (izolacja/tenant) | **8** | Realnie odpala się w CI (pin `setup-cli@2.111.0`, krok własności triggerów `auth.users`), **65 plików**, kontrakty na `get_chat_peers`, rekomendacje, suppression, scoring, izolację 3 tenantów | Kolizje numeracji migracji między równoległymi gałęziami **nadal bez gate'u** (2 incydenty w 2 dni na przełomie 07/08) | Gate na unikalność wersji migracji |
| Gate'y SQL statyczne | **9** | Trzy blokujące, wspólny parser stanu końcowego, wszystkie ✓ na tym HEAD: tenant-scope (504 funkcje), app_role (870 literałów), anon-insert (518 polityk + self-test) | Brak gate'u kolizji wersji migracji (j.w.) | Dodać czwarty gate |
| **Kontrakt bazy po wdrożeniu (nowa)** | **8** | Job `post-deploy` (push na main / ręcznie): `check:db-contract` sonduje Data API i rozróżnia **PGRST205/PGRST202 (brak obiektu)** od 401/403 („istnieje, ale RLS"), potem `report:deployment` generuje raport zgodności (zakres PR-ów od tagu, liczba testów, status CI, smoke) + artefakty; `db-schema-invariant.test.ts` pilnuje listy tabel | Uruchamiany **po** merge'u — nie blokuje PR-a; wymaga sekretów produkcyjnych | Utrzymać; rozważyć wariant PR-owy na bazie efemerycznej |

---

# PODSUMOWANIE OCEN MODUŁÓW

| # | Moduł | 30.07 | 01.08 | **03.08** | # | Moduł | 30.07 | 01.08 | **03.08** |
| - | ----- | :---: | :---: | :-------: | - | ----- | :---: | :---: | :-------: |
| 1 | Wpisy — czytelnik | 8,0 | 8,2 | **8,4** ↑ | 11 | Newsletter | 6,5 | 7,5 | **7,5** |
| 2 | Edytor + workflow | 8,4 | 8,4 | **8,5** ↑ | 12 | Realtime / push | 6,5 | 8,0 | **8,1** ↑ |
| 3 | Bloki + builder | 8,8 | 8,8 | **8,9** ↑ | 13 | Monetyzacja — checkout | 8,0 | 8,3 | **8,5** ↑ |
| 4 | Strony / media / import | 6,8 | 6,8 | **6,8** | 14 | Monetyzacja — kupony/reklamy | 6,8 | 7,3 | **7,7** ↑ |
| 5 | Strona główna / archiwa | 7,8 | 8,0 | **8,3** ↑ | 15 | Profil i konto | 7,5 | 7,8 | **8,0** ↑ |
| 6 | Wyszukiwarka | 8,3 | 8,3 | **8,3** | 16 | Społeczność | 7,5 | 7,5 | **7,5** |
| 7 | Typy specjalne | 6,5 | 7,0 | **7,6** ↑ | 17 | Analityka i BI | 7,5 | 7,5 | **7,5** |
| 8 | SEO / feedy | 7,5 | 7,5 | **7,8** ↑ | 18 | CRM | 8,0 | 8,0 | **8,4** ↑ |
| 9 | Czat | 7,5 | 8,0 | **8,1** ↑ | 19 | Ustawienia / multi-tenant | 7,8 | 8,2 | **8,5** ↑ |
| 10 | Sieć | 8,0 | 8,0 | **8,1** ↑ | 20 | Platforma / backend / SSR | 7,5 | 7,8 | **7,9** ↑ |

**Średnia platformy: ~8,0/10** (01.08: ~7,8 · 30.07: ~7,5). **Werdykt kompozytu: 7,8/10** (01.08: 7,5) —
niżej niż średnia arytmetyczna, bo ważę w dół: (a) **regres bundla** (jedyna sub-ocena, która spadła: 5→4),
(b) wydmuszki, które przetrwały trzy wydania (autozapis stron, odznaki, quiz-meta, import WP, dwie tabele
programów), (c) **otwarte P1** (`CASCADE` na dowodach księgowych), (d) **czerwony lint na main** i dryf
z commitów pchanych poza PR-ami. **14 modułów w górę, 6 bez zmian, żaden w dół.**

---
---

# CZĘŚĆ II — KONKURENCJA: OCENA SZCZEGÓŁOWA (PL / UE / ŚWIAT)

# K.0 Metodyka, granice i co jest wyłączone

**Co oceniam.** Wyłącznie **zdolności produktowe platformy cyfrowej**: mechanika czytania, archiwa,
wyszukiwarka, formaty specjalne, dystrybucja techniczna, komunikacja, sieć, newsletter, monetyzacja,
profil użytkownika. **Nie oceniam treści** — ani jakości analiz, ani doboru tematów, ani autorytetu marki,
ani skali redakcji (Reuters ma ~190 biur; ten wymiar celowo poza pomiarem).

**Reżim „b/d".** Konkurentów da się ocenić **wyłącznie po publicznie obserwowalnym efekcie serwisu**.
Dlatego:

- **11 modułów obserwowalnych** — oceniane 0–10: M1 (czytelnik), M5 (strona główna/archiwa/chrome),
  M6 (wyszukiwarka), M7 (typy specjalne), M8 (SEO/feedy), M9 (czat), M10 (sieć), M11 (newsletter),
  M13 (paywall), M14 (konwersja), M15 (profil).
- **9 modułów wewnętrznych → `b/d` dla WSZYSTKICH 38 konkurentów**: M2 (edytor/workflow), M3 (bloki+builder),
  M4 (wygląd/media/import), M12 (realtime/infra), M16 (społeczność-admin), M17 (analityka/BI), M18 (CRM),
  M19 (ustawienia/multi-tenant/RODO), M20 (backend/RLS/testy/CI). **`b/d` ≠ „nie mają"** — to „brak danych
  z zewnątrz". NES ma tu ocenę, bo jest oceniany **z kodu**.
- **Rozróżnienie krytyczne:** gdy funkcja jest **obserwowalnie nieobecna**, to jest **dana**, nie „b/d".
  M9 (czat) → **0 u wszystkich 38**. M10 (sieć) → 0,5–1,0 u wszystkich (delegacja do LinkedIna).

**Źródło ocen konkurentów.** `OCENA_KONKURENCI_INDYWIDUALNIE_2026-07-20.md` (31 kryteriów × 38 podmiotów),
przemapowane na moduły w `OCENA_FUNKCJI_KONKURENCI_2026-07-24.md`. **Stan wiedzy: do połowy 2026.**

**Ograniczenie tego wydania (jawne).** Nie udało się przeprowadzić **ponownej weryfikacji serwisów
konkurentów na żywo**: polityka sieciowa środowiska wykonawczego blokuje wychodzące pobrania stron
(wszystkie próby `WebFetch` → HTTP 403 z gatewaya). Oceny konkurentów pozostają więc na poziomie
korpusu 07-20/07-24; **to, co w tym wydaniu jest nowe, to głębokość rozbicia i przeliczenie różnic
względem stanu NES na 03.08**, nie nowy pomiar konkurencji. Jedyny punkt zweryfikowany zewnętrznie w tym
wydaniu: model członkostwa Chatham House (członkostwo indywidualne, eLibrary, 4 wydania drukowane
„The World Today", dostęp do „International Affairs"; bieżący numer magazynu open access, archiwalne
dla członków i prenumeratorów) — potwierdza notę paywall 5,5 [1].

**Skala:** 0–10, krok 0,5. **Różnic <0,5 nie traktować jako rozstrzygających.** Im mniejszy podmiot
(NIDS, SIIS, CIIS, IMEMO), tym niższa pewność.

# K.1 NES na 03.08 w przeliczeniu na moduły obserwowalne

| Moduł obserwowalny | NES 24.07 | NES 01.08 | **NES 03.08** | Co się zmieniło |
| ------------------ | :-------: | :-------: | :-----------: | --------------- |
| M1 Wpisy — czytelnik | 7,8 | 8,2 | **8,4** | takeaways na stronach (korekta), licznik odsłon, TOC ręczny |
| M5 Strona główna / archiwa | 8,0 | 8,0 | **8,3** | tryb „najnowsze wpisy" domknięty, mega menu odmartwione |
| M6 Wyszukiwarka | 8,3 | 8,3 | **8,3** | wyszukiwanie kontaktów; STT bez allowlisty MIME |
| M7 Typy specjalne | 7,5 | 7,0 | **7,6** | tracker (alerty — korekta), eventy/ankiety/biblioteka SSR, live blog |
| M8 SEO / feedy | 7,9 | 7,5 | **7,8** | klaster hreflang w sitemapie, monitor linków, `llms.txt` |
| M9 Czat | 8,0 | 8,0 | **8,1** | demo-bot bez duplikacji UI, ochrona purge załączników |
| M10 Sieć | 7,6 | 8,0 | **8,1** | polityki dokręcone, pierwszy test klienta |
| M11 Newsletter | 7,7 | 7,5 | **7,5** | podgląd = produkcja; open/click nadal podwójnie zapisywane |
| M13 Paywall / checkout | 8,4 | 8,3 | **8,5** | webhook fail-closed, trial 7 dni |
| M14 Konwersja | 6,9 | 7,3 | **7,7** | reklamy w sandboxie, cap prezentów w UI |
| M15 Profil | 8,0 | 7,8 | **8,0** | most zgód CMP↔rejestr; `CASCADE` faktur otwarty |
| **Agregat 11 modułów obserwowalnych** | **7,9** | **7,9** | **8,0** | — |

> **Uwaga o dwóch agregatach.** Starsze dokumenty podają agregat z **5 modułów** badania 07-20
> (NES 8,0; FT 5,5). Ten dokument liczy agregat z **11 modułów obserwowalnych** — te same dane, inny
> mianownik, inne liczby (FT 6,1). Podaję oba, żeby nie mieszać: **agregat-11 jest właściwy do porównań
> per moduł**, agregat-5 zostaje dla ciągłości z 07-20.

---

# K.2 POLSKA — 5 podmiotów, pełne rozbicie

Roster: **PISM**, **OSW**, **Klub Jagielloński (KJ)**, **Nowa Konfederacja (NK)**, **INE**.
(Sobieski / WEI / Batory cyfrowo ≈ KJ/NK — pominięte jako niedystynktywne.)

## K.2.1 Macierz: 11 modułów obserwowalnych × 5 podmiotów

| Moduł | **NES** | PISM | OSW | KJ | NK | INE | najlepszy PL | **Δ NES** |
| ----- | :-----: | :--: | :-: | :-: | :-: | :-: | :----------: | :-------: |
| M1 Czytelnik | **8,4** | 4,5 | 5,0 | 4,5 | 4,5 | 4,0 | OSW 5,0 | **+3,4** |
| M5 Strona gł. / archiwa | **8,3** | 3,5 | 4,0 | 3,5 | 3,0 | 3,0 | OSW 4,0 | **+4,3** |
| M6 Wyszukiwarka | **8,3** | 2,1 | 2,3 | 1,6 | 1,6 | 1,3 | OSW 2,3 | **+6,0** |
| M7 Typy specjalne | **7,6** | 2,5 | 3,0 | 2,5 | 2,5 | 2,0 | OSW 3,0 | **+4,6** |
| M8 SEO / feedy | **7,8** | 4,5 | 5,0 | 4,0 | 3,5 | 3,0 | OSW 5,0 | **+2,8** |
| M9 Czat | **8,1** | 0 | 0 | 0 | 0 | 0 | **brak** | **kategorialna** |
| M10 Sieć | **8,1** | 0,5 | 0,5 | 0,5 | 0,5 | 0,5 | 0,5 | **+7,6** |
| M11 Newsletter | **7,5** | 2,5 | 3,0 | 2,5 | 2,5 | 2,0 | OSW 3,0 | **+4,5** |
| M13 Paywall | **8,5** | 1,0 | 1,0 | 2,5 | 4,0 | 1,5 | NK 4,0 | **+4,5** |
| M14 Konwersja | **7,7** | 1,5 | 1,5 | 3,0 | 3,5 | 2,5 | NK 3,5 | **+4,2** |
| M15 Profil | **8,0** | 2,3 | 2,3 | 1,9 | 1,9 | 1,8 | PISM/OSW 2,3 | **+5,7** |
| **Agregat-11** | **8,0** | **2,3** | **2,5** | **2,4** | **2,5** | **2,0** | OSW/NK 2,5 | **+5,5** |
| Agregat-5 (07-20) | 8,0 | 2,3 | 2,4 | 2,1 | 2,1 | 1,8 | OSW 2,4 | +5,6 |

## K.2.2 Rozbicie kryterialne — gdzie liga PL jest najmocniejsza

| Kryterium (07-20) | **NES 03.08** | PISM | OSW | KJ | NK | INE | Komentarz |
| ----------------- | :-----------: | :--: | :-: | :-: | :-: | :-: | --------- |
| Języki (lustro PL/EN) | 9,0 | **7,0** | **7,0** | 2,0 | 2,0 | 6,0 | **jedyne kryterium, gdzie PL jest realnie blisko** — PISM/OSW mają pełne lustra |
| SEO techniczne | 9,0 | 4,5 | **5,0** | 4,0 | 3,5 | 3,0 | luka 4,0 |
| Czytanie artykułu | 6,5 | 4,5 | **5,0** | 4,5 | 4,5 | 4,0 | **najmniejsza luka NES w całym zestawieniu PL (1,5)** |
| Formaty (podcast/wideo/live) | 9,0 | 4,5 | 5,5 | 4,5 | 4,5 | 3,5 | — |
| Paywall | 9,0 | 1,0 | 1,0 | 2,5 | **4,0** | 1,5 | NK = darowizny + prosta bramka |
| Landingi konwersji | 7,0 | 1,5 | 1,5 | 3,0 | **3,5** | 2,5 | — |
| Str. ekspertów | 9,0 | **4,0** | **4,0** | 3,5 | 3,5 | 3,0 | statyczne wizytówki |
| Katalog ekspertów | 8,0 | **3,0** | **3,0** | 2,0 | 2,0 | 2,0 | bez filtrów/fasetów |
| Fasety wyszukiwania | 8,0 | 3,5 | **4,0** | 2,0 | 2,0 | 1,5 | — |
| Kanały (newsletter/push) | 8,0 | 2,5 | **3,0** | 2,5 | 2,5 | 2,0 | — |
| Prof. czytelnika | 8,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | **nie istnieje w lidze PL** |
| Networking | 8,0 | 0,5 | 0,5 | 0,5 | 0,5 | 0,5 | j.w. |
| Czat | 8,5 | 0 | 0 | 0 | 0 | 0 | j.w. |
| A/B | 9,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | j.w. |
| Alerty | 6,5 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | j.w. |

## K.2.3 Profile — co konkretnie mają

- **PISM (agregat-11: 2,3).** Najbardziej „instytucjonalny" serwis w lidze: pełne lustro PL/EN, uporządkowane
  kolekcje publikacji (biuletyny, policy papers), przyzwoite strony ekspertów (4,0 — najwyżej w PL razem z OSW).
  Zero monetyzacji (paywall 1,0), wyszukiwarka na poziomie WordPressowego `s=` z paroma filtrami (2,1),
  brak jakiejkolwiek warstwy konta.
- **OSW (2,5 — najlepszy w PL).** Lider dzięki dwóm rzeczom: **najlepszemu SEO w lidze (5,0)** i najszerszym
  formatom (5,5: komentarze, raporty, podcast). Archiwa i huby tematyczne najbardziej użyteczne w PL (4,0).
  Nadal: brak paywalla, brak konta, brak fasetów ponad podstawowe.
- **Klub Jagielloński (2,4).** Jedyny w PL z **hybrydą darowizny + treści premium** (paywall 2,5, landingi 3,0),
  żywszą kulturą komentarzy (2,0 — dwukrotność PISM/OSW) i mocnym podcastem. Cena: brak lustra EN (języki 2,0)
  i najsłabsza wyszukiwarka w pierwszej trójce (1,6).
- **Nowa Konfederacja (2,5).** **Najlepszy paywall w Polsce (4,0)** — realny model członkowski/„Darczyńca"
  z treścią za bramką i najlepszymi landingami konwersji w lidze (3,5). Reszta platformy najsłabsza z
  czołówki: strona główna 3,0, brak EN, wyszukiwarka 1,6.
- **INE (2,0).** Najmniejszy cyfrowo: lustro EN częściowe (6,0), ale wyszukiwarka 1,3 (najniżej w PL),
  formaty 3,5, brak paywalla i konta.

## K.2.4 Werdykt PL i co musiałoby się stać

**NES bije każdy polski think-tank we WSZYSTKICH 11 modułach obserwowalnych — po naprawach 01–03.08
przewagi jeszcze urosły** (M5 +4,0→+4,3; M7 +4,0→+4,6; M14 +3,8→+4,2). Liga PL to statyczne WordPressy
(agregat-11: 2,0–2,5). **Żaden** nie ma: paywalla klasy produkcyjnej, wyszukiwarki ponad podstawową,
profilu czytelnika, sieci, czatu, A/B, alertów. **To nie jest ta sama kategoria produktu.**

Jedyne pole, gdzie liga PL jest realnie blisko: **wielojęzyczność** (PISM/OSW 7,0 vs NES 9,0) — i jedyne,
gdzie luka NES jest mała: **mechanika czytania** (OSW 5,0 vs NES 6,5).

**Co musiałoby się stać, żeby ktokolwiek z PL zbliżył się do NES:** przejście z WordPressa na platformę
z kontem użytkownika i bramką treści (rok pracy studia), zbudowanie wyszukiwarki z fasetami (kwartał),
oraz zespół utrzymania. Prawdopodobieństwo w horyzoncie 12 miesięcy: **niskie**; najbardziej motywowani
są NK i KJ (mają już model płatny), najmniej PISM/OSW (finansowanie publiczne bez presji konwersji).

---

# K.3 UNIA EUROPEJSKA / EUROPA ZACHODNIA — 6 podmiotów

Roster: **ECFR**, **Bruegel**, **Chatham House (CH)**, **RUSI**, **CEPS**, **SWP**.
(IFRI / Clingendael cyfrowo ≈ SWP.)

## K.3.1 Macierz: 11 modułów × 6 podmiotów

| Moduł | **NES** | ECFR | Bruegel | CH | RUSI | CEPS | SWP | najlepszy UE | **Δ NES** |
| ----- | :-----: | :--: | :-----: | :-: | :--: | :--: | :-: | :----------: | :-------: |
| M1 Czytelnik | **8,4** | 6,5 | 6,5 | 6,0 | 5,5 | 5,0 | 5,0 | ECFR/Bruegel 6,5 | **+1,9** |
| M5 Strona gł. / archiwa | **8,3** | 6,0 | 6,0 | 5,0 | 5,0 | 4,5 | 4,5 | ECFR/Bruegel 6,0 | **+2,3** |
| M6 Wyszukiwarka | **8,3** | 3,8 | 3,7 | 3,3 | 3,0 | 3,0 | 3,1 | ECFR 3,8 | **+4,5** |
| M7 Typy specjalne | **7,6** | 5,0 | 5,0 | 4,0 | 4,0 | 3,5 | 3,0 | ECFR/Bruegel 5,0 | **+2,6** |
| M8 SEO / feedy | **7,8** | 6,0 | 6,0 | 5,5 | 5,0 | 5,0 | 5,0 | ECFR/Bruegel 6,0 | **+1,8** |
| M9 Czat | **8,1** | 0 | 0 | 0 | 0 | 0 | 0 | **brak** | **kategorialna** |
| M10 Sieć | **8,1** | 1,0 | 1,0 | 1,0 | 1,0 | 0,5 | 0,5 | 1,0 | **+7,1** |
| M11 Newsletter | **7,5** | 4,0 | 3,5 | 3,5 | 3,5 | 3,0 | 3,0 | ECFR 4,0 | **+3,5** |
| M13 Paywall | **8,5** | 1,0 | 2,0 | **5,5** | **6,0** | 2,5 | 1,0 | RUSI 6,0 | **+2,5** |
| M14 Konwersja | **7,7** | 4,0 | 4,0 | **6,0** | **6,0** | 4,0 | 2,0 | CH/RUSI 6,0 | **+1,7** |
| M15 Profil | **8,0** | 3,8 | 3,7 | 3,7 | 3,5 | 3,2 | 3,3 | ECFR 3,8 | **+4,2** |
| **Agregat-11** | **8,0** | **3,7** | **3,8** | **4,0** | **3,9** | **3,1** | **2,8** | CH 4,0 | **+4,0** |
| Agregat-5 (07-20) | 8,0 | 3,6 | 3,5 | 3,6 | 3,4 | 2,9 | 2,8 | ECFR/CH 3,6 | +4,4 |

## K.3.2 Rozbicie kryterialne — dwa bieguny ligi UE

Liga UE ma **dwa różne profile siły**: „treść + microsites" (ECFR/Bruegel) i „członkostwo + konwersja"
(CH/RUSI). Rozbicie pokazuje to wprost:

| Kryterium | **NES 03.08** | ECFR | Bruegel | CH | RUSI | CEPS | SWP |
| --------- | :-----------: | :--: | :-----: | :-: | :--: | :--: | :-: |
| Microsites / dorobek interaktywny | **7,0** | **7,0** | 6,5 | 4,0 | 4,0 | 3,0 | 2,5 |
| Huby tematyczne | 8,0 | **6,5** | 6,0 | 5,5 | 5,0 | 4,5 | 4,5 |
| Str. ekspertów | 9,0 | **7,5** | 7,0 | 6,5 | 6,0 | 5,5 | 5,5 |
| Katalog ekspertów | 8,0 | **6,5** | 6,0 | 5,5 | 5,0 | 5,0 | 5,0 |
| Paywall | 9,0 | 1,0 | 2,0 | 5,5 | **6,0** | 2,5 | 1,0 |
| Landingi konwersji | 7,0 | 4,0 | 4,0 | **6,0** | **6,0** | 4,0 | 2,0 |
| Społeczność członkowska | 8,0 | 2,0 | 2,5 | **4,5** | **4,5** | 2,5 | 1,5 |
| Q&A / wydarzenia interaktywne | **7,5** | 4,0 | 4,0 | **4,5** | 4,0 | 3,5 | 2,5 |
| Trafność wyszukiwania | 8,0 | 5,0 | **5,5** | 5,0 | 4,5 | 4,5 | 4,5 |
| Fasety | 8,0 | **5,5** | **5,5** | 4,5 | 4,0 | 4,0 | 4,5 |
| Alerty | **6,5** | 1,5 | 1,5 | 1,5 | 1,5 | 1,5 | 1,5 |
| Prywatność / RODO (CMP) | 9,0 | 5,0 | 5,0 | 5,0 | 5,0 | 5,0 | **5,5** |
| Języki | 9,0 | 5,0 | 3,0 | 3,0 | 2,5 | 3,0 | **6,0** |
| Wydajność techniczna | **7,5** | 5,5 | 6,0 | 5,0 | 4,5 | 4,5 | 4,5 |
| Prof. czytelnika | 8,0 | 1,0 | 1,0 | 2,0 | 2,0 | 1,0 | 1,0 |
| Czat / networking | 8,5 / 8,0 | 0 / 1,0 | 0 / 1,0 | 0 / 1,0 | 0 / 1,0 | 0 / 0,5 | 0 / 0,5 |

**Trzy obserwacje z rozbicia:**
1. **ECFR remisuje z NES w microsites (7,0 : 7,0)** — po tym, jak NES podniósł to kryterium (SSR trackera,
   eksplorator, feed zmian, live blog). To jedyny remis NES z podmiotem europejskim.
2. **CH/RUSI mają realną społeczność członkowską (4,5)** — jedyne w UE. To nie jest platforma społecznościowa
   (czat 0, networking 1,0), lecz **model członkostwa z portalem** (eLibrary, magazyn, dostęp do journala) [1].
3. **SWP wygrywa z NES w jednym kryterium ligi UE: prywatność/CMP (5,5 vs… NES 9,0)** — nie wygrywa;
   to najlepszy wynik w UE, wciąż −3,5. **W żadnym kryterium żaden podmiot UE nie bije NES.**

## K.3.3 Profile — co konkretnie mają

- **Chatham House (4,0 — najlepszy w UE).** Najsilniejszy model **członkowski** w europejskim think-tanku:
  członkostwo indywidualne i korporacyjne, eLibrary, cztery drukowane wydania „The World Today" (bieżący
  numer open access, archiwum dla członków), dostęp do „International Affairs" [1]. Do tego reguła Chatham
  House jako produkt eventowy. Cyfrowo: archiwa 5,0, wyszukiwarka 3,3, brak konta czytelnika w sensie
  produktowym (2,0).
- **RUSI (3,9).** **Najwyższy paywall w UE (6,0)** i równa CH konwersja (6,0) — członkostwo + journale
  (RUSI Journal, Newsbrief). Reszta platformy słabsza od ECFR/Bruegel (strona główna 5,0, formaty 5,5).
- **ECFR (3,7).** **Najlepszy „front" w UE**: strony ekspertów 7,5 (najwyżej w Europie), katalog 6,5,
  najlepsze microsites w UE (7,0 — interaktywne raporty i eksploratory koalicji), najlepszy newsletter (4,0),
  najlepsza wyszukiwarka (3,8). Zero monetyzacji (1,0).
- **Bruegel (3,8).** Profil „danych ekonomicznych": zestawy danych i wykresy do pobrania, blogi, podcast;
  microsites 6,5, trafność wyszukiwania najlepsza w UE (5,5). Paywall szczątkowy (2,0).
- **CEPS (3,1).** Repozytorium publikacji z przyzwoitym SEO (5,0) i słabą resztą; częściowa bramka (2,5).
- **SWP (2,8 — najsłabszy w UE).** Instytucjonalne repozytorium: najlepsza w UE wielojęzyczność (6,0)
  i CMP (5,5), ale konwersja 2,0, microsites 2,5, brak paywalla.

## K.3.4 Werdykt UE i realny wektor zagrożenia

**NES prowadzi we wszystkich 11 modułach**, ale margines jest **najcieńszy właśnie w UE**: M14 konwersja
**+1,7** i M8 SEO **+1,8**, M1 czytanie **+1,9**. To jedyna liga think-tankowa, w której ktoś (CH/RUSI)
robi **członkostwo jako produkt** — a tam NES wygrywa mechaniką (4 tryby bramki, per-item, prezenty,
metering, portal, faktury), nie lejkiem.

**Realny wektor zagrożenia:** ECFR/Bruegel w microsites (remis 7,0) — jeśli NES nie domknie trackera
(import EUR-Lex/OEIL, RSS, digest), remis przejdzie w porażkę, bo ich tempo produkcji interaktywnych
raportów jest wyższe (mają studia, NES ma silnik).

---

# K.4 ŚWIAT — THINK-TANKI USA (7 podmiotów)

Roster: **Brookings**, **CSIS**, **CFR**, **RAND**, **Carnegie Endowment**, **Atlantic Council (AC)**, **CNAS**.

## K.4.1 Macierz: 11 modułów × 7 podmiotów

| Moduł | **NES** | Brookings | CSIS | CFR | RAND | Carnegie | AC | CNAS | najlepszy USA | **Δ NES** |
| ----- | :-----: | :-------: | :--: | :-: | :--: | :------: | :-: | :--: | :-----------: | :-------: |
| M1 Czytelnik | **8,4** | 7,0 | 7,0 | **7,5** | 6,5 | 7,0 | 6,5 | 6,0 | CFR 7,5 | **+0,9** |
| M5 Strona gł. / archiwa | **8,3** | 6,5 | 6,5 | **7,0** | 6,0 | 6,5 | 6,0 | 5,5 | CFR 7,0 | **+1,3** |
| M6 Wyszukiwarka | **8,3** | 4,6 | 4,4 | 4,3 | **5,6** | 4,1 | 3,9 | 3,5 | RAND 5,6 | **+2,7** |
| M7 Typy specjalne | **7,6** | 5,5 | **7,0** | 6,5 | 5,0 | 5,0 | 6,0 | 4,0 | CSIS 7,0 | **+0,6** |
| M8 SEO / feedy | **7,8** | **7,5** | 7,0 | **7,5** | **7,5** | 7,0 | 6,5 | 6,0 | 7,5 | **+0,3** |
| M9 Czat | **8,1** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **brak** | **kategorialna** |
| M10 Sieć | **8,1** | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | **+7,1** |
| M11 Newsletter | **7,5** | 5,0 | 5,0 | 5,0 | 4,5 | 4,5 | 4,5 | 4,0 | 5,0 | **+2,5** |
| M13 Paywall | **8,5** | 1,5 | 1,5 | 2,0 | 1,5 | 1,0 | 1,5 | 1,5 | CFR 2,0 | **+6,5** |
| M14 Konwersja | **7,7** | 5,0 | 5,0 | 4,5 | 4,5 | 4,5 | 4,5 | 4,0 | 5,0 | **+2,7** |
| M15 Profil | **8,0** | **4,0** | 3,8 | 3,7 | 3,8 | 3,8 | 3,7 | 3,5 | Brookings 4,0 | **+4,0** |
| **Agregat-11** | **8,0** | **4,3** | **4,4** | **4,5** | **4,2** | **4,0** | **4,0** | **3,5** | CFR 4,5 | **+3,5** |
| Agregat-5 (07-20) | 8,0 | 4,0 | 4,1 | 4,1 | 4,0 | 3,8 | 3,7 | 3,2 | CSIS/CFR 4,1 | +3,9 |

## K.4.2 Rozbicie kryterialne — gdzie liga USA jest światową czołówką

| Kryterium | **NES 03.08** | Brookings | CSIS | CFR | RAND | Carnegie | AC | CNAS |
| --------- | :-----------: | :-------: | :--: | :-: | :--: | :------: | :-: | :--: |
| **Microsites / dorobek** | **7,0** | 6,0 | **9,0** | **8,0** | 5,5 | 5,5 | 7,5 | 4,5 |
| Huby tematyczne | 8,0 | 7,0 | **7,5** | 7,0 | 6,0 | 6,5 | 6,5 | 5,5 |
| **Fasety wyszukiwania** | **8,0** | 6,5 | 6,0 | 5,5 | **8,0** | 5,5 | 5,0 | 4,5 |
| Trafność wyszukiwania | 8,0 | 6,0 | 6,0 | 6,0 | **7,5** | 5,5 | 5,5 | 5,0 |
| Sugestie / autosuggest | 8,0 | 4,0 | 4,0 | 4,0 | **5,0** | 3,5 | 3,5 | 3,0 |
| Wyszukiwanie ekspertów | 8,0 | **6,5** | 6,0 | 5,5 | 6,0 | 6,0 | 5,5 | 5,0 |
| **Alerty** | **6,5** | 2,0 | 2,0 | 2,0 | **4,0** | 2,0 | 2,0 | 1,5 |
| SEO techniczne | 9,0 | **7,5** | 7,0 | **7,5** | **7,5** | 7,0 | 6,5 | 6,0 |
| Str. ekspertów | 9,0 | **8,0** | 7,5 | 7,0 | 7,0 | 7,5 | 7,0 | 6,5 |
| Kanały (newslettery) | 8,0 | **5,0** | **5,0** | **5,0** | 4,5 | 4,5 | 4,5 | 4,0 |
| Q&A / wydarzenia | **7,5** | 4,0 | **4,5** | **4,5** | 3,0 | 4,0 | 4,0 | 3,0 |
| Live / formaty newsowe | 7,0 | 3,5 | **4,0** | 3,5 | 2,5 | 3,0 | 3,5 | 2,5 |
| Personalizacja | 8,0 | **2,5** | 2,0 | **2,5** | 2,0 | 2,0 | 2,0 | 1,5 |
| Audio | 9,0 | 2,5 | **2,5** | **2,5** | 2,0 | 2,0 | 2,0 | 2,0 |
| Paywall | 9,0 | 1,5 | 1,5 | **2,0** | 1,5 | 1,0 | 1,5 | 1,5 |
| Builder self-service | 9,5 | 3,0 | 3,0 | 3,0 | 3,0 | 3,0 | 3,0 | 2,5 |
| A/B | 9,0 | 2,0 | 2,0 | 2,0 | 2,0 | 2,0 | 2,0 | 1,5 |
| Prof. czytelnika | 8,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 |

## K.4.3 Profile — co konkretnie mają

- **CFR (4,5 — najlepszy TT świata w agregacie-11).** Najlepsza w lidze mechanika czytania (7,5) i archiwa
  (7,0), trackery i przewodniki tematyczne klasy światowej (microsites 8,0 — Global Conflict Tracker,
  InfoGuides), najwyższy paywall wśród TT (2,0 — czyli **żaden**). Profil czytelnika 3,7.
- **CSIS (4,4).** **Microsites 9,0 — jedyny think-tank, który w kryterium dorobku interaktywnego bije NES
  o 2,0** (ChinaPower, Missile Threat i pokrewne to referencyjne produkty sektora). Do tego najlepsze huby
  (7,5) i najlepsze w lidze Q&A/wydarzenia (4,5). Wyszukiwarka 4,4, paywall 1,5.
- **Brookings (4,3).** Najlepsze strony ekspertów w całym zestawieniu poza NES (8,0), najlepsze wyszukiwanie
  ekspertów (6,5), SEO 7,5, profil czytelnika 4,0 (najwyżej w TT). Microsites 6,0.
- **RAND (4,2).** **Najlepsza wyszukiwarka think-tankowa świata (5,6) — remis z NES w fasetach (8,0 : 8,0)**
  i jedyny TT z realnymi alertami (4,0). Baza badań to de facto biblioteka cyfrowa. Reszta średnia.
- **Carnegie (4,0).** Sieć globalnych centrów + najlepsza w lidze USA wielojęzyczność (6,0). Cyfrowo równy AC.
- **Atlantic Council (4,0).** Mocne microsites (7,5 — trackery i „issue hubs"), słabsza wyszukiwarka (3,9).
- **CNAS (3,5).** Najmniejszy cyfrowo z siódemki: microsites 4,5, wyszukiwarka 3,5.

## K.4.4 Werdykt USA

**Po naprawach 01–03.08 NES nie przegrywa żadnego modułu z żadnym think-tankiem USA, a remis z CSIS
w typach specjalnych zamienił się w przewagę +0,6** (NES 7,0→7,6 dzięki SSR trackera, SSR eventów/ankiet/
biblioteki i publicznemu indeksowi live). Uwaga: **na poziomie kryterium** CSIS nadal bije NES w
microsites (9,0 : 7,0) — moduł wygrywa szerokość (waitlist, ICS, Q&A, ankiety, biblioteka, glosariusz),
nie flagowy interaktywny produkt.

**Najcieńsze marginesy:** SEO **+0,3** (Brookings/CFR/RAND 7,5), typy specjalne **+0,6**, czytanie **+0,9**.
**Największe:** paywall **+6,5**, sieć **+7,1**, czat kategorialnie.

**Kluczowe bez zmian:** oni budują to **studiami deweloperów**, nie self-service (builder 3,0 vs 9,5;
A/B 2,0 vs 9,0), a paywall (≤2,0), sieć (1,0), czat (0) i profil czytelnika (≤4,0) mają śladowe.

---

# K.5 ŚWIAT — MEDIA GLOBALNE (7 podmiotów)

Roster (serwisy publiczne): **FT**, **Bloomberg.com**, **Reuters**, **The Economist**, **Politico (.eu/.com)**,
**Axios**, **Euractiv**. Wykluczone platformy osobne: **Politico PRO, Bloomberg Terminal/BGOV/Law,
Reuters Eikon/Connect, Axios Pro, Euractiv Pro** — inna kategoria produktu i cennika.

## K.5.1 Macierz: 11 modułów × 7 podmiotów

| Moduł | **NES** | FT | Bloomberg | Reuters | Economist | Politico | Axios | Euractiv | najlepsze medium | **Δ NES** |
| ----- | :-----: | :-: | :-------: | :-----: | :-------: | :------: | :---: | :------: | :--------------: | :-------: |
| M1 Czytelnik | **8,4** | **9,0** | **9,0** | 8,0 | 8,5 | 7,0 | 7,5 | 5,5 | FT/Bloomberg 9,0 | **−0,6** |
| M5 Strona gł. / archiwa | **8,3** | 7,0 | 7,5 | 7,0 | 6,5 | 6,5 | 6,0 | 5,0 | Bloomberg 7,5 | **+0,8** |
| M6 Wyszukiwarka | **8,3** | 4,8 | 4,0 | 3,6 | 3,6 | 3,4 | 2,8 | 2,7 | FT 4,8 | **+3,5** |
| M7 Typy specjalne | **7,6** | 8,0 | **9,0** | 8,5 | 6,0 | 7,5 | 5,5 | 4,5 | Bloomberg 9,0 | **−1,4** |
| M8 SEO / feedy | **7,8** | 8,5 | 8,5 | **9,0** | 8,0 | 8,5 | 7,5 | 7,0 | Reuters 9,0 | **−1,2** |
| M9 Czat | **8,1** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **brak** | **kategorialna** |
| M10 Sieć | **8,1** | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | **+7,1** |
| M11 Newsletter | **7,5** | **8,0** | **8,0** | 7,5 | 7,5 | **8,0** | 7,5 | 6,0 | FT/BB/Politico 8,0 | **−0,5** |
| M13 Paywall | **8,5** | **9,0** | 8,0 | 7,0 | 8,5 | 4,0 | 3,0 | 4,5 | FT 9,0 | **−0,5** |
| M14 Konwersja | **7,7** | **8,5** | 8,0 | 7,0 | 8,0 | 5,5 | 5,0 | 4,5 | FT 8,5 | **−0,8** |
| M15 Profil | **8,0** | 3,7 | 3,2 | 3,2 | 2,7 | 3,2 | 2,9 | 2,8 | FT 3,7 | **+4,3** |
| **Agregat-11** | **8,0** | **6,1** | **6,0** | **5,6** | **5,5** | **5,0** | **4,4** | **4,0** | FT 6,1 | **+1,9** |
| Agregat-5 (07-20) | 8,0 | 5,5 | 4,9 | 4,7 | 4,4 | 4,2 | 3,6 | 3,3 | FT 5,5 | +2,5 |

## K.5.2 Rozbicie kryterialne — dokładnie tam, gdzie NES przegrywa

| Kryterium | **NES 03.08** | FT | Bloomberg | Reuters | Economist | Politico | Axios | Euractiv |
| --------- | :-----------: | :-: | :-------: | :-----: | :-------: | :------: | :---: | :------: |
| **Czytanie artykułu** | **6,5** | **9,0** | **9,0** | **8,0** | **8,5** | **7,0** | **7,5** | 5,5 |
| **Live / formaty newsowe** | **7,0** | **8,0** | **8,5** | **9,5** | 4,0 | **8,0** | 5,5 | 4,0 |
| **Microsites / dorobek** | **7,0** | **8,5** | **9,5** | **8,5** | **7,5** | **7,0** | 5,0 | 3,5 |
| **Landingi konwersji** | **7,0** | **8,5** | **8,0** | **7,0** | **8,0** | 5,5 | 5,0 | 4,5 |
| **Wydajność techniczna** | **7,5** | **7,5** | **8,0** | **8,0** | **7,5** | 7,0 | 7,0 | 5,0 |
| Personalizacja | 8,0 | **9,0** | 5,5 | 6,0 | 4,5 | 4,5 | 3,5 | 2,5 |
| Paywall | 9,0 | **9,0** | 8,0 | 7,0 | 8,5 | 4,0 | 3,0 | 4,5 |
| Audio | 9,0 | 6,5 | 7,0 | 3,0 | **9,0** | 2,5 | 2,0 | 2,0 |
| Kanały (newslettery) | 8,0 | **8,0** | **8,0** | 7,5 | 7,5 | **8,0** | 7,5 | 6,0 |
| Komentarze | 7,0 | **7,0** | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 |
| Alerty | **6,5** | **6,0** | 3,0 | 2,5 | 2,5 | 2,5 | 2,0 | 2,0 |
| SEO techniczne | 9,0 | 8,5 | 8,5 | **9,0** | 8,0 | 8,5 | 7,5 | 7,0 |
| Formaty (szerokość) | 9,0 | 7,5 | 8,5 | 8,0 | 7,0 | 7,5 | 6,0 | 5,5 |
| Języki | 9,0 | 4,0 | 5,0 | **8,0** | 2,5 | 4,5 | 2,0 | 7,0 |
| Fasety | 8,0 | 5,5 | 5,5 | 5,0 | 5,0 | 4,5 | 3,5 | 3,5 |
| Prof. czytelnika | 8,0 | 4,0 | 3,0 | 3,0 | 3,0 | 2,5 | 2,0 | 2,0 |
| Networking | 8,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 | 1,0 |
| Czat | 8,5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Builder self-service | 9,5 | 3,0 | 3,0 | 3,0 | 3,0 | 3,0 | 3,0 | 2,5 |

## K.5.3 Profile — co konkretnie mają

- **FT (6,1 — jedyny realny rywal platformowy).** Jedyny podmiot w stawce, który łączy **wszystkie** warstwy
  wydawnicze: czytanie 9,0, paywall 9,0 (metered + korporacyjny), personalizacja 9,0 (myFT — obserwowanie
  tematów/autorów z alertami, jedyny produkt alertowy w mediach: 6,0), żywa kultura komentarzy (7,0 — remis
  z NES, unikat w mediach), newslettery 8,0, lejek subskrypcyjny po dekadzie optymalizacji (8,5).
  **Słabości wobec NES:** wyszukiwarka 4,8, profil czytelnika 3,7, networking 1,0, czat 0, dwujęzyczność 4,0.
- **Bloomberg.com (6,0).** **Bloomberg Graphics = światowy benchmark storytellingu (microsites 9,5)**,
  najlepsze czytanie razem z FT (9,0), najlepsze archiwa/chrome w mediach (7,5), audio 7,0. Wyszukiwarka 4,0.
- **Reuters (5,6).** **Najlepszy live w stawce (9,5 — rdzeń agencyjny) i najlepsze SEO (9,0)**, najszersza
  skala językowa (8,0 jako sieć edycji). Paywall 7,0. Wyszukiwarka 3,6.
- **The Economist (5,5).** **Audio 9,0 — pełne wydanie audio, jedyny remis z TTS NES**; paywall 8,5,
  landingi 8,0. Celowa anonimowość autorów obniża profile (2,7). Live 4,0.
- **Politico (5,0).** Newslettery jako rdzeń produktu (8,0 — warsztat Playbooka to wzorzec sektorowy),
  live 8,0, microsites 7,0. Serwis publiczny bez mocnego paywalla (4,0 — realny produkt jest w PRO,
  wykluczonym z porównania).
- **Axios (4,4).** Smart Brevity jako format czytania (7,5) i mocne newslettery (7,5); reszta platformy słabsza
  (wyszukiwarka 2,8 — najniżej w mediach po Euractivie).
- **Euractiv (4,0).** Najbliższy tematycznie NES (Bruksela) i drugi po Reutersie w wielojęzyczności (7,0),
  ale najsłabszy cyfrowo z mediów: czytanie 5,5, microsites 3,5, wyszukiwarka 2,7.

## K.5.4 Werdykt media — gdzie NES realnie przegrywa (i o ile)

**Media pozostają jedynymi realnymi rywalami NES.** Lista przegranych modułów **skróciła się z 6 do 5**,
a marginesy stopniały:

| Przegrany moduł | 30.07 | 01.08 | **03.08** | Kto | Dlaczego wciąż przegrywamy |
| --------------- | :---: | :---: | :-------: | --- | -------------------------- |
| M7 Typy specjalne | −2,5 | −2,0 | **−1,4** | Bloomberg 9,0 | brak flagowego interaktywnego produktu; tracker bez importu/RSS |
| M8 SEO / feedy | −1,5 | −1,5 | **−1,2** | Reuters 9,0 | sitemap jednoplikowa, news-sitemap nieodkrywalny, brak prerenderu |
| M14 Konwersja | −1,5 | −1,2 | **−0,8** | FT 8,5 | brak checkoutu bez wybicia do `/profile/billing`, capping popupów w localStorage |
| M1 Czytelnik | −1,2 | −0,8 | **−0,6** | FT/Bloomberg 9,0 | mechanika czytania (typografia/tempo) to dystans szlifu |
| M11 Newsletter | −0,5 | −0,5 | **−0,5** | FT/BB/Politico 8,0 | open/click zawyżone (podwójny zapis), segmentacja nie self-service |
| M13 Paywall | −0,6 | −0,7 | **−0,5** | FT 9,0 | dekada optymalizacji lejka; NES nadrabia elastycznością (per-item, prezenty, dożywotni) |

**Ale:** media mają **wyszukiwarkę o połowę słabszą** (max FT 4,8 vs 8,3), **profil czytelnika szczątkowy**
(max FT 3,7 vs 8,0), a **czat i sieć zerowe**. To firmy z setkami inżynierów robiące jedną rzecz świetnie —
NES robi 20 rzeczy w jednym systemie.

**Jedna korekta na niekorzyść NES:** kryterium „wydajność techniczna" obniżam **9,0 → 7,5** z powodu
regresu bundla (1,76 MB gzip JS dla czytelnika). To **pierwszy raz, gdy media dorównują lub wyprzedzają
NES w warstwie technicznej** (Bloomberg/Reuters 8,0, FT/Economist 7,5). SSR jest mocny, ładunek klienta nie.

---

# K.6 ŚWIAT — AZJA I ROSJA (11 podmiotów)

Roster: **Rosja (4):** Klub Wałdajski, RIAC, IMEMO, Russia in Global Affairs (SVOP).
**Chiny (4):** CICIR, CIIS, SIIS, CCG. **Japonia (5):** JIIA, Sasakawa PF (SPF), RIETI, NIDS, Genron NPO.

| Podmiot | Region | M1 czyt. | M6 szuk. | M7 typy | M8 SEO | M13 paywall | M15 profil | Agregat-5 (07-20) | Δ NES (agregat-5) |
| ------- | ------ | :------: | :------: | :-----: | :----: | :---------: | :--------: | :---------------: | :---------------: |
| Klub Wałdajski | Rosja | 5,5 | 2,9 | 4,0 | 4,0 | 1,0 | 2,7 | **2,8** | −5,2 |
| RIAC | Rosja | 4,5 | 3,3 | 3,5 | 4,0 | 1,0 | 3,2 | **2,9** | −5,1 |
| Russia in Global Aff. | Rosja | 4,5 | 2,1 | 2,0 | 3,5 | 1,5 | 1,9 | **2,1** | −5,9 |
| IMEMO | Rosja | 3,0 | 2,0 | 2,0 | 3,0 | 1,0 | 2,1 | **1,9** | −6,1 |
| CCG | Chiny | 3,5 | 1,8 | 2,5 | 2,5 | 1,0 | 1,8 | **2,0** | −6,0 |
| CICIR / CIIS / SIIS | Chiny | 2,5 | 1,7 | 2,0 | 2,0 | 1,0 | 1,6 | **1,7** | −6,3 |
| SPF (Sasakawa) | Japonia | 4,5 | 2,2 | 3,0 | 4,0 | 1,0 | 2,2 | **2,3** | −5,7 |
| RIETI | Japonia | 4,0 | 3,0 | 3,0 | 4,5 | 1,0 | 2,3 | **2,4** | −5,6 |
| Genron NPO | Japonia | 3,5 | 1,6 | 3,0 | 3,0 | 1,0 | 1,8 | **2,1** | −5,9 |
| JIIA | Japonia | 3,5 | 1,8 | 2,0 | 3,5 | 1,0 | 1,9 | **1,9** | −6,1 |
| NIDS | Japonia | 3,0 | 1,6 | 2,0 | 3,0 | 1,0 | 1,7 | **1,7** | −6,3 |

Pozostałe moduły dla całej grupy: **M9 czat = 0 · M10 sieć ≈ 0,5 · M5/M11/M14 = niskie (2–4)** ·
9 modułów wewnętrznych = b/d. (Dla tej grupy korpus 07-24 nie podaje wartości per podmiot dla M5/M11/M14,
dlatego agregat-11 **nie jest** wyliczany — nie zgaduję brakujących pól.)

**Rozbicie kryterialne — jedyne pole realnej siły: języki.**

| Kryterium | NES | Wałdaj | RIAC | RGA | IMEMO | SPF | RIETI | JIIA | NIDS | Genron | CCG | CICIR/CIIS/SIIS |
| --------- | :-: | :----: | :--: | :-: | :---: | :-: | :---: | :--: | :--: | :----: | :-: | :-------------: |
| **Języki** | 9,0 | **7,5** | **7,0** | **6,5** | 5,5 | 6,0 | 6,0 | 5,5 | 5,5 | 5,5 | 5,0 | 3,5–4,0 |
| Katalog ekspertów | 8,0 | 5,0 | **6,0** | 3,0 | 4,0 | 3,0 | 3,5 | 2,5 | 2,0 | 2,0 | 3,0 | 2,5 |
| Prywatność / CMP | 9,0 | 2,0 | 2,0 | 1,5 | 1,5 | 3,0 | 3,0 | 2,5 | 2,5 | 2,5 | 1,0 | 1,0 |
| Q&A / wydarzenia | 7,5 | 3,0 | 3,0 | 2,0 | 2,0 | 2,5 | 2,0 | 2,0 | 1,5 | **4,5** | 2,5 | 1,5 |
| Kanały | 8,0 | 2,5 | 2,5 | 2,0 | 1,5 | 2,5 | 2,5 | 2,0 | 1,5 | 2,5 | **4,0** | 3,0 |

**Werdykt Azja/Rosja.** Cyfrowo najsłabsza część stawki (agregat-5: 1,7–2,9). Jedyny obszar zbliżający się
do NES to **wielojęzyczność** (Wałdaj 7,5, RIAC/RGA 6,5–7,0 — pełne lustra językowe vs NES 9,0). Poza tym:
zero monetyzacji (paywall ≤1,5 u wszystkich 11), brak wyszukiwarki ponad podstawową, brak społeczności
i profilu. **Chińskie TT prowadzą społeczności w grupach WeChat — poza własnymi platformami**, więc
w serwisie są niewidoczne (odzwierciedlone tylko podniesionym „kanałem" CCG 4,0). Genron NPO wyróżnia się
formatem debat/ankiet opinii (Q&A/wydarzenia 4,5 — najwyżej w grupie).

---

# K.7 TEST KATEGORII — 14 zdolności obserwowalnych × 38 konkurentów

Zamiast średnich: **binarne pytanie „czy ta zdolność w ogóle istnieje?"**. Kolumna „podstawa" mówi, z jakiego
kryterium korpusu 07-20 wynika odpowiedź i przy jakim progu (żeby dało się to zweryfikować, a nie tylko przyjąć).

| # | Zdolność | NES | Ilu z 38 ma | Kto (imiennie) | Podstawa (kryterium ≥ próg) |
| - | -------- | :-: | :---------: | -------------- | -------------------------- |
| 1 | **Czat 1:1 / grupowy na platformie** | ✅ | **0** | nikt | czat = 0,0 u wszystkich 38 |
| 2 | **Sieć / networking z rekomendacjami** | ✅ | **0** | nikt (wszyscy delegują do LinkedIna) | networking ≤1,0 u wszystkich |
| 3 | **Profil czytelnika jako produkt** | ✅ | **1** | FT (myFT 4,0) — reszta ≤3,0 | prof. czytelnika ≥4,0 |
| 4 | **Alerty zapisanych wyszukiwań** | ✅ | **1** | FT (6,0); RAND 4,0 = graniczne | alerty ≥5,0 |
| 5 | **Fasety wyszukiwania klasy produkcyjnej** | ✅ | **3** | RAND 8,0, Brookings 6,5, CSIS 6,0 | fasety ≥6,0 |
| 6 | **Paywall / bramka treści** | ✅ | **9** | FT 9,0, Economist 8,5, Bloomberg 8,0, Reuters 7,0, RUSI 6,0, CH 5,5, Euractiv 4,5, NK 4,0, Politico 4,0 | paywall ≥4,0 |
| 7 | **Elastyczna monetyzacja per-item / prezent / dożywotni** | ✅ | **0** (obserwowalnie w serwisach publicznych) | — | brak w korpusie; **nieweryfikowane na żywo w tym wydaniu** |
| 8 | **Dwujęzyczne lustro treści** | ✅ | **7** | Reuters 8,0, Wałdaj 7,5, PISM/OSW/RIAC/Euractiv 7,0, RGA 6,5 | języki ≥6,5 |
| 9 | **Interaktywne microsites / trackery** | ✅ | **9** | Bloomberg 9,5, CSIS 9,0, FT/Reuters 8,5, CFR 8,0, AC 7,5, Economist 7,5, ECFR/Politico 7,0 | microsites ≥7,0 |
| 10 | **Live / relacje newsowe** | ✅ | **4** | Reuters 9,5, Bloomberg 8,5, FT/Politico 8,0 | live ≥8,0 |
| 11 | **Audio treści (TTS lub wydanie audio)** | ✅ | **2** | Economist 9,0 (remis), Bloomberg 7,0 | audio ≥7,0 |
| 12 | **Żywa kultura komentarzy** | ✅ | **1** | FT 7,0 (remis) — u pozostałych 1,0–2,5 | komentarze ≥5,0 |
| 13 | **Społeczność członkowska online** | ✅ | **2** | Chatham House 4,5, RUSI 4,5 | społeczność ≥4,0 |
| 14 | **Builder stron self-service / A/B poza mediami** | ✅ | **0** | nikt (max 3,0 / TT ≤2,0) | builder ≥6,0 |

**Czytanie tej tabeli:** w 6 z 14 zdolności NES jest **sam** (czat, sieć, per-item, builder, plus praktycznie
sam w alertach i profilu czytelnika). W 4 (paywall, microsites, live, audio) gra w tłumie mediów i najlepszych
TT. Zdolności 9–12 to **dokładnie ta część stawki, w której NES nie dominuje** — i pokrywa się to 1:1
z listą przegranych modułów z K.5.4.

---

# K.8 KTO BIJE NES I W CZYM — lista na poziomie kryteriów (stan 03.08)

Na 38 konkurentów × 31 kryteriów NES przegrywa lub remisuje **wyłącznie** poniżej. Wobec 07-20 lista
**skróciła się o 1 pozycję** (alerty FT — NES wyszedł na prowadzenie) i **wydłużyła o 1** (wydajność
techniczna — regres wewnętrzny). Trzy remisy (Economist audio, RAND fasety, FT komentarze/paywall/newslettery)
utrzymane.

| Konkurent | Kryterium | Wynik vs NES | Zmiana od 07-20 | Komentarz |
| --------- | --------- | :----------: | --------------- | --------- |
| Bloomberg / FT | Czytanie artykułu | 9,0 : 6,5 | bez zmian | najlepsza typografia i tempo w stawce |
| The Economist | Czytanie artykułu | 8,5 : 6,5 | bez zmian | — |
| Reuters | Czytanie artykułu | 8,0 : 6,5 | bez zmian | — |
| Axios / Politico / CSIS / Brookings / Carnegie / CFR | Czytanie | 7,0–7,5 : 6,5 | bez zmian | przewaga niewielka, ale realna |
| Reuters | Live / formaty newsowe | 9,5 : 7,0 | bez zmian | rdzeń agencyjny — świadomie poza modelem NES |
| Bloomberg / FT / Politico | Live | 8,0–8,5 : 7,0 | bez zmian | — |
| Bloomberg.com | Microsites / dorobek | 9,5 : **7,0** | **luka −3,0 → −2,5** | Bloomberg Graphics |
| CSIS | Microsites / dorobek | 9,0 : **7,0** | **−2,5 → −2,0** | ChinaPower, Missile Threat |
| Reuters / FT | Microsites | 8,5 : **7,0** | **−2,0 → −1,5** | zespoły graphics |
| CFR | Microsites | 8,0 : **7,0** | **−1,5 → −1,0** | Global Conflict Tracker, InfoGuides |
| AC / Economist / Politico / ECFR | Microsites | 7,0–7,5 : **7,0** | **porażka → remis/−0,5** | ECFR = **remis 7,0** |
| FT | Personalizacja | 9,0 : 8,0 | bez zmian | myFT |
| The Economist | Audio | 9,0 : 9,0 | bez zmian | remis: pełne wydanie audio vs TTS per artykuł |
| FT / Bloomberg / Economist | Landingi konwersji | 8,0–8,5 : 7,0 | bez zmian | dekada optymalizacji lejków |
| RAND | Fasety wyszukiwania | 8,0 : 8,0 | **remis utrzymany** | jedyny TT na tym poziomie |
| FT | Komentarze | 7,0 : 7,0 | bez zmian | remis |
| Politico / FT / Bloomberg | Kanały (newslettery) | 8,0 : 8,0 | bez zmian | remis; warsztat newsletterowy = benchmark |
| FT | Paywall | 9,0 : 9,0 | bez zmian | remis; inny model (metered vs elastyczny per-item) |
| **Bloomberg / Reuters** | **Wydajność techniczna** | **8,0 : 7,5** | **NOWE — regres NES** | bundle 1,76 MB gzip dla czytelnika |
| **FT / Economist** | **Wydajność techniczna** | **7,5 : 7,5** | **NOWE — remis** | j.w. |
| ~~FT~~ | ~~Alerty wyszukiwania~~ | ~~6,0 : 5,0~~ → **6,0 : 6,5** | **NES wyszedł na prowadzenie** | fan-out obserwacji trackera + cron zapisanych wyszukiwań + push; **zastrzeżenie: brak testu integracyjnego** |

**Wszystko pozostałe — 31 kryteriów × 38 konkurentów — NES wygrywa.** W szczególności: **żaden konkurent
nie bije NES w ani jednym kryterium modułów czatu i profili**; w wyszukiwarce nie bije go już nikt
(remis z RAND w fasetach); cała przewaga konkurencji koncentruje się w **czterech** obszarach:
**czytanie, live, dorobek interaktywny, wydajność ładunku klienta** — plus punktowo personalizacja FT.

---

# K.9 RANKING WSZYSTKICH 38 (agregat 11 modułów obserwowalnych) + delta do NES

| # | Podmiot | Typ | Agregat-11 | Δ do NES | Agregat-5 (07-20) | Najmniejsza luka do NES |
| - | ------- | --- | :--------: | :------: | :---------------: | ----------------------- |
| — | **NES (03.08)** | platforma | **8,0** | — | 8,0 | — |
| 1 | Financial Times | media | **6,1** | −1,9 | 5,5 | paywall −0,5 · czytanie **+0,6 na korzyść FT** |
| 2 | Bloomberg.com | media | **6,0** | −2,0 | 4,9 | typy specjalne **+1,4 na korzyść BB** |
| 3 | Reuters | media | **5,6** | −2,4 | 4,7 | SEO **+1,2 na korzyść Reutersa** |
| 4 | The Economist | media | **5,5** | −2,5 | 4,4 | paywall **remis** (moduł 8,5 : 8,5) · audio remis (9,0) |
| 5 | Politico | media | **5,0** | −3,0 | 4,2 | newsletter **+0,5 na korzyść Politico** |
| 6 | CFR | TT USA | **4,5** | −3,5 | 4,1 | SEO −0,3 |
| 7 | CSIS | TT USA | **4,4** | −3,6 | 4,1 | typy specjalne −0,6 |
| 8 | Axios | media | **4,4** | −3,6 | 3,6 | SEO −0,3 |
| 9 | Brookings | TT USA | **4,3** | −3,7 | 4,0 | SEO −0,3 |
| 10 | RAND | TT USA | **4,2** | −3,8 | 4,0 | SEO −0,3 · fasety remis |
| 11 | Chatham House | TT UE | **4,0** | −4,0 | 3,6 | konwersja −1,7 |
| 12 | Carnegie Endowment | TT USA | **4,0** | −4,0 | 3,8 | SEO −0,8 |
| 13 | Atlantic Council | TT USA | **4,0** | −4,0 | 3,7 | typy specjalne −1,6 |
| 14 | Euractiv | media | **4,0** | −4,0 | 3,3 | SEO −0,8 |
| 15 | RUSI | TT UE | **3,9** | −4,1 | 3,4 | konwersja −1,7 |
| 16 | Bruegel | TT UE | **3,8** | −4,2 | 3,5 | SEO −1,8 |
| 17 | ECFR | TT UE | **3,7** | −4,3 | 3,6 | **microsites remis 7,0** |
| 18 | CNAS | TT USA | **3,5** | −4,5 | 3,2 | SEO −1,8 |
| 19 | CEPS | TT UE | **3,1** | −4,9 | 2,9 | SEO −2,8 |
| 20 | SWP | TT UE | **2,8** | −5,2 | 2,8 | SEO −2,8 |
| 21 | RIAC | TT RU | b/d¹ | — | 2,9 | języki −2,0 |
| 22 | Klub Wałdajski | TT RU | b/d¹ | — | 2,8 | języki −1,5 |
| 23 | OSW | TT PL | **2,5** | −5,5 | 2,4 | języki −2,0 |
| 24 | Nowa Konfederacja | TT PL | **2,5** | −5,5 | 2,1 | paywall −4,5 |
| 25 | Klub Jagielloński | TT PL | **2,4** | −5,6 | 2,1 | SEO −3,8 |
| 26 | RIETI | TT JP | b/d¹ | — | 2,4 | SEO −3,3 |
| 27 | PISM | TT PL | **2,3** | −5,7 | 2,3 | języki −2,0 |
| 28 | Sasakawa PF | TT JP | b/d¹ | — | 2,3 | języki −3,0 |
| 29 | Russia in Global Aff. | TT RU | b/d¹ | — | 2,1 | języki −2,5 |
| 30 | Genron NPO | TT JP | b/d¹ | — | 2,1 | Q&A/wydarzenia −3,0 |
| 31 | INE | TT PL | **2,0** | −6,0 | 1,8 | języki −3,0 |
| 32 | CCG | TT CN | b/d¹ | — | 2,0 | kanały −4,0 |
| 33 | IMEMO | TT RU | b/d¹ | — | 1,9 | języki −3,5 |
| 34 | JIIA | TT JP | b/d¹ | — | 1,9 | języki −3,5 |
| 35 | NIDS | TT JP | b/d¹ | — | 1,7 | języki −3,5 |
| 36–38 | CICIR / CIIS / SIIS | TT CN | b/d¹ | — | 1,7 | języki −5,0 |

¹ Agregat-11 nie liczony: korpus 07-24 nie podaje dla tych podmiotów wartości M5/M11/M14 per podmiot
(tylko przedział „2–4" dla grupy). Podaję agregat-5, który jest policzony w pełni.

**Trzy wnioski z rankingu:**
1. **Cała pierwsza piątka to media.** Pierwszy think-tank (CFR) jest **−3,5** za NES i **−1,6** za FT.
2. **Najmniejsze luki nie są tam, gdzie największe agregaty.** Axios (4,4) i RAND (4,2) mają luki −0,3
   w SEO/fasetach; ECFR (3,7) ma **remis** w microsites. Agregat myli — liczy się kryterium.
3. **Liga polska awansowała w agregacie-11** (2,0–2,5 vs 1,8–2,4 w agregacie-5), bo mianownik zawiera
   moduły, w których wszyscy mają zero (M9, M10) — to statystyczny artefakt, nie postęp konkurencji.

---

# K.10 SYNTEZA KONKURENCYJNA

**1. Warstwa, na której nie ma z kim się porównać (9 modułów „b/d").** Edytor z parytetem Gutenberga,
builder (101 bloków + 89 widgetów), realtime-infra, silnik workflow, analityka BI z warstwą semantyczną,
CRM z lead scoringiem i outboxem integracji, multi-tenant z zaufanym hostem, backend z 518 politykami RLS
i trzema statycznymi gate'ami SQL — **żaden z 38 konkurentów nie wystawia tego publicznie**. Dla think-tanku
posiadanie własnego CMS + membership + CRM + BI w jednym systemie jest **ewenementem sektorowym**.

**2. Gdzie NES jest bezkonkurencyjny obserwowalnie (przewagi kategorialne, nie stopniowe):**
czat (**0 u wszystkich 38**), sieć/networking (**≤1,0 u wszystkich 38**), profil czytelnika (max FT 3,7 vs 8,0),
wyszukiwarka (max RAND 5,6 / FT 4,8 vs 8,3), builder self-service i A/B poza mediami (max 3,0 / TT ≤2,0),
elastyczna monetyzacja per-item + prezenty. **Żadna z tych przewag nie ucierpiała w tym wydaniu.**

**3. Gdzie NES realnie przegrywa (stan 03.08, uczciwie):**
- **Dorobek interaktywny** — Bloomberg Graphics (9,5) i CSIS (9,0) poza zasięgiem (−2,5 / −2,0); z CFR (8,0)
  jest −1,0, z ECFR (7,0) **remis**. Utrzymanie remisu wymaga domknięcia trackera: **import EUR-Lex/OEIL,
  diff wersji, RSS, digest e-mail**.
- **Mechanika czytania** — media 8,0–9,0 vs 6,5. Dystans szlifu, nie architektury.
- **Live** — Reuters 9,5. **Świadomie poza modelem** (NES ma live blog jako format, nie jako rdzeń).
- **Wydajność ładunku klienta (NOWE)** — 1,76 MB gzip JS dla czytelnika. **Pierwsza pozycja, w której NES
  cofnął się wobec konkurencji**: Bloomberg/Reuters 8,0 vs NES 7,5. Jedyny obszar, gdzie regres jest
  wewnętrzny (re-floory budżetu), a nie wynikiem ruchu konkurencji.
- **Konwersja i newsletter** — FT −0,8 / −0,5. Dystans szlifu (dedup open/click, segmentacja self-service,
  checkout bez wybicia do `/profile/billing`).

**4. Ryzyka konkurencyjne w horyzoncie 12 miesięcy (nie oceny — ryzyka):**
- **Wysokie:** wzrost bundla dalej zjada przewagę techniczną; każdy kolejny re-floor to realna strata
  wobec mediów, które inwestują w Core Web Vitals.
- **Średnie:** ECFR/Bruegel wyprzedzają NES w microsites (mają studia i tempo publikacyjne).
- **Niskie:** ktokolwiek z lig PL/UE/Azji buduje czat, sieć albo profil czytelnika — to wymagałoby zmiany
  modelu produktu, nie projektu strony.
- **Bardzo niskie:** FT/Bloomberg budują wyszukiwarkę z fasetami klasy NES (nie mają w tym interesu —
  ich retencja stoi na newsletterach i personalizacji).

**Konkluzja.** W kategorii **think-tank** NES nie ma realnego rywala: wyprzedza całą ligę PL o kategorię
(+5,5 agregatu), UE o +4,0 (najcieńszy margines: konwersja +1,7, remis w microsites z ECFR), a najlepsze
TT USA o +3,5, **nie przegrywając już żadnego modułu z żadnym think-tankiem** (30.07: jeden, z CSIS).
Realną poprzeczką pozostają **globalne media** (FT 6,1 / Bloomberg 6,0 / Reuters 5,6): biją NES w czytaniu
(−0,6), storytellingu (−1,4), SEO (−1,2), konwersji (−0,8), newsletterze (−0,5) i paywallu (−0,5), a od
tego wydania **dorównują lub wyprzedzają w wydajności ładunku klienta** — ale warstwy
społecznościowo-sieciowo-wyszukiwarkowej nie mają wcale.

---

# BACKLOG PO TYM AUDYCIE

**P1 (jedyny otwarty punkt tej klasy — trzecie wydanie z rzędu):**
- `payment_orders.user_id ON DELETE CASCADE` → `SET NULL` + anonimizacja (art. 74 uor). Wzorzec do skopiowania
  jest w repo: `billing_documents.order_id ON DELETE SET NULL`.

**P2 — regres, który trzeba zatrzymać teraz:**
- **Bundle publiczny.** Zamrozić budżet (koniec re-floorów), rozliczyć wzrost 1472 → 1756 KB z PR #141/#132,
  wypchnąć edytor/builder/admin poza ścieżkę publiczną.
- **Lint na `main`.** 10 błędów `prettier/prettier` blokuje bramkę; przyczyna to commity pchane poza PR-ami →
  **ochrona gałęzi `main`**.

**P2 — wydmuszki, które przetrwały trzy wydania:**
- Autozapis stron (kłamliwy komentarz albo włączenie hooka).
- `BADGE_CATALOG` (6 kluczy) vs DB CHECK (4) — 3 klucze zawsze rzucają 23514; brak auto-grantu.
- Meta quizu zahardkodowane po polsku (bez `activeLang`, bez `og:url`).
- Import WP niszczący drugi język + dwa równoległe stacki.
- Dwie tabele programów (`programs` vs `research_programs`).

**P2 — inwarianty, których brakuje (klasy błędów bez gate'u):**
- **Parytet schemat⇄renderer widgetów** — jedyna realna obrona przed powrotem klasy z PR #141.
- **Unikalność wersji migracji** (2 kolizje w 2 dni).
- **UNIQUE na `newsletter_campaign_events`** + wyłączenie jednego z dwóch pisarzy open/click.
- **Wyłączenie `documentStreamGuard` w e2e** — bez tego bramka kompletności SSR nie może zafailować.

**P3 — najkrótsza droga do zamknięcia luk konkurencyjnych:**
1. **Tracker: import EUR-Lex/OEIL + diff wersji + RSS + digest** → utrzymuje remis z ECFR, atakuje CFR (−1,0).
2. **Tryb czytania (typografia/tempo)** → jedyna droga do skrócenia −0,6 wobec FT/Bloomberg.
3. **Sitemap-index + `news-sitemap` w `robots.txt` + prerender kluczowych stron** → −1,2 wobec Reutersa.
4. **Dedup open/click + segmentacja self-service** → −0,5 wobec FT/Politico.

---

*Wydanie 2026-08-03 dokumentu `OCENA_FUNKCJI_TABELE_2026-08-01.md` (tamten pozostaje nietknięty jako migawka
stanu 01.08). Oceny NES — z kodu na HEAD `c4de8a2` (testy, tsc, lint i trzy gate'y SQL uruchomione, wyniki
w tabeli sygnałów). Oceny konkurentów — przemapowanie korpusu
`OCENA_KONKURENCI_INDYWIDUALNIE_2026-07-20.md` / `OCENA_FUNKCJI_KONKURENCI_2026-07-24.md` (stan wiedzy do
poł. 2026); **w tym wydaniu nie było możliwe ponowne pobranie serwisów konkurencji** (polityka sieciowa
środowiska: HTTP 403 na wszystkie wychodzące pobrania), więc nowa jest głębokość rozbicia i przeliczenie
różnic, nie sam pomiar konkurencji. „b/d" = brak danych z zewnątrz, nie brak funkcji. **Treść artykułów —
NES i konkurencji — celowo poza zakresem oceny.***

[1] Chatham House — model członkostwa i dostępu: <https://www.chathamhouse.org/become-member/individual-membership>,
<https://www.chathamhouse.org/publications/the-world-today/subscribe> (weryfikacja 2026-08-03).
