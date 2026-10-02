// Trasa `/admin/post-layouts` - SKLEJENIE adresu z organizmem panelu.
//
// Plik trasy trzyma wyłącznie rejestrację: treść panelu, odczyt i zapis
// ustawień mają testy przy `PostLayoutsSettingsPanel` i przy regułach
// `lib/post/layoutPanelRules`. Tu zostaje jedno pytanie, którego tamte testy
// nie zadają: czy POD TYM ADRESEM w ogóle montuje się ten panel. Zmiana
// ścieżki w `createFileRoute` albo podmiana importu na inny organizm daje
// pusty ekran w miejscu z zakładek redakcji - a statyczna analiza tego nie widzi.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: DOSTĘPU. Trasa nie ma własnej bramki roli -
// autorytetem jest wspólny layout `/admin` (+ RLS na `post_layout_settings`),
// czego dowodzi `adminRouteAuthority.gate.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderRoute } from "@/test/routeHarness";

vi.mock("@/components/admin/postExperience/organisms/PostLayoutsSettingsPanel", () => ({
  PostLayoutsSettingsPanel: () => <section aria-label="Układy wpisu - panel" />,
}));

import { Route as PostLayoutsRoute } from "@/routes/admin.post-layouts";

afterEach(() => {
  cleanup();
});

describe("/admin/post-layouts", () => {
  it("pod adresem panelu montuje się organizm globalnych układów wpisu", async () => {
    const view = await renderRoute({
      route: PostLayoutsRoute,
      path: "/admin/post-layouts",
      initialEntry: "/admin/post-layouts",
    });
    expect(view.currentPath()).toBe("/admin/post-layouts");
    expect(screen.getByRole("region", { name: "Układy wpisu - panel" })).toBeInTheDocument();
  });

  it("trasa jest czystą kompozycją - bez własnego loadera i bramki", () => {
    // Dane czyta organizm (react-query), a dostęp rozstrzyga layout `/admin`.
    // Loader tutaj dublowałby zapytanie panelu, a `beforeLoad` - bramkę roli.
    expect(PostLayoutsRoute.options.loader).toBeUndefined();
    expect(PostLayoutsRoute.options.beforeLoad).toBeUndefined();
  });
});
