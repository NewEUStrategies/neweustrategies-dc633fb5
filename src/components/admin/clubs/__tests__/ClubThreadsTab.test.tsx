// Zakładka „Tematy” panelu - SKLEJENIE, nie reguły.
//
// CO TEN PLIK DOWODZI. Reguły tej zakładki (przecięcie zaznaczenia z widocznymi
// wierszami, kierunek akcji, walidacja i ładunek nowego tematu, ładunek
// odpowiedzi, działy docelowe przeniesienia) mają tabelę przypadków
// w `src/lib/clubs/__tests__/adminThreadsBoard.test.ts`, a powtarzalne
// fragmenty widoku - własne testy molekuł. Tutaj sprawdzamy to, czego ani
// czysta funkcja, ani molekuła nie obejmuje:
//
//   1. CO ZAKŁADKA WYSYŁA DO ZAPYTANIA. Fraza i trzy filtry jadą do
//      `useAdminClubThreads`, a „wszystkie” jedzie jako `null` - nie jako
//      napis `__any__`, który RPC potraktowałby jako realne zawężenie
//      i oddał pustą listę.
//   2. CZTERY STANY ZAPYTANIA. Dane pełne / dane częściowe (wiersz bez
//      opcjonalnych pól nie może pokazać gołego `undefined`) / zapytanie
//      w locie / awaria i pustka.
//   3. CO JEDZIE DO MUTACJI. Akcja wiersza, wsad (z liczbą „ile z ilu”),
//      przeniesienie, nowy temat, nowa odpowiedź - i CO SIĘ DZIEJE PO AWARII
//      każdej z nich.
//   4. ZAZNACZENIE ZNIKA RAZEM Z WIERSZEM. Wiersz, który wypadł z listy po
//      zmianie filtra, przestaje być liczony w pasku wsadu - bez tego „usuń 12”
//      kasuje wpisy, których administrator nie ma na ekranie.
//   5. USUNIĘCIE WSADOWE PRZECHODZI PRZEZ DIALOG, a akcje odwracalne nie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie powtarza progów walidacji tematu ani tabeli
// kierunków akcji (`adminThreadsBoard.test.ts`), nie testuje wyglądu przycisków
// akcji (`ClubModerationThreadActions.test.tsx`), linii autora
// (`ClubModerationThreadAuthor.test.tsx`) ani paska wsadu
// (`ClubModerationBulkBar.test.tsx`). Nie sprawdza autorytetu RPC - moderacja
// i tworzenie wpisów mają pgTAP. Hooki są atrapami NA POZIOMIE MODUŁU, bo
// przedmiotem dowodu jest to, CO organizm do nich wysyła.
//
// TRZY GAŁĘZIE NIEOSIĄGALNE Z TESTU, świadomie zostawione w kodzie:
//   * `if (selectedVisible.length === 0) return` w akcji wsadowej - pasek wsadu
//     renderuje się WYŁĄCZNIE przy niepustym zaznaczeniu, a deskryptor
//     potwierdzenia domyka `bulkAct` z renderu, w którym zaznaczenie już było;
//   * `if (!openThread) return` w przeniesieniu - droplista działu docelowego
//     mieszka w treści dialogu, która nie istnieje, dopóki wątek jest `null`;
//   * `if (vars === null) return` przy publikacji odpowiedzi - przycisk jest
//     wyłączony dokładnie wtedy, gdy ładunek wyszedłby pusty.
// Wszystkie trzy są obroną na wypadek przestawienia warunków wyżej i nie da
// się ich wywołać bez rozmontowania tych gwarancji.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

/** Domknięcia mutacji React Query, w kształcie, w jakim organizm je podaje. */
interface MutationHandlers {
  onSuccess?: (data: number) => void;
  onError?: (error: Error) => void;
}

const h = vi.hoisted(() => ({
  threads: { rows: [] as unknown[], total: 0 } as { rows: unknown[]; total: number } | undefined,
  threadsPending: false,
  threadCalls: [] as { clubId: string | undefined; filters: Record<string, unknown> }[],
  groups: [] as unknown[] | undefined,
  replies: { rows: [] as unknown[], total: 0 } as { rows: unknown[]; total: number } | undefined,
  repliesPending: false,
  replyThreadIds: [] as (string | undefined)[],
  moderate: vi.fn(),
  moderatePending: false,
  bulk: vi.fn(),
  bulkPending: false,
  move: vi.fn(),
  createThread: vi.fn(),
  createPending: false,
  createReply: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
// Opóźnienie frazy jest tu tożsamością: przedmiotem dowodu jest to, CO dojedzie
// do zapytania, a nie po ilu milisekundach.
vi.mock("@/hooks/useDebouncedValue", () => ({ useDebouncedValue: (value: string) => value }));

// Radix Select nie działa pod happy-dom bez pełnego pointer API - podmieniamy
// na natywną dropListę. Przedmiotem dowodu jest to, KTÓRE opcje zakładka
// wystawia i CO robi ze zmianą, nie mechanika biblioteki.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <select
      data-testid="select"
      value={value ?? ""}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("@/components/admin/community/MemberPicker", () => ({
  MemberPicker: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <button
      type="button"
      data-testid="member-picker"
      data-value={value}
      onClick={() => onChange("user-member")}
    >
      wybierz osobę
    </button>
  ),
}));
vi.mock("@/components/clubs/molecules/ClubTopicSelect", () => ({
  ClubTopicSelect: ({ onChange }: { onChange: (next: string | null) => void }) => (
    <button type="button" data-testid="topic-select" onClick={() => onChange("energy")}>
      obszar
    </button>
  ),
}));
vi.mock("@/components/clubs/molecules/ClubEnumSelect", () => ({
  ClubEnumSelect: ({
    value,
    options,
    onChange,
  }: {
    value: string;
    options: readonly string[];
    onChange: (next: string) => void;
  }) => (
    <select
      data-testid="enum-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/lib/clubs/useClubs", () => ({
  useAdminClubThreads: (clubId: string | undefined, filters: Record<string, unknown>) => {
    h.threadCalls.push({ clubId, filters });
    return { data: h.threads, isPending: h.threadsPending, isError: false };
  },
  useAdminClubGroups: () => ({ data: h.groups, isPending: false, isError: false }),
  useAdminClubReplies: (threadId: string | undefined) => {
    h.replyThreadIds.push(threadId);
    return { data: h.replies, isPending: h.repliesPending, isError: false };
  },
  useModerateClubTarget: () => ({ mutate: h.moderate, isPending: h.moderatePending }),
  useBulkModerateClub: () => ({ mutate: h.bulk, isPending: h.bulkPending }),
  useMoveClubThread: () => ({ mutate: h.move, isPending: false }),
  useAdminCreateThread: () => ({ mutate: h.createThread, isPending: h.createPending }),
  useAdminCreateReply: () => ({ mutate: h.createReply, isPending: false }),
}));

import { ClubThreadsTab } from "@/components/admin/clubs/organisms/ClubThreadsTab";
import { CLUB_IDS } from "@/test/clubs/fixtures";
import { adminClubGroupRow } from "@/test/clubs/clubTableFixtures";
import { adminReplyRow, adminThreadRow } from "@/test/clubs/adminThreadFixtures";

const CLUB = CLUB_IDS.club;

function panel() {
  return render(<ClubThreadsTab clubId={CLUB} />);
}

/** Ostatnie filtry, z jakimi zakładka zapytała o listę. */
function lastFilters(): Record<string, unknown> {
  const call = h.threadCalls[h.threadCalls.length - 1];
  if (call === undefined) throw new Error("zakładka nie zapytała o listę");
  return call.filters;
}

/** Przyciski o treści zawierającej dany klucz i18n. */
function buttons(key: string): HTMLElement[] {
  return screen.queryAllByRole("button").filter((b) => (b.textContent ?? "").includes(key));
}

function firstButton(key: string): HTMLElement {
  const found = buttons(key)[0];
  if (found === undefined) throw new Error(`brak przycisku dla klucza ${key}`);
  return found;
}

/** Pole zaznaczenia o danej etykiecie (pierwsze z dwóch układów). */
function firstCheckbox(name: string): HTMLElement {
  const found = screen.getAllByRole("checkbox", { name });
  if (found[0] === undefined) throw new Error(`brak pola zaznaczenia ${name}`);
  return found[0];
}

function texts(fragment: string): HTMLElement[] {
  return screen.queryAllByText((text) => text.includes(fragment));
}

/** Droplista filtra po etykiecie z `aria-label` na wyzwalaczu. */
function filterSelect(index: number): HTMLElement {
  const found = screen.getAllByTestId("select")[index];
  if (found === undefined) throw new Error(`brak dropListy o indeksie ${index}`);
  return found;
}

beforeEach(() => {
  h.threads = { rows: [], total: 0 };
  h.threadsPending = false;
  h.threadCalls = [];
  h.groups = [];
  h.replies = { rows: [], total: 0 };
  h.repliesPending = false;
  h.replyThreadIds = [];
  h.moderatePending = false;
  h.bulkPending = false;
  h.createPending = false;
  h.moderate.mockReset().mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
    handlers.onSuccess?.(1);
  });
  h.bulk.mockReset().mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
    handlers.onSuccess?.(1);
  });
  h.move.mockReset().mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
    handlers.onSuccess?.(1);
  });
  h.createThread.mockReset().mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
    handlers.onSuccess?.(1);
  });
  h.createReply.mockReset().mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
    handlers.onSuccess?.(1);
  });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("cztery stany listy tematów", () => {
  it("zapytanie W LOCIE pokazuje szkielet, a nie pustkę", () => {
    h.threads = undefined;
    h.threadsPending = true;
    panel();

    expect(document.querySelectorAll('[aria-busy="true"]').length).toBe(1);
    expect(texts("adminClubs.threads.empty")).toHaveLength(0);
  });

  it("awaria zapytania pokazuje zdanie o pustce, nie gołe „undefined”", () => {
    // Zakładka nie ma osobnego komunikatu awarii: `data` jest wtedy
    // `undefined`, a `?? []` musi dać pustą listę, nie wysypkę.
    h.threads = undefined;
    h.threadsPending = false;
    panel();

    expect(texts("adminClubs.threads.empty")).toHaveLength(1);
    expect(texts("undefined")).toHaveLength(0);
  });

  it("pusta lista mówi to wprost i nie wystawia żadnej akcji wiersza", () => {
    panel();

    expect(texts("adminClubs.threads.empty")).toHaveLength(1);
    expect(buttons("adminClubs.threads.pin")).toHaveLength(0);
  });

  it("dane pełne renderują wiersz w tabeli I w karcie - te same akcje", () => {
    h.threads = {
      rows: [adminThreadRow({ id: "t1", title: "Temat o cenach energii", reply_count: 7 })],
      total: 1,
    };
    panel();

    // Dwa układy tej samej treści (tabela od lg, karta poniżej) - stąd dwa
    // trafienia na tytuł, a nie jedno.
    expect(screen.getAllByText("Temat o cenach energii")).toHaveLength(2);
    expect(buttons("adminClubs.threads.open")).toHaveLength(2);
  });

  it("dane CZĘŚCIOWE: wiersz bez działu i bez autora nie pokazuje „undefined”", () => {
    h.threads = {
      rows: [
        adminThreadRow({
          id: "t1",
          group_name_pl: "",
          group_name_en: "",
          author_name: "",
          posted_by_admin_name: "",
          pinned_at: "",
          locked_at: "",
        }),
      ],
      total: 1,
    };
    panel();

    expect(texts("undefined")).toHaveLength(0);
    // Brak przypięcia to „przypnij”, nie „odepnij” - pustka znacznika czasu
    // przychodzi z RPC jako pusty napis.
    expect(buttons("adminClubs.threads.pin").length).toBeGreaterThan(0);
    expect(buttons("adminClubs.threads.unpin")).toHaveLength(0);
  });
});

describe("co jedzie do zapytania", () => {
  it("start bez zawężeń: trzy filtry jako null, fraza pusta", () => {
    panel();

    expect(lastFilters()).toEqual({ groupId: null, status: null, kind: null, search: "" });
    expect(h.threadCalls[0]?.clubId).toBe(CLUB);
  });

  it("fraza z pola wyszukiwania dojeżdża do zapytania", () => {
    panel();

    fireEvent.change(screen.getByLabelText("adminClubs.threads.searchPlaceholder"), {
      target: { value: "energia" },
    });

    expect(lastFilters().search).toBe("energia");
  });

  it("wybór działu jedzie jako identyfikator, a „wszystkie” jako null", () => {
    h.groups = [adminClubGroupRow({ id: CLUB_IDS.group, name_pl: "Dyskusje" })];
    panel();

    fireEvent.change(filterSelect(0), { target: { value: CLUB_IDS.group } });
    expect(lastFilters().groupId).toBe(CLUB_IDS.group);

    fireEvent.change(filterSelect(0), { target: { value: "__any__" } });
    expect(lastFilters().groupId).toBeNull();
  });

  it("status i rodzaj jadą osobno, każdy z własnym powrotem do „wszystkie”", () => {
    panel();

    fireEvent.change(filterSelect(1), { target: { value: "locked" } });
    fireEvent.change(filterSelect(2), { target: { value: "question" } });
    expect(lastFilters().status).toBe("locked");
    expect(lastFilters().kind).toBe("question");

    fireEvent.change(filterSelect(1), { target: { value: "__any__" } });
    fireEvent.change(filterSelect(2), { target: { value: "__any__" } });
    expect(lastFilters().status).toBeNull();
    expect(lastFilters().kind).toBeNull();
  });
});

describe("akcja moderatorska na jednym wierszu", () => {
  beforeEach(() => {
    h.threads = { rows: [adminThreadRow({ id: "t1", title: "Temat" })], total: 1 };
  });

  it("przypięcie woła RPC z typem celu „thread” i potwierdza toastem", () => {
    panel();

    fireEvent.click(firstButton("adminClubs.threads.pin"));

    expect(h.moderate).toHaveBeenCalledWith(
      { targetType: "thread", targetId: "t1", action: "pin" },
      expect.anything(),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.saved");
  });

  it("awaria akcji pokazuje komunikat błędu, nie fałszywy sukces", () => {
    h.moderate.mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
      handlers.onError?.(new Error("denied"));
    });
    panel();

    fireEvent.click(firstButton("adminClubs.threads.pin"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("wpis zdjęty z klubu wysyła PRZYWRÓCENIE, nie kolejne usunięcie", () => {
    h.threads = { rows: [adminThreadRow({ id: "t1", status: "deleted" })], total: 1 };
    panel();

    fireEvent.click(firstButton("adminClubs.threads.restore"));

    expect(h.moderate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "restore", targetId: "t1" }),
      expect.anything(),
    );
  });
});

describe("wsad na liście tematów", () => {
  beforeEach(() => {
    h.threads = {
      rows: [
        adminThreadRow({ id: "t1", title: "Pierwszy" }),
        adminThreadRow({ id: "t2", title: "Drugi" }),
      ],
      total: 2,
    };
  });

  it("pasek wsadu pojawia się DOPIERO po zaznaczeniu", () => {
    panel();
    expect(texts("adminClubs.threads.selected")).toHaveLength(0);

    fireEvent.click(firstCheckbox("Pierwszy"));

    expect(texts("adminClubs.threads.selected(count=1)")).toHaveLength(1);
  });

  it("„zaznacz wszystkie” bierze CAŁĄ widoczną stronę, a drugi klik ją zwalnia", () => {
    panel();
    const all = firstCheckbox("adminClubs.threads.selectAll");

    fireEvent.click(all);
    expect(texts("adminClubs.threads.selected(count=2)")).toHaveLength(1);

    fireEvent.click(all);
    expect(texts("adminClubs.threads.selected")).toHaveLength(0);
  });

  it("wsadowe przypięcie wysyła identyfikatory i mówi ILE Z ILU", () => {
    h.bulk.mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
      handlers.onSuccess?.(2);
    });
    panel();
    fireEvent.click(firstCheckbox("adminClubs.threads.selectAll"));

    fireEvent.click(firstButton("adminClubs.threads.pin"));

    expect(h.bulk).toHaveBeenCalledWith(
      { targetType: "thread", targetIds: ["t1", "t2"], action: "pin" },
      expect.anything(),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.threads.bulkDone(done=2,total=2)");
    // Sukces zwalnia zaznaczenie: pasek nie ma zostać nad listą po operacji.
    expect(texts("adminClubs.threads.selected")).toHaveLength(0);
  });

  it("wsadowe zamknięcie i przywrócenie jadą jako osobne akcje", () => {
    panel();
    fireEvent.click(firstCheckbox("Pierwszy"));

    fireEvent.click(firstButton("adminClubs.threads.lock"));
    expect(h.bulk).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "lock", targetIds: ["t1"] }),
      expect.anything(),
    );

    fireEvent.click(firstCheckbox("Pierwszy"));
    fireEvent.click(firstButton("adminClubs.threads.restore"));
    expect(h.bulk).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "restore" }),
      expect.anything(),
    );
  });

  it("wsadowe USUNIĘCIE nie wychodzi przed potwierdzeniem w dialogu", async () => {
    panel();
    fireEvent.click(firstCheckbox("Pierwszy"));

    fireEvent.click(firstButton("adminClubs.threads.delete"));
    expect(h.bulk).not.toHaveBeenCalled();
    expect(texts("adminClubs.threads.bulkDeleteTitle")).toHaveLength(1);

    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(
      within(dialog)
        .getAllByRole("button")
        .find((b) => !(b.textContent ?? "").includes("cancel"))!,
    );

    await waitFor(() =>
      expect(h.bulk).toHaveBeenCalledWith(
        expect.objectContaining({ action: "delete" }),
        expect.anything(),
      ),
    );
  });

  it("awaria wsadu pokazuje błąd i ZOSTAWIA zaznaczenie", () => {
    h.bulk.mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
      handlers.onError?.(new Error("denied"));
    });
    panel();
    fireEvent.click(firstCheckbox("Pierwszy"));

    fireEvent.click(firstButton("adminClubs.threads.pin"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(texts("adminClubs.threads.selected(count=1)")).toHaveLength(1);
  });

  it("trwający wsad wyłącza przyciski paska", () => {
    h.bulkPending = true;
    panel();
    fireEvent.click(firstCheckbox("Pierwszy"));

    fireEvent.click(firstButton("adminClubs.threads.pin"));

    expect(h.bulk).not.toHaveBeenCalled();
  });

  it("„wyczyść zaznaczenie” zwija pasek bez wywołania RPC", () => {
    panel();
    fireEvent.click(firstCheckbox("Pierwszy"));

    fireEvent.click(firstButton("adminClubs.threads.clearSelection"));

    expect(texts("adminClubs.threads.selected")).toHaveLength(0);
    expect(h.bulk).not.toHaveBeenCalled();
  });

  it("wiersz, który WYPADŁ z listy, przestaje być liczony w pasku", () => {
    panel();
    fireEvent.click(firstCheckbox("adminClubs.threads.selectAll"));
    expect(texts("adminClubs.threads.selected(count=2)")).toHaveLength(1);

    // Zmiana filtra zwęża listę do jednego wiersza. Zaznaczenie jest
    // DERYWOWANE, więc „t2” wypada z partii bez dodatkowego renderu.
    h.threads = { rows: [adminThreadRow({ id: "t1", title: "Pierwszy" })], total: 1 };
    fireEvent.change(screen.getByLabelText("adminClubs.threads.searchPlaceholder"), {
      target: { value: "pierwszy" },
    });

    expect(texts("adminClubs.threads.selected(count=1)")).toHaveLength(1);
  });
});

describe("kompozytor nowego tematu", () => {
  beforeEach(() => {
    h.groups = [
      adminClubGroupRow({ id: CLUB_IDS.group, name_pl: "Dyskusje" }),
      adminClubGroupRow({ id: CLUB_IDS.otherGroup, name_pl: "Stanowiska" }),
    ];
  });

  function openComposer() {
    panel();
    fireEvent.click(firstButton("adminClubs.threads.newThread"));
    return screen.getByRole("dialog");
  }

  it("wersja robocza niepełna NIE wychodzi do RPC, pokazuje komunikat walidacji", () => {
    const dialog = openComposer();

    fireEvent.click(within(dialog).getByText("club.publishThread"));

    expect(h.createThread).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.threads.validation");
  });

  it("temat kompletny jedzie do RPC z PIERWSZYM działem, gdy nie wybrano innego", () => {
    const dialog = openComposer();

    fireEvent.change(within(dialog).getByLabelText("club.threadTitle"), {
      target: { value: "  Ceny energii w 2027  " },
    });
    fireEvent.change(within(dialog).getByLabelText("club.threadBody"), {
      target: { value: "  Treść z zapasem znaków ponad próg.  " },
    });
    fireEvent.click(within(dialog).getByText("club.publishThread"));

    expect(h.createThread).toHaveBeenCalledWith(
      {
        groupId: CLUB_IDS.group,
        title: "Ceny energii w 2027",
        body: "Treść z zapasem znaków ponad próg.",
        kind: "discussion",
        authorId: null,
        topic: null,
      },
      expect.anything(),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.threads.created");
  });

  it("wybrany dział, rodzaj, obszar i publikacja w imieniu jadą w ładunku", () => {
    const dialog = openComposer();

    fireEvent.change(within(dialog).getAllByTestId("select")[0]!, {
      target: { value: CLUB_IDS.otherGroup },
    });
    fireEvent.change(within(dialog).getByTestId("enum-select"), {
      target: { value: "question" },
    });
    fireEvent.click(within(dialog).getByTestId("topic-select"));
    fireEvent.click(within(dialog).getByTestId("member-picker"));
    fireEvent.change(within(dialog).getByLabelText("club.threadTitle"), {
      target: { value: "Pytanie o taryfy" },
    });
    fireEvent.change(within(dialog).getByLabelText("club.threadBody"), {
      target: { value: "Treść pytania z zapasem." },
    });
    fireEvent.click(within(dialog).getByText("club.publishThread"));

    expect(h.createThread).toHaveBeenCalledWith(
      {
        groupId: CLUB_IDS.otherGroup,
        title: "Pytanie o taryfy",
        body: "Treść pytania z zapasem.",
        kind: "question",
        authorId: "user-member",
        topic: "energy",
      },
      expect.anything(),
    );
  });

  it("wybór osoby zamienia podpowiedź na OSTRZEŻENIE o publikacji w imieniu", () => {
    const dialog = openComposer();
    expect(within(dialog).getByText("adminClubs.threads.onBehalfHint")).toBeTruthy();

    fireEvent.click(within(dialog).getByTestId("member-picker"));

    expect(within(dialog).getByText("adminClubs.threads.onBehalfWarning")).toBeTruthy();
  });

  it("awaria zapisu pokazuje błąd i NIE zamyka kompozytora", () => {
    h.createThread.mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
      handlers.onError?.(new Error("denied"));
    });
    const dialog = openComposer();
    fireEvent.change(within(dialog).getByLabelText("club.threadTitle"), {
      target: { value: "Tytuł tematu" },
    });
    fireEvent.change(within(dialog).getByLabelText("club.threadBody"), {
      target: { value: "Treść tematu z zapasem." },
    });

    fireEvent.click(within(dialog).getByText("club.publishThread"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("anulowanie zamyka kompozytor bez zapisu", () => {
    const dialog = openComposer();

    fireEvent.click(within(dialog).getByText("common.cancel"));

    expect(h.createThread).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("podgląd wątku", () => {
  const thread = adminThreadRow({ id: "t1", title: "Temat o cenach", group_id: CLUB_IDS.group });

  function openDetail() {
    h.threads = { rows: [thread], total: 1 };
    panel();
    fireEvent.click(screen.getAllByText("Temat o cenach")[0]!);
    return screen.getByRole("dialog");
  }

  it("otwarcie podglądu pyta o odpowiedzi DOKŁADNIE tego wątku", () => {
    openDetail();

    expect(h.replyThreadIds).toContain("t1");
  });

  it("odpowiedzi W LOCIE pokazują szkielet, pustka - zdanie o braku odpowiedzi", () => {
    h.repliesPending = true;
    h.replies = undefined;
    const dialog = openDetail();

    expect(within(dialog).queryAllByText((t) => t.includes("club.noReplies"))).toHaveLength(0);
    expect(dialog.querySelectorAll('[aria-busy="true"]').length).toBe(1);
  });

  it("brak odpowiedzi mówi to wprost", () => {
    const dialog = openDetail();

    expect(within(dialog).getByText("club.noReplies")).toBeTruthy();
  });

  it("licznik odpowiedzi bierze SUMĘ z RPC i mówi o ucięciu strony", () => {
    h.replies = { rows: [adminReplyRow({ id: "r1" })], total: 120 };
    const dialog = openDetail();

    expect(within(dialog).getByText("club.repliesCount(count=120)")).toBeTruthy();
    expect(within(dialog).getByText("club.repliesTruncated(shown=1,total=120)")).toBeTruthy();
  });

  it("pełna strona odpowiedzi NIE pokazuje zdania o ucięciu", () => {
    h.replies = { rows: [adminReplyRow({ id: "r1" })], total: 1 };
    const dialog = openDetail();

    expect(within(dialog).queryAllByText((t) => t.includes("club.repliesTruncated"))).toHaveLength(
      0,
    );
  });

  it("odpowiedź anonimowa nie pokazuje nazwiska, wpis z panelu ma adnotację", () => {
    h.replies = {
      rows: [
        adminReplyRow({ id: "r1", is_anonymous: true, author_name: "Anna Nowak" }),
        adminReplyRow({
          id: "r2",
          author_name: "Ewa Zielińska",
          posted_by_admin_name: "Jan Kowalski",
          depth: 2,
        }),
      ],
      total: 2,
    };
    const dialog = openDetail();

    expect(within(dialog).queryByText("Anna Nowak")).toBeNull();
    expect(within(dialog).getByText("adminClubs.threads.protectedIdentity")).toBeTruthy();
    expect(within(dialog).getByText("club.postedOnBehalf")).toBeTruthy();
  });

  it("usunięcie odpowiedzi woła RPC z typem celu „reply”", () => {
    h.replies = { rows: [adminReplyRow({ id: "r1", status: "published" })], total: 1 };
    const dialog = openDetail();

    fireEvent.click(
      within(dialog)
        .getAllByRole("button")
        .find((b) => (b.textContent ?? "").includes("adminClubs.threads.delete"))!,
    );

    expect(h.moderate).toHaveBeenCalledWith(
      { targetType: "reply", targetId: "r1", action: "delete" },
      expect.anything(),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.saved");
  });

  it("odpowiedź zdjęta z klubu ma plakietkę statusu i wysyła PRZYWRÓCENIE", () => {
    h.replies = { rows: [adminReplyRow({ id: "r1", status: "hidden" })], total: 1 };
    const dialog = openDetail();

    expect(within(dialog).getByText("club.threadStatus.hidden")).toBeTruthy();
    fireEvent.click(
      within(dialog)
        .getAllByRole("button")
        .find((b) => (b.textContent ?? "").includes("adminClubs.threads.restore"))!,
    );

    expect(h.moderate).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: "reply", action: "restore" }),
      expect.anything(),
    );
  });

  it("awaria moderacji odpowiedzi pokazuje błąd", () => {
    h.replies = { rows: [adminReplyRow({ id: "r1" })], total: 1 };
    h.moderate.mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
      handlers.onError?.(new Error("denied"));
    });
    const dialog = openDetail();

    fireEvent.click(
      within(dialog)
        .getAllByRole("button")
        .find((b) => (b.textContent ?? "").includes("adminClubs.threads.delete"))!,
    );

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
  });

  it("odpowiedź z panelu jedzie PRZYCIĘTA, a przycisk startuje wyłączony", () => {
    const dialog = openDetail();
    const publish = within(dialog).getByText("club.postReply").closest("button");
    expect(publish?.hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/adminClubs.threads.addReply/), {
      target: { value: "  odpowiedź z panelu  " },
    });
    fireEvent.click(within(dialog).getByText("club.postReply"));

    expect(h.createReply).toHaveBeenCalledWith(
      { threadId: "t1", body: "odpowiedź z panelu", authorId: null },
      expect.anything(),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("club.replyPosted");
  });

  it("odpowiedź w imieniu członka niesie identyfikator i pokazuje ostrzeżenie", () => {
    const dialog = openDetail();
    fireEvent.change(within(dialog).getByLabelText(/adminClubs.threads.addReply/), {
      target: { value: "odpowiedź" },
    });
    fireEvent.click(within(dialog).getByTestId("member-picker"));

    expect(within(dialog).getByText("adminClubs.threads.onBehalfWarning")).toBeTruthy();
    fireEvent.click(within(dialog).getByText("club.postReply"));

    expect(h.createReply).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: "user-member" }),
      expect.anything(),
    );
  });

  it("awaria publikacji odpowiedzi pokazuje błąd i NIE czyści pola", () => {
    h.createReply.mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
      handlers.onError?.(new Error("denied"));
    });
    const dialog = openDetail();
    const field = within(dialog).getByLabelText(/adminClubs.threads.addReply/);
    fireEvent.change(field, { target: { value: "odpowiedź" } });

    fireEvent.click(within(dialog).getByText("club.postReply"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(field.getAttribute("value") ?? (field as HTMLTextAreaElement).value).toBe("odpowiedź");
  });

  it("przeniesienie jest ZWINIĘTE, a po rozwinięciu pokazuje działy POZA obecnym", () => {
    h.groups = [
      adminClubGroupRow({ id: CLUB_IDS.group, name_pl: "Dyskusje" }),
      adminClubGroupRow({ id: CLUB_IDS.otherGroup, name_pl: "Stanowiska" }),
    ];
    const dialog = openDetail();
    expect(within(dialog).queryByText("Stanowiska")).toBeNull();

    fireEvent.click(within(dialog).getByText("adminClubs.threads.move"));

    expect(within(dialog).getByText("Stanowiska")).toBeTruthy();
    expect(within(dialog).queryByText("Dyskusje")).toBeNull();
  });

  it("wybór działu docelowego woła RPC przeniesienia i potwierdza", () => {
    h.groups = [
      adminClubGroupRow({ id: CLUB_IDS.group }),
      adminClubGroupRow({ id: CLUB_IDS.otherGroup, name_pl: "Stanowiska" }),
    ];
    const dialog = openDetail();
    fireEvent.click(within(dialog).getByText("adminClubs.threads.move"));

    const moveSelect = within(dialog).getAllByTestId("select")[0]!;
    fireEvent.change(moveSelect, { target: { value: CLUB_IDS.otherGroup } });

    expect(h.move).toHaveBeenCalledWith(
      { threadId: "t1", groupId: CLUB_IDS.otherGroup },
      expect.anything(),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.threads.moved");
  });

  it("awaria przeniesienia pokazuje błąd", () => {
    h.groups = [
      adminClubGroupRow({ id: CLUB_IDS.group }),
      adminClubGroupRow({ id: CLUB_IDS.otherGroup }),
    ];
    h.move.mockImplementation((_vars: unknown, handlers: MutationHandlers) => {
      handlers.onError?.(new Error("denied"));
    });
    const dialog = openDetail();
    fireEvent.click(within(dialog).getByText("adminClubs.threads.move"));
    fireEvent.change(within(dialog).getAllByTestId("select")[0]!, {
      target: { value: CLUB_IDS.otherGroup },
    });

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
  });

  it("klub z JEDNYM działem mówi, że nie ma gdzie przenieść", () => {
    h.groups = [adminClubGroupRow({ id: CLUB_IDS.group })];
    const dialog = openDetail();

    fireEvent.click(within(dialog).getByText("adminClubs.threads.move"));

    expect(within(dialog).getByText("adminClubs.threads.noOtherGroup")).toBeTruthy();
    // Powtórny klik zwija panel przeniesienia.
    fireEvent.click(within(dialog).getByText("adminClubs.threads.move"));
    expect(within(dialog).queryByText("adminClubs.threads.noOtherGroup")).toBeNull();
  });
});

describe("dwa układy tej samej listy", () => {
  beforeEach(() => {
    h.threads = { rows: [adminThreadRow({ id: "t1", title: "Pierwszy" })], total: 1 };
  });

  it("przycisk podglądu w TABELI otwiera ten sam wątek co klik w tytuł", () => {
    panel();

    fireEvent.click(buttons("adminClubs.threads.open")[0]!);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(h.replyThreadIds).toContain("t1");
  });

  it("KARTA (poniżej lg) ma własne pole zaznaczenia tego samego wiersza", () => {
    panel();

    // Indeks 1 to układ kartowy - ten sam wiersz, drugi znacznik. Bez tego
    // testu handlery karty nie były wywołane ANI RAZU, a na telefonie to
    // jedyna droga do zaznaczenia i do akcji moderatorskiej.
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Pierwszy" })[1]!);

    expect(texts("adminClubs.threads.selected(count=1)")).toHaveLength(1);
  });

  it("akcja moderatorska Z KARTY woła to samo RPC co z tabeli", () => {
    panel();

    // Bez zaznaczenia, żeby pasek wsadu nie wstawił trzeciego przycisku
    // „przypnij” przed listę: indeks 1 to karta, indeks 0 to tabela.
    const cardPin = buttons("adminClubs.threads.pin")[1]!;
    fireEvent.click(cardPin);

    expect(h.bulk).not.toHaveBeenCalled();
    expect(h.moderate).toHaveBeenCalledWith(
      { targetType: "thread", targetId: "t1", action: "pin" },
      expect.anything(),
    );
  });

  it("tytuł i przycisk podglądu W KARCIE otwierają podgląd wątku", () => {
    panel();

    fireEvent.click(screen.getAllByText("Pierwszy")[1]!);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(within(screen.getByRole("dialog")).getByText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(buttons("adminClubs.threads.open")[1]!);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("brak odpowiedzi z zapytania o działy", () => {
  it("lista działów W LOCIE nie wywala filtra, kompozytora ani podglądu", () => {
    // `useAdminClubGroups` oddaje `undefined`, dopóki zapytanie leci. Trzy
    // miejsca czytają tę samą listę i każde ma własne `?? []`.
    h.groups = undefined;
    h.threads = { rows: [adminThreadRow({ id: "t1", title: "Pierwszy" })], total: 1 };
    panel();

    expect(texts("club.allGroups")).toHaveLength(1);

    fireEvent.click(firstButton("adminClubs.threads.newThread"));
    const composer = screen.getByRole("dialog");
    fireEvent.click(within(composer).getByText("club.publishThread"));
    // Bez działu walidacja odmawia PRZED zapytaniem.
    expect(h.createThread).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledWith("adminClubs.threads.validation");
    fireEvent.click(within(composer).getByText("common.cancel"));

    fireEvent.click(screen.getAllByText("Pierwszy")[0]!);
    const detail = screen.getByRole("dialog");
    fireEvent.click(within(detail).getByText("adminClubs.threads.move"));
    expect(within(detail).getByText("adminClubs.threads.noOtherGroup")).toBeTruthy();
  });
});
