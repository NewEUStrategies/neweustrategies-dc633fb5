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
  NETWORK_IDS,
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
      "/people/marek-requester",
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
      "bg-brand/100/10",
    );
    expect(screen.getByText(k("network.introductions.status.forwarded")).className).toContain(
      "bg-primary/10",
    );
    expect(screen.getByText(k("network.introductions.status.declined")).className).toContain(
      "bg-muted",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Odnośniki do profilu: SLUG, nigdy id
// ─────────────────────────────────────────────────────────────────────────────
//
// Do 20261002100000 karta podawała trasie `/people/$slug` identyfikator osoby
// (`requester_id` / `target_id` / `bridge_id`), a `get_member_profile` szuka
// WYŁĄCZNIE po slugu (20260924100000:34-36) - każde kliknięcie w każdej z trzech
// ról kończyło się kartą "Nie znaleziono profilu". Jedyna asercja href w tym
// pliku przechodziła mimo to, bo fikstura miała id w kształcie sluga
// ("user-requester"). Tu id są prawdziwymi UUID-ami, a slug jest od nich różny,
// więc pomylenie jednego z drugim wywraca test.
//
// Oczekiwane adresy są wpisane DOSŁOWNIE (jak przy kotwicy niżej): po drugiej
// stronie kontraktu stoi baza, która o helperach klienta nic nie wie.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_IDS = {
  requester_id: "0b5a7c1e-3d2f-4e6a-9b8c-1d2e3f4a5b6c",
  target_id: "1c6b8d2f-4e3a-4f7b-8c9d-2e3f4a5b6c7d",
  bridge_id: "2d7c9e3a-5f4b-4a8c-9d0e-3f4a5b6c7d8e",
} as const;

type SlugColumn = "requester_slug" | "target_slug" | "bridge_slug";
type RouteColumn = "requester_route" | "target_route" | "bridge_route";

const ROLE_LINKS: ReadonlyArray<{
  role: IntroductionRole;
  tabKey: string | null;
  status: string;
  name: string;
  slugColumn: SlugColumn;
  href: string;
}> = [
  {
    role: "bridge",
    tabKey: null,
    status: "pending",
    name: "Marek Requester",
    slugColumn: "requester_slug",
    href: "/people/marek-requester",
  },
  {
    role: "requester",
    tabKey: "network.introductions.tabRequester",
    status: "pending",
    name: PEER_NAME,
    slugColumn: "target_slug",
    href: "/people/anna-nowak",
  },
  {
    role: "target",
    tabKey: "network.introductions.tabTarget",
    status: "forwarded",
    name: "Jan Kowalski",
    slugColumn: "bridge_slug",
    href: "/people/jan-kowalski",
  },
];

function renderRole(c: (typeof ROLE_LINKS)[number], overrides: Partial<IntroductionRow> = {}) {
  h.rows = { [c.role]: [introductionRow({ status: c.status, ...UUID_IDS, ...overrides })] };
  renderCard();
  if (c.tabKey) openTab(k(c.tabKey));
}

function peopleHrefs(): string[] {
  return Array.from(document.querySelectorAll('a[href^="/people/"]')).map(
    (a) => a.getAttribute("href") ?? "",
  );
}

describe("IntroductionsCard - odnośniki do profilu (slug, nie id)", () => {
  it.each(ROLE_LINKS)(
    "$role: awatar i nazwisko prowadzą na slug DRUGIEJ strony, nie na jej id",
    (c) => {
      renderRole(c);

      // Dwa odnośniki w wierszu (awatar bez nazwy dostępnej + nazwisko) - oba
      // na ten sam profil i żaden na cudzy slug ani na identyfikator.
      expect(peopleHrefs()).toEqual([c.href, c.href]);
      expect(screen.getByRole("link", { name: c.name })).toHaveAttribute("href", c.href);
      for (const href of peopleHrefs()) expect(href).not.toMatch(UUID_RE);
    },
  );

  it.each(
    ROLE_LINKS.flatMap((c) =>
      [null, "", "   "].map((slug) => ({ ...c, slug, label: JSON.stringify(slug) })),
    ),
  )(
    "$role: slug $label (baza nie rozwiąże profilu) - sam tekst, BEZ linku i bez zastępczego id",
    (c) => {
      renderRole(c, { [c.slugColumn]: c.slug, requester_avatar: "https://cdn.test/a.png" });

      expect(peopleHrefs()).toEqual([]);
      expect(screen.queryByRole("link", { name: c.name })).not.toBeInTheDocument();
      expect(screen.getByText(c.name)).toBeInTheDocument();
    },
  );

  it("brak sluga nie gubi awatara - zostaje obraz, znika tylko odnośnik", () => {
    const bridge = ROLE_LINKS[0];
    renderRole(bridge, { requester_slug: null, requester_avatar: "https://cdn.test/r.png" });

    expect(document.querySelector("img")).toHaveAttribute("src", "https://cdn.test/r.png");
    expect(document.querySelector("a")).toBeNull();
  });

  it.each(ROLE_LINKS)("$role: trasa 'author' (autor z publicznym hubem) -> /author/<slug>", (c) => {
    const routeColumn = c.slugColumn.replace("_slug", "_route") as RouteColumn;
    renderRole(c, { [routeColumn]: "author" });

    const authorHref = c.href.replace("/people/", "/author/");
    expect(screen.getByRole("link", { name: c.name })).toHaveAttribute("href", authorHref);
    expect(peopleHrefs()).toEqual([]);
  });

  it.each([null, "", "admin"])(
    "trasa %j (brak albo nieznana) - bez linku, mimo poprawnego sluga",
    (route) => {
      renderRole(ROLE_LINKS[0], { requester_route: route });

      expect(screen.queryByRole("link", { name: "Marek Requester" })).not.toBeInTheDocument();
      expect(document.querySelector("a")).toBeNull();
    },
  );

  it("id w kształcie sluga też nie trafia do adresu, gdy slug jest pusty", () => {
    renderRole(ROLE_LINKS[0], { requester_id: NETWORK_IDS.me, requester_slug: null });

    expect(peopleHrefs()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kotwica deep-linku z powiadomienia (A6)
// ─────────────────────────────────────────────────────────────────────────────
//
// Producent i konsument tego kontraktu żyją w dwóch różnych językach i żaden
// nie widzi drugiego: wyzwalacz `tg_introduction_notify` (20260812101000:92,
// 113, 125, 141) skleja adres `'/profile?tab=activity&intro=<rola>#i-' ||
// NEW.id || '-<status>'`, a wiersz karty jest zwykłym `<div>` w TSX.
//
// Do 20260913 ta druga połowa NIE ISTNIAŁA: w całym pliku nie było ani jednego
// atrybutu `id`, więc fragment adresu nie miał w co trafić - powiadomienie
// doprowadzało na właściwą zakładkę i zostawiało użytkownika na górze listy.
// Najostrzejsze jest to, że nagłówek tamtej migracji (punkt 2 "MARTWE LINKI")
// deklarował wprost, że "fragment #i-<id>-<status> wskazuje wiersz" - była to
// NAPRAWA martwych linków, która poprawiła parametry `?tab`/`?intro`
// i zostawiła drugą połowę nienapisaną, w przekonaniu, że istnieje.
//
// Dlatego asercja porównuje się z formatem DOSŁOWNIE, a nie przez helper:
// gdyby oba końce brały łańcuch z tej samej funkcji, test przeszedłby także po
// zmianie formatu po obu stronach naraz - czyli po rozjeździe z bazą, która
// o tej funkcji nic nie wie.
describe("IntroductionsCard - kotwica deep-linku z powiadomienia", () => {
  it("wiersz ma `id` DOKŁADNIE w formacie, który skleja wyzwalacz bazy", () => {
    h.rows = { bridge: [introductionRow({ id: "intro-42", status: "pending" })] };
    renderCard();

    expect(document.getElementById("i-intro-42-pending")).not.toBeNull();
  });

  it("status jest CZĘŚCIĄ kotwicy - wyzwalacz stempluje stan z chwili wysyłki", () => {
    h.rows = { bridge: [introductionRow({ id: "intro-7", status: "forwarded" })] };
    renderCard();

    expect(document.getElementById("i-intro-7-forwarded")).not.toBeNull();
    // Kotwica o innym statusie NIE istnieje - to ona zmusza `resolveAnchorId`
    // do zejścia na "ten sam wiersz w innym stanie".
    expect(document.getElementById("i-intro-7-pending")).toBeNull();
  });

  it("kotwica należy do WIERSZA, więc dwa wprowadzenia mają dwa różne `id`", () => {
    h.rows = {
      bridge: [
        introductionRow({ id: "intro-a", status: "pending" }),
        introductionRow({ id: "intro-b", status: "pending" }),
      ],
    };
    renderCard();

    expect(document.getElementById("i-intro-a-pending")).not.toBeNull();
    expect(document.getElementById("i-intro-b-pending")).not.toBeNull();
  });
});
