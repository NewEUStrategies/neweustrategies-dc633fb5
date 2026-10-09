import { createContext } from "react";

/**
 * `true` WYŁĄCZNIE w desktopowym nagłówku chrome (`Header.tsx`: wyspa `hdr-desktop`,
 * `hidden lg:block`) - P3.2a, LP-6. Logo z buildera ładuje się tam eager (bez
 * `fetchpriority="high"`) w `<picture>`, którego źródło poniżej `lg` to pusty GIF
 * z `data:`, więc telefon nie płaci za nie ani bajtem, a desktop żąda logo przy
 * parsowaniu zamiast po pierwszym układzie. Stopka, treść i kanwa: `false`
 * (wartość domyślna). Wartość nie zależy od motywu ani od urządzenia - SSR i
 * hydratacja renderują ten sam znacznik.
 */
export const HeaderChromeContext = createContext(false);
