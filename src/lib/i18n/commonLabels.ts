// Wspólne mikro-etykiety nawigacyjne używane przez powierzchnie, które renderują
// się także poza providerem i18next (breadcrumbs w SSR, JSON-LD w head()).
// Jedno źródło - wcześniej "Start"/"Home" było zdublowane w Breadcrumbs i jsonld.
export type UiLang = "pl" | "en";

export function homeLabel(lang: UiLang | string): string {
  return (lang ?? "pl").startsWith("en") ? "Home" : "Start";
}
