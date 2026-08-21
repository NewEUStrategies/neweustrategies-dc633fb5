// Molekuła: linia autora pod tytułem tematu w panelu.
//
// CO TO DOWODZI. Regułę Chatham House w miejscu, w którym łatwo ją złamać bez
// zauważenia: linia autora jest jednym `?:` w JSX-ie, wołanym z DWÓCH układów
// (wiersz tabeli i karta). Jeśli warunek się rozjedzie, panel pokaże nazwisko
// autora wypowiedzi anonimowej - i nikt tego nie wyłapie, bo dane testowe
// w panelu zwykle mają wpisy podpisane.
//
//   1. WPIS ANONIMOWY nie pokazuje nazwiska „na czysto”: pokazuje etykietę
//      tożsamości chronionej.
//   2. TRYB CHATHAM chroni tożsamość TAKŻE przy wpisie podpisanym - to
//      ustawienie działu, nie wybór autora.
//   3. ADNOTACJA REDAKCYJNA („wprowadzone przez”) pojawia się WYŁĄCZNIE wtedy,
//      gdy wpis rzeczywiście wprowadził ktoś z panelu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie powtarza tabeli warunku ochrony tożsamości
// (`isThreadIdentityProtected` w `adminThreadsBoard.test.ts`) ani reguły
// adnotacji (`adminAttributionNote` w `clubTypes.test.ts`). Sprawdza SKLEJENIE:
// co widać, gdy reguła mówi „chroniona”.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));

import { ClubModerationThreadAuthor } from "@/components/admin/clubs/molecules/ClubModerationThreadAuthor";
import { adminThreadRow } from "@/test/clubs/adminThreadFixtures";

const PROTECTED = "adminClubs.threads.protectedIdentity";

describe("linia autora tematu", () => {
  it("wpis podpisany pokazuje nazwisko i NIC ponad to", () => {
    render(
      <ClubModerationThreadAuthor
        row={adminThreadRow({ author_name: "Anna Nowak", attribution_mode: "named" })}
      />,
    );

    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.queryByText((text) => text.includes(PROTECTED))).toBeNull();
  });

  it("wpis anonimowy pokazuje etykietę tożsamości chronionej", () => {
    render(<ClubModerationThreadAuthor row={adminThreadRow({ is_anonymous: true })} />);

    const line = screen.getByText((text) => text.includes(PROTECTED));
    expect(line.className).toContain("amber");
  });

  it("tryb Chatham chroni tożsamość przy wpisie podpisanym", () => {
    render(
      <ClubModerationThreadAuthor
        row={adminThreadRow({ is_anonymous: false, attribution_mode: "chatham" })}
      />,
    );

    expect(screen.getByText((text) => text.includes(PROTECTED))).toBeTruthy();
  });

  it("adnotacja redakcyjna pojawia się tylko przy wpisie wprowadzonym z panelu", () => {
    const { unmount } = render(
      <ClubModerationThreadAuthor row={adminThreadRow({ posted_by_admin_name: "" })} />,
    );
    expect(screen.queryByText("club.postedOnBehalf")).toBeNull();
    unmount();

    render(
      <ClubModerationThreadAuthor row={adminThreadRow({ posted_by_admin_name: "Jan Kowalski" })} />,
    );
    expect(screen.getByText("club.postedOnBehalf")).toBeTruthy();
  });
});
