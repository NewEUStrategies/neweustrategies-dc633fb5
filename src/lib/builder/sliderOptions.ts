// Katalogi wariantów i zamknięte zbiory wartości slidera.
//
// DLACZEGO OSOBNY MODUŁ, a nie `sliderVariants.tsx`:
// renderer slidera to ~53 KB Reacta ładowanego leniwie (`lazyWidgets`).
// Miejsca wywołania (kanwa, strona publiczna) muszą zawężać treść widgetu do
// dozwolonych wariantów PRZED zamontowaniem renderera, więc potrzebują samych
// list wartości. Trzymanie ich tutaj (moduł czysto danych, bez importów
// runtime) pozwala je zaimportować bez wciągania renderera do głównego chunka.
//
// `sliderVariants.tsx` re-eksportuje cały ten moduł, więc dotychczasowe
// importy (`from "@/lib/builder/sliderVariants"`) działają bez zmian.

export type SliderVariant =
  "editorial-hero" | "multi-card" | "cinematic-overlay" | "split-feature" | "minimal-strip";

/** Sposób prezentacji autora slajdu. */
export type SliderAuthorDisplay = "avatar" | "label" | "none";
export type SliderRatio = "16/9" | "4/3" | "1/1" | "21/9" | "3/2";
export type SliderRounded = "none" | "sm" | "md" | "lg" | "xl" | "full";

export type NavBgStyle = "glass" | "solid" | "outline" | "soft" | "gradient" | "shadow";
export type NavPosition = "mid" | "mid-outside" | "bottom" | "top";
export type NavArrowVariant =
  | "chevron" // sharp V (default)
  | "chevron-bold" // heavier V
  | "arrow" // arrow with shaft
  | "arrow-long" // long shaft, sharp head
  | "caret" // filled triangle
  | "angle" // thin single line
  | "double-chevron" // >>
  | "arrow-tail"; // arrow with feather tail

/** Katalog wariantów pokazywany w panelu (etykiety PL -> labelsEn). */
export const SLIDER_VARIANTS: { value: SliderVariant; label: string }[] = [
  { value: "editorial-hero", label: "Editorial Hero" },
  { value: "multi-card", label: "Karuzela kart (3-up)" },
  { value: "cinematic-overlay", label: "Cinematic Overlay" },
  { value: "split-feature", label: "Split Feature" },
  { value: "minimal-strip", label: "Minimal + miniatury" },
];

export const NAV_ARROW_VARIANTS: { value: NavArrowVariant; label: string }[] = [
  { value: "chevron", label: "Chevron (klasyczny V)" },
  { value: "chevron-bold", label: "Chevron pogrubiony" },
  { value: "arrow", label: "Strzałka (z trzonem)" },
  { value: "arrow-long", label: "Strzałka długa" },
  { value: "caret", label: "Caret (trójkąt wypełniony)" },
  { value: "angle", label: "Angle (cienki kąt)" },
  { value: "double-chevron", label: "Podwójny chevron »" },
  { value: "arrow-tail", label: "Strzałka z ogonem" },
];

/** Zamknięte zbiory dla `asOneOf` - jedyne źródło prawdy dla WSZYSTKICH miejsc
 *  wywołania slidera, dzięki czemu renderer nigdy nie dostaje wariantu,
 *  którego nie umie narysować, i nikt nie powtarza unii w rzutowaniu `as`. */
export const SLIDER_VARIANT_VALUES: ReadonlyArray<SliderVariant> = SLIDER_VARIANTS.map(
  (v) => v.value,
);
export const NAV_ARROW_VARIANT_VALUES: ReadonlyArray<NavArrowVariant> = NAV_ARROW_VARIANTS.map(
  (v) => v.value,
);
export const SLIDER_AUTHOR_DISPLAYS: ReadonlyArray<SliderAuthorDisplay> = [
  "avatar",
  "label",
  "none",
];
export const SLIDER_RATIOS: ReadonlyArray<SliderRatio> = ["16/9", "4/3", "1/1", "21/9", "3/2"];
export const SLIDER_ROUNDED_VALUES: ReadonlyArray<SliderRounded> = [
  "none",
  "sm",
  "md",
  "lg",
  "xl",
  "full",
];
export const NAV_BG_STYLES: ReadonlyArray<NavBgStyle> = [
  "glass",
  "solid",
  "outline",
  "soft",
  "gradient",
  "shadow",
];
export const NAV_POSITIONS: ReadonlyArray<NavPosition> = ["mid", "mid-outside", "bottom", "top"];
