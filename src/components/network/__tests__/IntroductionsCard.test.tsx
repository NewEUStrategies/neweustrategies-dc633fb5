// IntroductionsCard: trzy role w jednej karcie (/profile > Aktywność).
//   - „Do mnie" (bridge): moderacja - przekaż / odmów, odmowa jest CICHA,
//   - „Wysłane" (requester): status + wycofanie,
//   - „O mnie" (target): tylko wprowadzenia PRZEKAZANE przez wspólną osobę.
// Filtr roli target jest tu wymogiem prywatności, nie kosmetyką: prośba
// odrzucona przez most nie może być widoczna dla osoby docelowej.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  PEER_NAME,
  failingMutation,
  idleMutation,
  introductionRow,
  pendingMutation,
  succeedingVoidMutation,
  translateKey as k,
  type MutationStub,
} from "@/test/network/fixtures";
import type { IntroductionRole, IntroductionRow } from "@/lib/network/useIntroductions";

type RespondVars = { id: string; action: "forward" | "decline" | "withdraw" };

const h = vi.hoisted(() => ({
  rows: {} as Record<string, ReadonlyArray<IntroductionRow>>,
  roles: [] as string[],
  respond: null as unknown,
  toastSuccess: vi.fn(),
  toastErrorMapper: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));
vi.mock("@/lib/network/useIntroductions", () => ({
  useMyIntroductions: (role: IntroductionRole) => {
    h.roles.push(role);
    return { data: h.rows[role] ?? [], isPending: false };
  },
  useRespondIntroduction: () => h.respond,
}));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastErrorMapper }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess } }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { IntroductionsCard } from "@/components/network/IntroductionsCard";

const respond = (): MutationStub<RespondVars, void> => h.respond as MutationStub<RespondVars, void>;

/** Radix przełącza zakładki na mouseDown/focus - klik w happy-dom nie wystarcza. */
function openTab(label: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name: new RegExp(label) }));
}

function renderCard() {
  return renderWithQueryClient(<IntroductionsCard />);
}

beforeEach(() => {
  h.rows = {};
  h.roles = [];
  h.respond = idleMutation<RespondVars, void>();
  h.toastSuccess.mockClear();
  h.toastErrorMapper.mockClear();
});

describe("IntroductionsCard - zakładki i liczniki", () => {
  it("pyta o wszystkie trzy role jednym RPC na rolę", () => {
    renderCard();
    expect(new Set(h.roles)).toEqual(new Set(["bridge", "requester", "target"]));
  });

  it("licznik oczekujących pokazuje się tylko przy niezerowej liczbie", () => {
    h.rows = {
      bridge: [introductionRow({ id: "a" }), introductionRow({ id: "b", status: "declined" })],
      requester: [introductionRow({ id: "c" })],
    };
    renderCard();
    const bridgeTab = screen.getByRole("tab", {
      name: new RegExp(k("network.introductions.tabBridge")),
    });
    const requesterTab = screen.getByRole("tab", {
      name: new RegExp(k("network.introductions.tabRequester")),
    });
    const targetTab = screen.getByRole("tab", {
      name: new RegExp(k("network.introductions.tabTarget")),
    });
    // Tylko `pending` liczy się do badge'a.
    expect(bridgeTab).toHaveTextContent("1");
    expect(requesterTab).toHaveTextContent("1");
    expect(targetTab.textContent).toBe(k("network.introductions.tabTarget"));
  });

  it("puste stany są osobne dla każdej roli", () => {
    renderCard();
    expect(screen.getByText(k("network.introductions.emptyBridge"))).toBeInTheDocument();

    openTab(k("network.introductions.tabRequester"));
    expect(screen.getByText(k("network.introductions.emptyRequester"))).toBeInTheDocument();

    openTab(k("network.introductions.tabTarget"));
    expect(screen.getByText(k("network.introductions.emptyTarget"))).toBeInTheDocument();
  });

  it("zakładka mostu przypomina, że odmowa jest cicha", () => {
    renderCard();
    expect(screen.getByText(k("network.introductions.bridgeHint"))).toBeInTheDocument();
  });
});

describe("IntroductionsCard - rola mostu (moderacja)", () => {
  beforeEach(() => {
    h.rows = { bridge: [introductionRow()] };
  });

  it("wiersz pokazuje kto prosi, do kogo i treść notki", () => {
    renderCard();
    expect(screen.getByRole("link", { name: "Marek Requester" })).toHaveAttribute(
      "href",
      "/author/user-requester",
    );
    expect(
      screen.getByText(k("network.introductions.wantsIntroTo", { name: PEER_NAME })),
    ).toBeInTheDocument();
    expect(screen.getByText(/pakietu energetycznego/)).toBeInTheDocument();
    expect(screen.getByText(k("network.introductions.status.pending"))).toBeInTheDocument();
  });

  it("przekazanie dalej: RPC z akcją forward i toast o przekazaniu", () => {
    h.respond = succeedingVoidMutation<RespondVars>();
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: k("network.introductions.accept") }));
    expect(respond().lastVars()).toEqual({ id: "intro-1", action: "forward" });
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.introductions.acceptedToast"));
  });

  it("odmowa: RPC z akcją decline i toast o odrzuceniu", () => {
    h.respond = succeedingVoidMutation<RespondVars>();
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: k("network.introductions.decline") }));
    expect(respond().lastVars()).toEqual({ id: "intro-1", action: "decline" });
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.introductions.declinedToast"));
  });

  it("błąd odpowiedzi: generyczny mapper zamiast surowego błędu RPC", () => {
    h.respond = failingMutation<RespondVars, void>("not your request");
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: k("network.introductions.accept") }));
    expect(h.toastErrorMapper).toHaveBeenCalledTimes(1);
    expect(h.toastErrorMapper.mock.calls[0][1]).toBe("save");
  });

  it("odpowiedź w locie blokuje obie akcje", () => {
    h.respond = pendingMutation<RespondVars, void>();
    renderCard();
    expect(screen.getByRole("button", { name: k("network.introductions.accept") })).toBeDisabled();
    expect(screen.getByRole("button", { name: k("network.introductions.decline") })).toBeDisabled();
  });

  it("prośba już rozstrzygnięta nie ma akcji moderacji", () => {
    h.rows = { bridge: [introductionRow({ status: "forwarded" })] };
    renderCard();
    expect(
      screen.queryByRole("button", { name: k("network.introductions.accept") }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(k("network.introductions.status.forwarded"))).toBeInTheDocument();
  });

  it("awatar mostu renderuje obraz, gdy jest w wierszu", () => {
    h.rows = { bridge: [introductionRow({ requester_avatar: "https://cdn.test/r.png" })] };
    renderCard();
    const img = document.querySelector("img");
    expect(img).toHaveAttribute("src", "https://cdn.test/r.png");
  });
});

describe("IntroductionsCard - rola wysyłającego", () => {
  it("wiersz pokazuje most i pozwala wycofać prośbę", () => {
    h.respond = succeedingVoidMutation<RespondVars>();
    h.rows = { requester: [introductionRow()] };
    renderCard();
    openTab(k("network.introductions.tabRequester"));

    expect(
      screen.getByText(k("network.introductions.viaBridge", { name: "Jan Kowalski" })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: k("network.introductions.withdraw") }));
    expect(respond().lastVars()).toEqual({ id: "intro-1", action: "withdraw" });
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.introductions.withdrawnToast"));
  });

  it("prośba wycofana / odrzucona nie ma już akcji wycofania", () => {
    h.rows = { requester: [introductionRow({ status: "withdrawn" })] };
    renderCard();
    openTab(k("network.introductions.tabRequester"));
    expect(
      screen.queryByRole("button", { name: k("network.introductions.withdraw") }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(k("network.introductions.status.withdrawn"))).toBeInTheDocument();
  });
});

describe("IntroductionsCard - rola osoby docelowej (prywatność)", () => {
  it("widać WYŁĄCZNIE wprowadzenia przekazane przez most", () => {
    h.rows = {
      target: [
        introductionRow({ id: "forwarded-1", status: "forwarded" }),
        introductionRow({ id: "declined-1", status: "declined" }),
        introductionRow({ id: "pending-1", status: "pending" }),
      ],
    };
    renderCard();
    openTab(k("network.introductions.tabTarget"));

    expect(
      screen.getByText(k("network.introductions.introducedBy", { name: "Jan Kowalski" })),
    ).toBeInTheDocument();
    // Jeden wiersz - odrzucona i oczekująca prośba nie mogą tu wyciekać.
    expect(screen.getAllByText(k("network.introductions.status.forwarded"))).toHaveLength(1);
    expect(screen.queryByText(k("network.introductions.status.declined"))).not.toBeInTheDocument();
    expect(screen.queryByText(k("network.introductions.status.pending"))).not.toBeInTheDocument();
  });

  it("zakładka wyjaśnia, dlaczego lista jest krótsza niż liczba próśb", () => {
    renderCard();
    openTab(k("network.introductions.tabTarget"));
    expect(screen.getByText(k("network.introductions.targetHint"))).toBeInTheDocument();
  });

  it("osoba docelowa nie ma akcji moderacji ani wycofania", () => {
    h.rows = { target: [introductionRow({ status: "forwarded" })] };
    renderCard();
    openTab(k("network.introductions.tabTarget"));
    expect(
      screen.queryByRole("button", { name: k("network.introductions.accept") }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: k("network.introductions.withdraw") }),
    ).not.toBeInTheDocument();
  });
});

describe("IntroductionsCard - chip statusu", () => {
  it("każdy status ma własne wybarwienie (oczekuje / przekazane / zamknięte)", () => {
    h.rows = {
      bridge: [
        introductionRow({ id: "p", status: "pending" }),
        introductionRow({ id: "f", status: "forwarded" }),
        introductionRow({ id: "d", status: "declined" }),
      ],
    };
    renderCard();
    expect(screen.getByText(k("network.introductions.status.pending")).className).toContain(
      "bg-amber-500/10",
    );
    expect(screen.getByText(k("network.introductions.status.forwarded")).className).toContain(
      "bg-primary/10",
    );
    expect(screen.getByText(k("network.introductions.status.declined")).className).toContain(
      "bg-muted",
    );
  });
});
