# Wdrożenie: popup rejestracji konta - układ referencyjny 1:1 + pełna edycja w adminie (2026-08-04)

Mandat: popup w Admin → Popupy ma być **popupem rejestracji użytkownika** (newsletter
wyłącznie jako opcjonalny checkbox), odwzorowywać 1:1 referencyjny projekt „auth-section-2"
i dać się edytować element po elemencie - lewa kolumna (galeria, teksty, kolory, miejsca)
i prawa (nagłówki, etykiety pól, zgody, przyciski) - w PL i EN, z platformowym 6px
rounding, trybem jasnym i ciemnym oraz logotypem poziomym z menu admina.

Fundament (kolumny `newsletter_settings.popup_*`, wariant `showcase`, `PopupSignupForm`)
istniał; ta rewizja go domyka.

## 1. Model danych: jedna kolumna jsonb zamiast lawiny kolumn

`supabase/migrations/20260804150000_newsletter_popup_design_jsonb.sql` dodaje
`newsletter_settings.popup_design jsonb NOT NULL DEFAULT '{}'` (+ CHECK na `jsonb_typeof =
'object'`, żeby tablica/skalar nie przeszły cicho i nie wyzerowały konfiguracji).

Kontrakt TS: `src/lib/newsletter/popupDesign.ts`

- `PopupDesign = { colorScheme, light, panel, gallery, form }`,
- `resolvePopupDesign(raw)` scala zapisany JSON z defaultami: nieznane enumy wracają do
  defaultu, liczby są klampowane do zakresów, puste etykiety wracają do defaultu, a puste
  prefiksy/URL-e **zostają puste** (to świadome „bez prefiksu"),
- `resolveGalleryOrder` odsiewa duplikaty i nieznane id-ki, brakujące bloki dopina na końcu.

Dzięki temu dodanie kolejnego pokrętła nie wymaga migracji, a starsze tenanty renderują
się dokładnie jak przed wdrożeniem (`{}` → komplet defaultów).

## 2. Paleta: ciemna, jasna i „za motywem strony"

Kolumny `popup_*_color` pozostają **paletą ciemną** (zgodność wstecz), paleta jasna żyje w
`popup_design.light`, a `colorScheme` (`dark` | `light` | `auto`) decyduje, która obowiązuje;
`auto` podąża za motywem strony (`useTheme`).

- `resolvePopupPalette(settings, mode)` zwraca komplet kolorów + `onDark` wyliczone z
  **luminancji tła**, nie z nazwy wariantu - jasne tło w „ciemnym" wariancie i tak dostanie
  pola w wersji on-light,
- `popupPaletteVars()` publikuje tokeny `--nl-bg/-fg/-muted/-accent/-accent-fg/--nl-radius`
  oraz `--brand`/`--brand-foreground` (CTA `btn-bubbly` bierze markę z palety popupu),
- gradient galerii dziedziczy akcent i tło, gdy kolumny gradientu są puste.

Domyślne kolory zeszły z generycznego `#f97316`/`#0a0a0a` na tokeny marki: akcent `#fa9346`
(`--brand`), atrament na akcencie `#141414` (WCAG AA na pomarańczu), tło `#0b0b0f`, tekst
pomocniczy `#a8a8b3` (> 7:1). Paleta jasna: akcent `#b85410` (`--brand-ink`, AA na białym),
galeria zostaje ciemna - jak w projekcie referencyjnym. Zmiana dotyczy tylko świeżych
instalacji; istniejące wiersze zachowują swoje kolory.

## 3. Jeden komponent = zero rozjazdu podglądu z produkcją

Wcześniej panel showcase istniał w dwóch kopiach: publicznej (`NewsletterPopup`) i
uproszczonej w podglądzie admina (`PopupPreview`, inne paddingi i rozmiary tytułu).
Teraz oba renderują `src/components/popups/SignupPopupPanel.tsx`; podgląd różni się
wyłącznie flagą `previewOnly` (brak zapisów, brak auto-rotacji).

Lewa kolumna: `src/components/ui/signup-showcase.tsx` (zastąpiła `newsletter-showcase.tsx`)

- siatka **referencyjna** `1.55fr / 1fr` z rzędami `1fr 1fr 0.96fr`: duży kadr po lewej
  (rzędy 1-2), dwa małe po prawej, szeroki pas na dole - z degradacją dla 1-3 zdjęć,
- alternatywy: mozaika 3x3 (układ z pierwszego wdrożenia) i jeden kadr z przenikaniem,
- narożniki „celownika" na aktywnym kadrze, wygaszenia góra/dół w kolorach gradientu,
- karta podpisu z ramką przerywaną, wyróżnionym prefiksem (odpowiednik „/imagine") i
  strzałką „następny kadr", hasło, kropki nawigacyjne,
- atrament galerii wyliczany z luminancji gradientu (jasny gradient nie daje białego
  tekstu na białym), kafle są dekoracyjne - nawigacja idzie przez opisane kropki i strzałkę.

## 4. Pola formularza: platformowy standard albo 1:1 z projektem

`src/components/ui/field-box.tsx` obsługuje dwa warianty przez jedno API:

- `floating` (domyślny) - platformowa etykieta pływająca (`.input-group` + `.user-label`),
  identyczna jak w formularzach kontaktowych,
- `inline` - etykieta po prawej wewnątrz ramki, czyli układ z projektu; nowa klasa
  `.field-inline` w `src/styles.css` (kolory tylko z tokenów `--nl-*`, więc działa na
  obu paletach).

Kontrolki trzymają **6px** niezależnie od promienia panelu (jak `.input-group > .input`).
Checkboxy to niezmieniony platformowy `Checkbox` (animowany SVG). Pary pól schodzą do
jednej kolumny poniżej `sm`, żeby w wąskim popupie nie ścinać etykiet.

Rejestracja nadal tworzy realne konto (`supabase.auth.signUp` + potwierdzenie mailem,
serwerowy `preAuthGuard`, honeypot i minimalny czas wypełnienia). Newsletter to jeden
checkbox - zapis na listę leci tylko przy świadomej zgodzie i nie może zablokować
rejestracji. Doszedł opcjonalny przycisk „Kontynuuj z Google" (`signInWithOAuth`, ta sama
ścieżka co bloki `/login`) z separatorem i pozycją nad polami albo pod przyciskiem oraz
link „Masz już konto? Zaloguj się".

## 5. Admin: każdy element ma swoje pole

`src/components/admin/popups/signup/` - edytor w sześciu zakładkach (i18n PL/EN w
`src/lib/i18n-admin-popup-signup.ts`), pod nim podgląd na żywo z przełącznikami PL/EN i
jasny/ciemny:

| Zakładka | Co obsługuje |
| --- | --- |
| Układ | wariant (stacked/split/showcase), strona galerii, proporcje kolumn, zaokrąglenie (6px), szerokość, ramka, cień |
| Lewa strona | siatka kadrów, rotacja, wysokość, odstępy, kąt gradientu, przygaszenie, **kolejność bloków** (logo/mozaika/podpis/hasło/kropki), wyrównanie, 8 przełączników detali, logo (nadpisanie + wysokość), marka i hasło PL/EN, prefiks podpisu PL/EN, 4 kadry z opisami i tytułami PL/EN |
| Prawa strona | eyebrow, tytuł, opis, podpowiedź, CTA, notka (PL/EN), wyrównanie, styl etykiet, rozmiar tytułu, jedna linia, szerokość, kolumny par, Google + separator + pozycja, link do logowania |
| Pola | widoczność, wymagalność, etykiety i **podpowiedzi** PL/EN dla 11 pól (e-mail i hasła zablokowane systemowo) |
| Zgody | wymagalność + treść HTML polityki prywatności i regulaminu w PL/EN |
| Kolory | tryb (ciemny/jasny/auto) i dwie pełne palety z ostrzeżeniem o kontraście < 4.5:1 |

Każdy patch zapisuje **komplet** `popup_design`, więc do bazy nigdy nie leci częściowy JSON.
Rekomendowane wymiary są przy każdym uploadzie: kadr główny 1200x1200 (1:1), małe 600x600,
szeroki 1200x600 (2:1), grafika split 1000x1200 (5:6), okładka stacked 1200x600.

## 6. Logo z menu admina

`useBrandLogoUrl(surface, "horizontal")` bierze najpierw
`theme_options.logo.sidebar_expanded*` - dokładnie ten poziomy znak, który admin widzi w
rozwiniętym menu (`SidebarBrand`), z fallbackiem na logo formularza logowania i logo
motywu. Nadpisanie per popup: `popup_design.gallery.logoUrl`.

## 7. Testy

- `src/lib/newsletter/popupDesign.test.ts` - defaulty, klampowanie, enumy, kolejność
  bloków, palety, luminancja, tryb `auto`,
- `src/components/popups/__tests__/SignupPopupPanel.test.tsx` - formularz konta, teksty
  PL/EN, logo poziome i nadpisanie, tokeny palet, oba warianty etykiet, bramka Google,
  kolejność i widoczność bloków, sanityzacja zgód, przycisk zamykania,
- `src/components/admin/popups/signup/__tests__/SignupPopupEditor.test.tsx` - kompletność
  patcha `popup_design`, rozdział palet jasna/ciemna, etykiety pól, przestawianie bloków,
  przełącznik podglądu bez efektów ubocznych.

Bramka parytetu i18n (`src/__tests__/i18nParity.gate.test.ts`) przechodzi - wszystkie nowe
klucze mają wersję PL i EN.
