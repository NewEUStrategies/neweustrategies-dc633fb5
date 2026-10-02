// Trasy `/admin/toc` i `/admin/key-takeaways` - SKLEJENIE adresu z organizmem.
//
// Oba pliki tras trzymają wyłącznie rejestrację: treść paneli, odczyt i zapis
// ustawień mają testy przy `TocSettingsPanel` / `KeyTakeawaysSettingsPanel`
// i przy regułach `lib/toc/panelRules` / `lib/keyTakeaways`. Tu zostaje jedno
// pytanie, którego tamte testy nie zadają: czy POD TYM ADRESEM montuje się
// WŁAŚCIWY panel. Literówka w `createFileRoute` albo zamiana importów między
// dwiema bliźniaczymi trasami daje pusty (albo cudzy) ekran w zakładkach
// redakcji - a statyczna analiza tego nie widzi.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: DOSTĘPU. Trasy nie mają własnej bramki roli -
// autorytetem jest wspólny layout `/admin` (+ RLS na tabelach ustawień),
// czego dowodzi `adminRouteAuthority.gate.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderRoute } from "@/test/routeHarness";

vi.mock("@/components/admin/postExperience/organisms/TocSettingsPanel", () => ({
  TocSettingsPanel: () => <section aria-label="Spis treści - panel" />,
}));
vi.mock("@/components/admin/postExperience/organisms/KeyTakeawaysSettingsPanel", () => ({
  KeyTakeawaysSettingsPanel: () => <section aria-label="Kluczowe wnioski - panel" />,
}));

import { Route as TocRoute } from "@/routes/admin.toc";
import { Route as KeyTakeawaysRoute } from "@/routes/admin.key-takeaways";

afterEach(() => {
  cleanup();
});

describe("/admin/toc", () => {
  it("pod adresem panelu montuje się organizm ustawień spisu treści", async () => {
    const view = await renderRoute({
      route: TocRoute,
      path: "/admin/toc",
      initialEntry: "/admin/toc",
    });

    expect(view.currentPath()).toBe("/admin/toc");
    expect(screen.getByRole("region", { name: "Spis treści - panel" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Kluczowe wnioski - panel" })).toBeNull();
  });
});

describe("/admin/key-takeaways", () => {
  it("pod adresem panelu montuje się organizm sekcji „Z tego artykułu dowiesz się”", async () => {
    const view = await renderRoute({
      route: KeyTakeawaysRoute,
      path: "/admin/key-takeaways",
      initialEntry: "/admin/key-takeaways",
    });

    expect(view.currentPath()).toBe("/admin/key-takeaways");
    expect(screen.getByRole("region", { name: "Kluczowe wnioski - panel" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Spis treści - panel" })).toBeNull();
  });
});

describe("obie trasy", () => {
  it("są czystą kompozycją - bez własnego loadera i bramki", () => {
    // Dane czyta organizm (react-query), a dostęp rozstrzyga layout `/admin`.
    // Loader tutaj dublowałby zapytanie panelu, a `beforeLoad` - bramkę roli.
    for (const route of [TocRoute, KeyTakeawaysRoute]) {
      expect(route.options.loader).toBeUndefined();
      expect(route.options.beforeLoad).toBeUndefined();
    }
  });
});
