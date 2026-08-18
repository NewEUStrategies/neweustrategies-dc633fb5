// Bramka: kanoniczne adresy paneli profilu muszą prowadzić do ISTNIEJĄCEJ
// trasy i NIE do przekierowania.
//
// CO TO ZA RYZYKO. `routes.ts` to jedno źródło prawdy dla adresów wklejanych
// w e-maile transakcyjne, powiadomienia push i CTA rozliczeń
// (`PROFILE_PLAN_PATH` ma w repo kilkanaście wywołań w `lib/billing`
// i `lib/email`). Taki adres żyje miesiącami w skrzynce użytkownika. Literówka
// w stałej albo zmiana nazwy pliku trasy nie daje ani błędu typów, ani
// czerwonego testu - daje 404 w mailu o nieudanej płatności.
//
// DRUGA POŁOWA BRAMKI JEST WAŻNIEJSZA. Moduł powstał właśnie dlatego, że
// konsolidacja IA zamieniła dwie trasy w przekierowania
// (`/profile/subscription` -> `/profile/plan`, `/profile/orders` ->
// `/profile/payments`). Same przekierowania wystarczyłyby, żeby nic nie umarło,
// ale nie żeby było dobrze - i dokładnie to zdanie z docbloku modułu jest tu
// przypięte asercją: żadna kanoniczna stała nie może wskazywać na trasę, która
// tylko przekierowuje dalej. Bez tego następna konsolidacja mogłaby przestawić
// stałą na stary adres i nikt by tego nie zobaczył.
//
// Asercja jest STATYCZNA (czyta drzewo tras z dysku), bo alternatywą byłoby
// wstanie routera z pełnym kontekstem sesji dla sześciu adresów.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROFILE_BILLING_PATH,
  PROFILE_MEMBERSHIP_PATH,
  PROFILE_PAYMENTS_PATH,
  PROFILE_PLAN_PATH,
  PROFILE_PRIVACY_PATH,
  PROFILE_SECURITY_PATH,
} from "../routes";

/** Wszystkie kanoniczne stałe modułu z nazwą, żeby błąd wskazywał którą. */
const CANONICAL: ReadonlyArray<readonly [string, string]> = [
  ["PROFILE_PLAN_PATH", PROFILE_PLAN_PATH],
  ["PROFILE_PAYMENTS_PATH", PROFILE_PAYMENTS_PATH],
  ["PROFILE_BILLING_PATH", PROFILE_BILLING_PATH],
  ["PROFILE_MEMBERSHIP_PATH", PROFILE_MEMBERSHIP_PATH],
  ["PROFILE_PRIVACY_PATH", PROFILE_PRIVACY_PATH],
  ["PROFILE_SECURITY_PATH", PROFILE_SECURITY_PATH],
];

/** `/profile/plan` -> `src/routes/profile.plan.tsx` (konwencja file-based). */
function routeFileFor(path: string): string {
  return `src/routes/${path.replace(/^\//, "").replace(/\//g, ".")}.tsx`;
}

describe("kanoniczne adresy profilu - istnienie trasy", () => {
  it.each(CANONICAL)("%s prowadzi do istniejącego pliku trasy", (_name, path) => {
    expect(existsSync(routeFileFor(path))).toBe(true);
  });

  it.each(CANONICAL)("%s jest adresem absolutnym pod /profile", (_name, path) => {
    // Adres relatywny w mailu transakcyjnym rozwija się względem domeny
    // klienta pocztowego, nie serwisu.
    expect(path.startsWith("/profile/")).toBe(true);
  });

  it("nie ma dwóch stałych o tym samym adresie", () => {
    const paths = CANONICAL.map(([, path]) => path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("kanoniczne adresy profilu - brak przeskoku", () => {
  it.each(CANONICAL)("%s NIE wskazuje na trasę-przekierowanie", (_name, path) => {
    // Trasa-przekierowanie ma `beforeLoad` z `throw redirect(...)` i żadnego
    // komponentu. Stała pokazująca na taką trasę kosztuje użytkownika
    // dodatkowy przeskok - to jest dokładnie ten koszt, który moduł likwiduje.
    const source = readFileSync(routeFileFor(path), "utf8");
    expect(source).not.toMatch(/throw\s+redirect\(/);
  });

  it("trasy skonsolidowane NADAL przekierowują na stałe z tego modułu", () => {
    // Druga strona tej samej umowy: stare adresy nie mogą umrzeć, bo żyją
    // w wysłanych już mailach i zakładkach. Gdyby ktoś usunął przekierowanie,
    // ta asercja to pokaże.
    const subscription = readFileSync("src/routes/profile.subscription.tsx", "utf8");
    const orders = readFileSync("src/routes/profile.orders.tsx", "utf8");
    expect(subscription).toContain(`to: "${PROFILE_PLAN_PATH}"`);
    expect(orders).toContain(`to: "${PROFILE_PAYMENTS_PATH}"`);
  });
});
