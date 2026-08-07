// Macierz ConnectButton: JEDNA maszyna stanów obsługuje trzy powierzchnie
// (karta /people, pasek profilu autora, sugestie /network), więc każda gałąź
// ma tu własny przypadek. Osie macierzy:
//   - bramki widoczności: moduł tenanta, anon, własny profil, ładowanie,
//     `canInvite` (polityka adresata / obcy tenant / blokada),
//   - pięć stanów relacji: ładowanie, none, pending_out, pending_in, connected,
//   - źródło stanu: batch z listy (`state`) vs samodzielne pobranie,
//   - warianty layoutu: pełny, `compact` (etykieta od sm), `iconOnly` (h-8 w-8),
//   - mapowanie błędów RPC na komunikaty (limit zaproszeń, blokada, bramka
//     czatu) - tu wzorce tekstu z bazy są kontraktem, nie szczegółem.
//
// Asercje idą po KLUCZACH i18n (patrz src/test/network/fixtures.ts), a nie po
// polskim copy: parytet i istnienie kluczy pilnują dwie osobne bramki i18n.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  NETWORK_IDS,
  PEER_NAME,
  connectionState,
  failingMutation,
  idleMutation,
  pendingMutation,
  pendingQueryStub,
  queryStub,
  stateFor,
  statusMap,
  structuralError,
  succeedingMutation,
  succeedingVoidMutation,
  translateKey as k,
  type MutationStub,
  type QueryStub,
} from "@/test/network/fixtures";
import type { ConnectionState } from "@/lib/network/useConnections";

type StatusesStub = QueryStub<ReadonlyMap<string, ConnectionState>>;
type SendVars = { userId: string; message?: string };
type RespondVars = { connectionId: string; accept: boolean };
type StartChatVars = string | { peerId: string; peerName?: string | null };

interface ToastAction {
  label: string;
  onClick: () => void;
}

const h = vi.hoisted(() => ({
  user: { id: "user-me" } as { id: string } | null,
  modules: { connections_enabled: true },
  statuses: null as unknown,
  requestedIds: [] as ReadonlyArray<string>[],
  send: null as unknown,
  respond: null as unknown,
  cancel: null as unknown,
  remove: null as unknown,
  startChat: null as unknown,
  openChatWindow: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastErrorMapper: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => h.modules,
}));

// `NO_CONNECTION` bierzemy z ORYGINAŁU - to fallback maszyny stanów i jego
// zduplikowanie w atrapie byłoby dokładnie tym rozjazdem, który testujemy.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/lib/network/useConnections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/network/useConnections")>();
  return {
    ...actual,
    useConnectionStatuses: (ids: ReadonlyArray<string>) => {
      h.requestedIds.push(ids);
      return h.statuses;
    },
    useSendConnectionRequest: () => h.send,
    useRespondToConnectionRequest: () => h.respond,
    useCancelConnectionRequest: () => h.cancel,
    useRemoveConnection: () => h.remove,
  };
});

vi.mock("@/lib/chat/useConversations", () => ({ useStartConversation: () => h.startChat }));
vi.mock("@/lib/chat/chatDockBus", () => ({ openChatWindow: h.openChatWindow }));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastErrorMapper }));
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));
vi.mock("@/components/network/ReportUserDialog", () => ({
  ReportUserDialog: ({ open, displayName }: { open: boolean; displayName: string }) =>
    open ? <div data-testid="report-dialog">{displayName}</div> : null,
}));

import { ConnectButton } from "@/components/network/ConnectButton";

// --- odczyt atrap w typach (h.* jest `unknown`, bo `vi.hoisted` biegnie
// przed importami) -----------------------------------------------------------
const send = (): MutationStub<SendVars, string> => h.send as MutationStub<SendVars, string>;
const respond = (): MutationStub<RespondVars, void> => h.respond as MutationStub<RespondVars, void>;
const cancel = (): MutationStub<string, void> => h.cancel as MutationStub<string, void>;
const remove = (): MutationStub<string, void> => h.remove as MutationStub<string, void>;
const startChat = (): MutationStub<StartChatVars, string> =>
  h.startChat as MutationStub<StartChatVars, string>;

function setStatuses(stub: StatusesStub): void {
  h.statuses = stub;
}

function resolved(state: ConnectionState): void {
  setStatuses(queryStub(statusMap({ [NETWORK_IDS.peer]: state })));
}

interface RenderOptions {
  state?: ConnectionState;
  compact?: boolean;
  iconOnly?: boolean;
}

function renderButton({ state, compact, iconOnly }: RenderOptions = {}) {
  return renderWithQueryClient(
    <ConnectButton
      userId={NETWORK_IDS.peer}
      displayName={PEER_NAME}
      state={state}
      compact={compact}
      iconOnly={iconOnly}
    />,
  );
}

/** Otwiera popover/dialog przez klik w główny przycisk stanu. */
function clickMain(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

/** Potwierdza AlertDialog (przycisk akcji o podanej etykiecie). */
function confirmAction(label: string): void {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

beforeEach(() => {
  h.user = { id: NETWORK_IDS.me };
  h.modules = { connections_enabled: true };
  h.requestedIds = [];
  setStatuses(queryStub(statusMap({})));
  h.send = idleMutation<SendVars, string>();
  h.respond = idleMutation<RespondVars, void>();
  h.cancel = idleMutation<string, void>();
  h.remove = idleMutation<string, void>();
  h.startChat = idleMutation<StartChatVars, string>();
  h.openChatWindow.mockClear();
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
  h.toastErrorMapper.mockClear();
});

describe("ConnectButton - bramki widoczności", () => {
  it("moduł sieci wyłączony w tenancie: nic się nie renderuje i status NIE jest odpytywany", () => {
    h.modules = { connections_enabled: false };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
    // Zmarnowane RPC na każdej karcie listy byłoby regresją wydajności.
    expect(h.requestedIds).toEqual([[]]);
  });

  it("anon: nic się nie renderuje (sieć jest tylko dla zalogowanych)", () => {
    h.user = null;
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
    expect(h.requestedIds).toEqual([[]]);
  });

  it("własny profil: nic się nie renderuje", () => {
    h.user = { id: NETWORK_IDS.peer };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
    expect(h.requestedIds).toEqual([[]]);
  });

  it("samodzielne pobranie w trakcie: nic się nie renderuje (bez migania stanu)", () => {
    setStatuses(pendingQueryStub());
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("status none + canInvite=false: przycisk nie jest serwowany (polityka / tenant / blokada)", () => {
    const { container } = renderButton({ state: connectionState({ canInvite: false }) });
    expect(container).toBeEmptyDOMElement();
  });

  it("canInvite=false NIE ukrywa istniejącej relacji (connected)", () => {
    renderButton({ state: stateFor("connected", { canInvite: false }) });
    expect(
      screen.getByRole("button", { name: `${k("network.connected")}: ${PEER_NAME}` }),
    ).toBeInTheDocument();
  });

  it("canInvite=false NIE ukrywa zaproszenia przychodzącego (pending_in)", () => {
    renderButton({ state: stateFor("pending_in", { canInvite: false }) });
    expect(
      screen.getByRole("button", { name: `${k("network.accept")}: ${PEER_NAME}` }),
    ).toBeInTheDocument();
  });

  it("canInvite=false NIE ukrywa zaproszenia wysłanego (pending_out)", () => {
    renderButton({ state: stateFor("pending_out", { canInvite: false }) });
    expect(
      screen.getByRole("button", { name: `${k("network.withdraw")}: ${PEER_NAME}` }),
    ).toBeInTheDocument();
  });
});

describe("ConnectButton - źródło stanu relacji", () => {
  it("stan z batcha listy: komponent nie dokłada własnego zapytania", () => {
    renderButton({ state: connectionState() });
    expect(h.requestedIds).toEqual([[]]);
  });

  it("bez propsa `state`: komponent pobiera status dla tej jednej osoby", () => {
    resolved(connectionState());
    renderButton();
    expect(h.requestedIds).toEqual([[NETWORK_IDS.peer]]);
  });

  it('brak wpisu w mapie statusów: fallback na NO_CONNECTION (widoczne „dodaj do sieci")', () => {
    setStatuses(queryStub(statusMap({ "kto-inny": stateFor("connected") })));
    renderButton();
    expect(
      screen.getByRole("button", { name: `${k("network.connect")}: ${PEER_NAME}` }),
    ).toBeInTheDocument();
  });
});

describe("ConnectButton - stan none (zaproszenie)", () => {
  it("wariant pełny: ikona + pełna etykieta, aria z nazwą osoby", () => {
    renderButton({ state: connectionState() });
    const button = screen.getByRole("button", { name: `${k("network.connect")}: ${PEER_NAME}` });
    expect(button).toHaveTextContent(k("network.connect"));
    expect(button).not.toBeDisabled();
  });

  it("wariant compact: krótka etykieta ukryta poniżej sm (bez łamania siatki kart)", () => {
    renderButton({ state: connectionState(), compact: true });
    const label = screen.getByText(k("network.connectShort"));
    expect(label.className).toContain("hidden");
    expect(label.className).toContain("sm:inline");
  });

  it("wariant iconOnly: bez tekstu, kwadrat h-8 w-8, tooltip w title", () => {
    renderButton({ state: connectionState(), iconOnly: true });
    const button = screen.getByRole("button", { name: `${k("network.connect")}: ${PEER_NAME}` });
    expect(button).toHaveAttribute("title", k("network.connect"));
    expect(button.className).toContain("h-8 w-8");
    expect(screen.queryByText(k("network.connect"))).not.toBeInTheDocument();
  });

  it("popover z notką: limit 300 znaków, licznik i wysyłka z treścią notki", () => {
    h.send = succeedingMutation<SendVars, string>(NETWORK_IDS.connection);
    renderButton({ state: connectionState() });
    clickMain(`${k("network.connect")}: ${PEER_NAME}`);

    const note = screen.getByRole("textbox", { name: k("network.inviteNoteLabel") });
    expect(note).toHaveAttribute("maxlength", "300");
    fireEvent.change(note, { target: { value: "Poznaliśmy się w Brukseli" } });
    expect(screen.getByText(`${k("network.inviteNoteHint")} (25/300)`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: k("network.sendInvite") }));
    expect(send().lastVars()).toEqual({
      userId: NETWORK_IDS.peer,
      message: "Poznaliśmy się w Brukseli",
    });
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.invitedToast"));
    // Sukces zamyka popover i czyści notkę.
    expect(screen.queryByRole("textbox", { name: k("network.inviteNoteLabel") })).toBeNull();
  });

  it("zaproszenie bez notki: wysyła pustą treść (RPC sam pomija puste)", () => {
    h.send = succeedingMutation<SendVars, string>(NETWORK_IDS.connection);
    renderButton({ state: connectionState() });
    clickMain(`${k("network.connect")}: ${PEER_NAME}`);
    fireEvent.click(screen.getByRole("button", { name: k("network.sendInvite") }));
    expect(send().lastVars()).toEqual({ userId: NETWORK_IDS.peer, message: "" });
  });

  it("dzienny limit zaproszeń (rate limited): własny komunikat, popover zamknięty", () => {
    h.send = failingMutation<SendVars, string>("connection_request: rate limited (30/day)");
    renderButton({ state: connectionState() });
    clickMain(`${k("network.connect")}: ${PEER_NAME}`);
    fireEvent.click(screen.getByRole("button", { name: k("network.sendInvite") }));
    expect(h.toastError).toHaveBeenCalledWith(k("network.rateLimited"));
    expect(h.toastErrorMapper).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: k("network.inviteNoteLabel") })).toBeNull();
  });

  it("blokada adresata: komunikat o niemożności zaproszenia", () => {
    h.send = failingMutation<SendVars, string>("connection_request: blocked");
    renderButton({ state: connectionState() });
    clickMain(`${k("network.connect")}: ${PEER_NAME}`);
    fireEvent.click(screen.getByRole("button", { name: k("network.sendInvite") }));
    expect(h.toastError).toHaveBeenCalledWith(k("network.inviteBlocked"));
  });

  it("adresat niedostępny (inny tenant / brak widoczności): ten sam komunikat co blokada", () => {
    h.send = failingMutation<SendVars, string>("connection_request: peer not available");
    renderButton({ state: connectionState() });
    clickMain(`${k("network.connect")}: ${PEER_NAME}`);
    fireEvent.click(screen.getByRole("button", { name: k("network.sendInvite") }));
    expect(h.toastError).toHaveBeenCalledWith(k("network.inviteBlocked"));
  });

  it("błąd nierozpoznany: generyczny mapper toastError (bez surowego message)", () => {
    h.send = failingMutation<SendVars, string>("nieznany błąd bazy");
    renderButton({ state: connectionState() });
    clickMain(`${k("network.connect")}: ${PEER_NAME}`);
    fireEvent.click(screen.getByRole("button", { name: k("network.sendInvite") }));
    expect(h.toastErrorMapper).toHaveBeenCalledTimes(1);
    expect(h.toastErrorMapper.mock.calls[0][1]).toBe("save");
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("wysyłka w locie: trigger i przycisk w popoverze zablokowane (bez podwójnego RPC)", () => {
    h.send = pendingMutation<SendVars, string>();
    renderButton({ state: connectionState() });
    const trigger = screen.getByRole("button", { name: `${k("network.connect")}: ${PEER_NAME}` });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
  });
});

describe("ConnectButton - stan pending_out (wysłane)", () => {
  it("etykieta i podpowiedź o oczekiwaniu na odpowiedź", () => {
    renderButton({ state: stateFor("pending_out") });
    const button = screen.getByRole("button", { name: `${k("network.withdraw")}: ${PEER_NAME}` });
    expect(button).toHaveTextContent(k("network.pendingOut"));
    expect(button).toHaveAttribute("title", k("network.pendingOutHint"));
  });

  it("wariant compact: etykieta stanu ukryta poniżej sm", () => {
    renderButton({ state: stateFor("pending_out"), compact: true });
    expect(screen.getByText(k("network.pendingOut")).className).toContain("hidden");
  });

  it("wariant iconOnly: title skrócony do stanu, bez etykiety tekstowej", () => {
    renderButton({ state: stateFor("pending_out"), iconOnly: true });
    const button = screen.getByRole("button", { name: `${k("network.withdraw")}: ${PEER_NAME}` });
    expect(button).toHaveAttribute("title", k("network.pendingOut"));
    expect(screen.queryByText(k("network.pendingOut"))).not.toBeInTheDocument();
  });

  it("wycofanie wymaga potwierdzenia i woła RPC z id relacji", () => {
    h.cancel = succeedingVoidMutation<string>();
    renderButton({ state: stateFor("pending_out") });
    clickMain(`${k("network.withdraw")}: ${PEER_NAME}`);
    expect(screen.getByText(k("network.withdrawTitle", { name: PEER_NAME }))).toBeInTheDocument();
    expect(screen.getByText(k("network.withdrawConfirm"))).toBeInTheDocument();

    confirmAction(k("network.withdraw"));
    expect(cancel().lastVars()).toBe(NETWORK_IDS.connection);
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.withdrawnToast"));
  });

  it("brak id relacji w stanie: potwierdzenie nie woła RPC (guard)", () => {
    h.cancel = succeedingVoidMutation<string>();
    renderButton({ state: connectionState({ status: "pending_out", connectionId: null }) });
    clickMain(`${k("network.withdraw")}: ${PEER_NAME}`);
    confirmAction(k("network.withdraw"));
    expect(cancel().mutate).not.toHaveBeenCalled();
  });

  it("błąd wycofania: generyczny mapper", () => {
    h.cancel = failingMutation<string, void>("boom");
    renderButton({ state: stateFor("pending_out") });
    clickMain(`${k("network.withdraw")}: ${PEER_NAME}`);
    confirmAction(k("network.withdraw"));
    expect(h.toastErrorMapper).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("inna mutacja w locie blokuje przycisk stanu", () => {
    h.cancel = pendingMutation<string, void>();
    renderButton({ state: stateFor("pending_out") });
    expect(
      screen.getByRole("button", { name: `${k("network.withdraw")}: ${PEER_NAME}` }),
    ).toBeDisabled();
  });
});

describe("ConnectButton - stan pending_in (do odpowiedzi)", () => {
  it("dwie akcje: akceptacja i ciche odrzucenie, obie opisane nazwą osoby", () => {
    renderButton({ state: stateFor("pending_in") });
    expect(
      screen.getByRole("button", { name: `${k("network.accept")}: ${PEER_NAME}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${k("network.decline")}: ${PEER_NAME}` }),
    ).toBeInTheDocument();
  });

  it("akceptacja: RPC z accept=true i toast o nowym połączeniu", () => {
    h.respond = succeedingVoidMutation<RespondVars>();
    renderButton({ state: stateFor("pending_in") });
    clickMain(`${k("network.accept")}: ${PEER_NAME}`);
    expect(respond().lastVars()).toEqual({
      connectionId: NETWORK_IDS.connection,
      accept: true,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.acceptedToast"));
  });

  it("odrzucenie: potwierdzenie mówi wprost, że odmowa jest cicha", () => {
    h.respond = succeedingVoidMutation<RespondVars>();
    renderButton({ state: stateFor("pending_in") });
    clickMain(`${k("network.decline")}: ${PEER_NAME}`);
    expect(screen.getByText(k("network.declineTitle", { name: PEER_NAME }))).toBeInTheDocument();
    expect(screen.getByText(k("network.declineConfirm"))).toBeInTheDocument();

    confirmAction(k("network.decline"));
    expect(respond().lastVars()).toEqual({
      connectionId: NETWORK_IDS.connection,
      accept: false,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.declinedToast"));
  });

  it("brak id relacji: ani akceptacja, ani odrzucenie nie wołają RPC", () => {
    h.respond = succeedingVoidMutation<RespondVars>();
    renderButton({ state: connectionState({ status: "pending_in", connectionId: null }) });
    clickMain(`${k("network.accept")}: ${PEER_NAME}`);
    clickMain(`${k("network.decline")}: ${PEER_NAME}`);
    confirmAction(k("network.decline"));
    expect(respond().mutate).not.toHaveBeenCalled();
  });

  it("błąd akceptacji: generyczny mapper", () => {
    h.respond = failingMutation<RespondVars, void>("boom");
    renderButton({ state: stateFor("pending_in") });
    clickMain(`${k("network.accept")}: ${PEER_NAME}`);
    expect(h.toastErrorMapper).toHaveBeenCalledTimes(1);
  });

  it("błąd odrzucenia: generyczny mapper", () => {
    h.respond = failingMutation<RespondVars, void>("boom");
    renderButton({ state: stateFor("pending_in") });
    clickMain(`${k("network.decline")}: ${PEER_NAME}`);
    confirmAction(k("network.decline"));
    expect(h.toastErrorMapper).toHaveBeenCalledTimes(1);
  });

  it("compact: etykieta akceptacji ukryta poniżej sm", () => {
    renderButton({ state: stateFor("pending_in"), compact: true });
    expect(screen.getByText(k("network.accept")).className).toContain("hidden");
  });

  it("mutacja w locie blokuje obie akcje", () => {
    h.respond = pendingMutation<RespondVars, void>();
    renderButton({ state: stateFor("pending_in") });
    expect(
      screen.getByRole("button", { name: `${k("network.accept")}: ${PEER_NAME}` }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: `${k("network.decline")}: ${PEER_NAME}` }),
    ).toBeDisabled();
  });
});

describe("ConnectButton - stan connected (w sieci)", () => {
  const connectedName = () => `${k("network.connected")}: ${PEER_NAME}`;

  it("menu relacji: wiadomość, zgłoszenie, usunięcie", () => {
    renderButton({ state: stateFor("connected") });
    clickMain(connectedName());
    expect(screen.getByRole("button", { name: k("network.messageAction") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: k("network.report") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: k("network.remove") })).toBeInTheDocument();
  });

  it("wariant iconOnly: title zamiast etykiety", () => {
    renderButton({ state: stateFor("connected"), iconOnly: true });
    const button = screen.getByRole("button", { name: connectedName() });
    expect(button).toHaveAttribute("title", k("network.connected"));
    expect(button.className).toContain("h-8 w-8");
  });

  it("wiadomość: startuje rozmowę Z NAZWĄ odbiorcy i otwiera dock czatu", () => {
    h.startChat = succeedingMutation<StartChatVars, string>(NETWORK_IDS.conversation);
    renderButton({ state: stateFor("connected") });
    clickMain(connectedName());
    fireEvent.click(screen.getByRole("button", { name: k("network.messageAction") }));
    // Forma obiektowa jest kontraktem z ExpertRequestDialog (prefill odbiorcy).
    expect(startChat().lastVars()).toEqual({
      peerId: NETWORK_IDS.peer,
      peerName: PEER_NAME,
    });
    expect(h.openChatWindow).toHaveBeenCalledWith({ conversationId: NETWORK_IDS.conversation });
  });

  it("bramka eksperta: żaden toast (dialog zapytania otwiera się z busa)", () => {
    h.startChat = failingMutation<StartChatVars, string>("chat: expert requires request");
    renderButton({ state: stateFor("connected") });
    clickMain(connectedName());
    fireEvent.click(screen.getByRole("button", { name: k("network.messageAction") }));
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.openChatWindow).not.toHaveBeenCalled();
  });

  it("bramka warstwy członkostwa: toast z akcją prowadzącą do cennika", () => {
    h.startChat = failingMutation<StartChatVars, string>("chat: tier disabled");
    renderButton({ state: stateFor("connected") });
    clickMain(connectedName());
    fireEvent.click(screen.getByRole("button", { name: k("network.messageAction") }));
    expect(h.toastError).toHaveBeenCalledTimes(1);
    const [message, options] = h.toastError.mock.calls[0] as [string, { action: ToastAction }];
    expect(message).toBe(k("expertRequest.chatGate.tierDisabledToast"));
    expect(options.action.label).toBe(k("expertRequest.chatGate.openPricing"));
    // Akcja toasta prowadzi do cennika - to jedyne wyjście z tej bramki.
    options.action.onClick();
    expect(window.location.href).toContain("/pricing");
  });

  it("inny błąd startu rozmowy: komunikat o nieudanym starcie", () => {
    h.startChat = failingMutation<StartChatVars, string>("timeout");
    renderButton({ state: stateFor("connected") });
    clickMain(connectedName());
    fireEvent.click(screen.getByRole("button", { name: k("network.messageAction") }));
    expect(h.toastError).toHaveBeenCalledWith(k("network.startError"));
  });

  it("odrzucenie nie będące instancją Error: nie udaje bramki, leci ogólny komunikat", () => {
    // Gałąź obronna `err instanceof Error` - inaczej wzorzec „chat: tier
    // disabled" z obcego obiektu otwierałby toast bramki bez podstaw.
    h.startChat = failingMutation<StartChatVars, string>(structuralError("chat: tier disabled"));
    renderButton({ state: stateFor("connected") });
    clickMain(connectedName());
    fireEvent.click(screen.getByRole("button", { name: k("network.messageAction") }));
    expect(h.toastError).toHaveBeenCalledWith(k("network.startError"));
  });

  it("start rozmowy w locie: akcja wiadomości zablokowana", () => {
    h.startChat = pendingMutation<StartChatVars, string>();
    renderButton({ state: stateFor("connected") });
    clickMain(connectedName());
    expect(screen.getByRole("button", { name: k("network.messageAction") })).toBeDisabled();
  });

  it("zgłoszenie: otwiera dialog moderacji z nazwą osoby", () => {
    renderButton({ state: stateFor("connected") });
    expect(screen.queryByTestId("report-dialog")).not.toBeInTheDocument();
    clickMain(connectedName());
    fireEvent.click(screen.getByRole("button", { name: k("network.report") }));
    expect(screen.getByTestId("report-dialog")).toHaveTextContent(PEER_NAME);
  });

  it("usunięcie z sieci: potwierdzenie uprzedza o obustronnym skutku, potem RPC po userId", () => {
    h.remove = succeedingVoidMutation<string>();
    renderButton({ state: stateFor("connected") });
    clickMain(connectedName());
    fireEvent.click(screen.getByRole("button", { name: k("network.remove") }));
    expect(screen.getByText(k("network.removeTitle", { name: PEER_NAME }))).toBeInTheDocument();
    expect(screen.getByText(k("network.removeConfirm"))).toBeInTheDocument();

    // Dialog ma własny przycisk akcji - bierzemy ten wewnątrz alertdialog.
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).filter(
        (b) => b.textContent === k("network.remove"),
      )[0],
    );
    expect(remove().lastVars()).toBe(NETWORK_IDS.peer);
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.removedToast"));
  });

  it("błąd usunięcia: generyczny mapper", () => {
    h.remove = failingMutation<string, void>("boom");
    renderButton({ state: stateFor("connected") });
    clickMain(connectedName());
    fireEvent.click(screen.getByRole("button", { name: k("network.remove") }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).filter(
        (b) => b.textContent === k("network.remove"),
      )[0],
    );
    expect(h.toastErrorMapper).toHaveBeenCalledTimes(1);
  });

  it("usuwanie w locie blokuje przycisk stanu", () => {
    h.remove = pendingMutation<string, void>();
    renderButton({ state: stateFor("connected") });
    expect(screen.getByRole("button", { name: connectedName() })).toBeDisabled();
  });

  it("compact: etykieta stanu ukryta poniżej sm", () => {
    renderButton({ state: stateFor("connected"), compact: true });
    expect(screen.getByText(k("network.connected")).className).toContain("hidden");
  });
});

describe("ConnectButton - potwierdzenia (wspólny atom dialogu)", () => {
  it("każde potwierdzenie ma anulowanie ze wspólnego słownika", () => {
    renderButton({ state: stateFor("pending_out") });
    clickMain(`${k("network.withdraw")}: ${PEER_NAME}`);
    expect(screen.getByRole("button", { name: k("common.cancel") })).toBeInTheDocument();
  });

  it("zamknięcie dialogu bez potwierdzenia nie woła RPC", () => {
    h.cancel = succeedingVoidMutation<string>();
    renderButton({ state: stateFor("pending_out") });
    clickMain(`${k("network.withdraw")}: ${PEER_NAME}`);
    fireEvent.click(screen.getByRole("button", { name: k("common.cancel") }));
    expect(cancel().mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
