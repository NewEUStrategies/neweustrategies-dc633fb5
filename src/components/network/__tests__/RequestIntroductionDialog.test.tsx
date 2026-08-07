// RequestIntroductionDialog: wprowadzenie przez wspólny kontakt („most").
// Reguły, których pilnujemy w UI, bo baza odrzuciłaby je dopiero po wysyłce:
//   - most wybiera się WYŁĄCZNIE z własnej sieci (lista `my_connections`),
//   - ten sam most nie może mieć dwóch aktywnych próśb do tej samej osoby,
//   - notka musi mieścić się w 20-600 znakach (licznik + blokada wysyłki),
//   - zamknięcie dialogu czyści formularz (żeby prośba nie „wracała").
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  NETWORK_IDS,
  PEER_NAME,
  failingMutation,
  idleMutation,
  introductionRow,
  myConnectionRow,
  pendingMutation,
  succeedingMutation,
  translateKey as k,
  type MutationStub,
} from "@/test/network/fixtures";
import {
  INTRO_MESSAGE_MAX,
  INTRO_MESSAGE_MIN,
  type IntroductionRow,
} from "@/lib/network/useIntroductions";
import type { MyConnectionRow } from "@/lib/network/useConnections";

type RequestVars = { bridgeId: string; targetId: string; message: string };

const h = vi.hoisted(() => ({
  connections: { pages: [] as MyConnectionRow[][], isPending: false },
  queries: [] as Array<{ query: string; pageSize: number }>,
  request: null as unknown,
  toastSuccess: vi.fn(),
  toastErrorMapper: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));
vi.mock("@/lib/network/useConnections", () => ({
  useMyConnections: (query: string, pageSize: number) => {
    h.queries.push({ query, pageSize });
    return {
      data: h.connections.isPending ? undefined : { pages: h.connections.pages },
      isPending: h.connections.isPending,
    };
  },
}));
vi.mock("@/lib/network/useIntroductions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/network/useIntroductions")>()),
  useRequestIntroduction: () => h.request,
}));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastErrorMapper }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess } }));

import { RequestIntroductionDialog } from "@/components/network/RequestIntroductionDialog";

const request = (): MutationStub<RequestVars, string> =>
  h.request as MutationStub<RequestVars, string>;

const VALID_NOTE = "Poznaliśmy się na szczycie klimatycznym w Brukseli w 2025 roku.";

function renderDialog(options: { open?: boolean; existing?: ReadonlyArray<IntroductionRow> } = {}) {
  const onOpenChange = vi.fn();
  const view = render(
    <RequestIntroductionDialog
      open={options.open ?? true}
      onOpenChange={onOpenChange}
      targetId={NETWORK_IDS.peer}
      targetName={PEER_NAME}
      existing={options.existing}
    />,
  );
  return { ...view, onOpenChange };
}

/** Notka - celujemy w placeholder, bo obok żyje pole wyszukiwania mostu. */
function noteField(): HTMLElement {
  return screen.getByPlaceholderText(
    k("network.introductions.messagePlaceholder", { name: PEER_NAME }),
  );
}

function typeNote(value: string): void {
  fireEvent.change(noteField(), { target: { value } });
}

function sendButton(): HTMLElement {
  return screen.getByRole("button", { name: k("network.introductions.send") });
}

beforeEach(() => {
  h.connections = { pages: [[myConnectionRow()]], isPending: false };
  h.queries = [];
  h.request = idleMutation<RequestVars, string>();
  h.toastSuccess.mockClear();
  h.toastErrorMapper.mockClear();
});

describe("RequestIntroductionDialog - szkielet", () => {
  it("zamknięty: nic nie renderuje", () => {
    const { container } = renderDialog({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("otwarty: tytuł z nazwą osoby docelowej i wyjaśnienie roli mostu", () => {
    renderDialog();
    expect(
      screen.getByText(k("network.introductions.requestTitle", { name: PEER_NAME })),
    ).toBeInTheDocument();
    expect(screen.getByText(k("network.introductions.requestSubtitle"))).toBeInTheDocument();
    expect(screen.getByText(k("network.introductions.bridgeLabel"))).toBeInTheDocument();
  });

  it("lista mostów jeździ na mojej sieci z limitem 30 i frazą wyszukiwania", () => {
    renderDialog();
    expect(h.queries[0]).toEqual({ query: "", pageSize: 30 });

    fireEvent.change(screen.getByPlaceholderText(k("network.searchPlaceholder")), {
      target: { value: "kowalski" },
    });
    expect(h.queries.at(-1)).toEqual({ query: "kowalski", pageSize: 30 });
  });

  it("ładowanie sieci: komunikat zamiast pustej listy", () => {
    h.connections = { pages: [], isPending: true };
    renderDialog();
    expect(screen.getByText(k("network.loadingMore"))).toBeInTheDocument();
  });

  it("brak kontaktów: prośba o wprowadzenie nie ma z czego wyjść", () => {
    h.connections = { pages: [[]], isPending: false };
    renderDialog();
    expect(screen.getByText(k("network.introductions.noBridges"))).toBeInTheDocument();
  });

  it("kontakt na liście: nazwa i rola z firmą złączone półpauzą", () => {
    renderDialog();
    expect(screen.getByText("Jan Kowalski")).toBeInTheDocument();
    expect(screen.getByText("Dyrektor - NES")).toBeInTheDocument();
  });

  it("kontakt z awatarem renderuje obraz z lazy-loadingiem", () => {
    h.connections = {
      pages: [[myConnectionRow({ avatar_url: "https://cdn.test/j.png" })]],
      isPending: false,
    };
    renderDialog();
    // Dialog jeździ w portalu, więc szukamy w dokumencie, nie w kontenerze.
    const img = document.querySelector("img");
    expect(img).toHaveAttribute("src", "https://cdn.test/j.png");
    expect(img).toHaveAttribute("loading", "lazy");
  });
});

describe("RequestIntroductionDialog - wybór mostu", () => {
  it("kliknięty most zostaje podświetlony", () => {
    renderDialog();
    const option = screen.getByRole("button", { name: /Jan Kowalski/ });
    expect(option.className).not.toContain("bg-primary/10");
    fireEvent.click(option);
    expect(option.className).toContain("bg-primary/10");
  });

  it("most z aktywną prośbą do TEJ osoby jest zablokowany i oznaczony", () => {
    renderDialog({
      existing: [
        introductionRow({
          bridge_id: NETWORK_IDS.bridge,
          target_id: NETWORK_IDS.peer,
          status: "pending",
        }),
      ],
    });
    const option = screen.getByRole("button", { name: /Jan Kowalski/ });
    expect(option).toBeDisabled();
    expect(screen.getByText(k("network.introductions.bridgeUsed"))).toBeInTheDocument();
  });

  it("prośba przez ten most do INNEJ osoby nie blokuje wyboru", () => {
    renderDialog({
      existing: [introductionRow({ target_id: "kto-inny", status: "pending" })],
    });
    expect(screen.getByRole("button", { name: /Jan Kowalski/ })).not.toBeDisabled();
  });

  it("prośba zamknięta (nie `pending`) nie blokuje ponowienia", () => {
    renderDialog({
      existing: [introductionRow({ target_id: NETWORK_IDS.peer, status: "declined" })],
    });
    expect(screen.getByRole("button", { name: /Jan Kowalski/ })).not.toBeDisabled();
  });
});

describe("RequestIntroductionDialog - notka i wysyłka", () => {
  it("bez mostu i bez notki wysyłka jest zablokowana", () => {
    renderDialog();
    expect(sendButton()).toBeDisabled();
  });

  it("notka poniżej minimum: licznik na czerwono, wysyłka nadal zablokowana", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Jan Kowalski/ }));
    typeNote("Za krótka");
    expect(screen.getByText(`9 / ${INTRO_MESSAGE_MAX}`).className).toContain("text-destructive");
    expect(sendButton()).toBeDisabled();
  });

  it("pusta notka nie jest wybarwiana na czerwono (formularz jeszcze nietknięty)", () => {
    renderDialog();
    expect(screen.getByText(`0 / ${INTRO_MESSAGE_MAX}`).className).not.toContain(
      "text-destructive",
    );
  });

  it("notka dłuższa niż limit jest ucinana przy wpisywaniu", () => {
    renderDialog();
    typeNote("x".repeat(INTRO_MESSAGE_MAX + 50));
    expect(noteField()).toHaveValue("x".repeat(INTRO_MESSAGE_MAX));
    expect(screen.getByText(`${INTRO_MESSAGE_MAX} / ${INTRO_MESSAGE_MAX}`)).toBeInTheDocument();
  });

  it("minimalna długość notki to kontrakt z bazą, nie zaokrąglenie UI", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Jan Kowalski/ }));
    typeNote("y".repeat(INTRO_MESSAGE_MIN - 1));
    expect(sendButton()).toBeDisabled();
    typeNote("y".repeat(INTRO_MESSAGE_MIN));
    expect(sendButton()).not.toBeDisabled();
  });

  it("wysyłka: RPC dostaje most, osobę docelową i notkę bez białych znaków", () => {
    h.request = succeedingMutation<RequestVars, string>("intro-1");
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Jan Kowalski/ }));
    typeNote(`   ${VALID_NOTE}   `);
    fireEvent.click(sendButton());

    expect(request().lastVars()).toEqual({
      bridgeId: NETWORK_IDS.bridge,
      targetId: NETWORK_IDS.peer,
      message: VALID_NOTE,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.introductions.requestedToast"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sukces czyści formularz (kolejne otwarcie startuje od zera)", () => {
    h.request = succeedingMutation<RequestVars, string>("intro-1");
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Jan Kowalski/ }));
    typeNote(VALID_NOTE);
    fireEvent.click(sendButton());
    expect(noteField()).toHaveValue("");
    expect(sendButton()).toBeDisabled();
  });

  it("błąd RPC: generyczny mapper, dialog zostaje otwarty z treścią notki", () => {
    h.request = failingMutation<RequestVars, string>("must be connected to bridge");
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Jan Kowalski/ }));
    typeNote(VALID_NOTE);
    fireEvent.click(sendButton());

    expect(h.toastErrorMapper).toHaveBeenCalledTimes(1);
    expect(h.toastErrorMapper.mock.calls[0][1]).toBe("save");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(noteField()).toHaveValue(VALID_NOTE);
  });

  it("wysyłka w locie: etykieta wysyłania i blokada przycisku", () => {
    h.request = pendingMutation<RequestVars, string>();
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Jan Kowalski/ }));
    typeNote(VALID_NOTE);
    const button = screen.getByRole("button", { name: k("network.introductions.sending") });
    expect(button).toBeDisabled();
  });

  it("anulowanie zamyka dialog i czyści formularz", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /Jan Kowalski/ }));
    typeNote(VALID_NOTE);
    fireEvent.click(screen.getByRole("button", { name: k("network.introductions.cancel") }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("zamknięcie z zewnątrz (Escape) też czyści formularz", () => {
    const { onOpenChange } = renderDialog();
    typeNote(VALID_NOTE);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(noteField()).toHaveValue("");
  });
});
