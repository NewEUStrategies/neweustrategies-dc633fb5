// Tworzenie kręgu (czat grupowy): okno `GroupCreateDialog` i multiselect
// `GroupMemberPicker` - dwa pliki, które przed tym testem miały ZERO pokrycia
// (0/40 linii i 0/16 linii), a stoi na nich jedyna ścieżka założenia rozmowy
// grupowej w produkcie.
//
// CO JEST PRZEDMIOTEM DOWODU. Pełny cykl życia okna zapisu, czyli to, co
// psuje się użytkownikowi:
//   - otwarcie rysuje pola i akcje, a `open={false}` NIE rysuje nic i nie pyta
//     serwera o katalog osób (zamknięte okno nie ma prawa generować ruchu),
//   - walidacja: pusta / jednoznakowa / za długa nazwa i brak wybranych osób
//     blokują zapis, zanim cokolwiek poleci na serwer,
//   - akcja woła RPC `create_group_conversation` z PRZYCIĘTĄ nazwą i listą
//     identyfikatorów, a po sukcesie oddaje rodzicowi identyfikator rozmowy,
//   - odmowa serwera pokazuje właściwy komunikat i NIE zamyka okna (wpisane
//     dane zostają - to jest cena błędu, którą płaci użytkownik),
//   - zamknięcie bez zapisu nie woła żadnej mutacji, a ponowne otwarcie
//     startuje z czystym formularzem,
//   - przycisk gaśnie na czas mutacji, więc drugie kliknięcie nie zakłada
//     drugiego kręgu.
//
// TENANT. Zakres liczy serwer: `create_group_conversation` i
// `search_chat_contacts` są SECURITY DEFINER i same przycinają wynik do
// tenanta wołającego. Dowód po stronie klienta jest więc dwuczęściowy:
// komponent NIE wysyła żadnego argumentu tenanta (nie ma czego podrobić)
// ORAZ rysuje dokładnie te wiersze, które wrócily z serwera - nikogo z
// własnego cache'u react-query nie dokłada.
//
// POZA ZAKRESEM ŚWIADOMIE. Warstwa danych (`useCreateGroup`, `usePeopleSearch`)
// jest tu PRAWDZIWA - atrapą jest dopiero klient Supabase, bo tylko na tym
// poziomie widać nazwy argumentów RPC. Reguły serwera (blokady,
// `allow_messages_from`, limit 50 osób) mają dowód w migracji i testach SQL,
// tutaj sprawdzamy wyłącznie mapowanie ich werdyktów na komunikaty.
//
// RODO: wszystkie osoby zmyślone, adresy w domenie `example.com`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n-chat";
import "@/lib/i18n-expert-request";
import { chatPl } from "@/lib/i18n-chat";
import { expertRequestPl } from "@/lib/i18n-expert-request";
import { CHAT_IDS, chatContactHit, peerProfile } from "@/test/chat/fixtures";
import { chatKeys } from "@/lib/chat/keys";
import type { ChatContactHit } from "@/lib/chat/types";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
  /** Bramki opóźniające ODPOWIEDŹ RPC (wywołanie zapisuje się natychmiast). */
  gates: {} as Record<string, Promise<void> | undefined>,
  online: new Set<string>() as ReadonlySet<string>,
  toastError: [] as Array<{ message: unknown; options: unknown }>,
  toastSuccess: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      const result = await h.rpc.rpc(name, args);
      const gate = h.gates[name];
      if (gate) await gate;
      return result;
    },
    // Katalog kandydatów i zapis kręgu idą WYŁĄCZNIE przez RPC. Gdyby ktoś
    // podmienił je na łańcuch PostgREST (czyli na zapytanie zakresowane przez
    // klienta, nie przez serwer), test pada tutaj, a nie na cichym wyniku.
    from: (table: string) => {
      throw new Error(`test: nieoczekiwany SELECT na "${table}"`);
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: CHAT_IDS.me, email: "jan.przykladowy@example.com" },
    tenantId: CHAT_IDS.tenant,
  }),
}));

// Presence ma własny plik testowy (`src/lib/chat/__tests__/presence.test.tsx`)
// i własny kanał realtime - tutaj liczy się tylko to, że picker CZYTA zbiór.
vi.mock("@/lib/chat/presence", () => ({ useOnlineUsers: () => h.online }));

vi.mock("sonner", () => ({
  toast: {
    error: (message: unknown, options?: unknown) => {
      h.toastError.push({ message, options });
    },
    success: (message: unknown) => {
      h.toastSuccess.push(message);
    },
  },
}));

import { supabaseRpcStub } from "@/test/supabase/rpc";
import { GroupCreateDialog } from "../GroupCreateDialog";
import { GroupMemberPicker, type GroupMemberPickerProps } from "../GroupMemberPicker";

const t = chatPl.chat;
const gateDict = expertRequestPl.expertRequest.chatGate;

interface GroupCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

/** Dwie kandydatki z tenanta wołającego - domyślna odpowiedź katalogu. */
const ZOFIA = chatContactHit({
  id: "user-zofia",
  display_name: "Zofia Testowa",
  slug: "zofia-testowa",
  job_title: "Analityczka",
  current_company: "Instytut Przykładowy",
});
const JAN = chatContactHit({
  id: "user-jan",
  display_name: "Jan Przykładowy",
  slug: "jan-przykladowy",
  job_title: "Doradca",
  current_company: "Biuro Testowe",
  verified: false,
});

function rpcStub(): ReturnType<typeof supabaseRpcStub> {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
  return h.rpc;
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Bramka, którą test otwiera ręcznie - do dowodu na stan „w trakcie zapisu". */
function deferred(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = () => resolve();
  });
  return { promise, open };
}

function renderDialog(overrides: Partial<GroupCreateDialogProps> = {}) {
  const props: GroupCreateDialogProps = {
    open: true,
    onClose: vi.fn(),
    onCreated: vi.fn(),
    ...overrides,
  };
  const client = newClient();
  const view = render(
    <QueryClientProvider client={client}>
      <GroupCreateDialog {...props} />
    </QueryClientProvider>,
  );
  const reopen = (open: boolean) =>
    view.rerender(
      <QueryClientProvider client={client}>
        <GroupCreateDialog {...props} open={open} />
      </QueryClientProvider>,
    );
  return { ...view, props, client, reopen };
}

function renderPicker(
  overrides: Partial<GroupMemberPickerProps> = {},
  seed?: (client: QueryClient) => void,
) {
  const props: GroupMemberPickerProps = {
    selected: new Map<string, string>(),
    onToggle: vi.fn(),
    ...overrides,
  };
  const client = newClient();
  seed?.(client);
  const view = render(
    <QueryClientProvider client={client}>
      <GroupMemberPicker {...props} />
    </QueryClientProvider>,
  );
  return { ...view, props, client };
}

function titleInput(): HTMLInputElement {
  const el = screen.getByLabelText(t.group.titleLabel);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error("test: pole nazwy kręgu nie jest polem tekstowym");
  }
  return el;
}

function searchInput(): HTMLInputElement {
  const el = screen.getByLabelText(t.searchPeoplePlaceholder);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error("test: wyszukiwarka osób nie jest polem tekstowym");
  }
  return el;
}

function createButton(): HTMLElement {
  return screen.getByRole("button", { name: t.group.create });
}

/** Wiersz kandydata: przycisk o roli checkboxa, nazwany imieniem osoby. */
function candidate(name: string): Promise<HTMLElement> {
  return screen.findByRole("checkbox", { name: new RegExp(name) });
}

/** Treść licznika wybranych (jedyny obszar `aria-live` w tym drzewie). */
function selectionSummary(): string {
  return document.querySelector('[aria-live="polite"]')?.textContent ?? "";
}

/** Etykieta licznika z prawdziwego słownika (polska mnogość: 1 / 2-4 / 5+). */
function selectedLabel(count: number): string {
  const dict = t.group;
  const template =
    count === 1
      ? dict.selected_one
      : count >= 2 && count <= 4
        ? dict.selected_few
        : dict.selected_many;
  return template.replace("{{count}}", String(count));
}

/** Minimalny poprawny formularz: nazwa 2-80 znaków + jedna wybrana osoba. */
async function fillValidForm(title = "Krąg energetyczny"): Promise<void> {
  fireEvent.click(await candidate("Zofia Testowa"));
  fireEvent.change(titleInput(), { target: { value: title } });
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.rpc.setData("search_chat_contacts", [ZOFIA, JAN]);
  h.rpc.setData("create_group_conversation", CHAT_IDS.group);
  h.gates = {};
  h.online = new Set<string>();
  h.toastError = [];
  h.toastSuccess = [];
});

afterEach(() => {
  cleanup();
});

describe("otwarcie i zamknięcie okna tworzenia kręgu", () => {
  it("zamknięte okno nie renderuje nic i NIE pyta serwera o katalog osób", async () => {
    renderDialog({ open: false });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("heading", { name: t.group.createTitle })).toBeNull();
    expect(screen.queryByRole("button", { name: t.group.create })).toBeNull();
    // Ruch sieciowy z niewidocznego okna to koszt bez odbiorcy.
    await waitFor(() => expect(rpcStub().calls).toHaveLength(0));
  });

  it("otwarte okno pokazuje nazwę kręgu, kandydatów i przycisk tworzenia", async () => {
    renderDialog();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Tytuł okna i etykieta przycisku brzmią IDENTYCZNIE („Utwórz krąg"),
    // więc szukamy po roli - inaczej asercja trafiałaby w dwa węzły.
    expect(screen.getByRole("heading", { name: t.group.createTitle })).toBeInTheDocument();
    expect(screen.getByText(t.group.createHint)).toBeInTheDocument();
    expect(titleInput()).toBeInTheDocument();
    expect(screen.getByText(t.group.membersLabel)).toBeInTheDocument();
    expect(searchInput()).toBeInTheDocument();
    expect(await candidate("Zofia Testowa")).toBeInTheDocument();
    // Pusty formularz nie ma czego zapisać.
    expect(createButton()).toBeDisabled();
  });

  it("Escape zamyka okno i NIE woła żadnej mutacji (rezygnacja nic nie kosztuje)", async () => {
    const { props } = renderDialog();
    await fillValidForm();

    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(rpcStub().callsFor("create_group_conversation")).toHaveLength(0);
    expect(props.onCreated).not.toHaveBeenCalled();
  });

  it("ponowne otwarcie startuje z czystym formularzem, nie z porzuconym wyborem", async () => {
    const { reopen } = renderDialog();
    await fillValidForm("Krąg do porzucenia");
    expect(selectionSummary()).toContain("Zofia Testowa");

    fireEvent.keyDown(document.body, { key: "Escape" });
    reopen(false);
    reopen(true);

    expect(titleInput().value).toBe("");
    expect(selectionSummary()).toBe("");
    expect(createButton()).toBeDisabled();
  });
});

describe("walidacja przed wysłaniem", () => {
  it("sama nazwa bez wybranych osób nie tworzy kręgu", async () => {
    renderDialog();
    await candidate("Zofia Testowa");
    fireEvent.change(titleInput(), { target: { value: "Krąg energetyczny" } });

    expect(createButton()).toBeDisabled();
    fireEvent.click(createButton());
    expect(rpcStub().callsFor("create_group_conversation")).toHaveLength(0);
  });

  it("sami członkowie bez nazwy nie tworzą kręgu", async () => {
    renderDialog();
    fireEvent.click(await candidate("Zofia Testowa"));

    expect(createButton()).toBeDisabled();
    fireEvent.click(createButton());
    expect(rpcStub().callsFor("create_group_conversation")).toHaveLength(0);
  });

  it("nazwa jednoznakowa jest za krótka, a pole nie przyjmie więcej niż 80 znaków", async () => {
    renderDialog();
    fireEvent.click(await candidate("Zofia Testowa"));

    fireEvent.change(titleInput(), { target: { value: "K" } });
    expect(createButton()).toBeDisabled();

    // Sama spacja też nie jest nazwą - liczy się wartość po przycięciu.
    fireEvent.change(titleInput(), { target: { value: " K " } });
    expect(createButton()).toBeDisabled();

    // Górny limit pilnuje przeglądarka (maxLength), więc użytkownik nie zdąży
    // wpisać 81. znaku; gdyby limit zniknął, walidacja i tak trzyma próg.
    expect(titleInput()).toHaveAttribute("maxlength", "80");
    fireEvent.change(titleInput(), { target: { value: "K".repeat(81) } });
    expect(createButton()).toBeDisabled();
    fireEvent.click(createButton());
    expect(rpcStub().callsFor("create_group_conversation")).toHaveLength(0);
  });

  it("poprawna nazwa i co najmniej jedna osoba odblokowują zapis", async () => {
    renderDialog();
    await fillValidForm();

    expect(createButton()).toBeEnabled();
  });
});

describe("utworzenie kręgu", () => {
  it("zapis woła RPC create_group_conversation z przyciętą nazwą i identyfikatorami", async () => {
    renderDialog();
    fireEvent.click(await candidate("Zofia Testowa"));
    fireEvent.click(await candidate("Jan Przykładowy"));
    fireEvent.change(titleInput(), { target: { value: "  Krąg energetyczny  " } });

    fireEvent.click(createButton());

    await waitFor(() => expect(rpcStub().callsFor("create_group_conversation")).toHaveLength(1));
    const call = rpcStub().lastCall("create_group_conversation");
    if (!call) throw new Error("test: brak wywołania create_group_conversation");
    // Białe znaki na brzegach nazwy nie mają prawa dojechać do bazy.
    expect(call.arg("p_title")).toBe("Krąg energetyczny");
    expect(call.arg("p_member_ids")).toEqual([ZOFIA.id, JAN.id]);
  });

  it("po sukcesie okno zamyka się i oddaje rodzicowi identyfikator nowej rozmowy", async () => {
    rpcStub().setData("create_group_conversation", CHAT_IDS.group);
    const { props } = renderDialog();
    await fillValidForm();

    fireEvent.click(createButton());

    await waitFor(() => expect(props.onCreated).toHaveBeenCalledWith(CHAT_IDS.group));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(h.toastError).toHaveLength(0);
  });

  it("podwójne kliknięcie nie zakłada dwóch kręgów - przycisk gaśnie na czas zapisu", async () => {
    const gate = deferred();
    h.gates.create_group_conversation = gate.promise;
    renderDialog();
    await fillValidForm();

    fireEvent.click(createButton());
    // Między dwoma prawdziwymi kliknięciami React zdąży złożyć stan „w trakcie".
    await waitFor(() => expect(createButton()).toBeDisabled());
    fireEvent.click(createButton());

    expect(rpcStub().callsFor("create_group_conversation")).toHaveLength(1);

    await act(async () => {
      gate.open();
      await gate.promise;
    });
  });
});

interface ServerRefusal {
  readonly verdict: string;
  readonly expected: string;
}

const REFUSALS: ServerRefusal[] = [
  { verdict: "invalid group title", expected: t.group.titleInvalid },
  { verdict: "no eligible members", expected: t.group.noEligible },
  { verdict: "too many members", expected: t.group.tooMany },
];

describe("odmowa serwera", () => {
  it("błąd NIE zamyka okna - wpisana nazwa i wybór osób zostają", async () => {
    rpcStub().setError("create_group_conversation", "boom", "XX000");
    const { props } = renderDialog();
    await fillValidForm("Krąg energetyczny");

    fireEvent.click(createButton());

    await waitFor(() => expect(h.toastError.at(-1)?.message).toBe(t.group.createError));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Sedno: użytkownik nie przepisuje formularza po nieudanym zapisie.
    expect(titleInput().value).toBe("Krąg energetyczny");
    expect(selectionSummary()).toContain("Zofia Testowa");
    expect(createButton()).toBeEnabled();
  });

  it.each(REFUSALS)(
    "werdykt serwera „$verdict” dostaje własny komunikat, nie ogólną awarię",
    async ({ verdict, expected }) => {
      rpcStub().setError("create_group_conversation", `chat: ${verdict}`, "P0001");
      renderDialog();
      await fillValidForm();

      fireEvent.click(createButton());

      await waitFor(() => expect(h.toastError.at(-1)?.message).toBe(expected));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    },
  );

  it("próg taryfowy dostaje upsell z akcją do cennika zamiast nagiego błędu", async () => {
    rpcStub().setError("create_group_conversation", "chat: tier disabled", "P0001");
    renderDialog();
    await fillValidForm();

    fireEvent.click(createButton());

    await waitFor(() => expect(h.toastError).toHaveLength(1));
    const notice = h.toastError[0];
    expect(notice.message).toBe(gateDict.tierDisabledToast);
    const options = notice.options;
    if (typeof options !== "object" || options === null || !("action" in options)) {
      throw new Error("test: upsell progu taryfowego bez akcji");
    }
    const action: unknown = options.action;
    if (typeof action !== "object" || action === null || !("label" in action)) {
      throw new Error("test: akcja upsellu bez etykiety");
    }
    expect(action.label).toBe(gateDict.openPricing);
  });
});

describe("GroupMemberPicker - wyszukiwanie i wybór", () => {
  it("wpisana fraza nie strzela zapytaniem na każdy znak, tylko po odczekaniu", async () => {
    rpcStub().setResponse("search_chat_contacts", (call) => ({
      data: call.arg("p_query") === "zof" ? [ZOFIA] : [ZOFIA, JAN],
      error: null,
    }));
    renderPicker();
    await candidate("Jan Przykładowy");
    expect(rpcStub().callsFor("search_chat_contacts")).toHaveLength(1);

    fireEvent.change(searchInput(), { target: { value: "z" } });
    fireEvent.change(searchInput(), { target: { value: "zo" } });
    fireEvent.change(searchInput(), { target: { value: "zof" } });

    // Trzy znaki, ZERO nowych zapytań - dopóki nie minie okno debounce'u.
    expect(rpcStub().callsFor("search_chat_contacts")).toHaveLength(1);

    await waitFor(() => expect(rpcStub().callsFor("search_chat_contacts")).toHaveLength(2));
    const call = rpcStub().lastCall("search_chat_contacts");
    if (!call) throw new Error("test: brak wywołania search_chat_contacts");
    expect(call.arg("p_query")).toBe("zof");
    expect(call.arg("p_limit")).toBe(20);
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: /Jan/ })).toBeNull());
  });

  it("kliknięcie kandydata oddaje rodzicowi jego identyfikator i nazwę", async () => {
    const { props } = renderPicker();

    fireEvent.click(await candidate("Jan Przykładowy"));

    expect(props.onToggle).toHaveBeenCalledWith(JAN.id, "Jan Przykładowy");
  });

  it("już wybrana osoba jest zaznaczona na wierszu i widoczna w liczniku", async () => {
    renderPicker({ selected: new Map([[ZOFIA.id, "Zofia Testowa"]]) });

    expect(await candidate("Zofia Testowa")).toHaveAttribute("aria-checked", "true");
    expect(await candidate("Jan Przykładowy")).toHaveAttribute("aria-checked", "false");
    expect(selectionSummary()).toContain(selectedLabel(1));
    expect(selectionSummary()).toContain("Zofia Testowa");
  });

  it("bez wyboru nie ma licznika (zero nie jest komunikatem)", async () => {
    renderPicker();
    await candidate("Zofia Testowa");

    expect(selectionSummary()).toBe("");
  });

  it("zaznaczenie i odznaczenie aktualizuje licznik wybranych", async () => {
    renderDialog();

    fireEvent.click(await candidate("Zofia Testowa"));
    expect(selectionSummary()).toContain(selectedLabel(1));

    fireEvent.click(await candidate("Jan Przykładowy"));
    expect(selectionSummary()).toContain(selectedLabel(2));
    expect(selectionSummary()).toContain("Zofia Testowa");
    expect(selectionSummary()).toContain("Jan Przykładowy");

    fireEvent.click(await candidate("Zofia Testowa"));
    expect(selectionSummary()).toContain(selectedLabel(1));
    expect(selectionSummary()).not.toContain("Zofia Testowa");
    expect(await candidate("Zofia Testowa")).toHaveAttribute("aria-checked", "false");
  });

  it("osoby już będące w kręgu znikają z listy kandydatów", async () => {
    renderPicker({ excludeIds: new Set([JAN.id]) });

    expect(await candidate("Zofia Testowa")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Jan Przykładowy/ })).toBeNull();
  });

  it("pusty katalog i brak wyników frazy to DWA różne komunikaty", async () => {
    rpcStub().setData("search_chat_contacts", []);
    renderPicker();

    expect(await screen.findByText(chatPl.people.emptyDirectory)).toBeInTheDocument();

    fireEvent.change(searchInput(), { target: { value: "nieistniejąca fraza" } });

    expect(await screen.findByText(chatPl.people.empty)).toBeInTheDocument();
  });
});

describe("izolacja tenanta", () => {
  it("wyszukiwarka kandydatów NIE wysyła argumentu tenanta - zakres liczy serwer", async () => {
    renderPicker();
    await candidate("Zofia Testowa");

    const call = rpcStub().lastCall("search_chat_contacts");
    if (!call) throw new Error("test: brak wywołania search_chat_contacts");
    // Klient nie ma czym skłamać: przekazuje wyłącznie frazę i limit.
    expect(call.keys()).toEqual(["p_query", "p_limit"]);
    expect(call.has("p_tenant_id")).toBe(false);
    expect(call.has("p_user_id")).toBe(false);
  });

  it("lista to DOKŁADNIE wiersze serwera - klient nie dokłada nikogo z cache'u", async () => {
    // Serwer (SECURITY DEFINER) oddaje wyłącznie osoby z tenanta wołającego.
    const fromMyTenant: ChatContactHit[] = [ZOFIA, JAN];
    rpcStub().setData("search_chat_contacts", fromMyTenant);

    renderPicker({}, (client) => {
      // Cache react-query jest zatruty osobą z INNEGO obszaru roboczego -
      // gdyby picker sięgał po cokolwiek poza wynikiem RPC, wyszłaby tutaj.
      client.setQueryData(chatKeys.people(CHAT_IDS.me, "obcy:20"), [
        chatContactHit({ id: CHAT_IDS.stranger, display_name: "Borys Obcy" }),
      ]);
      client.setQueryData(chatKeys.peers(CHAT_IDS.me, [CHAT_IDS.stranger]), [
        peerProfile({ id: CHAT_IDS.stranger, display_name: "Borys Obcy" }),
      ]);
    });

    await candidate("Zofia Testowa");
    const rows = screen.getAllByRole("checkbox");
    expect(rows).toHaveLength(fromMyTenant.length);
    expect(screen.queryByText("Borys Obcy")).toBeNull();
    for (const person of fromMyTenant) {
      expect(screen.getByText(person.display_name)).toBeInTheDocument();
    }
  });

  it("zapis kręgu wysyła tylko nazwę i identyfikatory - nie ma czego podrobić", async () => {
    renderDialog();
    await fillValidForm();

    fireEvent.click(createButton());

    await waitFor(() => expect(rpcStub().callsFor("create_group_conversation")).toHaveLength(1));
    const call = rpcStub().lastCall("create_group_conversation");
    if (!call) throw new Error("test: brak wywołania create_group_conversation");
    expect(call.keys()).toEqual(["p_title", "p_member_ids"]);
    expect(call.has("p_tenant_id")).toBe(false);
    expect(call.has("p_owner_id")).toBe(false);
  });
});
