import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Router i i18n sa tu zamockowane celowo: przedmiotem testu jest KONTRAKT
// SSR-owy regionu aria-live, nie integracja z routerem. `busy` ustawione na
// true odtwarza stan, w ktorym router raportuje "pending" w trakcie skladania
// dokumentu - dokladnie ten, ktory wywalal hydratacje calego drzewa.
vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? "Ładowanie…",
  }),
}));

const { RouteProgress } = await import("../RouteProgress");

describe("RouteProgress - kontrakt hydratacji", () => {
  it("nie wypisuje tekstu ladowania w SSR, mimo ze router raportuje pending", () => {
    // W SSR useEffect sie nie wykonuje, wiec useHasMounted() zwraca false.
    // Gdyby tresc nie byla nim bramkowana, serwer wyslalby "Ładowanie…",
    // klient po hydratacji pusty string i React regenerowalby cale drzewo
    // (RouteProgress siedzi w layoucie korzenia, wiec dotyczylo to KAZDEJ strony).
    const html = renderToString(<RouteProgress />);

    expect(html).not.toContain("Ładowanie");
  });

  it("zachowuje region aria-live w DOM juz w SSR, zeby czytnik mial punkt zaczepienia", () => {
    const html = renderToString(<RouteProgress />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });
});
