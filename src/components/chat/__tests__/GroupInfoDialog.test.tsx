// Dialog informacji o kręgu - przed tym plikiem 0/77 linii i 0/29 funkcji,
// czyli największy dialog czatu bez ani jednego dowodu.
//
// CO JEST PRZEDMIOTEM DOWODU. Cały ekran zarządzania kręgiem widziany oczami
// użytkownika: skład z rolami, edycja nazwy i opisu przez właściciela,
// zapraszanie osób i opuszczenie kręgu. Warstwa danych jest zamockowana
// (`useGroups`, `useConversations`, `presence`), bo ma własne testy - tutaj
// liczy się SKLEJENIE: co widać, co się klika i JAKIE ARGUMENTY lecą do mutacji.
//
// UPRAWNIENIA TO WIDOCZNOŚĆ, NIE AUTORYZACJA. Testy „właściciel widzi / członek
// nie widzi" dowodzą wyłącznie tego, że interfejs nie kusi zwykłego członka
// akcjami, które serwer i tak odrzuci. Autoryzację trzymają SECURITY DEFINER
// RPC + RLS (`rename_group_conversation`, `chat_set_group_description`,
// `add_group_members` sprawdzają `role = 'owner'` oraz `current_tenant_id()`),
// a dowody na to mieszkają w testach bazy. Ukryty przycisk NIE jest
// zabezpieczeniem i ten plik niczego takiego nie twierdzi.
//
// ŚWIADOMIE POZA ZAKRESEM: pseudonimy (`useSetNickname`/`useNicknames`)
// i ustawienia rozmowy (wyciszenie, znikanie wiadomości, wygląd) - ten dialog
// ich NIE MA, mieszkają w menu `ChatWindow` i w `ChatAppearanceDialog`.
// Usuwania cudzego członkostwa komponent też nie oferuje: jedyne wyjście
// z kręgu to `leave_group_conversation` wołane przez samego zainteresowanego
// (serwer przekazuje wtedy rolę właściciela najstarszemu członkowi).
// Wnętrze `GroupMemberPicker` (debounce frazy, stany puste) ma własną
// odpowiedzialność - tutaj sprawdzamy tylko to, co dialog mu podaje i co
// z niego odbiera.
//
// RODO: wszystkie osoby są zmyślone, identyfikatory pochodzą z `CHAT_IDS`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/lib/i18n";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { CHAT_IDS, chatContactHit, groupConversationView, peerProfile } from "@/test/chat/fixtures";
import type { ChatContactHit, ConversationView, PeerProfile } from "@/lib/chat/types";

/** Opcje przekazywane do `mutate` przez komponent (react-query, wariant per-wywołanie). */
interface MutateOptions {
  onSuccess?: (data: number) => void;
  onError?: (error: Error) => void;
}

/** Atrapa mutacji: zapisuje argumenty i odgrywa werdykt serwera. */
interface MutationStub {
  calls: unknown[];
  outcome: { kind: "success"; data: number } | { kind: "error"; error: Error };
  isPending: boolean;
  mutate: (vars: unknown, options?: MutateOptions) => void;
}

const h = vi.hoisted(() => {
  const makeMutation = (): MutationStub => {
    const stub: MutationStub = {
      calls: [],
      outcome: { kind: "success", data: 1 },
      isPending: false,
      mutate: (vars, options) => {
        stub.calls.push(vars);
        if (stub.outcome.kind === "success") options?.onSuccess?.(stub.outcome.data);
        else options?.onError?.(stub.outcome.error);
      },
    };
    return stub;
  };
  return {
    online: new Set<string>() as ReadonlySet<string>,
    profiles: null as ReadonlyMap<string, PeerProfile> | null,
    people: [] as ChatContactHit[],
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    rename: makeMutation(),
    addMembers: makeMutation(),
    leave: makeMutation(),
    setDescription: makeMutation(),
  };
});

vi.mock("@/lib/chat/presence", () => ({ useOnlineUsers: () => h.online }));

vi.mock("@/lib/chat/useConversations", () => ({
  usePeerProfiles: () => ({ data: h.profiles }),
  useSetGroupDescription: () => h.setDescription,
  // Czyta go `GroupMemberPicker` - katalog osób jest tu podstawiony, żeby
  // wybór zaproszonych dało się kliknąć bez chodzenia do bazy.
  usePeopleSearch: () => ({ data: h.people, isLoading: false }),
}));

vi.mock("@/lib/chat/useGroups", () => ({
  useRenameGroup: () => h.rename,
  useAddGroupMembers: () => h.addMembers,
  useLeaveGroup: () => h.leave,
}));

vi.mock("sonner", () => ({ toast: h.toast }));

import { GroupInfoDialog } from "../GroupInfoDialog";

const t = chatPl.chat;

interface DialogProps {
  view: ConversationView;
  open: boolean;
  onClose: () => void;
  onLeft?: () => void;
}

function dialogProps(overrides: Partial<DialogProps> = {}): DialogProps {
  return {
    view: groupConversationView(),
    open: true,
    onClose: vi.fn(),
    onLeft: vi.fn(),
    ...overrides,
  };
}

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const props = dialogProps(overrides);
  const utils = render(<GroupInfoDialog {...props} />);
  return { ...utils, props };
}

/** Krąg widziany przez zwykłego członka - bez roli właściciela. */
function memberView(): ConversationView {
  return groupConversationView({ me: { role: "member" } });
}

/** Lista członków (`ul` z etykietą dostępną), żeby nie mylić jej z listą w wyszukiwarce osób. */
function memberList(): HTMLElement {
  return screen.getByRole("list", { name: t.group.membersLabel });
}

function memberNames(): string[] {
  return within(memberList())
    .getAllByRole("listitem")
    .map((li) => li.textContent ?? "");
}

/** Żadna mutacja tego dialogu nie poszła do serwera. */
function expectNoMutations(): void {
  expect(h.rename.calls).toEqual([]);
  expect(h.addMembers.calls).toEqual([]);
  expect(h.leave.calls).toEqual([]);
  expect(h.setDescription.calls).toEqual([]);
}

beforeEach(() => {
  h.online = new Set();
  h.profiles = new Map([
    [CHAT_IDS.peer, peerProfile({ id: CHAT_IDS.peer, display_name: "Anna Przykładowa" })],
    [CHAT_IDS.peerTwo, peerProfile({ id: CHAT_IDS.peerTwo, display_name: "Zofia Testowa" })],
  ]);
  h.people = [];
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.toast.info.mockReset();
  for (const stub of [h.rename, h.addMembers, h.leave, h.setDescription]) {
    stub.calls.length = 0;
    stub.outcome = { kind: "success", data: 1 };
    stub.isPending = false;
  }
});

afterEach(() => cleanup());

describe("GroupInfoDialog - otwarcie i skład kręgu", () => {
  it("zamknięty dialog nie renderuje NICZEGO - żadnego składu ani akcji w tle", () => {
    renderDialog({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Krąg energetyczny")).toBeNull();
    expect(screen.queryByRole("button", { name: t.group.leave })).toBeNull();
  });

  it("otwarty pokazuje nazwę, liczbę członków WRAZ z wołającym i akcje", () => {
    renderDialog();
    expect(screen.getByText("Krąg energetyczny")).toBeTruthy();
    // Dwóch rozmówców + wołający = 3; liczba idzie przez liczebnik i18n.
    expect(screen.getByText(i18n.t("chat.group.members", { count: 3 }))).toBeTruthy();
    expect(screen.getByRole("button", { name: t.group.leave })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.group.addMembers })).toBeTruthy();
  });

  it("skład: wołający jest pierwszy i podpisany jako Ty, potem nazwy z profili", () => {
    renderDialog();
    const rows = memberNames();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(t.group.you);
    expect(rows[1]).toContain("Anna Przykładowa");
    expect(rows[2]).toContain("Zofia Testowa");
  });

  it("rola właściciela ma plakietkę przy DOKŁADNIE jednym wierszu", () => {
    renderDialog();
    const owners = within(memberList()).getAllByText(t.group.owner);
    expect(owners).toHaveLength(1);
    // Właścicielem jest wołający - plakietka siedzi w jego wierszu.
    expect(memberNames()[0]).toContain(t.group.owner);
  });

  it("plakietka właściciela trafia do CUDZEGO wiersza, gdy krąg należy do kogoś innego", () => {
    renderDialog({
      view: groupConversationView({
        me: { role: "member" },
        peers: [
          { ...groupConversationView().peers[0], role: "owner" },
          groupConversationView().peers[1],
        ],
      }),
    });
    const rows = memberNames();
    expect(rows[0]).not.toContain(t.group.owner);
    expect(rows[1]).toContain(t.group.owner);
  });

  it("niewczytany profil daje placeholder zamiast pustego wiersza", () => {
    h.profiles = null;
    renderDialog();
    const rows = memberNames();
    expect(rows[1]).toContain("...");
    expect(rows[0]).toContain(t.group.you);
  });

  it("krąg bez nazwy dostaje etykietę zastępczą, nie pusty nagłówek", () => {
    renderDialog({ view: groupConversationView({ conversation: { title: null } }) });
    expect(screen.getByRole("dialog").textContent).toContain(t.group.circle);
  });

  it("obecność online zapala kropkę tylko przy obecnych", () => {
    // Sama kropka jest atomem `PresenceDot` (span `aria-hidden`, więc niedostępny
    // dla zapytań po roli) - dowodem jest to, że dialog konsultuje
    // `useOnlineUsers` per wiersz, a nie zapala kropki wszystkim naraz.
    const dots = () => memberList().querySelectorAll("span.bg-emerald-500");
    const { unmount } = renderDialog();
    expect(dots()).toHaveLength(0);
    unmount();

    h.online = new Set([CHAT_IDS.peer]);
    renderDialog();
    expect(dots()).toHaveLength(1);
  });

  it("pusty opis pokazuje wyraźny stan pusty, a nie puste miejsce", () => {
    renderDialog();
    expect(screen.getByText(t.group.descriptionEmpty)).toBeTruthy();
  });

  it("istniejący opis jest pokazany bez otaczających spacji", () => {
    renderDialog({
      view: groupConversationView({
        conversation: { description: "  Robocza grupa ds. energii  " },
      }),
    });
    expect(screen.getByText("Robocza grupa ds. energii")).toBeTruthy();
  });
});

describe("GroupInfoDialog - widoczność akcji administracyjnych", () => {
  // WIDOCZNOŚĆ, NIE AUTORYZACJA: sprawdzamy wyłącznie, czy interfejs nie
  // proponuje członkowi akcji zarezerwowanych dla właściciela. Zakaz egzekwują
  // RPC (SECURITY DEFINER, warunek `role = 'owner'`) i RLS - i to one są
  // jedyną granicą bezpieczeństwa.
  it("właściciel widzi zmianę nazwy, edycję opisu i zapraszanie", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: t.group.rename })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.group.descriptionLabel })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.group.addMembers })).toBeTruthy();
  });

  it("zwykły członek NIE widzi żadnej z akcji właściciela", () => {
    renderDialog({ view: memberView() });
    expect(screen.queryByRole("button", { name: t.group.rename })).toBeNull();
    expect(screen.queryByRole("button", { name: t.group.descriptionLabel })).toBeNull();
    expect(screen.queryByRole("button", { name: t.group.addMembers })).toBeNull();
  });

  it("zwykły członek nadal widzi skład i może opuścić krąg", () => {
    renderDialog({ view: memberView() });
    expect(memberNames()).toHaveLength(3);
    expect(screen.getByRole("button", { name: t.group.leave })).toBeTruthy();
  });
});

describe("GroupInfoDialog - zmiana nazwy kręgu", () => {
  /** Wchodzi w tryb edycji nazwy i zwraca pole tekstowe. */
  function startRename(): HTMLElement {
    fireEvent.click(screen.getByRole("button", { name: t.group.rename }));
    return screen.getByRole("textbox", { name: t.group.rename });
  }

  it("edycja startuje od aktualnej nazwy, nie od pustego pola", () => {
    renderDialog();
    expect(startRename()).toHaveValue("Krąg energetyczny");
  });

  it("pusta nazwa i nazwa jednoznakowa są odrzucane BEZ dotykania serwera", () => {
    renderDialog();
    const input = startRename();

    for (const invalid of ["", "   ", "K"]) {
      fireEvent.change(input, { target: { value: invalid } });
      fireEvent.click(screen.getByRole("button", { name: t.group.renameSave }));
    }

    expect(h.rename.calls).toEqual([]);
    expect(h.toast.error).toHaveBeenCalledTimes(3);
    expect(h.toast.error).toHaveBeenLastCalledWith(t.group.titleInvalid);
    // Pole zostaje otwarte - użytkownik nie traci tego, co wpisał.
    expect(screen.getByRole("textbox", { name: t.group.rename })).toBeTruthy();
  });

  it("nazwa dłuższa niż 80 znaków (np. wklejona) też nie dojdzie do serwera", () => {
    renderDialog();
    fireEvent.change(startRename(), { target: { value: "N".repeat(81) } });
    fireEvent.click(screen.getByRole("button", { name: t.group.renameSave }));
    expect(h.rename.calls).toEqual([]);
    expect(h.toast.error).toHaveBeenCalledWith(t.group.titleInvalid);
  });

  it("poprawna nazwa leci przycięta z identyfikatorem rozmowy i zamyka edycję", () => {
    renderDialog();
    fireEvent.change(startRename(), { target: { value: "  Krąg klimatyczny  " } });
    fireEvent.click(screen.getByRole("button", { name: t.group.renameSave }));

    expect(h.rename.calls).toEqual([{ conversationId: CHAT_IDS.group, title: "Krąg klimatyczny" }]);
    expect(h.toast.success).toHaveBeenCalledWith(t.group.renamed);
    expect(screen.queryByRole("textbox", { name: t.group.rename })).toBeNull();
  });

  it("Enter zapisuje bez sięgania po przycisk", () => {
    renderDialog();
    const input = startRename();
    fireEvent.change(input, { target: { value: "Krąg transportowy" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.rename.calls).toEqual([
      { conversationId: CHAT_IDS.group, title: "Krąg transportowy" },
    ]);
  });

  it("Escape porzuca edycję i NIE zapisuje niczego", () => {
    renderDialog();
    const input = startRename();
    fireEvent.change(input, { target: { value: "Nazwa do porzucenia" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(h.rename.calls).toEqual([]);
    expect(screen.queryByRole("textbox", { name: t.group.rename })).toBeNull();
    expect(screen.getByText("Krąg energetyczny")).toBeTruthy();
  });

  it("odmowa serwera daje komunikat i ZOSTAWIA edycję otwartą", () => {
    renderDialog();
    h.rename.outcome = { kind: "error", error: new Error("chat: owner required") };
    fireEvent.change(startRename(), { target: { value: "Krąg wodorowy" } });
    fireEvent.click(screen.getByRole("button", { name: t.group.renameSave }));

    expect(h.toast.error).toHaveBeenCalledWith(t.group.renameError);
    expect(h.toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: t.group.rename })).toHaveValue("Krąg wodorowy");
  });

  it("trwający zapis blokuje przycisk - jedno kliknięcie to jedno żądanie", () => {
    h.rename.isPending = true;
    renderDialog();
    startRename();
    expect(screen.getByRole("button", { name: t.group.renameSave })).toBeDisabled();
  });
});

describe("GroupInfoDialog - opis kręgu", () => {
  /** Wchodzi w edycję opisu i zwraca pole wielolinijkowe. */
  function startDescriptionEdit(): HTMLElement {
    fireEvent.click(screen.getByRole("button", { name: t.group.descriptionLabel }));
    return screen.getByRole("textbox", { name: t.group.descriptionLabel });
  }

  it("edycja startuje od aktualnego opisu (przyciętego), nie od pustego pola", () => {
    renderDialog({
      view: groupConversationView({ conversation: { description: "  Opis roboczy  " } }),
    });
    expect(startDescriptionEdit()).toHaveValue("Opis roboczy");
  });

  it("zapis wysyła przycięty opis z identyfikatorem rozmowy i zamyka edytor", () => {
    renderDialog();
    fireEvent.change(startDescriptionEdit(), {
      target: { value: "  Krąg dla zespołu ds. energii  " },
    });
    fireEvent.click(screen.getByRole("button", { name: t.group.descriptionSave }));

    expect(h.setDescription.calls).toEqual([
      { conversationId: CHAT_IDS.group, description: "Krąg dla zespołu ds. energii" },
    ]);
    expect(h.toast.success).toHaveBeenCalledWith(t.group.descriptionSaved);
    expect(screen.queryByRole("textbox", { name: t.group.descriptionLabel })).toBeNull();
  });

  it("wyczyszczenie opisu jest DOZWOLONE - pusty opis kasuje wpis, nie jest błędem", () => {
    // Asymetria wobec nazwy jest zamierzona: nazwa musi mieć 2-80 znaków,
    // a opis wolno zdjąć (RPC robi `NULLIF(btrim(...), '')`).
    renderDialog({
      view: groupConversationView({ conversation: { description: "Opis do skasowania" } }),
    });
    fireEvent.change(startDescriptionEdit(), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: t.group.descriptionSave }));

    expect(h.setDescription.calls).toEqual([{ conversationId: CHAT_IDS.group, description: "" }]);
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("odmowa serwera daje komunikat i ZOSTAWIA edytor z treścią użytkownika", () => {
    renderDialog();
    h.setDescription.outcome = { kind: "error", error: new Error("chat: owner required") };
    fireEvent.change(startDescriptionEdit(), { target: { value: "Opis niezapisany" } });
    fireEvent.click(screen.getByRole("button", { name: t.group.descriptionSave }));

    expect(h.toast.error).toHaveBeenCalledWith(t.group.descriptionError);
    expect(screen.getByRole("textbox", { name: t.group.descriptionLabel })).toHaveValue(
      "Opis niezapisany",
    );
  });

  it("wyjście z edytora przyciskiem NIE zapisuje zmian", () => {
    renderDialog();
    fireEvent.change(startDescriptionEdit(), { target: { value: "Zmiana do porzucenia" } });
    fireEvent.click(screen.getByRole("button", { name: t.close }));

    expect(h.setDescription.calls).toEqual([]);
    expect(screen.getByText(t.group.descriptionEmpty)).toBeTruthy();
  });

  it("Escape w polu opisu też porzuca zmiany", () => {
    renderDialog();
    const textarea = startDescriptionEdit();
    fireEvent.change(textarea, { target: { value: "Zmiana do porzucenia" } });
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(h.setDescription.calls).toEqual([]);
    expect(screen.queryByRole("textbox", { name: t.group.descriptionLabel })).toBeNull();
  });

  it("trwający zapis blokuje przycisk opisu", () => {
    h.setDescription.isPending = true;
    renderDialog();
    startDescriptionEdit();
    expect(screen.getByRole("button", { name: t.group.descriptionSave })).toBeDisabled();
  });
});

describe("GroupInfoDialog - zapraszanie osób", () => {
  beforeEach(() => {
    h.people = [
      // Osoba JUŻ w kręgu - nie wolno jej proponować po raz drugi.
      chatContactHit({ id: CHAT_IDS.peer, display_name: "Anna Przykładowa" }),
      chatContactHit({ id: CHAT_IDS.stranger, display_name: "Jan Przykładowy" }),
    ];
  });

  /** Otwiera panel zapraszania. */
  function openInvitePanel(): void {
    fireEvent.click(screen.getByRole("button", { name: t.group.addMembers }));
  }

  it("wyszukiwarka pomija osoby już należące do kręgu", () => {
    renderDialog();
    openInvitePanel();
    const candidates = screen.getAllByRole("checkbox");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].textContent).toContain("Jan Przykładowy");
  });

  it("bez zaznaczenia przycisk zaproszenia jest nieaktywny", () => {
    renderDialog();
    openInvitePanel();
    expect(screen.getByRole("button", { name: t.group.addMembers })).toBeDisabled();
  });

  it("zaznaczenie osoby odblokowuje wysyłkę i pokazuje podsumowanie wyboru", () => {
    renderDialog();
    openInvitePanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /Jan Przykładowy/ }));

    expect(screen.getByRole("checkbox", { name: /Jan Przykładowy/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText(new RegExp(i18n.t("chat.group.selected", { count: 1 })))).toBeTruthy();
    expect(screen.getByRole("button", { name: t.group.addMembers })).toBeEnabled();
  });

  it("wysyłka niesie identyfikatory zaznaczonych osób i zamyka panel po sukcesie", () => {
    h.addMembers.outcome = { kind: "success", data: 1 };
    renderDialog();
    openInvitePanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /Jan Przykładowy/ }));
    fireEvent.click(screen.getByRole("button", { name: t.group.addMembers }));

    expect(h.addMembers.calls).toEqual([
      { conversationId: CHAT_IDS.group, memberIds: [CHAT_IDS.stranger] },
    ]);
    expect(h.toast.success).toHaveBeenCalledWith(i18n.t("chat.group.added", { count: 1 }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("serwer, który nikogo nie dodał (blokady, prywatność), mówi to wprost", () => {
    // Filtrowanie kandydatów robi RPC - klient dostaje samą LICZBĘ dodanych.
    h.addMembers.outcome = { kind: "success", data: 0 };
    renderDialog();
    openInvitePanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /Jan Przykładowy/ }));
    fireEvent.click(screen.getByRole("button", { name: t.group.addMembers }));

    expect(h.toast.info).toHaveBeenCalledWith(t.group.noneAdded);
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("błąd serwera nazywa przyczynę i nie udaje sukcesu", () => {
    h.addMembers.outcome = { kind: "error", error: new Error("chat: group full") };
    renderDialog();
    openInvitePanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /Jan Przykładowy/ }));
    fireEvent.click(screen.getByRole("button", { name: t.group.addMembers }));

    expect(h.toast.error).toHaveBeenCalledWith(t.group.addMembersError);
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("wyjście z panelu kasuje zaznaczenie - powrót zaczyna od czystej listy", () => {
    renderDialog();
    openInvitePanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /Jan Przykładowy/ }));
    fireEvent.click(screen.getByRole("button", { name: t.close }));

    expect(h.addMembers.calls).toEqual([]);
    openInvitePanel();
    expect(screen.getByRole("checkbox", { name: /Jan Przykładowy/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

describe("GroupInfoDialog - opuszczenie kręgu", () => {
  /** Klika „Opuść krąg" w treści dialogu (nie w potwierdzeniu). */
  function clickLeave(): void {
    const dialog = screen.getByRole("dialog", { name: /./ });
    fireEvent.click(within(dialog).getByRole("button", { name: t.group.leave }));
  }

  /** Potwierdzenie opuszczenia (osobna warstwa `AlertDialog`). */
  function confirmation(): HTMLElement {
    return screen.getByRole("alertdialog");
  }

  it("samo kliknięcie NIE opuszcza kręgu - najpierw potwierdzenie", () => {
    renderDialog();
    clickLeave();

    expect(h.leave.calls).toEqual([]);
    expect(confirmation().textContent).toContain(t.group.leaveConfirm);
  });

  it("rezygnacja z potwierdzenia zostawia użytkownika w kręgu", () => {
    const { props } = renderDialog();
    clickLeave();
    fireEvent.click(within(confirmation()).getByRole("button", { name: t.close }));

    expect(h.leave.calls).toEqual([]);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("potwierdzenie woła mutację identyfikatorem rozmowy, zamyka dialog i melduje wyjście", () => {
    const { props } = renderDialog();
    clickLeave();
    fireEvent.click(within(confirmation()).getByRole("button", { name: t.group.leave }));

    expect(h.leave.calls).toEqual([CHAT_IDS.group]);
    expect(h.toast.success).toHaveBeenCalledWith(t.group.left);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onLeft).toHaveBeenCalledTimes(1);
  });

  it("nieudane opuszczenie NIE zamyka dialogu i nie melduje wyjścia", () => {
    h.leave.outcome = { kind: "error", error: new Error("chat: not a member") };
    const { props } = renderDialog();
    clickLeave();
    fireEvent.click(within(confirmation()).getByRole("button", { name: t.group.leave }));

    expect(h.toast.error).toHaveBeenCalledWith(t.group.leaveError);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onLeft).not.toHaveBeenCalled();
  });

  it("brak `onLeft` nie wywraca komponentu po udanym wyjściu", () => {
    const { props } = renderDialog({ onLeft: undefined });
    clickLeave();
    fireEvent.click(within(confirmation()).getByRole("button", { name: t.group.leave }));

    expect(h.leave.calls).toEqual([CHAT_IDS.group]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it.fails("zamknięcie okna kręgu zostawia wiszące potwierdzenie opuszczenia", () => {
    // ZŁAMANY KONTRAKT: `leaveOpen` żyje obok propsa `open`, a `AlertDialog`
    // stoi POZA `Dialog`, więc gdy rodzic zamknie okno kręgu w trakcie pytania
    // (np. przełączenie rozmowy albo `onClose` z innego miejsca), pytanie
    // „Opuścić ten krąg?" zostaje samo na ekranie - bez kontekstu, o którym
    // kręgu mówi, a jego potwierdzenie nadal wywoła `leave_group_conversation`.
    // OCZEKIWANY KONTRAKT: zamknięcie dialogu informacji zamyka też jego
    // potwierdzenie (`useEffect` zerujący `leaveOpen` przy `open === false`
    // albo osadzenie `AlertDialog` wewnątrz `Dialog`).
    const props = dialogProps();
    const { rerender } = render(<GroupInfoDialog {...props} />);
    clickLeave();
    expect(confirmation()).toBeTruthy();

    rerender(<GroupInfoDialog {...props} open={false} />);

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("trwające opuszczanie blokuje przycisk", () => {
    h.leave.isPending = true;
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: /./ });
    expect(within(dialog).getByRole("button", { name: t.group.leave })).toBeDisabled();
  });
});

describe("GroupInfoDialog - zamknięcie bez zapisu", () => {
  it("Escape zamyka dialog i NIE wysyła żadnej mutacji", () => {
    const { props } = renderDialog();
    fireEvent.keyDown(screen.getByRole("dialog", { name: /./ }), { key: "Escape" });

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expectNoMutations();
  });

  it("zamknięcie w trakcie edycji nazwy porzuca wpisaną nazwę", () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: t.group.rename }));
    fireEvent.change(screen.getByRole("textbox", { name: t.group.rename }), {
      target: { value: "Nazwa, której nikt nie zapisał" },
    });
    fireEvent.keyDown(screen.getByRole("dialog", { name: /./ }), { key: "Escape" });

    expect(props.onClose).toHaveBeenCalled();
    expectNoMutations();
  });

  it("zamknięcie w trakcie edycji opisu porzuca wpisany opis", () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: t.group.descriptionLabel }));
    fireEvent.change(screen.getByRole("textbox", { name: t.group.descriptionLabel }), {
      target: { value: "Opis, którego nikt nie zapisał" },
    });
    fireEvent.keyDown(screen.getByRole("dialog", { name: /./ }), { key: "Escape" });

    expect(props.onClose).toHaveBeenCalled();
    expectNoMutations();
  });
});
