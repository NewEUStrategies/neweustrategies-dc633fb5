// Zakładka „Grupy" - SKLEJENIE listy działów z mutacjami.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY STANY LISTY MAJĄ TRZY WIDOKI: szkielet w locie, komunikat pustki
//      i lista. Szkielet nie może wyglądać jak „brak działów" - administrator
//      zakłada wtedy drugi dział o tej samej nazwie.
//   2. PRZECIĄGNIĘCIE ZAPISUJE SIĘ JEDNYM WYWOŁANIEM na całą listę, a lokalna
//      kolejność zmienia się PRZED odpowiedzią serwera (przeciąganie, które
//      wraca na miejsce na czas round-tripu, czyta się jak zepsute).
//   3. AWARIA ZAPISU COFA optymistyczną zmianę do odpowiedzi serwera - lista
//      pokazująca kolejność inną niż zapisana jest gorsza niż brak przeciągania.
//   4. PRZECIĄGNIĘCIE BEZ SKUTKU (na siebie, poza listę) NIE WOŁA mutacji.
//   5. NOWY DZIAŁ jedzie z nazwami w OBU kolumnach językowych i ze statusem
//      roboczym - kolumna trzyma język, który zapowiada jej nazwa, więc przy
//      angielskim interfejsie do kolumny polskiej NIE wpisuje się „New section".
//   6. KLIK W DZIAŁ OTWIERA EDYTOR z tym działem, a zamknięcie go zwalnia;
//      edytor dostaje RODZEŃSTWO w aktualnej kolejności (to z niego liczy się
//      pozycję i unikalność sluga).
//   7. DZIAŁ ZAMROŻONY, DZIAŁ PUSTY i DZIAŁ Z DZIEDZICZENIEM renderują się bez
//      gołego `undefined` na ekranie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguły nowej kolejności i trzech stanów -
// tabela przypadków w `lib/clubs/__tests__/adminClubGroupsBoard.test.ts`; tutaj
// dowodzimy, że organizm ją WOŁA i co robi z wynikiem. (2) Znacznika wiersza
// działu - `ClubTableGroupRow.test.tsx`. (3) Hierarchii działów po slugu -
// `groupTree.test.ts`. (4) Samego edytora działu (`ClubGroupEditorDialog`) -
// należy do innego organizmu, tu jest atrapą-markerem. (5) Mechaniki dnd-kit:
// pod happy-dom nie ma pełnego pointer API, więc `onDragEnd` wołamy wprost -
// przedmiotem dowodu jest handler, nie biblioteka.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AdminClubGroupRow, ClubGroupUpsertInput } from "@/lib/clubs/types";

/** Minimalny kształt zdarzenia upuszczenia - tylko to, co czyta handler. */
type Upuszczenie = { active: { id: string | number }; over: { id: string | number } | null };
type Wynik = { onSuccess: () => void; onError: () => void };

const h = vi.hoisted(() => ({
  grupy: undefined as AdminClubGroupRow[] | undefined,
  isPending: false,
  groupsCalls: [] as string[],
  reorderClub: [] as string[],
  reorderIds: [] as string[][],
  reorderFails: false,
  createClub: [] as string[],
  createInputs: [] as ClubGroupUpsertInput[],
  createFails: false,
  createPending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  onDragEnd: null as ((event: Upuszczenie) => void) | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// dnd-kit pod happy-dom nie ma pełnego pointer API, więc kontekst przeciągania
// jest przelotką, a handler upuszczenia przechwytujemy i wołamy wprost.
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: ({
      onDragEnd,
      children,
    }: {
      onDragEnd?: (event: Upuszczenie) => void;
      children?: ReactNode;
    }) => {
      h.onDragEnd = onDragEnd ?? null;
      return <div data-testid="obszar-przeciagania">{children}</div>;
    },
  };
});
vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/sortable")>();
  return {
    ...actual,
    SortableContext: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => undefined,
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});
vi.mock("@/components/admin/clubs/organisms/ClubGroupEditorDialog", () => ({
  ClubGroupEditorDialog: ({
    clubId,
    group,
    siblings,
    onOpenChange,
  }: {
    clubId: string;
    group: AdminClubGroupRow | null;
    siblings: readonly AdminClubGroupRow[];
    onOpenChange: (open: boolean) => void;
  }) => (
    <div
      data-testid="edytor-dzialu"
      data-klub={clubId}
      data-grupa={group === null ? "" : group.id}
      data-rodzenstwo={siblings.map((g) => g.id).join(",")}
    >
      <button type="button" data-testid="zamknij-edytor" onClick={() => onOpenChange(false)} />
      <button type="button" data-testid="otworz-edytor" onClick={() => onOpenChange(true)} />
    </div>
  ),
}));
vi.mock("@/lib/clubs/useClubs", () => ({
  useAdminClubGroups: (clubId: string) => {
    h.groupsCalls.push(clubId);
    return { data: h.grupy, isPending: h.isPending };
  },
  useReorderClubGroups: (clubId: string) => {
    h.reorderClub.push(clubId);
    return {
      mutate: (ids: string[], wynik: Wynik) => {
        h.reorderIds.push(ids);
        if (h.reorderFails) wynik.onError();
        else wynik.onSuccess();
      },
      isPending: false,
    };
  },
  useUpsertClubGroup: (clubId: string) => {
    h.createClub.push(clubId);
    return {
      mutate: (input: ClubGroupUpsertInput, wynik: Wynik) => {
        h.createInputs.push(input);
        if (h.createFails) wynik.onError();
        else wynik.onSuccess();
      },
      isPending: h.createPending,
    };
  },
}));

import { ClubGroupsTab } from "@/components/admin/clubs/organisms/ClubGroupsTab";
import { CLUB_BASE_ISO, CLUB_IDS } from "@/test/clubs/fixtures";
import { adminClubGroupRow } from "@/test/clubs/clubTableFixtures";

function trzyDzialy(): AdminClubGroupRow[] {
  return [
    adminClubGroupRow({ id: "g1", slug: "pierwszy", name_pl: "Pierwszy" }),
    adminClubGroupRow({ id: "g2", slug: "drugi", name_pl: "Drugi" }),
    adminClubGroupRow({ id: "g3", slug: "trzeci", name_pl: "Trzeci" }),
  ];
}

function panel() {
  return render(<ClubGroupsTab clubId={CLUB_IDS.club} />);
}

/** Kolejność nazw działów widoczna na ekranie. */
function kolejnosc(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((li) => li.querySelector("button.truncate")?.textContent ?? "");
}

function upusc(activeId: string | number, overId: string | number | null): void {
  const handler = h.onDragEnd;
  if (handler === null) throw new Error("organizm nie wystawił handlera upuszczenia");
  act(() => handler({ active: { id: activeId }, over: overId === null ? null : { id: overId } }));
}

function edytor(): HTMLElement {
  return screen.getByTestId("edytor-dzialu");
}

beforeEach(() => {
  h.grupy = trzyDzialy();
  h.isPending = false;
  h.groupsCalls = [];
  h.reorderClub = [];
  h.reorderIds = [];
  h.reorderFails = false;
  h.createClub = [];
  h.createInputs = [];
  h.createFails = false;
  h.createPending = false;
  h.onDragEnd = null;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("trzy stany listy działów", () => {
  it("zapytanie W LOCIE pokazuje szkielet, nie komunikat pustki", () => {
    h.isPending = true;
    h.grupy = undefined;
    panel();

    expect(document.querySelector("[aria-busy='true']")).toBeTruthy();
    expect(screen.queryByText("adminClubs.groups.empty")).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("brak działów mówi to wprost i nie rysuje podpowiedzi o przeciąganiu", () => {
    h.grupy = [];
    panel();

    expect(screen.getByText("adminClubs.groups.empty")).toBeTruthy();
    expect(screen.queryByTestId("obszar-przeciagania")).toBeNull();
  });

  it("lista działów rysuje wiersz na dział i podpowiedź o kolejności", () => {
    panel();

    expect(kolejnosc()).toEqual(["Pierwszy", "Drugi", "Trzeci"]);
    expect(screen.getByText("adminClubs.groups.reorderHint")).toBeTruthy();
    expect(h.groupsCalls[0]).toBe(CLUB_IDS.club);
  });

  it("dane CZĘŚCIOWE: dział bez nazwy polskiej i bez wątków renderuje się bez pustki", () => {
    h.grupy = [adminClubGroupRow({ name_pl: "", thread_count: 0, status: "frozen" })];
    const { container } = panel();

    expect(screen.getByText("Discussions")).toBeTruthy();
    expect(screen.getByText("club.threadsCount(count=0)")).toBeTruthy();
    expect(screen.getByText("club.groupStatus.frozen")).toBeTruthy();
    expect(container.textContent).not.toContain("undefined");
  });

  it("dział z DZIEDZICZONĄ widocznością mówi, skąd wartość", () => {
    h.grupy = [adminClubGroupRow({ visibility_inherited: true, visibility: "private" })];
    panel();

    expect(screen.getByText("club.inheritedFromClub")).toBeTruthy();
    expect(screen.getByText("club.visibility.private")).toBeTruthy();
  });
});

describe("zmiana kolejności", () => {
  it("nowa kolejność jedzie JEDNYM wywołaniem i od razu widać ją na liście", () => {
    panel();

    upusc("g3", "g1");

    expect(h.reorderIds).toEqual([["g3", "g1", "g2"]]);
    expect(h.reorderClub[0]).toBe(CLUB_IDS.club);
    expect(kolejnosc()).toEqual(["Trzeci", "Pierwszy", "Drugi"]);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.groups.reordered");
  });

  it("AWARIA zapisu cofa kolejność do odpowiedzi serwera", () => {
    h.reorderFails = true;
    panel();

    upusc("g1", "g3");

    expect(h.reorderIds).toEqual([["g2", "g3", "g1"]]);
    expect(kolejnosc()).toEqual(["Pierwszy", "Drugi", "Trzeci"]);
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("AWARIA zapisu przy PUSTEJ odpowiedzi serwera zostawia listę pustą, nie starą", () => {
    // Realny przebieg: unieważnienie cache po błędzie zdejmuje dane
    // (`data: undefined`), a cofnięcie optymistycznej zmiany NIE MA do czego
    // wrócić. Lista musi wtedy powiedzieć „brak działów", a nie pokazywać
    // kolejności, której nikt nie zapisał.
    h.reorderFails = true;
    const { rerender } = panel();
    h.grupy = undefined;
    rerender(<ClubGroupsTab clubId={CLUB_IDS.club} />);

    upusc("g1", "g3");

    expect(h.reorderIds).toEqual([["g2", "g3", "g1"]]);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("adminClubs.groups.empty")).toBeTruthy();
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
  });

  it("upuszczenie NA SOBIE i POZA LISTĄ nie wysyła mutacji", () => {
    panel();

    upusc("g2", "g2");
    upusc("g2", null);
    upusc("nieistniejacy", "g1");

    expect(h.reorderIds).toEqual([]);
    expect(kolejnosc()).toEqual(["Pierwszy", "Drugi", "Trzeci"]);
  });
});

describe("zakładanie działu", () => {
  it("nowy dział ma nazwy w OBU kolumnach i status roboczy", () => {
    // `Date.now()` jest podmienione na stały znacznik: slug ma być
    // przewidywalny, a nie zależny od chwili uruchomienia testu.
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(CLUB_BASE_ISO));
    panel();

    fireEvent.click(screen.getByRole("button", { name: /adminClubs.groups.newGroup/ }));

    expect(h.createInputs).toEqual([
      {
        club_id: CLUB_IDS.club,
        slug: `dzial-${Date.parse(CLUB_BASE_ISO).toString(36)}`,
        name_pl: "Nowy dział",
        name_en: "New section",
        status: "draft",
      },
    ]);
    expect(h.createClub[0]).toBe(CLUB_IDS.club);
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.saved");
    vi.restoreAllMocks();
  });

  it("AWARIA zakładania mówi o błędzie zapisu", () => {
    h.createFails = true;
    panel();

    fireEvent.click(screen.getByRole("button", { name: /adminClubs.groups.newGroup/ }));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("w trakcie zapisu przycisk jest zablokowany", () => {
    h.createPending = true;
    panel();

    const przycisk = screen.getByRole("button", { name: /adminClubs.groups.newGroup/ });
    expect(przycisk.hasAttribute("disabled")).toBe(true);
  });
});

describe("edytor działu", () => {
  it("startuje zamknięty i dostaje rodzeństwo w aktualnej kolejności", () => {
    panel();

    expect(edytor().getAttribute("data-grupa")).toBe("");
    expect(edytor().getAttribute("data-klub")).toBe(CLUB_IDS.club);
    expect(edytor().getAttribute("data-rodzenstwo")).toBe("g1,g2,g3");
  });

  it("klik w nazwę działu otwiera edytor z TYM działem", () => {
    panel();

    fireEvent.click(screen.getByRole("button", { name: "Drugi" }));

    expect(edytor().getAttribute("data-grupa")).toBe("g2");
  });

  it("klik w ikonę ustawień otwiera ten sam edytor", () => {
    panel();

    fireEvent.click(screen.getAllByRole("button", { name: "adminClubs.groups.editTitle" })[2]!);

    expect(edytor().getAttribute("data-grupa")).toBe("g3");
  });

  it("zamknięcie zwalnia wybrany dział, a zdarzenie otwarcia go nie czyści", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Pierwszy" }));

    fireEvent.click(screen.getByTestId("otworz-edytor"));
    expect(edytor().getAttribute("data-grupa")).toBe("g1");

    fireEvent.click(screen.getByTestId("zamknij-edytor"));
    expect(edytor().getAttribute("data-grupa")).toBe("");
  });

  it("rodzeństwo idzie do edytora W NOWEJ kolejności po przeciągnięciu", () => {
    panel();

    upusc("g3", "g1");

    expect(edytor().getAttribute("data-rodzenstwo")).toBe("g3,g1,g2");
  });
});
