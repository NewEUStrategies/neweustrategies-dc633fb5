# Ocena UX / UI platformy — audyt surowy, kryteria rynkowe

Data audytu: 2026-07-11 · Branch: `claude/platform-review-ux-ui-smcper` (HEAD `7082fd7`).

Ten dokument uzupełnia `OCENA_PLATFORMY.md` (audyt funkcjonalności, obecnie ~8,2/10)
o osobny, **surowy audyt doświadczenia użytkownika i warstwy wizualnej**. Punkt
odniesienia to nie „czy działa", tylko: **czy to wygląda i prowadzi użytkownika
lepiej niż konkurencja** — premium serwisy wydawnicze (The Verge, Axios, Substack,
Morning Brew) po stronie publicznej i narzędzia klasy Linear / Notion / Webflow /
Gutenberg po stronie panelu. Skala 0–10, przyznawana surowo.

## Metodologia

- Pełny przegląd kodu warstwy UI/UX: `styles.css` (3596 linii), 25 komponentów
  `ui/`, system themingu CMS (5 injectorów), header/megamenu/search, strona
  artykułu, wszystkie nakładki (consent, popupy, paywall), panel `/admin`
  (~75 tras), oba edytory i builder.
- Aplikacja **uruchomiona** (dev server + mock backendu bez treści) i obejrzana:
  zrzuty ekranu desktop 1440px / mobile 390px, tryb jasny i ciemny, 12 tras
  publicznych. Zachowania (motyw, nakładki, stany puste) potwierdzone empirycznie.
- Każdy zarzut w tym dokumencie ma pokrycie w `plik:linia` lub w zrzucie ekranu.

## Werdykt ogólny UX/UI: **5,9/10**

Rozjazd między silnikiem a wykończeniem jest największym problemem platformy.
Funkcjonalnie to solidny produkt (8+), ale doświadczeniem i wyglądem jest
**poprawny, nie wyróżniający**: rdzeń wizualny to rozpoznawalny stock shadcn,
strona artykułu jest przeładowana konkurującymi elementami, nakładki nie mają
orkiestracji, warstwa błędów/404 jest rozjechana językowo, a panel admina —
potężny dla eksperta — nowego redaktora odrzuca (zero onboardingu, 11 zakładek,
natywne `window.prompt` w edytorach klasy premium). Jeśli celem jest „pokazać
się lepiej od innych", dziś ta platforma **wygląda jak dobrze wykonany standard,
nie jak lider**.

---

## Karta ocen

### UI / warstwa wizualna (średnia ~6,4)

| Obszar | Ocena | Werdykt jednym zdaniem |
|---|---|---|
| System tokenów / theming CMS | **7,0** | Semantyczny, sanityzowany, sterowany z CMS — ale monolit 3600 linii, mieszanka OKLCH/hex i surowa interpolacja kolorów w injectorach. |
| Biblioteka komponentów | **6,0** | Spójny stock shadcn; **cele dotykowe 28–36px, nigdy 44px** i focus ring 1px to realne braki. |
| Typografia | **6,5** | Wzorowy self-hosting Red Hat Display (subset latin-ext, GDPR), ale **błędny fallback `Georgia, serif` dla sans-serifa** (×12 miejsc) i brak kontrastu edytorskiego (jedna rodzina na wszystko). |
| Dark mode | **6,5** | Kompletny technicznie (dual-source obrazy, autofill, `.light` scoping) — ale **nie respektuje `prefers-color-scheme`**: użytkownik z ciemnym systemem dostaje jasną stronę (potwierdzone empirycznie; `ThemeProvider.tsx:16-20`, `__root.tsx:236` — czyta tylko localStorage). |
| Responsywność | **6,5** | Szeroko pokryta (safe-area, clamp, hscroll ze snapem), ale zbudowana na ścianie `!important` i zdublowanej osi media-query/`data-device`. |
| Motion / micro-interactions | **8,5** | Najlepszy obszar: View Transitions z morphem okładki, shimmer, reveal wykresów, `prefers-reduced-motion` wszędzie — ponad standard rynkowy. |
| Wyróżnialność wizualna | **5,5** | Autorskie detale w warstwie wydawniczej (chevron rules, ghost-typografia takeaways, 6 stylów sidebara), ale pierwsze wrażenie = „ładny shadcn"; tożsamość marki wisi na jednym pomarańczu. |

### UX publiczny — czytelnik (średnia ~5,4)

| Obszar | Ocena | Werdykt jednym zdaniem |
|---|---|---|
| Nawigacja / IA | **6,0** | Wzorcowy drawer mobilny i dobre skróty, ale **MegaMenu nie otwiera się z klawiatury** (hover-only, `MegaMenu.tsx:139-143`) i IA profilu jest rozmyta (zapisane treści w 2 miejscach, 3 edytory tożsamości, 13 pozycji nawigacji). |
| Wyszukiwanie | **5,0** | **Dwa różne silniki**: overlay szuka tylko po tytule ILIKE (`SearchOverlay.tsx:53`), `/search` po pełnym FTS — różne wyniki dla tej samej frazy; zero podpowiedzi/ostatnich wyszukiwań; wyniki bez semantyki `option`/`aria-activedescendant`. |
| Czytanie artykułu | **6,5** | Świetne fundamenty (przypisy, LCP preload, morph okładki), ale strona artykułu to **kaskada 15+ elementów**: 4 strefy reklam, 2 spisy treści, 3 wskaźniki postępu naraz, newsletter, komentarze, popup. Konkurencja premium tak nie robi. |
| Stany loading / empty / error | **4,5** | `RouteProgress` klasy premium, ale **dwa 404 w przeciwnych językach** (`__root.tsx:67` EN vs `$.tsx:883` PL), trzy komponenty błędu bez i18n, surowe `error.message` pokazywane czytelnikowi, spinnery zamiast skeletonów (32 vs 11 plików). |
| Popupy / presja monetyzacyjna | **4,0** | **Brak orkiestracji nakładek**: ConsentBanner + NewsletterPopup + PopupHost to niezależne systemy bez wspólnej kolejki (`__root.tsx:289-297`) — pierwsza wizyta może dostać 3 nakładki naraz; do tego AlertBar, FooterSlideup i 4 strefy reklam. Podręcznikowy popup fatigue. |
| Dostępność | **6,0** | Dobre nawyki (focus trap współdzielony, `inert`, skip-link, axe w testach), ale test axe **wyłącza kontrast**, pokrywa tylko PostLayoutRenderer, a MegaMenu i wyniki szukajki wypadają z klawiatury/SR. |
| i18n copy | **5,5** | Duże, zbalansowane słowniki (1704/1689 linii), ale **56 plików z hardkodowanymi ternarami językowymi**, warstwa błędów w ogóle poza i18n, smaczki typu „Clear" po polsku i „Start" po angielsku. |
| Lejek konwersji | **5,0** | Paywall techniczne 8/10, ale `/pricing` to 49 linii bez porównania planów/FAQ/social proof, a checkout **wyrzuca z lejka** do `/profile/billing` po dane adresowe (`checkout.$planId.tsx:50-58`); dwa równoległe lejki bez kanonu. |

### UX panelu administracyjnego — redakcja (średnia ~5,6)

| Obszar | Ocena | Werdykt jednym zdaniem |
|---|---|---|
| IA / nawigacja admina | **6,0** | Command palette (⌘K) klasy Linear ratuje całość, ale menu `text-[9px]/[12px]` poniżej minimum czytelności, grupa „engagement" ma 12 pozycji, a **ustawienia designu są w 3 miejscach** (settings.design / appearance.global-colors / theme-options). |
| Edytor postów | **6,0** | Autosave, presence, rewizje, workflow — poziom rynkowy; ale monolit 1448 linii, **11 zakładek metadanych** przed napisaniem pierwszego zdania, `window.prompt("URL obrazka")` przy pełnym media managerze (`admin.posts.$slug.tsx:483`), 4 typy edytora w selekcie (ekspozycja długu technicznego na redaktora). |
| Builder stron | **6,5** | Breakpointy, dark preview, 60 widgetów, navigator, skróty — funkcjonalnie blisko Webflow; **zero onboardingu** przy tej złożoności i `window.prompt` na operacjach globalnych (`useBuilderOperations.ts:81,158,180`). |
| Block editor | **5,0** | Szkielet Gutenberga OK (outline, historia per-język, Alt+strzałki), ale **54 ze 100 bloków w jednym kubełku „advanced"**, 25 niezaimplementowanych bloków wyszarzonych w inserterze (wyglądają jak zepsute), panel ustawień tylko dla ~11 z 75 typów. |
| Spójność wzorców / feedback | **5,0** | `ConfirmDialog` i `AutosaveBar` wzorcowe — ale obok **14 plików z `window.confirm/prompt`** (nawet `AutosaveBar.tsx:85`!), przyciski ładowania jako `"..."`, `toast.error(e.message)` z surowym backendem. Zespół zna zasadę (komentarz w `admin.popups.tsx:5`), ale jej nie egzekwuje. |
| Listy / zarządzanie treścią | **7,0** | Najlepszy obszar: filtry pokrycia językowego (ponadstandardowe), bulk, kosz; psuje brak serwerowej paginacji (wszystkie posty do pamięci, `admin.posts.tsx:86-98`). |
| Krzywa uczenia nowego redaktora | **4,0** | **Zero onboardingu** (żadnego tour/coachmark w całym repo) przy 4 edytorach, 100 blokach, 60 widgetach i 11 zakładkach — panel eksperta zachwyci, nowicjusza odrzuci. |

### Zbiorczo

| Płaszczyzna | Ocena |
|---|---|
| UI / warstwa wizualna | **6,4** |
| UX publiczny (czytelnik) | **5,4** |
| UX admina (redakcja) | **5,6** |
| **UX/UI ogółem** | **5,9/10** |

---

## 10 defektów UX/UI o największym koszcie (kolejność = priorytet)

1. **Brak menedżera nakładek** — Consent + Newsletter + PopupHost montowane
   niezależnie (`__root.tsx:289-297`), każdy z własnym frequency-cappingiem w LS;
   na pierwszej wizycie mogą wystąpić 3 naraz. Jedna kolejka priorytetów
   (consent → max 1 marketingowa → reszta) to najtańsza duża wygrana.
2. **Dark mode ignoruje system** — `themeInitScript` (`__root.tsx:236`)
   i `ThemeProvider.tsx:16-20` czytają wyłącznie localStorage; brak
   `matchMedia("(prefers-color-scheme: dark)")` w całym repo dla motywu.
   Użytkownik z ciemnym OS dostaje jasną stronę — standard rynkowy od lat.
3. **Rozjechana warstwa awaryjna** — 404 po angielsku na trasach rootowych
   (`__root.tsx:67-87`), po polsku na `$` (`$.tsx:883-896`); 3 komponenty błędów
   w 2 językach, żaden przez i18n; surowe `error.message` do użytkownika
   (`ErrorBoundary.tsx:39`). Pierwsze wrażenie przy awarii = chaos.
4. **Dwa silniki wyszukiwania** — overlay ILIKE po tytule vs `/search` FTS
   (`SearchOverlay.tsx:53` vs `search.tsx:12-17`); te same frazy, inne wyniki.
   Overlay bez podpowiedzi, ostatnich wyszukiwań i ARIA listboxa.
5. **MegaMenu niedostępny z klawiatury** — otwarcie tylko `onMouseEnter`
   (`MegaMenu.tsx:139-143,164`), Escape tylko dla wariantu `click`; `role="menu"`
   bez semantyki. To bariera dostępności na głównej nawigacji.
6. **`window.prompt`/`confirm` w edytorach premium** — 14 plików, w tym okładka
   posta (`admin.posts.$slug.tsx:483`), nazwy globalnych widgetów
   (`useBuilderOperations.ts:158`) i odrzucanie zmian (`AutosaveBar.tsx:85`).
7. **Cele dotykowe poniżej normy** — button `h-8`/`h-7`/`icon h-8` (28–36px),
   checkbox 16px (`button.tsx:20-25`, `checkbox.tsx:14`); WCAG 2.5.5 / HIG = 44px.
   Na mobile to realna klikalność, nie pedanteria.
8. **Przeładowana strona artykułu** — 4 strefy reklam + 2 TOC + 3 wskaźniki
   postępu + newsletter + komentarze + popup wokół jednego tekstu
   (`$.tsx:641-799`); TTS dodatkowo za login-wallem (`TtsPlayer.tsx:66-70`).
9. **Onboarding-cliff admina** — zero mechanizmów wprowadzenia przy 4 edytorach /
   100 blokach (54 w „advanced", 25 martwych-wyszarzonych) / 60 widgetach /
   11 zakładkach; ustawienia designu w 3 miejscach.
10. **Błędny fallback typografii** — `"Red Hat Display", Georgia, serif`
    (`styles.css:67`, `globalColors.ts` ×12): przy FOUT nagłówki błyskają
    szeryfem. Plus off-brand indygo w domyślnych Key Takeaways
    (`styles.css:3366-3407`) w pomarańczowym serwisie.

## Mocne strony (uczciwie, bo jest ich sporo)

- **Motion klasy premium**: View Transitions z shared-element morphem okładki
  post→artykuł, skeleton shimmer, reveal wykresów, `prefers-reduced-motion`
  respektowany w każdym bloku animacji. Tego nie ma większość konkurencji.
- **Command palette w adminie** (⌘K, fuzzy, dwujęzyczna, server-search) — poziom
  Linear; najlepszy pojedynczy element UX panelu.
- **AutosaveBar + presence + rewizje** w edytorze postów — warsztat, którego
  nie powstydziłby się Notion.
- **AdSlot z realną ochroną CLS** (rezerwacja wymiarów od pierwszego paintu,
  montaż po idle+viewport) i LCP preload okładki 1:1 z renderowanym `srcset`.
- **Typografia infrastrukturalnie wzorowa**: self-hosted variable font,
  subset latin/latin-ext, `font-display: swap`, zero Google Fonts (GDPR).
- **Strona logowania** — jedyny ekran, który już dziś wygląda „na własny":
  ilustracja, boczna nawigacja kroków, przełącznik PL/EN i motywu (potwierdzone
  wizualnie na zrzutach).
- Focus trap współdzielony przez wszystkie nakładki, `inert` na ukrytym
  headerze, skip-link — fundamenty a11y są, brakuje egzekwowania na krawędziach.

## Czy ta platforma „pokazuje się lepiej od innych"? — ocena wyróżnialności: **5,5/10**

Dziś: **nie**. Wyróżniki realnie istnieją (motion, theming CMS, dwujęzyczność
treści, warsztat edytorski), ale są niewidoczne na pierwszy rzut oka, a rzeczy
widoczne od razu (prymitywy shadcn, gęstość reklam i popupów, chaos błędów,
jasny motyw mimo ciemnego systemu) pozycjonują produkt jako „porządny szablon".
Konkurencję bije się spójnością i pierwszym wrażeniem, nie liczbą funkcji.

Najkrótsza droga do „pokazania się lepiej" (w kolejności zwrotu):

1. **Tydzień higieny** (pkt 1–7 z listy defektów): menedżer nakładek, system
   dark mode, jedna warstwa błędów i18n, jeden silnik szukajki, klawiatura
   w MegaMenu, wymiana `window.prompt`, 44px na mobile. To podnosi UX publiczny
   z ~5,4 do ~7 bez projektowania czegokolwiek nowego.
2. **Tożsamość edytorska**: kontrastowa rodzina display/serif dla tytułów i prozy,
   własne cienie/promienie zamiast domyślnych shadcn, domyślne kolory komponentów
   spięte z marką (koniec indygo). Wtedy warstwa publiczna przestaje wyglądać
   jak szablon.
3. **Odchudzenie strony artykułu**: jeden TOC, jeden wskaźnik postępu, maks 2
   strefy reklam, TTS bez logowania — czytanie ma być przewagą, nie torem
   przeszkód.
4. **Onboarding redakcji**: coachmarki pierwszego użycia buildera/block editora,
   ukrycie 25 martwych bloków, rozbicie „advanced", jedno źródło prawdy dla
   ustawień designu. Panel ekspercki, który umie przyjąć nowicjusza, to rzadkość
   — i realny wyróżnik sprzedażowy.

Po wykonaniu punktów 1–4 realistyczny pułap tej platformy to **8/10 UX/UI** —
silnik już na to pozwala; brakuje wyłącznie wykończenia i dyscypliny.

---

# Wdrożenia — „tydzień higieny" (2026-07-11)

Zrealizowano rekomendacje 1–7 i 10 z listy defektów priorytetowych. Bramki po
zmianach: `tsc --noEmit` 0 błędów, testy **1367 przechodzą** (1363 + 4 nowe),
`lint` 0 błędów (61 ostrzeżeń `exhaustive-deps` = baseline sprzed zmian).

| # | Defekt | Wdrożenie |
|---|---|---|
| 1 | Brak menedżera nakładek | Nowy `lib/overlayCoordinator.ts` (+ testy vitest): pojedynczy właściciel slotu marketingowego, kolejka FIFO, cooldown 30 s między nakładkami. `ConsentBanner` zgłasza widoczność (zgody zawsze pierwsze), `NewsletterPopup` i `PopupHost` proszą o slot zamiast otwierać się na ślepo — koniec 3 nakładek naraz. |
| 2 | Dark mode ignorował system | `themeInitScript` (`__root.tsx`) i `ThemeProvider` honorują `prefers-color-scheme`, gdy brak jawnego wyboru w localStorage; żywa reakcja na zmianę motywu OS; jawny wybór użytkownika nadal wygrywa. |
| 3 | Rozjechana warstwa błędów/404 | Nowy `lib/errorCopy.ts` — jedna dwujęzyczna kopia dla WSZYSTKICH powierzchni awaryjnych (`__root` 404+error, `$.tsx` 404+error, `ErrorBoundary`). Surowe `error.message` już nigdy nie renderuje się czytelnikowi (idzie do console/reportera). |
| 4 | Dwa silniki wyszukiwania | `SearchOverlay` przepięty z ILIKE-po-tytule na RPC `search_posts` (ten sam ranked FTS co `/search`: unaccent, prefiksy, treść bloków). Dodane ARIA combobox/listbox/`aria-activedescendant` — strzałki są teraz ogłaszane czytnikom ekranu. |
| 5 | MegaMenu hover-only | Otwieranie także z fokusa klawiatury (parytet z hoverem), Escape działa dla obu wariantów, zdjęte fałszywe `role="menu"`/`aria-haspopup` (wzorzec disclosure-nav). |
| 6 | Natywne `window.confirm/prompt` | Nowy `lib/appDialogs.ts` + `<AppDialogHost/>` (promise-owe `confirmDialog()`/`promptDialog()` w stylach aplikacji, wzorzec jak `unsavedChanges`). Wymienione WSZYSTKIE 21 wywołań w 15 plikach (AutosaveBar, edytory postów/stron, builder ops, sidebar builder, eksperymenty, custom-meta, ads, kategorie, paywall, ikony, crop-sizes, subskrybenci, profil, toolbar bloków, audio bar). `grep window.confirm\|window.prompt` = 0 trafień w kodzie produkcyjnym. |
| 7 | Cele dotykowe < 44px | `button.tsx` (wszystkie rozmiary) i `input.tsx` dostały `pointer-coarse:min-h-11` (44px) — tylko na urządzeniach dotykowych, gęstość desktopu bez zmian. |
| 10 | Zły fallback fontu + off-brand indygo | `"Red Hat Display", Georgia, serif` → `…, system-ui, sans-serif` (32 wystąpienia: styles.css, globalColors.ts, GlobalColorsEditor). Domyślne kolory Key Takeaways i TOC: indygo `#4f46e5`/`#eef1ff` → kolory marki `#fa9346`/`#fff4ea` (nadpisania z DB nadal wygrywają). |
| — | Drobne i18n | „Clear" → „Wyczyść", `aria-label` „Close" → dwujęzyczny (SearchOverlay), breadcrumb „Start" → „Home" w EN, wyszarzone 25 niezaimplementowanych bloków usunięte z insertera (pokazujemy tylko realnie dostępne). |

Poza zakresem tej rundy (świadomie): odchudzenie strony artykułu (pkt 8 — decyzja
redakcyjna o liczbie stref reklam), onboarding admina i konsolidacja 3 ekranów
ustawień designu (pkt 9 — wymaga decyzji o docelowej IA), TTS bez logowania
(decyzja kosztowa właściciela).

Uwaga: budżet bundle (`check:bundle`) jest przekroczony **na main** (public
1176 KB > 1000 KB, overall 1561 KB > 1300 KB — stan zastany, dokumentacja
ARCHITECTURE.md podaje nieaktualne ~930 KB); wkład tych zmian to ~+1 KB.
Wymaga osobnej rundy odchudzania lub urealnienia budżetów.

---

# Rewaluacja po wdrożeniach (2026-07-11, wieczór) — karta ocen przed → po

Metoda: **adwersaryjny re-audyt** każdej wdrożonej poprawki w aktualnym kodzie
(próba obalenia, że działa; weryfikacja podłączenia, ścieżek zamknięcia,
SSR-safety, wygenerowanego CSS w buildzie). Werdykt re-audytu: **zero defektów
klasy „uszkodzone"** — wszystkie wdrożenia realnie podłączone; wykryto 3
przypadki brzegowe, wszystkie naprawione w tej samej rundzie:

| Znalezisko re-audytu | Waga | Status |
|---|---|---|
| NewsletterPopup mógł otworzyć się ponownie ~30 s po zamknięciu (duplikat w kolejce koordynatora po nawigacji przy otwartym popupie; grant bez re-sprawdzenia frequency cap) | średnia | **NAPRAWIONE** — `shouldShow()` sprawdzany ponownie w momencie przyznania slotu |
| Błąd RPC `search_posts` połykany — awaria backendu wyglądała jak „Brak wyników" | niska | **NAPRAWIONE** — stan `errored` + osobny komunikat PL/EN + `console.error` |
| `aria-controls` wskazywało na nieistniejący listbox przy braku wyników (dangling IDREF) | niska | **NAPRAWIONE** — atrybut warunkowy (`expanded ? listboxId : undefined`) |

Bramki po całej rundzie: `tsc --noEmit` **0 błędów**, testy **1367/1367**,
lint **0 błędów** (61 ostrzeżeń = baseline), `pointer-coarse:min-h-11`
potwierdzony w wygenerowanym CSS produkcyjnym (`@media (pointer:coarse)` →
`min-height: 44px`).

## UI / warstwa wizualna: 6,4 → **7,2**

| Obszar | Przed | Po | Co się zmieniło / co trzyma ocenę |
|---|---|---|---|
| System tokenów / theming CMS | 7,0 | **7,2** | Domyślne kolory komponentów spięte z marką (koniec indygo). Trzyma: monolit 3600 linii, mieszanka OKLCH/hex, surowa interpolacja kolorów w injectorach. |
| Biblioteka komponentów | 6,0 | **7,0** | Cele dotykowe 44px na dotyku (button wszystkie rozmiary + input, zweryfikowane w buildzie). Trzyma: stock shadcn, focus ring 1px. |
| Typografia | 6,5 | **7,0** | Poprawny fallback sans (32 miejsca). Trzyma: brak kontrastu edytorskiego (jedna rodzina), miara wiersza w px. |
| Dark mode | 6,5 | **8,0** | Honoruje `prefers-color-scheme` + żywa reakcja na zmianę motywu OS; jawny wybór wygrywa; zero flashu (zweryfikowana zgodność init-script ↔ provider). Trzyma: zaszyte hex neutrale w `.dark`. |
| Responsywność | 6,5 | 6,5 | Bez zmian (ściana `!important`, dwie osie responsywności). |
| Motion / micro-interactions | 8,5 | 8,5 | Bez zmian — nadal najmocniejszy obszar. |
| Wyróżnialność wizualna | 5,5 | **6,0** | Spójna paleta marki w domyślnych komponentach. Trzyma: rdzeń = rozpoznawalny shadcn, tożsamość na jednym pomarańczu. |

## UX publiczny (czytelnik): 5,4 → **6,4**

| Obszar | Przed | Po | Co się zmieniło / co trzyma ocenę |
|---|---|---|---|
| Nawigacja / IA | 6,0 | **6,5** | MegaMenu w pełni klawiaturowy (focus/blur/Escape, poprawne ARIA — zweryfikowane bąbelkowanie focusin/focusout). Trzyma: rozmyta IA profilu (2 miejsca na zapisane, 3 edytory tożsamości). |
| Wyszukiwanie | 5,0 | **7,0** | Jeden silnik: overlay na tym samym rankowanym FTS co `/search`; ARIA combobox/listbox/activedescendant; uczciwy stan błędu backendu. Trzyma: brak podpowiedzi/ostatnich wyszukiwań/snippetów. |
| Czytanie artykułu | 6,5 | 6,5 | Bez zmian (kaskada 15+ elementów — decyzja redakcyjna, poza rundą). |
| Stany loading / empty / error | 4,5 | **6,5** | Jedna dwujęzyczna warstwa 404/błędów na wszystkich 5 powierzchniach; `error.message` nigdy nie renderowany czytelnikowi. Trzyma: przewaga spinnerów nad skeletonami, empty states bez CTA. |
| Popupy / presja monetyzacyjna | 4,0 | **6,5** | Koordynator nakładek: zgody pierwsze, max 1 marketingowa naraz, cooldown 30 s, release na każdej ścieżce zamknięcia (zweryfikowane: brak deadlocka), frequency cap re-sprawdzany przy grancie. Trzyma: gęstość reklam (4 strefy + AlertBar + FooterSlideup). |
| Dostępność | 6,0 | **7,0** | MegaMenu klawiaturowy, semantyka combobox w szukajce, 44px na dotyku, `role="status"` na stanach pustych. Trzyma: axe bez testu kontrastu, pokrycie tylko PostLayoutRenderer. |
| i18n copy | 5,5 | **6,0** | Warstwa awaryjna w 100% dwujęzyczna; „Clear"→„Wyczyść", „Start"→„Home" (EN). Trzyma: ~50 plików z hardkodowanymi ternarami, kopia poza zasobami. |
| Lejek konwersji | 5,0 | 5,0 | Bez zmian (anemiczny /pricing, wyrzucanie do /profile/billing). |

## UX admina (redakcja): 5,6 → **6,2**

| Obszar | Przed | Po | Co się zmieniło / co trzyma ocenę |
|---|---|---|---|
| IA / nawigacja admina | 6,0 | 6,0 | Bez zmian (mikro-typografia, 3 ekrany ustawień designu). |
| Edytor postów | 6,0 | **6,5** | Okładka/link/obraz przez stylowane dialogi (koniec `window.prompt`), usuwanie przez AlertDialog. Trzyma: monolit 1448 linii, 11 zakładek. |
| Builder stron | 6,5 | **7,0** | Nazwy szablonów/widgetów globalnych/testów A/B przez dialogi z walidacją pustej nazwy. Trzyma: zero onboardingu. |
| Block editor | 5,0 | **5,5** | Inserter pokazuje tylko 75 działających bloków (25 martwych ukrytych — slash-menu zweryfikowane). Trzyma: 54 bloki w kubełku „advanced", panel ustawień dla ~11 typów. |
| Spójność wzorców / feedback | 5,0 | **7,0** | **0 natywnych `window.confirm/prompt`** (było 21 wywołań w 15 plikach) — jeden promise-owy serwis dialogów z focus-trap i Escape. Trzyma: loadery „...", `toast.error(e.message)`. |
| Listy / zarządzanie treścią | 7,0 | 7,0 | Bez zmian (brak serwerowej paginacji). |
| Krzywa uczenia | 4,0 | **4,5** | Mniej szumu (martwe bloki ukryte, przewidywalne dialogi). Trzyma: brak jakiegokolwiek onboardingu. |

## Zbiorczo — cała platforma

| Płaszczyzna | Przed rundą | Po rundzie | Benchmark rynkowy |
|---|---|---|---|
| UI / warstwa wizualna | 6,4 | **7,2** | premium serwisy wydawnicze |
| UX publiczny (czytelnik) | 5,4 | **6,4** | The Verge / Axios / Substack |
| UX admina (redakcja) | 5,6 | **6,2** | Gutenberg / Webflow / Notion / Linear |
| **UX/UI ogółem** | **5,9** | **6,6** | |
| Funkcjonalność (wg OCENA_PLATFORMY.md, po rundzie 5) | 8,2 | 8,2 | dojrzały CMS produkcyjny |
| **Platforma — werdykt całościowy** | **~7,1** | **~7,4** | |

Interpretacja: silnik (8,2) wciąż wyprzedza doświadczenie (6,6) — ale luka
zmalała z 2,3 do 1,6 punktu w jednej rundzie czysto higienicznej, bez
projektowania nowych funkcji. Największe pozostałe rezerwy UX/UI (w kolejności
zwrotu): odchudzenie strony artykułu (jeden TOC, mniej stref reklam, TTS bez
logowania), tożsamość typograficzna (kontrast display/serif), konsolidacja
3 ekranów ustawień designu + onboarding redakcji, podpowiedzi/recent w szukajce,
lejek konwersji (/pricing z porównaniem planów, adres w kroku płatności).
Po ich domknięciu realny pułap: **UX/UI ~8/10, platforma ~8,2/10**.
