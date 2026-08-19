// MessageOrConnectButton - jedna kontrolka kontaktu tam, gdzie na karcie jest
// miejsce tylko na jedną: koperta dla zaakceptowanego kontaktu, zaproszenie
// dla wszystkich pozostałych stanów.
//
// CO DOWODZI TEN PLIK: sam WYBÓR i to, co komponent przekazuje dalej. Obie
// kontrolki mają własne, gęste suity (`DirectMessageButton.test.tsx`,
// `ConnectButton.matrix.test.tsx`), więc tutaj stoją sondy - test pilnuje
// rozstrzygnięcia, a nie po raz drugi zachowania dzieci.
//
// Trzy rzeczy, których nie widać w typach:
//   1. ROZSTRZYGNIĘCIE. Pomyłka w warunku daje kopertę przy braku relacji -
//      czyli przycisk, który natychmiast dostaje odmowę z bazy.
//   2. PLACEHOLDER W CZASIE ŁADOWANIA. Bez niego lista osób skacze przy
//      każdym rozstrzygnięciu statusu.
//   3. JEDNO ZAPYTANIE NA LISTĘ. Gdy status przychodzi z batchowanego RPC,
//      komponent nie może dopytywać osobno - karta z dwudziestoma osobami
//      wysłałaby dwadzieścia zapytań.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  NETWORK_IDS,
  PEER_NAME,
  pendingQueryStub,
  queryStub,
  stateFor,
  statusMap,
} from "@/test/network/fixtures";

const h = vi.hoisted(() => ({
  user: { id: "user-me" } as { id: string } | null,
  modules: { chat_enabled: true, connections_enabled: true },
  statuses: null as unknown,
  requestedIds: [] as ReadonlyArray<string>[],
  props: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/community/useCommunityModules", () => ({ useCommunityModules: () => h.modules }));
vi.mock("@/lib/network/useConnections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/network/useConnections")>()),
  useConnectionStatuses: (ids: ReadonlyArray<string>) => {
    h.requestedIds.push(ids);
    return h.statuses;
  },
}));

/** Sonda zapisująca propy - dzieci mają własne suity, tu liczy się wybór. */
function probe(name: string) {
  return (props: Record<string, unknown>) => {
    h.props[name] = props;
    return <div data-testid={name} />;
  };
}
vi.mock("@/components/network/ConnectButton", () => ({ ConnectButton: probe("ConnectButton") }));
vi.mock("@/components/network/DirectMessageButton", () => ({
  DirectMessageButton: probe("DirectMessageButton"),
}));

import { MessageOrConnectButton } from "@/components/network/MessageOrConnectButton";

function renderButton(props: Record<string, unknown> = {}) {
  return render(
    <MessageOrConnectButton
      userId={NETWORK_IDS.peer}
      displayName={PEER_NAME}
      displayAvatar="https://cdn.test/a.png"
      {...props}
    />,
  );
}

beforeEach(() => {
  h.user = { id: NETWORK_IDS.me };
  h.modules = { chat_enabled: true, connections_enabled: true };
  h.statuses = queryStub(statusMap({ [NETWORK_IDS.peer]: stateFor("connected") }));
  h.requestedIds = [];
  h.props = {};
});

describe("MessageOrConnectButton - wybór kontrolki", () => {
  it("kontakt zaakceptowany: koperta, nie zaproszenie", () => {
    renderButton();

    expect(screen.getByTestId("DirectMessageButton")).toBeInTheDocument();
    expect(screen.queryByTestId("ConnectButton")).not.toBeInTheDocument();
  });

  it.each(["none", "pending_out", "pending_in"] as const)(
    "relacja „%s” - zaproszenie, nie koperta",
    (status) => {
      h.statuses = queryStub(statusMap({ [NETWORK_IDS.peer]: stateFor(status) }));

      renderButton();

      expect(screen.getByTestId("ConnectButton")).toBeInTheDocument();
      expect(screen.queryByTestId("DirectMessageButton")).not.toBeInTheDocument();
    },
  );

  it("odbiorca spoza zasięgu sieci: zaproszenie BEZ narzuconego stanu", () => {
    // Brak wpisu w mapie znaczy „nie wiem", a nie „brak relacji". `ConnectButton`
    // ma wtedy sam sięgnąć po swój fallback, więc `state` musi być `undefined`,
    // nie `null` - inaczej maszyna stanów zaproszenia dostaje fałszywą pewność.
    h.statuses = queryStub(statusMap({}));

    renderButton();

    expect(screen.getByTestId("ConnectButton")).toBeInTheDocument();
    expect(h.props.ConnectButton.state).toBeUndefined();
  });

  it("koperta dostaje ROZSTRZYGNIĘTY stan relacji, nie pyta o niego drugi raz", () => {
    renderButton();

    expect(h.props.DirectMessageButton.connectionState).toMatchObject({ status: "connected" });
  });
});

describe("MessageOrConnectButton - ładowanie statusu", () => {
  it("stabilny placeholder zamiast skoku układu na liście", () => {
    h.statuses = pendingQueryStub();

    renderButton();

    const placeholder = screen.getByRole("button", { hidden: true });
    expect(placeholder).toBeDisabled();
    expect(screen.queryByTestId("ConnectButton")).not.toBeInTheDocument();
    expect(screen.queryByTestId("DirectMessageButton")).not.toBeInTheDocument();
  });

  it("placeholder trzyma rozmiar docelowej kontrolki (h-9, compact/iconOnly h-8)", () => {
    h.statuses = pendingQueryStub();
    const { unmount } = renderButton();
    expect(screen.getByRole("button", { hidden: true }).className).toContain("h-9");
    unmount();

    renderButton({ compact: true });
    expect(screen.getByRole("button", { hidden: true }).className).toContain("h-8");
  });

  it("placeholder przyjmuje className wywołującego", () => {
    h.statuses = pendingQueryStub();

    renderButton({ className: "moja-klasa", iconOnly: true });

    const placeholder = screen.getByRole("button", { hidden: true });
    expect(placeholder.className).toContain("moja-klasa");
    expect(placeholder.className).toContain("h-8");
  });

  it("STATUS PODANY Z GÓRY nie ma stanu ładowania - kontrolka jest od razu", () => {
    h.statuses = pendingQueryStub();

    renderButton({ connectionState: stateFor("connected") });

    expect(screen.getByTestId("DirectMessageButton")).toBeInTheDocument();
    expect(screen.queryByRole("button", { hidden: true })).not.toBeInTheDocument();
  });
});

describe("MessageOrConnectButton - kiedy NIE pytamy o status", () => {
  it("status podany z góry: żadnego zapytania", () => {
    renderButton({ connectionState: stateFor("none") });

    expect(h.requestedIds.every((ids) => ids.length === 0)).toBe(true);
  });

  it("gość: żadnego zapytania", () => {
    h.user = null;

    renderButton();

    expect(h.requestedIds.every((ids) => ids.length === 0)).toBe(true);
  });

  it("własny profil: żadnego zapytania", () => {
    h.user = { id: NETWORK_IDS.peer };

    renderButton();

    expect(h.requestedIds.every((ids) => ids.length === 0)).toBe(true);
  });

  it("moduł kontaktów wyłączony: żadnego zapytania", () => {
    h.modules = { chat_enabled: true, connections_enabled: false };

    renderButton();

    expect(h.requestedIds.every((ids) => ids.length === 0)).toBe(true);
  });

  it("z kompletem warunków pytamy DOKŁADNIE o tego odbiorcę", () => {
    renderButton();

    expect(h.requestedIds.some((ids) => ids.length === 1 && ids[0] === NETWORK_IDS.peer)).toBe(
      true,
    );
  });
});

describe("MessageOrConnectButton - przekazanie wyglądu w dół", () => {
  it("compact, iconOnly i className jadą do wybranej kontrolki", () => {
    renderButton({ compact: true, iconOnly: true, className: "moja-klasa" });

    expect(h.props.DirectMessageButton).toMatchObject({
      compact: true,
      iconOnly: true,
      className: "moja-klasa",
      displayName: PEER_NAME,
    });
  });

  it("zaproszenie dostaje ten sam zestaw", () => {
    h.statuses = queryStub(statusMap({ [NETWORK_IDS.peer]: stateFor("none") }));

    renderButton({ compact: true, iconOnly: true, className: "moja-klasa" });

    expect(h.props.ConnectButton).toMatchObject({
      compact: true,
      iconOnly: true,
      className: "moja-klasa",
      userId: NETWORK_IDS.peer,
    });
  });
});
