// ProfileViewsCard: „kto oglądał Twój profil" - karta widoczna wyłącznie
// właścicielowi. Sedno testów to PRYWATNOŚĆ widza: baza maskuje anonimowych
// (klient nie zna ich id, nazwy ani awatara), a prywatnych w ogóle nie zwraca.
// Dodatkowo: liczniki 7/30/90 dni, przełącznik własnego trybu widoczności
// i czas względny w czterech kubełkach.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  NETWORK_IDS,
  PEER_NAME,
  idleMutation,
  minutesAgo,
  pendingMutation,
  pendingQueryStub,
  profileViewerRow,
  queryStub,
  translateKey as k,
  type MutationStub,
} from "@/test/network/fixtures";
import type {
  ProfileViewMode,
  ProfileViewStats,
  ProfileViewer,
} from "@/lib/network/useProfileViews";

const h = vi.hoisted(() => ({
  viewers: null as unknown,
  stats: null as unknown,
  mode: null as unknown,
  update: null as unknown,
  viewerLimits: [] as number[],
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));
vi.mock("@/lib/network/useProfileViews", () => ({
  useMyProfileViewers: (limit: number) => {
    h.viewerLimits.push(limit);
    return h.viewers;
  },
  useMyProfileViewStats: () => h.stats,
  useMyProfileViewMode: () => h.mode,
  useUpdateProfileViewMode: () => h.update,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ProfileViewsCard } from "@/components/network/ProfileViewsCard";

const update = (): MutationStub<ProfileViewMode, void> =>
  h.update as MutationStub<ProfileViewMode, void>;

function setViewers(rows: ReadonlyArray<ProfileViewer>): void {
  h.viewers = queryStub(rows);
}

function privacySelect(): HTMLElement {
  return screen.getByRole("combobox");
}

function renderCard() {
  return renderWithQueryClient(<ProfileViewsCard />);
}

beforeEach(() => {
  h.viewerLimits = [];
  setViewers([]);
  h.stats = queryStub<ProfileViewStats | null>({ last_7: 4, last_30: 19, last_90: 42 });
  h.mode = queryStub<ProfileViewMode>("public");
  h.update = idleMutation<ProfileViewMode, void>();
});

describe("ProfileViewsCard - liczniki", () => {
  it("trzy okna czasowe z liczbami z RPC", () => {
    renderCard();
    expect(screen.getByText(k("network.profileViews.last7"))).toBeInTheDocument();
    expect(screen.getByText(k("network.profileViews.last30"))).toBeInTheDocument();
    expect(screen.getByText(k("network.profileViews.last90"))).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("19")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("ładowanie: szkielety zamiast zer (żeby nie kłamać liczbą)", () => {
    h.stats = pendingQueryStub<ProfileViewStats | null>();
    const { container } = renderCard();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("brak statystyk po stronie RPC: zera, nie puste kafle", () => {
    h.stats = queryStub<ProfileViewStats | null>(null);
    renderCard();
    expect(screen.getAllByText("0")).toHaveLength(3);
  });

  it("lista widzów pobierana z limitem 20", () => {
    renderCard();
    expect(h.viewerLimits).toEqual([20]);
  });
});

describe("ProfileViewsCard - mój tryb widoczności", () => {
  it("pokazuje aktualny tryb i wszystkie trzy opcje", () => {
    h.mode = queryStub<ProfileViewMode>("anonymous");
    renderCard();
    expect(privacySelect()).toHaveTextContent(k("network.profileViews.modeAnonymous"));

    fireEvent.keyDown(privacySelect(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      k("network.profileViews.modePublic"),
      k("network.profileViews.modeAnonymous"),
      k("network.profileViews.modePrivate"),
    ]);
  });

  it("brak zapisanego trybu: domyślnie publiczny", () => {
    h.mode = queryStub<ProfileViewMode | undefined>(undefined);
    renderCard();
    expect(privacySelect()).toHaveTextContent(k("network.profileViews.modePublic"));
  });

  it("zmiana trybu wysyła mutację z nową wartością", () => {
    renderCard();
    fireEvent.keyDown(privacySelect(), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: k("network.profileViews.modePrivate") }));
    expect(update().lastVars()).toBe("private");
  });

  it("zapis w locie blokuje przełącznik (bez wyścigu trybów)", () => {
    h.update = pendingMutation<ProfileViewMode, void>();
    renderCard();
    expect(privacySelect()).toBeDisabled();
  });

  it("tryb jeszcze nieodczytany: przełącznik zablokowany", () => {
    h.mode = pendingQueryStub<ProfileViewMode>();
    renderCard();
    expect(privacySelect()).toBeDisabled();
  });

  it("wyjaśnia konsekwencje trybów anonimowego i prywatnego", () => {
    renderCard();
    expect(screen.getByText(k("network.profileViews.privacyLabel"))).toBeInTheDocument();
    expect(screen.getByText(k("network.profileViews.privacyHint"))).toBeInTheDocument();
  });
});

describe("ProfileViewsCard - lista widzów i prywatność", () => {
  it("widz publiczny: nazwa, rola z firmą i link na profil", () => {
    setViewers([profileViewerRow({ viewed_at: minutesAgo(0) })]);
    renderCard();
    expect(screen.getByText(PEER_NAME)).toBeInTheDocument();
    expect(screen.getByText("Analityk - NES")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/author/${NETWORK_IDS.peer}`);
  });

  it("widz anonimowy: maska nazwy, brak podpisu, brak linku do profilu", () => {
    setViewers([
      profileViewerRow({
        viewer_mode: "anonymous",
        display_name: PEER_NAME,
        job_title: "Analityk",
        company: "NES",
        avatar_url: "https://cdn.test/a.png",
      }),
    ]);
    renderCard();
    expect(screen.getByText(k("network.profileViews.anonymousViewer"))).toBeInTheDocument();
    expect(screen.queryByText(PEER_NAME)).not.toBeInTheDocument();
    expect(screen.queryByText("Analityk - NES")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // Awatar anonimowego widza nigdy nie trafia do DOM.
    expect(document.querySelector("img")).toBeNull();
  });

  it("widz publiczny bez nazwy: też maska (RPC zwrócił pustą nazwę)", () => {
    setViewers([profileViewerRow({ display_name: "   " })]);
    renderCard();
    expect(screen.getByText(k("network.profileViews.anonymousViewer"))).toBeInTheDocument();
  });

  it("widz publiczny bez id: nazwa bez linku", () => {
    setViewers([profileViewerRow({ viewer_id: "" })]);
    renderCard();
    expect(screen.getByText(PEER_NAME)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("widz z awatarem: obraz z lazy-loadingiem", () => {
    setViewers([profileViewerRow({ avatar_url: "https://cdn.test/a.png" })]);
    renderCard();
    const img = document.querySelector("img");
    expect(img).toHaveAttribute("src", "https://cdn.test/a.png");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("czas względny ma cztery kubełki: chwila, minuty, godziny, dni", () => {
    setViewers([
      profileViewerRow({ viewer_id: "v1", viewed_at: minutesAgo(0) }),
      profileViewerRow({ viewer_id: "v2", viewed_at: minutesAgo(5) }),
      profileViewerRow({ viewer_id: "v3", viewed_at: minutesAgo(180) }),
      profileViewerRow({ viewer_id: "v4", viewed_at: minutesAgo(60 * 24 * 3) }),
    ]);
    renderCard();
    expect(screen.getByText(k("network.profileViews.justNow"))).toBeInTheDocument();
    expect(
      screen.getByText(k("network.profileViews.minutesAgo", { count: 5 })),
    ).toBeInTheDocument();
    expect(screen.getByText(k("network.profileViews.hoursAgo", { count: 3 }))).toBeInTheDocument();
    expect(screen.getByText(k("network.profileViews.daysAgo", { count: 3 }))).toBeInTheDocument();
  });

  it("data z przyszłości (zegar klienta) nie daje ujemnego czasu", () => {
    setViewers([profileViewerRow({ viewed_at: minutesAgo(-30) })]);
    renderCard();
    expect(screen.getByText(k("network.profileViews.justNow"))).toBeInTheDocument();
  });

  it("ładowanie listy: szkielety wierszy", () => {
    h.viewers = pendingQueryStub<ReadonlyArray<ProfileViewer>>();
    const { container } = renderCard();
    expect(container.querySelectorAll(".h-14.animate-pulse")).toHaveLength(3);
  });

  it("pusta lista w trybie publicznym: komunikat, że nikt jeszcze nie zaglądał", () => {
    renderCard();
    expect(screen.getByText(k("network.profileViews.empty"))).toBeInTheDocument();
  });

  it("pusta lista w trybie prywatnym: wyjaśnienie, że to skutek własnego wyboru", () => {
    h.mode = queryStub<ProfileViewMode>("private");
    renderCard();
    // Ta sama treść co przy przełączniku - lista jest wyłączona, nie pusta.
    expect(screen.getAllByText(k("network.profileViews.privacyHint"))).toHaveLength(2);
    expect(screen.queryByText(k("network.profileViews.empty"))).not.toBeInTheDocument();
  });
});
