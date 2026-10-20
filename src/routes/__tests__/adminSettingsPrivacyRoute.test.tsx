// /admin/settings/privacy (I9c-X2): sekcyjny nagłówek (AGENTS - prywatny ekran
// panelu nie ma ogólnego tytułu) i karta „Retencja danych" w LENIWYM chunku -
// słownik, zapytania i molekuły karty nie mogą trafić do chunku trasy.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: null }) }));

import { Route } from "@/routes/admin.settings.privacy";

const SOURCE = readFileSync("src/routes/admin.settings.privacy.tsx", "utf8");

describe("/admin/settings/privacy", () => {
  it("nagłówek sekcyjny: tytuł, opis i noindex", () => {
    const head = Route.options.head?.({} as never) as { meta: Record<string, string>[] };
    expect(head.meta).toContainEqual({
      title: "Prywatność i retencja danych | New European Strategies",
    });
    expect(head.meta).toContainEqual(
      expect.objectContaining({
        name: "description",
        content: expect.stringContaining("okresy przechowywania"),
      }),
    );
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });

  it("karta retencji tylko przez dynamiczny import (leniwy chunk), bez słownika w trasie", () => {
    expect(SOURCE).toContain(
      'import("@/components/admin/settings/dataRetention/DataRetentionCard")',
    );
    expect(SOURCE).not.toMatch(/^import .*dataRetention\/DataRetentionCard/m);
    expect(SOURCE).not.toContain("i18n-admin-data-retention");
  });
});
