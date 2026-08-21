// Zakładka „Moderacja” - RENDER operacji NIEODWRACALNYCH i SKLEJENIE trzech
// powierzchni: kolejki premoderacji, blokad członków i dziennika moderacji.
//
// Reguły mają tabele przypadków w dwóch czystych modułach:
// `lib/clubs/__tests__/moderationRules.test.ts` (rozbicie wsadu na typy celu,
// próg powodu ujawnienia, przełączanie zaznaczenia) oraz
// `lib/clubs/__tests__/adminModerationDesk.test.ts` (okno czasu dziennika,
// liczniki, filtr, ładunki blokady, redakcji i ujawnienia). Karta pozycji
// kolejki, pasek wsadu i plakietka dziennika mają własne testy molekuł.
//
// TUTAJ sprawdzamy to, czego ani czysta funkcja, ani molekuła nie obejmuje,
// a co decyduje o tym, czy moderator skasuje właściwy wpis:
//
//   1. USUNIĘCIE PRZECHODZI PRZEZ DIALOG, zatwierdzenie i ukrycie NIE.
//   2. WSAD woła RPC OSOBNO dla wątków i odpowiedzi (kolejka je miesza),
//      a awaria którejkolwiek partii NIE daje fałszywego sukcesu.
//   3. UJAWNIENIE AUTORA jest zablokowane, dopóki powód jest za krótki; po
//      udanym ujawnieniu ekran pokazuje nazwisko, odnośnik do profilu (tylko
//      gdy RPC oddał sluga) i zdanie o zapisie w dziennikach - a zamknięcie
//      dialogu CZYŚCI zarówno powód, jak i wynik.
//   4. Anonimowy wpis nie pokazuje nazwiska, a przycisk ujawnienia jest
//      WYŁĄCZNIE przy nim.
//   5. REDAKCJA MODERATORSKA startuje TREŚCIĄ WPISU i trafia do RPC WŁAŚCIWEGO
//      DLA TYPU CELU: wątek z tytułem, odpowiedź bez tytułu.
//   6. BLOKADA CZŁONKA idzie z kolejki przez potwierdzenie, z powodem jako
//      `null`, gdy pole zostało puste; zdjęcie blokady idzie od razu.
//   7. DZIENNIK ma cztery filtry, dwa RÓŻNE komunikaty pustki („nic nie ma”
//      vs „nic nie pasuje”) i licznik, który mówi „ile z ilu” tylko wtedy, gdy
//      filtr coś odjął.
//   8. CZTERY STANY KAŻDEGO ZAPYTANIA: dane pełne, dane częściowe (wpis bez
//      powodu i bez stanowiska nie pokazuje gołego `undefined`), zapytanie
//      w locie i awaria.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Autorytetu RPC (`club_moderate`,
// `club_ban_member`, `club_reveal_author`, `admin_club_thread_edit` mają pgTAP),
// progów i słowników reguł (patrz moduły wyżej) ani wyglądu molekuł.
//
// CZTERY GAŁĘZIE NIEOSIĄGALNE Z TESTU, świadomie zostawione w kodzie. Wszystkie
// mają kształt „bramka przed mutacją”, a wszystkie cztery są DRUGĄ bramką:
// pierwsza siedzi w warunku renderu albo w atrybucie `disabled`, więc żeby
// wywołać którąkolwiek, trzeba najpierw rozmontować tę pierwszą.
//   * `if (selected.size === 0) return` we wsadzie - pasek wsadu renderuje się
//     wyłącznie przy niepustym zaznaczeniu;
//   * `if (vars === null) return` w blokadzie członka - przycisk blokady jest
//     wyłączony bez wybranej osoby, a deskryptor potwierdzenia domyka funkcję
//     z renderu, w którym osoba już była wybrana;
//   * `if (vars === null) return` przy ujawnieniu autora i `if (payload ===
//     null) return` przy redakcji - oba przyciski są wyłączone dokładnie wtedy,
//     gdy ładunek wyszedłby `null`.
//
// DETERMINIZM. Okno czasu dziennika liczy się względem zegara przeglądarki,
// więc wiersze „poza oknem” są datowane ponad rok przed `CLUB_BASE_ISO` -
// wypadają z okna siedmiu dni dla KAŻDEGO zegara, a nie tylko dla dzisiejszego.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

/** Domknięcia mutacji React Query, w kształcie, w jakim organizm je podaje. */
interface MutationHandlers<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

const h = vi.hoisted(() => ({
  queue: { rows: [] as unknown[], total: 0 } as { rows: unknown[]; total: number } | undefined,
  queuePending: false,
  queueError: false,
  log: [] as unknown[] | undefined,
  logPending: false,
  banned: { rows: [] as unknown[], total: 0 } as { rows: unknown[]; total: number } | undefined,
  bannedPending: false,
  moderate: vi.fn(),
  moderatePending: false,
  bulk: vi.fn(),
  bulkPending: false,
  reveal: vi.fn(),
  revealPending: false,
  ban: vi.fn(),
  banPending: false,
  editThread: vi.fn(),
  editReply: vi.fn(),
  editPending: false,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));
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
// Radix Select nie działa pod happy-dom bez pełnego pointer API - filtry
// dziennika podmieniamy na natywne droplisty. Przedmiotem dowodu jest to,
// KTÓRE opcje zakładka wystawia i CO robi ze zmianą.
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
vi.mock("@/lib/clubs/useClubs", () => ({
  useClubModerationQueue: () => ({
    data: h.queue,
    isPending: h.queuePending,
    isError: h.queueError,
  }),
  useClubModerationLog: () => ({ data: h.log, isPending: h.logPending, isError: false }),
  useClubMembers: () => ({ data: h.banned, isPending: h.bannedPending, isError: false }),
  useModerateClubTarget: () => ({ mutate: h.moderate, isPending: h.moderatePending }),
  useBulkModerateClub: () => ({ mutateAsync: h.bulk, isPending: h.bulkPending }),
  useRevealClubAuthor: () => ({ mutate: h.reveal, isPending: h.revealPending }),
  useBanClubMember: () => ({ mutate: h.ban, isPending: h.banPending }),
  useModeratorEditThread: () => ({ mutate: h.editThread, isPending: h.editPending }),
  useModeratorEditReply: () => ({ mutate: h.editReply, isPending: h.editPending }),
}));

import { ClubModerationTab } from "@/components/admin/clubs/organisms/ClubModerationTab";
import { CLUB_IDS, clubIsoOffset, clubMemberRow, moderationItem } from "@/test/clubs/fixtures";
import { moderationLogRow } from "@/test/clubs/adminThreadFixtures";

const CLUB = CLUB_IDS.club;

/** Data pewnie POZA każdym oknem czasu dziennika, niezależnie od zegara. */
const LONG_AGO = clubIsoOffset(-60 * 24 * 400);

function queueOf(...items: ReturnType<typeof moderationItem>[]) {
  h.queue = { rows: items, total: items.length };
}

function panel() {
  return render(<ClubModerationTab clubId={CLUB} />);
}

/** Przycisk o etykiecie zaczynającej się danym kluczem i18n. */
function buttons(key: string): HTMLElement[] {
  return screen.queryAllByRole("button").filter((b) => (b.textContent ?? "").includes(key));
}

function firstButton(key: string): HTMLElement {
  const found = buttons(key)[0];
  if (found === undefined) throw new Error(`brak przycisku dla klucza ${key}`);
  return found;
}

function texts(fragment: string): HTMLElement[] {
  return screen.queryAllByText((text) => text.includes(fragment));
}

/** Droplista dziennika: 0 - akcja, 1 - typ celu, 2 - okno czasu. */
function logSelect(index: number): HTMLElement {
  const found = screen.getAllByTestId("select")[index];
  if (found === undefined) throw new Error(`brak dropListy o indeksie ${index}`);
  return found;
}

/** Zatwierdzenie w dialogu potwierdzenia (`ConfirmDialog`). */
function confirmDialog() {
  const dialog = screen.getByRole("alertdialog");
  const accept = within(dialog)
    .getAllByRole("button")
    .find((b) => !(b.textContent ?? "").includes("cancel"));
  if (accept === undefined) throw new Error("dialog potwierdzenia bez przycisku zatwierdzenia");
  fireEvent.click(accept);
}

beforeEach(() => {
  h.queue = { rows: [], total: 0 };
  h.queuePending = false;
  h.queueError = false;
  h.log = [];
  h.logPending = false;
  h.banned = { rows: [], total: 0 };
  h.bannedPending = false;
  h.moderatePending = false;
  h.bulkPending = false;
  h.revealPending = false;
  h.banPending = false;
  h.editPending = false;
  h.moderate
    .mockReset()
    .mockImplementation((_vars: unknown, handlers: MutationHandlers<boolean>) => {
      handlers.onSuccess?.(true);
    });
  h.bulk.mockReset().mockResolvedValue(1);
  h.reveal.mockReset();
  h.ban.mockReset().mockImplementation((_vars: unknown, handlers: MutationHandlers<boolean>) => {
    handlers.onSuccess?.(true);
  });
  h.editThread
    .mockReset()
    .mockImplementation((_vars: unknown, handlers: MutationHandlers<boolean>) => {
      handlers.onSuccess?.(true);
    });
  h.editReply
    .mockReset()
    .mockImplementation((_vars: unknown, handlers: MutationHandlers<boolean>) => {
      handlers.onSuccess?.(true);
    });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("kolejka premoderacji", () => {
  it("pusta kolejka mówi to wprost, bez zaznaczania i bez akcji", () => {
    panel();

    expect(texts("moderation.queueEmpty")).toHaveLength(1);
    expect(buttons("moderation.approve")).toHaveLength(0);
  });

  it("zapytanie W LOCIE pokazuje szkielet, nie zdanie o pustce", () => {
    h.queue = undefined;
    h.queuePending = true;
    panel();

    expect(texts("moderation.queueEmpty")).toHaveLength(0);
    expect(document.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
  });

  it("AWARIA zapytania mówi o błędzie, a nie o pustej kolejce", () => {
    // Różnica jest operacyjna: „kolejka pusta” znaczy „nie ma pracy”,
    // a awaria znaczy „nie wiesz, czy jest praca”.
    h.queue = undefined;
    h.queueError = true;
    panel();

    expect(texts("adminClubs.loadError")).toHaveLength(1);
    expect(texts("moderation.queueEmpty")).toHaveLength(0);
  });

  it("licznik przy tytule bierze się z TOTAL, nie z długości strony", () => {
    // Kolejka jest stronicowana po stronie RPC - moderator widzący „50” przy
    // kolejce liczącej trzysta pozycji planuje pracę na złych danych.
    h.queue = { rows: [moderationItem()], total: 300 };
    panel();

    expect(screen.getByText("300")).toBeTruthy();
  });

  it("ZATWIERDZENIE idzie od razu, bez dialogu potwierdzenia", () => {
    queueOf(moderationItem({ target_id: "t1", target_type: "thread" }));
    panel();

    fireEvent.click(buttons("moderation.approve")[0]!);

    // Akcja odwracalna (`restore`), więc dialog tylko uczyłby klikania „tak”.
    expect(h.moderate).toHaveBeenCalledWith(
      { targetType: "thread", targetId: "t1", action: "approve" },
      expect.anything(),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.moderation.done.approve");
  });

  it("UKRYCIE też idzie od razu", () => {
    queueOf(moderationItem({ target_id: "r1", target_type: "reply" }));
    panel();

    fireEvent.click(buttons("moderation.hide")[0]!);

    expect(h.moderate).toHaveBeenCalledWith(
      { targetType: "reply", targetId: "r1", action: "hide" },
      expect.anything(),
    );
  });

  it("awaria akcji jednostkowej pokazuje komunikat błędu", () => {
    queueOf(moderationItem({ target_id: "t1" }));
    h.moderate.mockImplementation((_vars: unknown, handlers: MutationHandlers<boolean>) => {
      handlers.onError?.(new Error("denied"));
    });
    panel();

    fireEvent.click(buttons("moderation.approve")[0]!);

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("USUNIĘCIE NIE wywołuje RPC przed potwierdzeniem", () => {
    queueOf(moderationItem({ target_id: "t1" }));
    panel();

    fireEvent.click(buttons("moderation.delete")[0]!);

    // Operacja nieodwracalna: klik otwiera dialog, nie kasuje wątku.
    expect(h.moderate).not.toHaveBeenCalled();
    expect(texts("moderation.deleteTitle")).toHaveLength(1);
  });

  it("USUNIĘCIE wykonuje się dopiero po potwierdzeniu w dialogu", async () => {
    queueOf(moderationItem({ target_id: "t1", target_type: "thread" }));
    panel();
    fireEvent.click(buttons("moderation.delete")[0]!);

    confirmDialog();

    await waitFor(() =>
      expect(h.moderate).toHaveBeenCalledWith(
        { targetType: "thread", targetId: "t1", action: "delete" },
        expect.anything(),
      ),
    );
  });

  it("nieznany typ celu jest traktowany jak WĄTEK, nie przekazywany surowo", () => {
    queueOf(moderationItem({ target_id: "x1", target_type: "post" }));
    panel();

    fireEvent.click(buttons("moderation.approve")[0]!);

    expect(h.moderate).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: "thread" }),
      expect.anything(),
    );
  });

  it("pole zaznaczenia POZYCJI przełącza partię niezależnie od „zaznacz wszystko”", () => {
    queueOf(
      moderationItem({ target_id: "t1", title: "Pierwszy" }),
      moderationItem({ target_id: "t2", title: "Drugi" }),
    );
    panel();

    fireEvent.click(screen.getByRole("checkbox", { name: "Drugi" }));
    expect(texts("moderation.selected(count=1)")).toHaveLength(1);

    // Drugi klik w to samo pole zwalnia pozycję - zbiór jest przełączany,
    // nie dopisywany.
    fireEvent.click(screen.getByRole("checkbox", { name: "Drugi" }));
    expect(texts("moderation.selected")).toHaveLength(0);
  });

  it("udana akcja ZDEJMUJE pozycję z zaznaczenia", () => {
    queueOf(
      moderationItem({ target_id: "t1", title: "Pierwszy" }),
      moderationItem({ target_id: "t2", title: "Drugi" }),
    );
    panel();
    fireEvent.click(screen.getByRole("checkbox", { name: "adminClubs.moderation.selectAll" }));
    expect(texts("moderation.selected(count=2)")).toHaveLength(1);

    fireEvent.click(buttons("moderation.approve")[1]!);

    // Wpis zatwierdzony wychodzi z kolejki, więc nie może zostać w partii.
    expect(texts("moderation.selected(count=1)")).toHaveLength(1);
  });
});

describe("wpis anonimowy", () => {
  it("NIE pokazuje nazwiska autora, pokazuje plakietkę anonimowości", () => {
    queueOf(moderationItem({ is_anonymous: true, author_name: "Anna Nowak" }));
    panel();

    // Reguła Chatham House: kolejka nie zdradza autora, nawet moderatorowi -
    // od tego jest osobna, logowana akcja.
    expect(screen.queryByText("Anna Nowak")).toBeNull();
    expect(texts("moderation.anonymous")).toHaveLength(1);
  });

  it("przycisk ujawnienia jest WYŁĄCZNIE przy wpisie anonimowym", () => {
    queueOf(moderationItem({ is_anonymous: false, author_name: "Anna Nowak" }));
    panel();

    expect(buttons("moderation.reveal")).toHaveLength(0);
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
  });
});

describe("ujawnienie autora - próg powodu i wynik", () => {
  function openReveal(overrides: Parameters<typeof moderationItem>[0] = {}) {
    queueOf(
      moderationItem({ is_anonymous: true, target_id: "t1", target_type: "thread", ...overrides }),
    );
    panel();
    fireEvent.click(buttons("moderation.reveal")[0]!);
    return screen.getByRole("dialog");
  }

  function confirmButton(dialog: HTMLElement): HTMLElement {
    const found = within(dialog)
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").includes("moderation.revealConfirm"));
    if (found === undefined) throw new Error("brak przycisku ujawnienia");
    return found;
  }

  it("dialog mówi, KTÓREGO wpisu dotyczy", () => {
    const dialog = openReveal({ title: "Zgłoszony wpis anonimowy" });

    expect(within(dialog).getByText("Zgłoszony wpis anonimowy")).toBeTruthy();
  });

  it("przy pustym powodzie przycisk potwierdzenia jest WYŁĄCZONY", () => {
    const dialog = openReveal();

    expect(confirmButton(dialog).hasAttribute("disabled")).toBe(true);
  });

  it("powód za krótki nadal blokuje - RPC odrzuciłoby to błędem 22023", () => {
    const dialog = openReveal();

    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "krótko" } });

    expect(confirmButton(dialog).hasAttribute("disabled")).toBe(true);
    expect(h.reveal).not.toHaveBeenCalled();
  });

  it("powód powyżej progu odblokowuje i wysyła PRZYCIĘTY tekst", () => {
    const dialog = openReveal();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "   podejrzenie podszycia pod inną osobę   " },
    });

    expect(confirmButton(dialog).hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirmButton(dialog));

    expect(h.reveal).toHaveBeenCalledWith(
      {
        targetType: "thread",
        targetId: "t1",
        reason: "podejrzenie podszycia pod inną osobę",
      },
      expect.anything(),
    );
  });

  it("trwające ujawnienie wyłącza przycisk - drugi klik nie strzela drugi raz", () => {
    h.revealPending = true;
    const dialog = openReveal();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "wystarczająco długi powód" },
    });

    expect(confirmButton(dialog).hasAttribute("disabled")).toBe(true);
  });

  it("udane ujawnienie pokazuje nazwisko, odnośnik do profilu i zdanie o dziennikach", () => {
    h.reveal.mockImplementation(
      (
        _vars: unknown,
        handlers: MutationHandlers<{ displayName: string; profileSlug: string | null }>,
      ) => {
        handlers.onSuccess?.({ displayName: "Anna Nowak", profileSlug: "anna-nowak" });
      },
    );
    const dialog = openReveal();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "wystarczająco długi powód" },
    });
    fireEvent.click(confirmButton(dialog));

    expect(within(dialog).getByText("Anna Nowak")).toBeTruthy();
    expect(
      within(dialog).getByText("adminClubs.moderation.revealOpenProfile").getAttribute("href"),
    ).toBe("/profile/anna-nowak");
    expect(within(dialog).getByText("adminClubs.moderation.revealLogged")).toBeTruthy();
    // Po ujawnieniu nie ma już czego potwierdzać.
    expect(
      within(dialog)
        .getAllByRole("button")
        .filter((b) => (b.textContent ?? "").includes("revealConfirm")),
    ).toHaveLength(0);
  });

  it("osoba BEZ profilu publicznego nie dostaje martwego odnośnika", () => {
    h.reveal.mockImplementation(
      (
        _vars: unknown,
        handlers: MutationHandlers<{ displayName: string; profileSlug: string | null }>,
      ) => {
        handlers.onSuccess?.({ displayName: "Anna Nowak", profileSlug: null });
      },
    );
    const dialog = openReveal();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "wystarczająco długi powód" },
    });
    fireEvent.click(confirmButton(dialog));

    expect(within(dialog).getByText("Anna Nowak")).toBeTruthy();
    expect(within(dialog).queryByText("adminClubs.moderation.revealOpenProfile")).toBeNull();
  });

  it("PUSTA odpowiedź RPC to komunikat błędu, nie pusty wynik na ekranie", () => {
    h.reveal.mockImplementation(
      (
        _vars: unknown,
        handlers: MutationHandlers<{ displayName: string; profileSlug: string | null } | null>,
      ) => {
        handlers.onSuccess?.(null);
      },
    );
    const dialog = openReveal();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "wystarczająco długi powód" },
    });
    fireEvent.click(confirmButton(dialog));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.moderation.revealEmpty");
    expect(within(dialog).queryByText("adminClubs.moderation.revealResult")).toBeNull();
  });

  it("awaria ujawnienia ma WŁASNY komunikat, nie ogólne „nie zapisano”", () => {
    h.reveal.mockImplementation((_vars: unknown, handlers: MutationHandlers<null>) => {
      handlers.onError?.(new Error("denied"));
    });
    const dialog = openReveal();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "wystarczająco długi powód" },
    });
    fireEvent.click(confirmButton(dialog));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.moderation.revealFailed");
  });

  it("zamknięcie dialogu CZYŚCI powód - następne ujawnienie startuje od zera", () => {
    const dialog = openReveal();
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "wystarczająco długi powód" },
    });

    fireEvent.click(within(dialog).getByText("common.cancel"));

    fireEvent.click(buttons("moderation.reveal")[0]!);
    const reopened = screen.getByRole("dialog");
    expect(within(reopened).getByRole("textbox")).toHaveProperty("value", "");
    expect(confirmButton(reopened).hasAttribute("disabled")).toBe(true);
  });
});

describe("wsad", () => {
  it("pasek wsadu pojawia się DOPIERO po zaznaczeniu", () => {
    queueOf(moderationItem({ target_id: "t1" }));
    panel();

    expect(texts("moderation.selected")).toHaveLength(0);

    const checkbox = screen.getAllByRole("checkbox")[0]!;
    fireEvent.click(checkbox);

    expect(texts("moderation.selected")).toHaveLength(1);
  });

  it("wsad woła RPC OSOBNO dla wątków i dla odpowiedzi", async () => {
    queueOf(
      moderationItem({ target_id: "t1", target_type: "thread" }),
      moderationItem({ target_id: "r1", target_type: "reply" }),
    );
    panel();

    // „Zaznacz wszystko” w nagłówku karty.
    const all = screen.getAllByRole("checkbox")[0]!;
    fireEvent.click(all);

    const approve = buttons("moderation.approve").find((b) => b.textContent?.includes("approve"));
    fireEvent.click(approve!);

    await waitFor(() => expect(h.bulk).toHaveBeenCalledTimes(2));
    // `admin_club_bulk_moderate` przyjmuje JEDEN typ celu na wywołanie.
    expect(h.bulk).toHaveBeenCalledWith({
      targetType: "thread",
      targetIds: ["t1"],
      action: "approve",
    });
    expect(h.bulk).toHaveBeenCalledWith({
      targetType: "reply",
      targetIds: ["r1"],
      action: "approve",
    });
  });

  it("zaznaczenie SAMYCH wątków woła RPC RAZ, bez pustej partii odpowiedzi", async () => {
    queueOf(
      moderationItem({ target_id: "t1", target_type: "thread" }),
      moderationItem({ target_id: "t2", target_type: "thread" }),
    );
    panel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    fireEvent.click(buttons("moderation.approve").find((b) => b.textContent?.includes("approve"))!);

    await waitFor(() => expect(h.bulk).toHaveBeenCalledTimes(1));
  });

  it("wsadowe USUNIĘCIE przechodzi przez dialog i mówi ILE z ILU", async () => {
    queueOf(moderationItem({ target_id: "t1", target_type: "thread" }));
    h.bulk.mockResolvedValue(1);
    panel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    const bulkDelete = buttons("moderation.delete").find((b) =>
      b.textContent?.includes("moderation.delete"),
    );
    fireEvent.click(bulkDelete!);
    expect(h.bulk).not.toHaveBeenCalled();

    confirmDialog();

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.moderation.bulkDone(done=1,total=1)"),
    );
    expect(texts("moderation.selected")).toHaveLength(0);
  });

  it("awaria wsadu pokazuje komunikat błędu, nie fałszywy sukces", async () => {
    queueOf(moderationItem({ target_id: "t1", target_type: "thread" }));
    h.bulk.mockRejectedValue(new Error("denied"));
    panel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    fireEvent.click(buttons("moderation.approve").find((b) => b.textContent?.includes("approve"))!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("partia z pozycji, które WYPADŁY z kolejki, nie woła RPC wcale", async () => {
    queueOf(
      moderationItem({ target_id: "t1", title: "Pierwszy" }),
      moderationItem({ target_id: "t2", title: "Drugi" }),
    );
    panel();
    fireEvent.click(screen.getByRole("checkbox", { name: "adminClubs.moderation.selectAll" }));

    // Ktoś inny zmoderował oba wpisy między refetchami: kolejka ma już inną
    // pozycję, a zaznaczenie wciąż niesie stare identyfikatory. Zwolnienie
    // „Drugiego” przerysowuje zakładkę na nowej kolejce, zostawiając w partii
    // wyłącznie wpis, którego na ekranie już nie ma.
    h.queue = { rows: [moderationItem({ target_id: "t9", title: "Inny" })], total: 1 };
    fireEvent.click(screen.getByRole("checkbox", { name: "Drugi" }));

    expect(texts("moderation.selected(count=1)")).toHaveLength(1);
    fireEvent.click(buttons("moderation.approve").find((b) => b.textContent?.includes("approve"))!);

    // Pusta część wspólna znaczy „nie ma co moderować”, a nie „moderuj
    // wszystko”: żądanie nie wychodzi i nie ma fałszywego potwierdzenia.
    await waitFor(() => expect(h.bulk).not.toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("trwający wsad wyłącza przyciski paska", () => {
    queueOf(moderationItem({ target_id: "t1" }));
    h.bulkPending = true;
    panel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    fireEvent.click(buttons("moderation.approve").find((b) => b.textContent?.includes("approve"))!);

    expect(h.bulk).not.toHaveBeenCalled();
  });

  it("'wyczyść zaznaczenie' zwija pasek wsadu", () => {
    queueOf(moderationItem({ target_id: "t1" }));
    panel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    fireEvent.click(buttons("moderation.clearSelection")[0]!);

    expect(texts("moderation.selected")).toHaveLength(0);
  });

  it("„zaznacz wszystko” drugim kliknięciem zwalnia całą stronę", () => {
    queueOf(moderationItem({ target_id: "t1" }), moderationItem({ target_id: "t2" }));
    panel();
    const all = screen.getByRole("checkbox", { name: "adminClubs.moderation.selectAll" });

    fireEvent.click(all);
    expect(texts("moderation.selected(count=2)")).toHaveLength(1);

    fireEvent.click(all);
    expect(texts("moderation.selected")).toHaveLength(0);
  });
});

describe("redakcja moderatorska wpisu", () => {
  function openEditor(overrides: Parameters<typeof moderationItem>[0] = {}) {
    queueOf(
      moderationItem({
        target_id: CLUB_IDS.thread,
        target_type: "thread",
        title: "Zgłoszony temat",
        body: "Treść ze zdaniem do zaczernienia",
        ...overrides,
      }),
    );
    panel();
    fireEvent.click(buttons("moderation.edit")[0]!);
    return screen.getByRole("dialog");
  }

  function saveButton(dialog: HTMLElement): HTMLElement {
    const found = within(dialog)
      .getAllByRole("button")
      .find((b) => (b.textContent ?? "").includes("common.save"));
    if (found === undefined) throw new Error("brak przycisku zapisu");
    return found;
  }

  it("formularz startuje TREŚCIĄ WPISU, a powód pusty", () => {
    const dialog = openEditor();

    expect(within(dialog).getByLabelText("club.threadTitle")).toHaveProperty(
      "value",
      "Zgłoszony temat",
    );
    expect(within(dialog).getByLabelText("club.threadBody")).toHaveProperty(
      "value",
      "Treść ze zdaniem do zaczernienia",
    );
    expect(within(dialog).getByLabelText("adminClubs.moderation.editReason")).toHaveProperty(
      "value",
      "",
    );
    expect(saveButton(dialog).hasAttribute("disabled")).toBe(true);
  });

  it("wpis typu ODPOWIEDŹ nie ma pola tytułu - odpowiedź go nie ma", () => {
    const dialog = openEditor({ target_type: "reply", target_id: CLUB_IDS.reply });

    expect(within(dialog).queryByLabelText("club.threadTitle")).toBeNull();
    expect(within(dialog).getByLabelText("club.threadBody")).toBeTruthy();
  });

  it("powód krótszy od progu nadal blokuje zapis", () => {
    const dialog = openEditor();

    fireEvent.change(within(dialog).getByLabelText("adminClubs.moderation.editReason"), {
      target: { value: "aa" },
    });

    expect(saveButton(dialog).hasAttribute("disabled")).toBe(true);
    fireEvent.click(saveButton(dialog));
    expect(h.editThread).not.toHaveBeenCalled();
  });

  it("pusta treść blokuje zapis nawet z powodem", () => {
    const dialog = openEditor();

    fireEvent.change(within(dialog).getByLabelText("club.threadBody"), {
      target: { value: "   " },
    });
    fireEvent.change(within(dialog).getByLabelText("adminClubs.moderation.editReason"), {
      target: { value: "dane osobowe" },
    });

    expect(saveButton(dialog).hasAttribute("disabled")).toBe(true);
  });

  it("redakcja WĄTKU jedzie do RPC wątku, z tytułem i PRZYCIĘTYM powodem", () => {
    const dialog = openEditor();

    fireEvent.change(within(dialog).getByLabelText("club.threadTitle"), {
      target: { value: "  Temat po redakcji  " },
    });
    fireEvent.change(within(dialog).getByLabelText("club.threadBody"), {
      target: { value: "  Treść po zaczernieniu  " },
    });
    fireEvent.change(within(dialog).getByLabelText("adminClubs.moderation.editReason"), {
      target: { value: "  dane osobowe w treści  " },
    });
    fireEvent.click(saveButton(dialog));

    expect(h.editThread).toHaveBeenCalledWith(
      {
        threadId: CLUB_IDS.thread,
        title: "Temat po redakcji",
        body: "Treść po zaczernieniu",
        reason: "dane osobowe w treści",
      },
      expect.anything(),
    );
    expect(h.editReply).not.toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.moderation.edited");
    // Udany zapis zamyka dialog.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("redakcja ODPOWIEDZI jedzie do RPC odpowiedzi, bez tytułu", () => {
    const dialog = openEditor({ target_type: "reply", target_id: CLUB_IDS.reply });

    fireEvent.change(within(dialog).getByLabelText("club.threadBody"), {
      target: { value: "Odpowiedź po redakcji" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminClubs.moderation.editReason"), {
      target: { value: "wulgaryzmy" },
    });
    fireEvent.click(saveButton(dialog));

    expect(h.editReply).toHaveBeenCalledWith(
      { replyId: CLUB_IDS.reply, body: "Odpowiedź po redakcji", reason: "wulgaryzmy" },
      expect.anything(),
    );
    expect(h.editThread).not.toHaveBeenCalled();
  });

  it("awaria redakcji pokazuje błąd i NIE zamyka formularza", () => {
    h.editThread.mockImplementation((_vars: unknown, handlers: MutationHandlers<boolean>) => {
      handlers.onError?.(new Error("denied"));
    });
    const dialog = openEditor();
    fireEvent.change(within(dialog).getByLabelText("adminClubs.moderation.editReason"), {
      target: { value: "dane osobowe" },
    });

    fireEvent.click(saveButton(dialog));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("trwający zapis wyłącza przycisk", () => {
    h.editPending = true;
    const dialog = openEditor();
    fireEvent.change(within(dialog).getByLabelText("adminClubs.moderation.editReason"), {
      target: { value: "dane osobowe" },
    });

    expect(saveButton(dialog).hasAttribute("disabled")).toBe(true);
  });

  it("anulowanie zamyka formularz bez zapisu", () => {
    const dialog = openEditor();

    fireEvent.click(within(dialog).getByText("common.cancel"));

    expect(h.editThread).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wpis CZĘŚCIOWY (bez treści) daje puste pola, nie „undefined”", () => {
    const dialog = openEditor({ title: "", body: "" });

    expect(within(dialog).getByLabelText("club.threadBody")).toHaveProperty("value", "");
    expect(texts("undefined")).toHaveLength(0);
  });
});

describe("blokady członków", () => {
  it("bez wybranej osoby przycisk blokady jest WYŁĄCZONY", () => {
    panel();

    expect(firstButton("adminClubs.moderation.ban").hasAttribute("disabled")).toBe(true);
  });

  it("blokada przechodzi przez potwierdzenie i niesie PRZYCIĘTY powód", async () => {
    panel();
    fireEvent.click(screen.getByTestId("member-picker"));
    fireEvent.change(screen.getByLabelText("adminClubs.moderation.reason"), {
      target: { value: "  wielokrotny spam  " },
    });

    fireEvent.click(firstButton("adminClubs.moderation.ban"));
    expect(h.ban).not.toHaveBeenCalled();

    confirmDialog();

    await waitFor(() =>
      expect(h.ban).toHaveBeenCalledWith(
        { userId: "user-member", banned: true, reason: "wielokrotny spam" },
        expect.anything(),
      ),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.moderation.banned");
  });

  it("pusty powód jedzie jako null, nie jako pusty napis", async () => {
    panel();
    fireEvent.click(screen.getByTestId("member-picker"));

    fireEvent.click(firstButton("adminClubs.moderation.ban"));
    confirmDialog();

    await waitFor(() =>
      expect(h.ban).toHaveBeenCalledWith(
        expect.objectContaining({ reason: null }),
        expect.anything(),
      ),
    );
  });

  it("awaria blokady ma WŁASNY komunikat", async () => {
    h.ban.mockImplementation((_vars: unknown, handlers: MutationHandlers<boolean>) => {
      handlers.onError?.(new Error("denied"));
    });
    panel();
    fireEvent.click(screen.getByTestId("member-picker"));

    fireEvent.click(firstButton("adminClubs.moderation.ban"));
    confirmDialog();

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminClubs.moderation.banFailed"),
    );
  });

  it("lista blokad W LOCIE pokazuje szkielet, pustka - zdanie o braku blokad", () => {
    h.bannedPending = true;
    h.banned = undefined;
    panel();

    expect(texts("moderation.noBans")).toHaveLength(0);

    h.bannedPending = false;
    h.banned = { rows: [], total: 0 };
    panel();

    expect(texts("moderation.noBans")).toHaveLength(1);
  });

  it("zablokowana osoba pokazuje stanowisko, a bez stanowiska - rolę", () => {
    h.banned = {
      rows: [
        clubMemberRow({ user_id: "u1", display_name: "Anna Nowak", job_title: "Analityk" }),
        clubMemberRow({ user_id: "u2", display_name: "Jan Kowalski", job_title: "", role: "lead" }),
      ],
      total: 2,
    };
    panel();

    expect(texts("Analityk")).toHaveLength(1);
    expect(texts("club.role.lead")).toHaveLength(1);
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("zdjęcie blokady idzie OD RAZU, bez powodu i bez dialogu", () => {
    h.banned = { rows: [clubMemberRow({ user_id: "u1" })], total: 1 };
    panel();

    fireEvent.click(firstButton("adminClubs.moderation.unban"));

    expect(h.ban).toHaveBeenCalledWith({ userId: "u1", banned: false }, expect.anything());
    expect(h.toastSuccess).toHaveBeenCalledWith("adminClubs.moderation.unbanned");
  });

  it("awaria zdjęcia blokady pokazuje ogólny komunikat zapisu", () => {
    h.banned = { rows: [clubMemberRow({ user_id: "u1" })], total: 1 };
    h.ban.mockImplementation((_vars: unknown, handlers: MutationHandlers<boolean>) => {
      handlers.onError?.(new Error("denied"));
    });
    panel();

    fireEvent.click(firstButton("adminClubs.moderation.unban"));

    expect(h.toastError).toHaveBeenCalledWith("adminClubs.saveFailed");
  });
});

describe("dziennik moderacji", () => {
  it("zapytanie W LOCIE pokazuje szkielet, nie zdanie o pustym dzienniku", () => {
    h.logPending = true;
    h.log = undefined;
    panel();

    expect(texts("moderation.logEmpty")).toHaveLength(0);
  });

  it("pusty dziennik mówi „nic nie ma”, nie „nic nie pasuje”", () => {
    panel();

    expect(texts("moderation.logEmpty")).toHaveLength(1);
    expect(texts("moderation.logEmptyFiltered")).toHaveLength(0);
  });

  it("wiersz dziennika renderuje się w tabeli I w karcie", () => {
    h.log = [
      moderationLogRow({
        id: "l1",
        action: "delete",
        moderator_name: "Jan Kowalski",
        reason: "spam",
      }),
    ];
    panel();

    // Dwa układy tej samej treści (tabela od lg, karta poniżej).
    expect(screen.getAllByText("Jan Kowalski")).toHaveLength(2);
    expect(screen.getAllByText("spam")).toHaveLength(2);
    expect(screen.getAllByText("adminClubs.moderation.action.delete")).toHaveLength(2);
  });

  it("wpis BEZ powodu pokazuje kreskę w tabeli i nic w karcie", () => {
    h.log = [moderationLogRow({ id: "l1", reason: "" })];
    panel();

    expect(screen.getByText("-")).toBeTruthy();
    expect(texts("undefined")).toHaveLength(0);
  });

  it("akcja spoza słownika pokazuje własną nazwę, nie goły klucz i18n", () => {
    // Dziennik jest zapisem historycznym: wpis sprzed zmiany słownika nie ma
    // znikać ani wyświetlać prefiksu klucza.
    h.log = [moderationLogRow({ id: "l1", action: "group_purge", target_type: "widget" })];
    panel();

    expect(screen.getAllByText("group_purge")).toHaveLength(2);
    expect(screen.getByText("widget")).toBeTruthy();
    expect(texts("adminClubs.moderation.action.group_purge")).toHaveLength(0);
  });

  it("licznik mówi „ile z ilu” DOPIERO wtedy, gdy filtr coś odjął", () => {
    h.log = [
      moderationLogRow({ id: "l1", moderator_name: "Jan Kowalski" }),
      moderationLogRow({ id: "l2", moderator_name: "Ewa Zielińska" }),
    ];
    panel();
    expect(screen.getByText("2")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("adminClubs.moderation.logSearchPlaceholder"), {
      target: { value: "ewa" },
    });

    expect(texts("moderation.logCount(shown=1,total=2)")).toHaveLength(1);
    expect(screen.getAllByText("Ewa Zielińska")).toHaveLength(2);
    expect(screen.queryByText("Jan Kowalski")).toBeNull();
  });

  it("filtr akcji i filtr celu wystawiają WYŁĄCZNIE wartości z licznikiem", () => {
    h.log = [
      moderationLogRow({ id: "l1", action: "ban", target_type: "member" }),
      moderationLogRow({ id: "l2", action: "ban", target_type: "member" }),
    ];
    panel();

    expect(screen.getByText("adminClubs.moderation.action.ban (2)")).toBeTruthy();
    expect(screen.getByText("adminClubs.moderation.target.member (2)")).toBeTruthy();
    expect(texts("adminClubs.moderation.action.approve (")).toHaveLength(0);
    expect(screen.getByText("adminClubs.filterAny (2)")).toBeTruthy();
  });

  it("wybór akcji zawęża listę, a powrót na „wszystkie” ją przywraca", () => {
    h.log = [
      moderationLogRow({ id: "l1", action: "ban", moderator_name: "Jan Kowalski" }),
      moderationLogRow({ id: "l2", action: "delete", moderator_name: "Ewa Zielińska" }),
    ];
    panel();

    fireEvent.change(logSelect(0), { target: { value: "ban" } });
    expect(screen.queryByText("Ewa Zielińska")).toBeNull();

    fireEvent.change(logSelect(0), { target: { value: "__any__" } });
    expect(screen.getAllByText("Ewa Zielińska")).toHaveLength(2);
  });

  it("wybór typu celu zawęża listę", () => {
    h.log = [
      moderationLogRow({ id: "l1", target_type: "thread", moderator_name: "Jan Kowalski" }),
      moderationLogRow({ id: "l2", target_type: "member", moderator_name: "Ewa Zielińska" }),
    ];
    panel();

    fireEvent.change(logSelect(1), { target: { value: "member" } });

    expect(screen.queryByText("Jan Kowalski")).toBeNull();
    expect(screen.getAllByText("Ewa Zielińska")).toHaveLength(2);

    fireEvent.change(logSelect(1), { target: { value: "__any__" } });
    expect(screen.getAllByText("Jan Kowalski")).toHaveLength(2);
  });

  it("okno czasu odcina stare wpisy i zmienia komunikat pustki", () => {
    h.log = [moderationLogRow({ id: "l1", created_at: LONG_AGO, moderator_name: "Jan Kowalski" })];
    panel();
    expect(screen.getAllByText("Jan Kowalski")).toHaveLength(2);

    fireEvent.change(logSelect(2), { target: { value: "7" } });

    expect(screen.queryByText("Jan Kowalski")).toBeNull();
    // Pustka po zawężeniu mówi INNE zdanie niż pusty dziennik.
    expect(texts("moderation.logEmptyFiltered")).toHaveLength(1);
    expect(texts("moderation.logEmpty(")).toHaveLength(0);
  });

  it("„wyczyść filtry” pojawia się dopiero po zawężeniu i przywraca komplet", () => {
    h.log = [
      moderationLogRow({ id: "l1", created_at: LONG_AGO, moderator_name: "Jan Kowalski" }),
      moderationLogRow({ id: "l2", created_at: LONG_AGO, moderator_name: "Ewa Zielińska" }),
    ];
    panel();
    expect(buttons("moderation.clearFilters")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("adminClubs.moderation.logSearchPlaceholder"), {
      target: { value: "ewa" },
    });
    fireEvent.change(logSelect(2), { target: { value: "30" } });
    expect(buttons("moderation.clearFilters")).toHaveLength(1);

    fireEvent.click(firstButton("moderation.clearFilters"));

    expect(buttons("moderation.clearFilters")).toHaveLength(0);
    expect(screen.getAllByText("Jan Kowalski")).toHaveLength(2);
  });

  it("ujawnienie autora jest w dzienniku WYRÓŻNIONE, usunięcie nie", () => {
    h.log = [
      moderationLogRow({ id: "l1", action: "reveal_author" }),
      moderationLogRow({ id: "l2", action: "delete" }),
    ];
    panel();

    const revealBadges = screen
      .getAllByText("adminClubs.moderation.action.reveal_author")
      .map((node) => node.getAttribute("data-reveal"));
    expect(revealBadges).toEqual(["true", "true"]);
    expect(
      screen.getAllByText("adminClubs.moderation.action.delete")[0]?.getAttribute("data-reveal"),
    ).toBe("false");
  });
});
