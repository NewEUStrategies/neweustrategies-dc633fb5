// Molekuła: plakietka akcji w dzienniku moderacji.
//
// CO TO DOWODZI. Jedną rzecz, której nie widać w recenzji kodu: ujawnienie
// autora jest w dzienniku WYRÓŻNIONE, a każda inna akcja - nie. Kolor jest tu
// nośnikiem znaczenia, nie ozdobą: ujawnienie to jedyny wpis łamiący regułę
// Chatham House, więc musi dać się znaleźć wzrokiem w kolumnie z siedemnastoma
// innymi akcjami. Plakietka stała w organizmie DWA RAZY (tabela i karta),
// każdy raz z własną kopią warunku - stąd molekuła.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie sprawdza, które akcje są ujawnieniem - to
// `isRevealLogAction` i jego tabela w `adminModerationDesk.test.ts`. Nie
// testuje `Badge` z `components/ui` (biblioteka) ani istnienia kluczy i18n
// (bramka `adminClubsI18nLoading.gate.test.ts`); etykieta wchodzi propsem,
// bo dziennik pokazuje też nazwy akcji spoza słownika.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { ClubModerationLogBadge } from "@/components/admin/clubs/molecules/ClubModerationLogBadge";

describe("plakietka dziennika moderacji", () => {
  it("ujawnienie autora dostaje ton bursztynowy", () => {
    render(<ClubModerationLogBadge action="reveal_author" label="Ujawnienie autora" />);

    const badge = screen.getByText("Ujawnienie autora");
    expect(badge.getAttribute("data-reveal")).toBe("true");
    expect(badge.className).toContain("amber");
  });

  it("każda inna akcja idzie bez wyróżnienia", () => {
    render(<ClubModerationLogBadge action="delete" label="Usunięcie" />);

    const badge = screen.getByText("Usunięcie");
    expect(badge.getAttribute("data-reveal")).toBe("false");
    expect(badge.className).not.toContain("amber");
  });

  it("etykieta spoza słownika pokazuje się taka, jaka przyszła", () => {
    // Dziennik jest zapisem historycznym: akcja sprzed zmiany słownika nie ma
    // znikać ani pokazywać surowego klucza.
    render(<ClubModerationLogBadge action="group_purge" label="group_purge" />);

    expect(screen.getByText("group_purge").getAttribute("data-reveal")).toBe("false");
  });
});
