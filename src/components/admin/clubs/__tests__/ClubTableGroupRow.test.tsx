// Molekuła wiersza działu klubu - DWIE DROGI DO USTAWIEŃ I JAWNE DZIEDZICZENIE.
//
// CO TEN PLIK DOWODZI.
//   1. DO USTAWIEŃ DZIAŁU PROWADZĄ DWA ELEMENTY: nazwa (najkrótsza droga -
//      klik w wiersz) i ikona koła zębatego (dla tych, którzy jej szukają).
//      Oba wołają ten sam handler, więc oba są realnie klikane w teście.
//   2. UCHWYT PRZECIĄGANIA MA DOSTĘPNĄ NAZWĘ - bez niej wiersz jest dla
//      czytnika ekranu przyciskiem bez treści.
//   3. ETYKIETA DZIEDZICZENIA jest widoczna WYŁĄCZNIE przy wartości z klubu.
//      Bez tego rozróżnienia wartość klubu wygląda jak ustawiona na dziale,
//      a pierwsza zmiana ustawień klubu przestaje działać „bez powodu".
//   4. ZNACZNIKI dostają ZAWĘŻONE wartości, więc status z innej migracji
//      renderuje wersję roboczą, a nie pustą klasę.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł projekcji wiersza i kolejności -
// `lib/clubs/__tests__/adminClubGroupsBoard.test.ts`. (2) Tonów znaczników -
// `ClubBadges.test.tsx`. (3) Mechaniki przeciągania dnd-kit (biblioteka) ani
// zapisu kolejności - `ClubGroupsTab.test.tsx`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";

const h = vi.hoisted(() => ({ przeciagany: false }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
// Stan „w trakcie przeciągania" jest wewnątrz dnd-kit i pod happy-dom nie da się
// go wywołać zdarzeniem wskaźnika (brak pełnego pointer API). Owijamy PRAWDZIWY
// hook i podmieniamy tylko tę jedną flagę - reszta (atrybuty ARIA, nasłuchy,
// transformacja) zostaje biblioteczna.
vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/sortable")>();
  return {
    ...actual,
    useSortable: (args: Parameters<typeof actual.useSortable>[0]) => ({
      ...actual.useSortable(args),
      isDragging: h.przeciagany,
    }),
  };
});

import { ClubTableGroupRow } from "@/components/admin/clubs/molecules/ClubTableGroupRow";
import { clubGroupRowView } from "@/lib/clubs/adminClubGroupsBoard";
import type { AdminClubGroupRow } from "@/lib/clubs/types";
import { adminClubGroupRow } from "@/test/clubs/clubTableFixtures";

beforeEach(() => {
  h.przeciagany = false;
});

function renderRow(overrides: Partial<AdminClubGroupRow> = {}, onEdit = vi.fn()) {
  const view = clubGroupRowView(adminClubGroupRow(overrides), "pl");
  render(
    <DndContext>
      <SortableContext items={[view.id]}>
        <ul>
          <ClubTableGroupRow view={view} onEdit={onEdit} />
        </ul>
      </SortableContext>
    </DndContext>,
  );
  return onEdit;
}

describe("wiersz działu klubu", () => {
  it("nazwa działu otwiera ustawienia", () => {
    const onEdit = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "Dyskusje" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("ikona ustawień otwiera te same ustawienia", () => {
    const onEdit = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "adminClubs.groups.editTitle" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("uchwyt przeciągania ma dostępną nazwę", () => {
    renderRow();

    expect(screen.getByRole("button", { name: "adminClubs.groups.reorderHint" })).toBeTruthy();
  });

  it("adres działu i licznik wątków jadą z projekcji", () => {
    renderRow({ thread_count: 9 });

    expect(screen.getByText("/dyskusje")).toBeTruthy();
    expect(screen.getByText("club.threadsCount(count=9)")).toBeTruthy();
  });

  it("wartość DZIEDZICZONA z klubu jest opisana wprost", () => {
    renderRow({ visibility_inherited: true });

    expect(screen.getByText("club.inheritedFromClub")).toBeTruthy();
  });

  it("wartość NADPISANA na dziale nie udaje dziedziczonej", () => {
    renderRow({ visibility_inherited: false, visibility: "secret" });

    expect(screen.queryByText("club.inheritedFromClub")).toBeNull();
    expect(screen.getByText("club.visibility.secret")).toBeTruthy();
  });

  it("status z innej migracji renderuje wersję roboczą", () => {
    renderRow({ status: "published" });

    expect(screen.getByText("club.groupStatus.draft")).toBeTruthy();
  });

  it("dział ZAMROŻONY pokazuje własny status", () => {
    renderRow({ status: "frozen" });

    expect(screen.getByText("club.groupStatus.frozen")).toBeTruthy();
  });

  it("wiersz w trakcie przeciągania jest przygaszony", () => {
    // Przygaszenie jest jedyną informacją o tym, KTÓRY wiersz trzyma kursor -
    // bez niej lista trzech podobnych działów podczas przeciągania kłamie.
    h.przeciagany = true;
    renderRow();

    const wiersz = screen.getByRole("listitem");
    expect(wiersz.className).toContain("opacity-60");
    expect(wiersz.className).toContain("shadow-lg");
  });

  it("wiersz spoczywający NIE jest przygaszony", () => {
    renderRow();

    expect(screen.getByRole("listitem").className).not.toContain("opacity-60");
  });
});
