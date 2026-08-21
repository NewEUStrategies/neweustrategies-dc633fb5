// Molekuła: cztery akcje moderatorskie przy JEDNYM temacie.
//
// CO TO DOWODZI. Że klik w przycisk oddaje NAZWĘ AKCJI zgodną ze stanem wpisu -
// czyli to, czego czysta funkcja nie obejmuje: sklejenie deskryptora z
// `threadRowActions` z realnym zdarzeniem. Pomyłka tutaj nie wywala niczego:
// „odepnij” na wpisie nieprzypiętym po prostu nic nie zmienia, a moderator
// klika drugi raz.
//
//   1. WPIS ŻYWY, NIEPRZYPIĘTY, OTWARTY oddaje `pin`, `lock`, `delete`.
//   2. WPIS PRZYPIĘTY, ZAMKNIĘTY, ZDJĘTY Z KLUBU oddaje `unpin`, `unlock`,
//      `restore` - komplet odwrotności.
//   3. PODGLĄD jest osobnym zdarzeniem, nie akcją moderacyjną.
//   4. WARIANT `compact` (karta poniżej lg) ma etykiety WIDOCZNE, a wariant
//      tabelaryczny - tylko dla czytnika ekranu. To nie kosmetyka: w tabeli
//      z ośmioma kolumnami tekst przy każdej ikonie wypycha kolumnę akcji
//      poza ekran.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie powtarza tabeli kierunków akcji
// (`threadRowActions` w `adminThreadsBoard.test.ts`) ani mutacji - molekuła
// nie zna klubu i nie woła RPC.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));

import { ClubModerationThreadActions } from "@/components/admin/clubs/molecules/ClubModerationThreadActions";
import { adminThreadRow } from "@/test/clubs/adminThreadFixtures";

/** Przycisk zawierający dany klucz i18n w treści. */
function button(key: string): HTMLElement {
  const found = screen
    .getAllByRole("button")
    .find((element) => (element.textContent ?? "").includes(key));
  if (found === undefined) throw new Error(`brak przycisku dla klucza ${key}`);
  return found;
}

describe("akcje wiersza tematu", () => {
  it("wpis żywy oddaje przypięcie, zamknięcie i usunięcie", () => {
    const onAct = vi.fn();
    render(
      <ClubModerationThreadActions
        row={adminThreadRow({ pinned_at: "", locked_at: "", status: "open" })}
        onAct={onAct}
        onOpen={vi.fn()}
      />,
    );

    fireEvent.click(button("adminClubs.threads.pin"));
    fireEvent.click(button("adminClubs.threads.lock"));
    fireEvent.click(button("adminClubs.threads.delete"));

    expect(onAct.mock.calls.map(([action]) => action)).toEqual(["pin", "lock", "delete"]);
  });

  it("wpis przypięty, zamknięty i zdjęty z klubu oddaje odwrotności", () => {
    const onAct = vi.fn();
    render(
      <ClubModerationThreadActions
        row={adminThreadRow({
          pinned_at: "2026-08-18T10:00:00.000Z",
          locked_at: "2026-08-18T11:00:00.000Z",
          status: "deleted",
        })}
        onAct={onAct}
        onOpen={vi.fn()}
      />,
    );

    fireEvent.click(button("adminClubs.threads.unpin"));
    fireEvent.click(button("adminClubs.threads.unlock"));
    fireEvent.click(button("adminClubs.threads.restore"));

    expect(onAct.mock.calls.map(([action]) => action)).toEqual(["unpin", "unlock", "restore"]);
  });

  it("podgląd jest osobnym zdarzeniem, bez akcji moderacyjnej", () => {
    const onAct = vi.fn();
    const onOpen = vi.fn();
    render(<ClubModerationThreadActions row={adminThreadRow()} onAct={onAct} onOpen={onOpen} />);

    fireEvent.click(button("adminClubs.threads.open"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onAct).not.toHaveBeenCalled();
  });

  it("wariant tabelaryczny ukrywa etykiety przed wzrokiem, ale nie przed czytnikiem", () => {
    render(<ClubModerationThreadActions row={adminThreadRow()} onAct={vi.fn()} onOpen={vi.fn()} />);

    const label = screen.getByText("adminClubs.threads.open");
    expect(label.className).toContain("sr-only");
  });

  it("wariant karty pokazuje etykiety obok ikon", () => {
    render(
      <ClubModerationThreadActions
        row={adminThreadRow()}
        onAct={vi.fn()}
        onOpen={vi.fn()}
        compact
      />,
    );

    const label = screen.getByText("adminClubs.threads.open");
    expect(label.className).not.toContain("sr-only");
    expect(button("adminClubs.threads.open").className).toContain("h-7");
  });
});
