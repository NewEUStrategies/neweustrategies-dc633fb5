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
