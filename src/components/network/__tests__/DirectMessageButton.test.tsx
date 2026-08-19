// DirectMessageButton: uniwersalna „koperta" na profilach i kartach osób.
// Dwie bramki nad sobą: moduł czatu tenanta (twarda, ukrywa przycisk) i
// `features.chat_enabled` warstwy członkostwa (miękka, otwiera dialog upgrade'u
// zamiast rzucać 403 z bazy). Do tego trzy stany wizualne (aktywny / zamknięty
// / w locie) i wyciszenie toasta, gdy dialog zapytania do eksperta otwiera bus.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  NETWORK_IDS,
  PEER_NAME,
  errorQueryStub,
  stateFor,
  statusMap,
  failingMutation,
  idleMutation,
  pendingMutation,
  pendingQueryStub,
  queryStub,
  structuralError,
  succeedingMutation,
  translateKey as k,
  type MutationStub,
} from "@/test/network/fixtures";
import type { CurrentTier } from "@/lib/billing/tiers";

type StartChatVars = { peerId: string; peerName?: string | null; peerAvatar?: string | null };

const h = vi.hoisted(() => ({
  user: { id: "user-me" } as { id: string } | null,
  modules: { chat_enabled: true, connections_enabled: true },
  /** Wynik `useConnectionStatuses` - koperta pokazuje się TYLKO dla „connected". */
  statuses: null as unknown,
  /** Identyfikatory, o które komponent faktycznie zapytał (albo nie zapytał). */
  requestedIds: [] as ReadonlyArray<string>[],
  tier: null as unknown,
  startChat: null as unknown,
  openChatWindow: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/lib/i18n-direct-message", () => ({ ensureI18n: () => {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/community/useCommunityModules", () => ({ useCommunityModules: () => h.modules }));
// `tierHasFeature` zostaje PRAWDZIWE - to ono decyduje o miękkiej bramce.
vi.mock("@/lib/billing/tiers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/tiers")>()),
  useCurrentTier: () => h.tier,
}));
// Stan relacji rozstrzyga o samym ISTNIENIU przycisku, więc musi być sterowalny.
// `importOriginal` zostawia resztę modułu prawdziwą - atrapa podmienia wyłącznie
// odczyt statusów.
vi.mock("@/lib/network/useConnections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/network/useConnections")>()),
  useConnectionStatuses: (ids: ReadonlyArray<string>) => {
    h.requestedIds.push(ids);
    return h.statuses;
  },
}));
vi.mock("@/lib/chat/useConversations", () => ({ useStartConversation: () => h.startChat }));
vi.mock("@/lib/chat/chatDockBus", () => ({ openChatWindow: h.openChatWindow }));
vi.mock("sonner", () => ({ toast: { error: h.toastError } }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { DirectMessageButton } from "@/components/network/DirectMessageButton";

const startChat = (): MutationStub<StartChatVars, string> =>
  h.startChat as MutationStub<StartChatVars, string>;

function tierWith(chatEnabled: boolean): CurrentTier {
  return {
    key: chatEnabled ? "plus" : "essential",
    rank: chatEnabled ? 10 : 0,
    name_pl: "Warstwa",
    name_en: "Tier",
    features: { chat_enabled: chatEnabled },
  };
}

function renderButton(props: { compact?: boolean; className?: string } = {}) {
  return render(
    <DirectMessageButton
      userId={NETWORK_IDS.peer}
      displayName={PEER_NAME}
      displayAvatar="https://cdn.test/a.png"
      compact={props.compact}
      className={props.className}
    />,
  );
}

const activeAria = () => k("directMessage.ariaLabel", { name: PEER_NAME });
const busyAria = () => k("directMessage.ariaBusy", { name: PEER_NAME });

/**
 * Radix montuje treść tooltipa dopiero po interakcji - focus otwiera go bez
 * czekania na `delayDuration`, więc test czyta REALNĄ podpowiedź, a nie prop.
 */
function tooltipTextFor(name: string): string {
  fireEvent.focus(screen.getByRole("button", { name }));
  const tip = screen.getAllByRole("tooltip")[0];
  return tip.textContent ?? "";
}

beforeEach(() => {
  h.user = { id: NETWORK_IDS.me };
  h.modules = { chat_enabled: true, connections_enabled: true };
  h.statuses = queryStub(statusMap({ [NETWORK_IDS.peer]: stateFor("connected") }));
  h.requestedIds = [];
  h.tier = queryStub<CurrentTier | null>(tierWith(true));
  h.startChat = idleMutation<StartChatVars, string>();
  h.openChatWindow.mockClear();
  h.toastError.mockClear();
});

describe("DirectMessageButton - bramki widoczności", () => {
  it("moduł czatu wyłączony w tenancie: przycisk nie istnieje", () => {
    h.modules = { chat_enabled: false, connections_enabled: true };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("anon: przycisk nie istnieje", () => {
    h.user = null;
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("własny profil: przycisk nie istnieje", () => {
    h.user = { id: NETWORK_IDS.peer };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("DirectMessageButton - bramka RELACJI (koperta tylko dla kontaktu)", () => {
  // Wiadomość bezpośrednia wymaga zaakceptowanego kontaktu. W pozostałych
  // stanach komponent MUSI zniknąć, bo to samo miejsce zajmuje wtedy
  // `ConnectButton` (patrz `MessageOrConnectButton`) - dwie kontrolki naraz
  // albo koperta prowadząca do odmowy z bazy to defekt widoczny na każdej
  // karcie osoby.
  it.each(["none", "pending_out", "pending_in"] as const)(
    "relacja „%s” - koperty nie ma, miejsce zostaje dla zaproszenia",
    (status) => {
      h.statuses = queryStub(statusMap({ [NETWORK_IDS.peer]: stateFor(status) }));

      const { container } = renderButton();

      expect(container).toBeEmptyDOMElement();
    },
  );

  it("brak wpisu o relacji w mapie: koperty nie ma", () => {
    // Odbiorca spoza zasięgu sieci nie pojawia się w mapie statusów wcale.
    h.statuses = queryStub(statusMap({}));

    expect(renderButton().container).toBeEmptyDOMElement();
  });

  it("ŁADOWANIE statusu: stabilny placeholder zamiast skoku układu", () => {
    // Bez placeholdera lista osób przeskakiwałaby przy każdym rozstrzygnięciu
    // statusu - koperta pojawia się i znika w trakcie przewijania.
    h.statuses = pendingQueryStub();

    renderButton();

    const placeholder = screen.getByRole("button", { hidden: true });
    expect(placeholder).toBeDisabled();
    expect(placeholder.className).toContain("cursor-not-allowed");
  });

  it("placeholder trzyma ten sam rozmiar co docelowy przycisk (h-9, compact h-8)", () => {
    h.statuses = pendingQueryStub();
    const { unmount } = renderButton();
    expect(screen.getByRole("button", { hidden: true }).className).toContain("h-9");
    unmount();

    renderButton({ compact: true });
    expect(screen.getByRole("button", { hidden: true }).className).toContain("h-8");
  });

  it("STATUS PODANY Z GÓRY (batch RPC) nie generuje drugiego zapytania", () => {
    // Listy osób czytają statusy jednym RPC. Gdyby każdy przycisk dopytywał
    // osobno, karta z dwudziestoma osobami wysyłałaby dwadzieścia zapytań.
    render(
      <DirectMessageButton
        userId={NETWORK_IDS.peer}
        displayName={PEER_NAME}
        displayAvatar={null}
        connectionState={stateFor("connected")}
      />,
    );

    expect(screen.getByRole("button", { name: activeAria() })).toBeInTheDocument();
    expect(h.requestedIds.every((ids) => ids.length === 0)).toBe(true);
  });

  it("moduł kontaktów WYŁĄCZONY: nie pytamy o status wcale", () => {
    h.modules = { chat_enabled: true, connections_enabled: false };

    renderButton();

    expect(h.requestedIds.every((ids) => ids.length === 0)).toBe(true);
  });

  it("WŁASNY profil: nie pytamy o status wcale", () => {
    h.user = { id: NETWORK_IDS.peer };

    renderButton();

    expect(h.requestedIds.every((ids) => ids.length === 0)).toBe(true);
  });
});

describe("DirectMessageButton - miękka bramka warstwy członkostwa", () => {
  it("warstwa z chat_enabled: przycisk aktywny, tooltip zachęca do rozmowy", () => {
    renderButton();
    const button = screen.getByRole("button", { name: activeAria() });
    expect(button).not.toBeDisabled();
    expect(button.className).toContain("hover:bg-brand/10");
    expect(tooltipTextFor(activeAria())).toBe(k("directMessage.tooltipEnabled"));
  });

  it("warstwa bez chat_enabled: klik otwiera dialog upgrade'u, nie startuje rozmowy", () => {
    h.tier = queryStub<CurrentTier | null>(tierWith(false));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: activeAria() }));

    expect(startChat().mutate).not.toHaveBeenCalled();
    expect(screen.getByText(k("directMessage.upgrade.title"))).toBeInTheDocument();
    expect(
      screen.getByText(k("directMessage.upgrade.description", { name: PEER_NAME })),
    ).toBeInTheDocument();
    // Trzy korzyści + wyjście na cennik.
    expect(screen.getByText(k("directMessage.upgrade.benefit1"))).toBeInTheDocument();
    expect(screen.getByText(k("directMessage.upgrade.benefit3"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: k("directMessage.upgrade.cta") })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  it("warstwa jeszcze nieznana: domyślnie zablokowane (bez migania aktywne -> zamknięte)", () => {
    h.tier = pendingQueryStub<CurrentTier | null>();
    renderButton();
    expect(tooltipTextFor(activeAria())).toBe(k("directMessage.tooltipLocked"));
    fireEvent.click(screen.getByRole("button", { name: activeAria() }));
    expect(startChat().mutate).not.toHaveBeenCalled();
  });

  it("błąd odczytu warstwy: też zablokowane (fail-closed)", () => {
    h.tier = errorQueryStub<CurrentTier | null>();
    renderButton();
    expect(tooltipTextFor(activeAria())).toBe(k("directMessage.tooltipLocked"));
    expect(screen.getByRole("button", { name: activeAria() }).className).toContain(
      "text-muted-foreground",
    );
  });

  it("warstwa bez pola features: zablokowane", () => {
    h.tier = queryStub<CurrentTier | null>({
      key: "x",
      rank: 0,
      name_pl: "x",
      name_en: "x",
      features: null,
    });
    renderButton();
    expect(tooltipTextFor(activeAria())).toBe(k("directMessage.tooltipLocked"));
  });

  it("dialog upgrade'u da się zamknąć bez wychodzenia na cennik", () => {
    h.tier = queryStub<CurrentTier | null>(tierWith(false));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: activeAria() }));
    fireEvent.click(screen.getByRole("button", { name: k("directMessage.upgrade.cancel") }));
    expect(screen.queryByText(k("directMessage.upgrade.title"))).not.toBeInTheDocument();
  });

  it("klik w cennik zamyka dialog (nie zostaje otwarty pod nową trasą)", () => {
    h.tier = queryStub<CurrentTier | null>(tierWith(false));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: activeAria() }));
    fireEvent.click(screen.getByRole("link", { name: k("directMessage.upgrade.cta") }));
    expect(screen.queryByText(k("directMessage.upgrade.title"))).not.toBeInTheDocument();
  });
});

describe("DirectMessageButton - start rozmowy", () => {
  it("sukces: przekazuje nazwę i awatar odbiorcy, otwiera dock czatu", () => {
    h.startChat = succeedingMutation<StartChatVars, string>(NETWORK_IDS.conversation);
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: activeAria() }));
    expect(startChat().lastVars()).toEqual({
      peerId: NETWORK_IDS.peer,
      peerName: PEER_NAME,
      peerAvatar: "https://cdn.test/a.png",
    });
    expect(h.openChatWindow).toHaveBeenCalledWith({ conversationId: NETWORK_IDS.conversation });
  });

  it("brak awatara: przekazuje null zamiast undefined (kontrakt busa)", () => {
    h.startChat = succeedingMutation<StartChatVars, string>(NETWORK_IDS.conversation);
    render(<DirectMessageButton userId={NETWORK_IDS.peer} displayName={PEER_NAME} />);
    fireEvent.click(screen.getByRole("button", { name: activeAria() }));
    expect(startChat().lastVars()).toEqual({
      peerId: NETWORK_IDS.peer,
      peerName: PEER_NAME,
      peerAvatar: null,
    });
  });

  it("bramka eksperta z bazy: cisza w toastach (dialog zapytania idzie z busa)", () => {
    h.startChat = failingMutation<StartChatVars, string>("chat: expert requires request");
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: activeAria() }));
    expect(h.toastError).not.toHaveBeenCalled();
    expect(screen.queryByText(k("directMessage.upgrade.title"))).not.toBeInTheDocument();
  });

  it("bramka warstwy z bazy: dialog upgrade'u zamiast surowego błędu", () => {
    h.startChat = failingMutation<StartChatVars, string>("chat: tier disabled");
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: activeAria() }));
    expect(screen.getByText(k("directMessage.upgrade.title"))).toBeInTheDocument();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("inny błąd: komunikat o nieudanym starcie rozmowy", () => {
    h.startChat = failingMutation<StartChatVars, string>("timeout");
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: activeAria() }));
    expect(h.toastError).toHaveBeenCalledWith(k("directMessage.startError"));
  });

  it("odrzucenie nie będące instancją Error: ogólny komunikat, bez fałszywej bramki", () => {
    h.startChat = failingMutation<StartChatVars, string>(structuralError("chat: tier disabled"));
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: activeAria() }));
    expect(h.toastError).toHaveBeenCalledWith(k("directMessage.startError"));
    expect(screen.queryByText(k("directMessage.upgrade.title"))).not.toBeInTheDocument();
  });

  it("w locie: aria-busy, spinner, kursor oczekiwania i brak drugiego RPC", () => {
    h.startChat = pendingMutation<StartChatVars, string>();
    renderButton();
    const button = screen.getByRole("button", { name: busyAria() });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "true");
    expect(button.className).toContain("cursor-wait");
    expect(screen.getByText(k("directMessage.opening"))).toBeInTheDocument();
    expect(tooltipTextFor(busyAria())).toBe(k("directMessage.tooltipBusy"));

    fireEvent.click(button);
    expect(startChat().mutate).not.toHaveBeenCalled();
  });
});

describe("DirectMessageButton - layout", () => {
  it("domyślnie h-9, compact h-8 (kafelki wyszukiwarki i listy)", () => {
    const { unmount } = renderButton();
    expect(screen.getByRole("button", { name: activeAria() }).className).toContain("h-9 w-9");
    unmount();
    renderButton({ compact: true });
    expect(screen.getByRole("button", { name: activeAria() }).className).toContain("h-8 w-8");
  });

  it("klik nie propaguje się do karty osoby pod przyciskiem", () => {
    const onCardClick = vi.fn();
    h.startChat = succeedingMutation<StartChatVars, string>(NETWORK_IDS.conversation);
    render(
      <button type="button" onClick={onCardClick}>
        <DirectMessageButton userId={NETWORK_IDS.peer} displayName={PEER_NAME} />
      </button>,
    );
    fireEvent.click(screen.getByRole("button", { name: activeAria() }));
    expect(onCardClick).not.toHaveBeenCalled();
    expect(startChat().mutate).toHaveBeenCalledTimes(1);
  });

  it("przyjmuje className wywołującego", () => {
    renderButton({ className: "ml-1" });
    expect(screen.getByRole("button", { name: activeAria() }).className).toContain("ml-1");
  });
});
