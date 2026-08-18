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
  oraz przemapowane tokeny platformy (szczegóły w sekcji 8.1),
- gradient galerii startuje z tła panelu z delikatną poświatą marki, gdy kolumny gradientu
  są puste (sekcja 8.2).

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

## 4. Pola formularza: jedno zachowanie - platformowa etykieta pływająca

`src/components/ui/field-box.tsx` używa dokładnie tego samego atomu co formularze
kontaktowe (`.input-group` + `.user-label`): etykieta (i18n) w spoczynku **siedzi wewnątrz
pola**, a kiedy użytkownik zaczyna pisać, wjeżdża na ramkę i zwalnia miejsce na wartość;
własny placeholder pola odsłania się dopiero po focusie. Wariant „etykieta po prawej"
został wycofany - jedno zachowanie w całej platformie zamiast przełącznika.

Kontrolki trzymają **6px** niezależnie od promienia panelu (jak `.input-group > .input`),
w popupie mają zwartą wysokość ~46 px. Checkboxy to niezmieniony platformowy `Checkbox`
(animowany SVG). Pary pól schodzą do jednej kolumny poniżej `sm`. Lista mailingowa idzie
tym samym atomem (platformowe CSS trzyma etykietę selecta na ramce).

Rejestracja tworzy realne konto (`supabase.auth.signUp` + potwierdzenie mailem, serwerowy
`preAuthGuard`, honeypot i minimalny czas wypełnienia). Newsletter to jeden checkbox -
zapis na listę leci tylko przy świadomej zgodzie i nie może zablokować rejestracji.
**Rejestracji przez dostawców zewnętrznych (Google, Apple ID) nie ma** - jedyna ścieżka to
e-mail + hasło, plus link „Masz już konto? Zaloguj się".

## 5. Admin: każdy element ma swoje pole

`src/components/admin/popups/signup/` - edytor w sześciu zakładkach (i18n PL/EN w
`src/lib/i18n-admin-popup-signup.ts`), pod nim podgląd na żywo z przełącznikami PL/EN i
jasny/ciemny:

| Zakładka     | Co obsługuje                                                                                                                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Układ        | wariant (stacked/split/showcase), strona galerii, proporcje kolumn, zaokrąglenie (6px), szerokość, ramka, cień                                                                                                                                                                    |
| Lewa strona  | siatka kadrów, rotacja, wysokość, odstępy, kąt gradientu, przygaszenie, **kolejność bloków** (logo/mozaika/podpis/hasło/kropki), wyrównanie, 8 przełączników detali, logo (nadpisanie + wysokość), marka i hasło PL/EN, prefiks podpisu PL/EN, 4 kadry z opisami i tytułami PL/EN |
| Prawa strona | eyebrow, tytuł, opis, podpowiedź, CTA, notka (PL/EN), wyrównanie, rozmiar tytułu, jedna linia, szerokość, kolumny par pól, link do logowania                                                                                                                                      |
| Pola         | widoczność, wymagalność, etykiety i **podpowiedzi** PL/EN dla 11 pól (e-mail i hasła zablokowane systemowo)                                                                                                                                                                       |
| Zgody        | wymagalność + treść HTML polityki prywatności i regulaminu w PL/EN                                                                                                                                                                                                                |
| Kolory       | tryb (ciemny/jasny/auto) i dwie pełne palety z ostrzeżeniem o kontraście < 4.5:1                                                                                                                                                                                                  |

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
  PL/EN, logo poziome i nadpisanie, tokeny palet i przemapowane tokeny platformy,
  platformowa etykieta pływająca, brak dostawców zewnętrznych, kolejność i widoczność
  bloków, sanityzacja zgód, przycisk zamykania,
- `src/components/admin/popups/signup/__tests__/SignupPopupEditor.test.tsx` - kompletność
  patcha `popup_design`, rozdział palet jasna/ciemna, etykiety pól, przestawianie bloków,
  przełącznik podglądu bez efektów ubocznych.

Bramka parytetu i18n (`src/__tests__/i18nParity.gate.test.ts`) przechodzi - wszystkie nowe
klucze mają wersję PL i EN.

## 8. Rewizja czytelności (druga tura)

Podgląd w adminie renderował się nieczytelnie: pola jako białe plamy bez widocznych
etykiet, ciemny nagłówek na ciemnym panelu, lewa kolumna zalana pomarańczem, a karta
podpisu i hasło nachodziły na zdjęcia. Wszystkie cztery przyczyny są różne i wszystkie
zostały usunięte u źródła.

### 8.1 Popup jest teraz hermetycznym zakresem tokenów

Panel dziedziczył tokeny motywu **adminu**. Najbardziej bolała globalna reguła
autouzupełniania Chrome:

```css
:where(input):-webkit-autofill {
  -webkit-box-shadow: 0 0 0 1000px var(--background) inset;
}
```

W jasnym adminie `--background` jest niemal biały, więc przeglądarka zamalowywała pola
popupu bielą, a etykieta w wariancie on-dark (biel na 60%) stawała się niewidoczna.
Analogicznie nagłówek brał `var(--foreground)` z otoczenia i wychodził ciemny na ciemnym.

`popupPaletteVars()` przedefiniowuje teraz na korzeniu panelu nie tylko `--nl-*`, ale też
tokeny platformy: `--background`, `--foreground`, `--card`, `--border`, `--input`,
`--ring`, `--primary`, `--muted-foreground`, `--brand`, `--brand-ink` i `--gc-input-*`.
Efekt: pola z pływającą etykietą, checkboxy, linki zgód i sama reguła autofill renderują
się z palety popupu - identycznie na stronie publicznej i w podglądzie w jasnym adminie.
Wariant `input-group--on-dark` przestał być potrzebny. Dodatkowo w podglądzie
`autoComplete="off"`, żeby przeglądarka nie wstawiała tam danych logowania administratora.

Zakres `.nlp` w `src/styles.css` dopina tylko to, czego tokeny nie załatwiają: zwartą
wysokość kontrolek, subtelne wypełnienie pola, kolor nagłówków i mocniejszą kreskę
nieaktywnego checkboxa na ciemnym tle.

### 8.2 Gradient galerii przestał krzyczeć

Domyślny gradient startował z **akcentu** (pomarańcz), więc lewa kolumna była
pomarańczową płachtą. Teraz fallback to baza z tła panelu z 14% poświatą marki na końcu
(`color-mix(in srgb, accent 14%, bg)`), a wygaszenia góra/dół leżą **pod** zdjęciami
(z-0 vs z-10) - mają wtapiać krawędzie panelu, nie kłaść koloru na kadrach.

### 8.3 Mozaika nie wylewa się już pod podpis

Siatka miała `height: 100%` w kontenerze o automatycznej wysokości, więc rzędy brały
intrinsic height zdjęć (np. 400 px) i wychodziły poza swój box - karta podpisu, hasło
i kropki lądowały na zdjęciu. Mozaika jest teraz pozycjonowana absolutnie w kontenerze
`flex-1` z `min-height`, obrazy wypełniają komórki (`absolute inset-0`), a pozostałe
bloki mają `shrink-0`. Karta podpisu dostała nieprzejrzystą bazę i `backdrop-blur`.

### 8.4 Bramka kontrastu na akcencie

`accentInk()` porównuje kontrast zapisanego atramentu z akcentem: poniżej 3:1 podmienia
go na czytelny (wybierany przez porównanie obu kandydatów, nie przez próg luminancji -
markowy `#fa9346` leży dokładnie na granicy). Historyczne wiersze z białą czcionką na
jasnym pomarańczu (2.2:1) dostają ciemny atrament (8:1) bez zmiany danych w bazie.

### 8.5 Domyślne treści w języku rejestracji

Dla świeżych instalacji: tytuł „Załóż konto" / „Create an account", CTA „Załóż konto" /
„Create account", notka o potwierdzeniu e-maila, a marka galerii pusta (zostaje samo
poziome logo z menu admina). Istniejące wiersze nie są ruszane - treść zmienia się
w panelu.
