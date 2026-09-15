/**
 * PRZEŁĄCZNIK DOKUMENTÓW PRAWNYCH - kokpit wpięty w każdą stronę prawną.
 *
 * Logika budowania listy (język, aktywny klucz, adresy) ma własne dowody
 * w `src/lib/legal/__tests__/documentIndex.test.ts` i jest tam testowana jako
 * czysta funkcja. Ten plik dowodzi rzeczy, których tamten nie dosięgnie, bo
 * wymagają DRZEWA:
 *
 *   1. ZAKŁADKI SĄ PRAWDZIWYMI LINKAMI. To jest cała różnica między kokpitem
 *      a stanem komponentu: trzynaście dokumentów musi zostać trzynastoma
 *      adresami, które da się zalinkować, zaindeksować i wskazać w piśmie do
 *      organu. Dowód czyta `href` z DOM-u, a nie z modelu.
 *
 *   2. AKTYWNA POZYCJA JEST OZNACZONA DLA CZYTNIKA EKRANU, nie tylko kolorem.
 *      `aria-current="page"` to jedyne, co odróżnia bieżący dokument dla kogoś,
 *      kto nie widzi wypełnienia pigułki.
 *
 *   3. NAWIGACJA NIE MA NARUSZEŃ DOSTĘPNOŚCI. Trzynaście linków w jednym
 *      bloku to dokładnie ten kształt, w którym łatwo zgubić etykietę nawigacji
 *      albo zduplikować punkt orientacyjny.
 *
 * `useRouterState` i `Link` są podmienione: komponent prezentacyjny nie
 * potrzebuje działającego routera, a podstawienie ścieżki jest tu dźwignią,
 * która wybiera język i aktywny dokument.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({ pathname: "/polityka-prywatnosci" }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  // Atrapa URUCHAMIA prawdziwy selektor komponentu na podstawionym stanie,
  // zamiast oddawać ścieżkę na skróty. Dzięki temu dowód nadal przewróci się,
  // gdyby komponent zaczął czytać z innego miejsca niż `location.pathname`.
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: h.pathname } }),
}));

import { LegalDocSwitcher } from "../LegalDocSwitcher";

function mountAt(pathname: string) {
  h.pathname = pathname;
  return render(<LegalDocSwitcher />);
}

afterEach(() => {
  cleanup();
  h.pathname = "/polityka-prywatnosci";
});

describe("LegalDocSwitcher", () => {
  it("renderuje trzynaście zakładek, a każda jest linkiem z własnym adresem", () => {
    mountAt("/polityka-prywatnosci");
    const nav = screen.getByRole("navigation", { name: "Dokumenty prawne" });
    const links = within(nav).getAllByRole("link");

    expect(links).toHaveLength(13);
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(new Set(hrefs).size).toBe(13);
    expect(hrefs).toContain("/rodo");
    expect(hrefs).toContain("/statut");
    expect(hrefs).toContain("/polityka-prywatnosci");
  });

  it("oznacza bieżący dokument przez aria-current, nie samym kolorem", () => {
    mountAt("/rodo");
    const nav = screen.getByRole("navigation", { name: "Dokumenty prawne" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/rodo");
  });

  it("stojąc na polityce prywatności oznacza JĄ - to jest strona główna zestawu", () => {
    mountAt("/polityka-prywatnosci");
    const current = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/polityka-prywatnosci");
  });

  it("pod /en wystawia angielskie etykiety i adresy z prefiksem", () => {
    mountAt("/en/statut");
    const nav = screen.getByRole("navigation", { name: "Legal documents" });
    const links = within(nav).getAllByRole("link");

    expect(links).toHaveLength(13);
    for (const link of links) {
      expect(link.getAttribute("href")?.startsWith("/en/")).toBe(true);
    }
    expect(within(nav).getByText("GDPR - your rights")).toBeInTheDocument();
    expect(links.find((a) => a.getAttribute("aria-current") === "page")?.getAttribute("href")).toBe(
      "/en/statut",
    );
  });

  it("grupuje zakładki podpisanymi sekcjami - trzynaście pigułek bez podziału to ściana", () => {
    mountAt("/rodo");
    const nav = screen.getByRole("navigation", { name: "Dokumenty prawne" });

    expect(within(nav).getByText("Prywatność i dane")).toBeInTheDocument();
    expect(within(nav).getByText("Usługi i zakupy")).toBeInTheDocument();
    expect(within(nav).getByText("Społeczność i treść")).toBeInTheDocument();
    expect(within(nav).getByText("Wydawca")).toBeInTheDocument();
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = mountAt("/rodo");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toHaveLength(0);
  });
});
