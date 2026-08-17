# Wytyczne dla tła strony `/quiz`

> Dokument dla osoby przygotowującej grafiki tła. Po wykonaniu plików wystarczy podmienić asset(y) w `src/assets/quiz/` i ewentualnie dostosować nazwy w `src/routes/quiz.tsx`.

---

## 1. Obecny stan

W `src/routes/quiz.tsx` tło jest renderowane jako absolutnie pozycjonowany div pod całą zawartością strony (między `Header` a `Footer`):

```tsx
<div
  className="pointer-events-none absolute inset-0 -z-20 bg-cover bg-bottom bg-no-repeat dark:invert"
  style={{ backgroundImage: `url(${quizFansBg.url})` }}
  aria-hidden="true"
/>
<div
  className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-background/60 via-background/85 to-background/95"
  aria-hidden="true"
/>
```

- Obraz: `src/assets/quiz-fans-bg.png.asset.json` (sylwetki kibiców).
- Skalowanie: `bg-cover` + `bg-bottom`.
- Dark mode: `dark:invert` (filtrowanie CSS) — do zastąpienia dedykowanym wariantem ciemnym.
- Overlay gradientowy chroni czytelność headera i iframe’u quizu.

---

## 2. Wymagane warianty

Przygotuj **dwa główne warianty** + opcjonalnie `reduced-motion`:

| Wariant                      | Nazwa pliku bazowa                            | Kiedy używany                                                      |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| Light                        | `quiz-bg-light`                               | `prefers-color-scheme: light` oraz `.light`                        |
| Dark                         | `quiz-bg-dark`                                | `prefers-color-scheme: dark` oraz `.dark`                          |
| Reduced motion (opcjonalnie) | `quiz-bg-light-subtle`, `quiz-bg-dark-subtle` | `prefers-reduced-motion: reduce` — mniej detali, mniejszy kontrast |

---

## 3. Rozmiary i proporcje

### Rekomendowane canvasy (bazowe @1x)

| Breakpoint | Szerokość | Wysokość min | Uwagi                                     |
| ---------- | --------- | ------------ | ----------------------------------------- |
| Mobile     | 640 px    | 1200 px      | Wąski, wysoki obraz — focal point na dole |
| Tablet     | 1024 px   | 1400 px      | Więcej przestrzeni bocznej                |
| Desktop    | 1920 px   | 1600 px      | Główny wariant                            |
| Wide       | 2560 px   | 1800 px      | Dla ekranów 2K/4K                         |

### Eksportuj w dwóch gęstościach

- `@1x` — dla ekranów standardowych.
- `@2x` — dla Retina / HiDPI.
- Opcjonalnie `@3x` tylko dla mobile, jeśli grafika ma drobne detale.

Przykładowe nazewnictwo:

```
quiz-bg-light-mobile-640x1200.webp
quiz-bg-light-mobile-640x1200@2x.webp
quiz-bg-light-desktop-1920x1600.webp
quiz-bg-light-desktop-1920x1600@2x.webp
quiz-bg-dark-desktop-1920x1600.webp
...
```

---

## 4. Formaty plików

| Format   | Kiedy       | Uwagi                                                                                         |
| -------- | ----------- | --------------------------------------------------------------------------------------------- |
| **WebP** | Preferowany | Najlepszy stosunek jakości do rozmiaru, wsparcie > 95%                                        |
| **AVIF** | Opcjonalnie | Jeszcze mniejszy plik; można dodać jako pierwszy `<source>`                                   |
| **PNG**  | Fallback    | Tylko jeśli obraz zawiera przezroczystość. Dla `/quiz` lepszy jest **JPG** lub WebP bez alpha |
| **JPG**  | Fallback    | Dla starszych przeglądarek                                                                    |

> **Nie używaj przezroczystości** w tle — overlay gradientowy i tak zmiękcza krawędzie.

### Kompresja

- WebP: jakość `80–85`.
- AVIF: jakość `70–75`.
- JPG: jakość `85–90`, progressive.
- Cel: plik desktopowy `@1x` poniżej **250 KB**, `@2x` poniżej **600 KB**.

---

## 5. Styl grafiki

### Motyw

- Sylwetki / kontury kibiców / tłumu na stadionie lub w przestrzeni publicznej.
- Energetyczny, ale **nie konkurencyjny z iframe’em quizu**.
- Brak realnych twarzy, brak logotypów, brak tekstu w obrazie.

### Paleta (dopasowana do design systemu NES)

#### Light mode

- Tło główne (góra): `#F8FAFC` / `hsl(210 40% 98%)` — bliskie `var(--background)`.
- Tło dolne / akcent: `#E2E8F0` / `hsl(214 32% 91%)`.
- Sylwetki: `#94A3B8` / `hsl(215 20% 65%)` z opacity `0.25–0.45`.
- Akcent (opcjonalnie): `#3B82F6` / primary w bardzo niskiej saturacji.

#### Dark mode

- Tło główne (góra): `#0F172A` / `hsl(222 47% 11%)` — bliskie `dark --background`.
- Tło dolne: `#1E293B` / `hsl(217 33% 17%)`.
- Sylwetki: `#64748B` / `hsl(215 16% 47%)` z opacity `0.15–0.35`.
- Unikaj czystej czerni — strona ma ciemny, ale nie czarny motyw.

### Kompozycja

- **Focal point na dole** (`bg-bottom`). Najgęstsza część grafiki powinna znajdować się w dolnej połowie, poniżej iframe’u quizu.
- **Górna połowa** powinna być bardzo rozmyta / jasna / jednolita, żeby nie kłóciła się z headerem i paskiem powrotu.
- Zastosuj **vignette** (lekne przyciemnienie / rozjaśnienie krawędzi) dla lepszej czytelności.

---

## 6. Bezpieczna strefa

Na stronie `/quiz` znajdują się trzy stałe obszary UI, które muszą pozostać czytelne:

1. **Header NES** — górna krawędź, pełna szerokość, `z-index` wysoki.
2. **Przycisk „Wróć”** — lewy górny róg, nad iframem.
3. **Iframe quizu** — centralny, duży element, musi mieć kontrast z tłem.
4. **Footer** — dolna krawędź, pełna szerokość.

Zalecenia:

- Najciemniejsze / najbardziej szczegółowe elementy grafiki powinny być **poniżej dolnej krawędzi iframe’u** (bezpieczny margines ok. 80–120 px).
- Górna część obrazu powinna być **niemal jednolita** z koloru tła strony.
- Po bokach zostaw **min. 40 px** wolnej przestrzeni, żeby sidebar udostępniania nie zlewał się z tłem.

---

## 7. Dostępność

- `prefers-reduced-motion`: przygotuj warianty z mniejszą ilością detali / mniejszym kontrastem.
- Kontrast tekstu na tle: overlay gradientowy zapewnia wystarczający kontrast, ale tło nie może zawierać bardzo jaskrawych plam pod iframem.
- Nie umieszczaj ważnych informacji w samej grafice — wszystkie komunikaty muszą być w HTML.

---

## 8. Implementacja w kodzie (po przygotowaniu plików)

### 8.1. Struktura katalogów

```
src/assets/quiz/
├── quiz-bg-light-mobile-640x1200.webp
├── quiz-bg-light-mobile-640x1200@2x.webp
├── quiz-bg-light-tablet-1024x1400.webp
├── quiz-bg-light-tablet-1024x1400@2x.webp
├── quiz-bg-light-desktop-1920x1600.webp
├── quiz-bg-light-desktop-1920x1600@2x.webp
├── quiz-bg-light-wide-2560x1800.webp
├── quiz-bg-dark-mobile-640x1200.webp
├── quiz-bg-dark-mobile-640x1200@2x.webp
├── quiz-bg-dark-tablet-1024x1400.webp
├── quiz-bg-dark-tablet-1024x1400@2x.webp
├── quiz-bg-dark-desktop-1920x1600.webp
├── quiz-bg-dark-desktop-1920x1600@2x.webp
└── quiz-bg-dark-wide-2560x1800.webp
```

> W projekcie używany jest system assetów platformy (`*.asset.json`). Po wrzuceniu plików do `src/assets/quiz/` mogą wymagać wygenerowania / odświeżenia assetów. Alternatywnie można umieścić pliki w `public/quiz/` i odwoływać się bezpośrednio przez ścieżkę.

### 8.2. Przykładowy komponent `QuizBackground`

```tsx
// src/components/quiz/QuizBackground.tsx
import { cn } from "@/lib/utils";

const lightMobile = "/quiz/quiz-bg-light-mobile-640x1200.webp";
const lightMobile2x = "/quiz/quiz-bg-light-mobile-640x1200@2x.webp";
const lightDesktop = "/quiz/quiz-bg-light-desktop-1920x1600.webp";
const lightDesktop2x = "/quiz/quiz-bg-light-desktop-1920x1600@2x.webp";
const lightWide = "/quiz/quiz-bg-light-wide-2560x1800.webp";

const darkMobile = "/quiz/quiz-bg-dark-mobile-640x1200.webp";
const darkMobile2x = "/quiz/quiz-bg-dark-mobile-640x1200@2x.webp";
const darkDesktop = "/quiz/quiz-bg-dark-desktop-1920x1600.webp";
const darkDesktop2x = "/quiz/quiz-bg-dark-desktop-1920x1600@2x.webp";
const darkWide = "/quiz/quiz-bg-dark-wide-2560x1800.webp";

export function QuizBackground() {
  return (
    <picture className="pointer-events-none absolute inset-0 -z-20 block">
      {/* Light mode */}
      <source
        media="(prefers-color-scheme: light) and (max-width: 639px)"
        srcSet={`${lightMobile} 1x, ${lightMobile2x} 2x`}
        type="image/webp"
      />
      <source
        media="(prefers-color-scheme: light) and (min-width: 2560px)"
        srcSet={lightWide}
        type="image/webp"
      />
      <source
        media="(prefers-color-scheme: light)"
        srcSet={`${lightDesktop} 1x, ${lightDesktop2x} 2x`}
        type="image/webp"
      />

      {/* Dark mode */}
      <source
        media="(prefers-color-scheme: dark) and (max-width: 639px)"
        srcSet={`${darkMobile} 1x, ${darkMobile2x} 2x`}
        type="image/webp"
      />
      <source
        media="(prefers-color-scheme: dark) and (min-width: 2560px)"
        srcSet={darkWide}
        type="image/webp"
      />
      <source
        media="(prefers-color-scheme: dark)"
        srcSet={`${darkDesktop} 1x, ${darkDesktop2x} 2x`}
        type="image/webp"
      />

      <img
        src={lightDesktop}
        alt=""
        className={cn(
          "h-full w-full object-cover object-bottom",
          "[.dark_&]:hidden",
          "dark:hidden",
        )}
        aria-hidden="true"
        loading="eager"
        decoding="async"
      />
      <img
        src={darkDesktop}
        alt=""
        className={cn(
          "hidden h-full w-full object-cover object-bottom",
          "dark:block [.dark_&]:block",
        )}
        aria-hidden="true"
        loading="eager"
        decoding="async"
      />
    </picture>
  );
}
```

### 8.3. Użycie w `src/routes/quiz.tsx`

Zastąp obecny blok tła:

```tsx
<QuizBackground />
<div
  className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-background/60 via-background/85 to-background/95"
  aria-hidden="true"
/>
```

Usuń `dark:invert` — zastępuje go dedykowany dark asset.

---

## 9. Nazewnictwo i organizacja

- Używaj kebab-case: `quiz-bg-{mode}-{breakpoint}-{width}x{height}@{density}.{ext}`.
- Nie używaj polskich znaków ani spacji.
- Wersjonowanie: jeśli zmieniasz tło w przyszłości, dodaj sufiks `-v2`, ale aktualizuj też komponent.

---

## 10. Checklista przed wdrożeniem

- [ ] Przygotowano warianty light i dark.
- [ ] Wyeksportowano w rozmiarach mobile / tablet / desktop / wide.
- [ ] Wygenerowano wersje `@2x`.
- [ ] Skompresowano do WebP (lub AVIF + WebP).
- [ ] Sprawdzono wielkość plików (desktop `@1x` < 250 KB, `@2x` < 600 KB).
- [ ] Grafika nie zawiera tekstu, logotypów, realnych twarzy.
- [ ] Focal point znajduje się w dolnej połowie obrazu.
- [ ] Górna część obrazu jest jednolita i nie kłóci się z headerem.
- [ ] Testowo wyświetlono na mobile, tablet, desktop oraz w dark mode.
- [ ] Sprawdzono `prefers-reduced-motion` (opcjonalnie).
- [ ] Zaktualizowano `src/routes/quiz.tsx` (lub utworzono `QuizBackground.tsx`).
- [ ] Usunięto `dark:invert` z poprzedniego rozwiązania.
- [ ] Typecheck przechodzi (`bunx tsc --noEmit` lub `tsgo`).

---

## 11. Przykładowe parametry eksportu (Figma / Photoshop)

### Light mode

- Canvas: 1920 × 1600 px
- Color profile: sRGB
- Background: `#F8FAFC`
- Sylwetki: `#94A3B8`, opacity 35%
- Gradient overlay (wewnątrz grafiki, opcjonalnie): od `#F8FAFC` (góra, 100%) do `#E2E8F0` (dół, 60%)
- Eksport: WebP, quality 85

### Dark mode

- Canvas: 1920 × 1600 px
- Color profile: sRGB
- Background: `#0F172A`
- Sylwetki: `#64748B`, opacity 25%
- Gradient overlay (wewnątrz grafiki, opcjonalnie): od `#0F172A` (góra, 100%) do `#1E293B` (dół, 60%)
- Eksport: WebP, quality 85

---

## 12. Uwagi końcowe

- Nie stosuj `background-attachment: fixed` — powoduje problemy z wydajnością na mobile i z iframem.
- Nie używaj animacji CSS na tle (np. `animate-pulse`, `transition`) — tło ma być statyczne.
- Jeśli chcesz dodać lekką animację (np. subtelne przesuwanie sylwetek), umieść ją w osobnym, małym elemencie nad tłem i szanuj `prefers-reduced-motion`.
