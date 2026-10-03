// Wspólne mikro-etykiety nawigacyjne używane przez powierzchnie, które renderują
// się także poza providerem i18next (breadcrumbs w SSR, JSON-LD w head()).
// Jedno źródło - wcześniej "Start"/"Home" było zdublowane w Breadcrumbs i jsonld.
//
// Język rozstrzyga `uiLang` z `format.ts`. Stała tu jego kopia (własny typ
// `UiLang` i własne `startsWith("en")`), czyli druga definicja tej samej
// decyzji - rozjechałaby się przy pierwszej zmianie reguły normalizacji.
import { uiLang } from "./format";

export function homeLabel(lang: string | undefined): string {
  return uiLang(lang) === "en" ? "Home" : "Start";
}
