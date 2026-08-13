// RecommendationsSection: rekomendacje na publicznym profilu autora.
// Trzy widoki w jednym komponencie:
//   - gość / czytelnik: tylko rekomendacje `published`,
//   - odbiorca profilu: dodatkowo kolejka `pending` z akcjami publish/hide/delete,
//   - osoba z sieci: przycisk „napisz rekomendację" (RPC i tak wymaga relacji).
// Osobno testujemy mapowanie KODÓW BŁĘDÓW RPC na komunikaty - to była droga
// defektu „cichego sukcesu": UI nie odróżniał braku zmiany od zmiany.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  NETWORK_IDS,
  PEER_NAME,
  failingMutation,
  idleMutation,
  pendingMutation,
  queryStub,
  recommendationRow,
  stateFor,
  statusMap,
  succeedingMutation,
  succeedingVoidMutation,
  translateKey as k,
  type MutationStub,
} from "@/test/network/fixtures";
import {
  RECOMMENDATION_BODY_MAX,
  RECOMMENDATION_BODY_MIN,
  type Recommendation,
  type RecommendationRelationship,
} from "@/lib/network/useRecommendations";
import type { ConnectionState } from "@/lib/network/useConnections";

type RespondVars = { id: string; action: string; recipientId: string };
type WriteVars = { body: string; relationship: RecommendationRelationship };

const h = vi.hoisted(() => ({
  user: { id: "user-me" } as { id: string } | null,
  lang: "pl",
  rows: [] as ReadonlyArray<Recommendation>,
  statuses: null as unknown,
  statusRequests: [] as ReadonlyArray<string>[],
  respond: null as unknown,
  write: null as unknown,
  writeRecipients: [] as string[],
  confirm: true,
  confirmCalls: [] as Array<Record<string, unknown>>,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/network/fixtures");
  return reactI18nextStub(() => h.lang);
});
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/network/useConnections", () => ({
  useConnectionStatuses: (ids: ReadonlyArray<string>) => {
    h.statusRequests.push(ids);
    return h.statuses;
  },
}));
// Stałe długości treści i słownik relacji zostają PRAWDZIWE - to kontrakt
// z CHECK-ami w bazie, a nie parametr testu.
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@/lib/network/useRecommendations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/network/useRecommendations")>();
  return {
    ...actual,
    useRecommendations: () => queryStub(h.rows),
    useRespondRecommendation: () => h.respond,
    useWriteRecommendation: (recipientId: string) => {
      h.writeRecipients.push(recipientId);
      return h.write;
    },
  };
});
vi.mock("@/lib/i18n/format", () => ({
  formatDate: (_date: Date, lang: string) => `data(${lang})`,
}));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: (opts: Record<string, unknown>) => {
    h.confirmCalls.push(opts);
    return Promise.resolve(h.confirm);
  },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { RecommendationsSection } from "@/components/network/RecommendationsSection";

const respond = (): MutationStub<RespondVars, void> => h.respond as MutationStub<RespondVars, void>;
const write = (): MutationStub<WriteVars, string> => h.write as MutationStub<WriteVars, string>;

function connectedToRecipient(): void {
  h.statuses = queryStub(statusMap({ [NETWORK_IDS.peer]: stateFor("connected") }));
}

function renderSection() {
  return renderWithQueryClient(
    <RecommendationsSection recipientId={NETWORK_IDS.peer} recipientName={PEER_NAME} />,
  );
}

function openWriteDialog(): void {
  fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.writeCta") }));
}

beforeEach(() => {
  h.user = { id: NETWORK_IDS.me };
  h.lang = "pl";
  h.rows = [];
  h.statuses = queryStub<ReadonlyMap<string, ConnectionState>>(statusMap({}));
  h.statusRequests = [];
  h.respond = idleMutation<RespondVars, void>();
  h.write = idleMutation<WriteVars, string>();
  h.writeRecipients = [];
  h.confirm = true;
  h.confirmCalls = [];
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

describe("RecommendationsSection - widoczność sekcji", () => {
  it("brak rekomendacji i brak relacji: sekcja w ogóle nie zajmuje miejsca na profilu", () => {
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });

  it("anon z opublikowanymi rekomendacjami: sekcja widoczna, bez CTA", () => {
    h.user = null;
    h.rows = [recommendationRow()];
    renderSection();
    expect(screen.getByText(k("network.recommendations.heading"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: k("network.recommendations.writeCta") }),
    ).not.toBeInTheDocument();
    // Anon nie generuje zapytania o status relacji.
    expect(h.statusRequests).toEqual([[]]);
  });

  it("osoba z sieci bez żadnych rekomendacji: sekcja z pustym stanem i CTA", () => {
    connectedToRecipient();
    renderSection();
    expect(screen.getByText(k("network.recommendations.empty"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: k("network.recommendations.writeCta") }),
    ).toBeInTheDocument();
  });

  it("osoba spoza sieci: brak CTA (RPC i tak wymaga zaakceptowanej relacji)", () => {
    h.statuses = queryStub(statusMap({ [NETWORK_IDS.peer]: stateFor("pending_out") }));
    h.rows = [recommendationRow()];
    renderSection();
    expect(
      screen.queryByRole("button", { name: k("network.recommendations.writeCta") }),
    ).not.toBeInTheDocument();
  });

  it("właściciel profilu: brak CTA i brak zapytania o status z samym sobą", () => {
    h.user = { id: NETWORK_IDS.peer };
    h.rows = [recommendationRow()];
    renderSection();
    expect(
      screen.queryByRole("button", { name: k("network.recommendations.writeCta") }),
    ).not.toBeInTheDocument();
    expect(h.statusRequests).toEqual([[]]);
  });

  it("licznik przy nagłówku pokazuje liczbę opublikowanych rekomendacji", () => {
    h.rows = [
      recommendationRow({ id: "r1" }),
      recommendationRow({ id: "r2" }),
      recommendationRow({ id: "r3", status: "pending" }),
    ];
    renderSection();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("RecommendationsSection - karta rekomendacji", () => {
  it("autor linkuje na profil, obok nagłówek i rodzaj relacji", () => {
    h.rows = [recommendationRow()];
    renderSection();
    expect(screen.getByRole("link", { name: "Ewa Autorka" })).toHaveAttribute(
      "href",
      "/author/user-author",
    );
    expect(screen.getByText("· Ekspertka ds. klimatu")).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(k("network.recommendations.relationshipOptions.colleague"))),
    ).toBeInTheDocument();
    expect(screen.getByText(/Współpraca wzorowa/)).toBeInTheDocument();
  });

  it("bez awatara: inicjały autora; z awatarem: obraz", () => {
    h.rows = [recommendationRow()];
    const { unmount } = renderSection();
    expect(screen.getByText("EA")).toBeInTheDocument();
    unmount();

    h.rows = [recommendationRow({ author_avatar: "https://cdn.test/e.png" })];
    renderSection();
    expect(document.querySelector("img")).toHaveAttribute("src", "https://cdn.test/e.png");
  });

  it("nazwa bez sensownych inicjałów: znak zapytania zamiast pustego kółka", () => {
    h.rows = [recommendationRow({ author_name: "   " })];
    renderSection();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("brak rodzaju relacji: karta pokazuje samą datę", () => {
    h.rows = [recommendationRow({ relationship: null, author_headline: null })];
    renderSection();
    expect(screen.getByText("data(pl)")).toBeInTheDocument();
  });

  it("data jest formatowana w języku interfejsu", () => {
    h.rows = [recommendationRow({ relationship: null })];
    h.lang = "en-GB";
    renderSection();
    expect(screen.getByText("data(en)")).toBeInTheDocument();
  });
});

describe("RecommendationsSection - kolejka odbiorcy", () => {
  beforeEach(() => {
    h.user = { id: NETWORK_IDS.peer };
    h.rows = [recommendationRow({ id: "p1", status: "pending" })];
  });

  it("właściciel widzi kolejkę do zatwierdzenia z licznikiem", () => {
    renderSection();
    expect(
      screen.getByText(k("network.recommendations.pendingHeading", { count: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByText("Ewa Autorka")).toBeInTheDocument();
  });

  it("ktoś inny NIE widzi kolejki (moderacja jest prywatna)", () => {
    h.user = { id: NETWORK_IDS.me };
    connectedToRecipient();
    renderSection();
    expect(
      screen.queryByText(k("network.recommendations.pendingHeading", { count: 1 })),
    ).not.toBeInTheDocument();
  });

  it("publikacja: RPC z akcją publish i profilem, którego dotyczy decyzja", () => {
    h.respond = succeedingVoidMutation<RespondVars>();
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.publish") }));
    expect(respond().lastVars()).toEqual({
      id: "p1",
      action: "publish",
      recipientId: NETWORK_IDS.peer,
    });
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.recommendations.toastPublished"));
  });

  it("ukrycie: RPC z akcją hide", () => {
    h.respond = succeedingVoidMutation<RespondVars>();
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.hide") }));
    expect(respond().lastVars()?.action).toBe("hide");
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.recommendations.toastHidden"));
  });

  it("usunięcie wymaga potwierdzenia i jest oznaczone jako destrukcyjne", async () => {
    h.respond = succeedingVoidMutation<RespondVars>();
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.remove") }));

    await waitFor(() => expect(respond().mutate).toHaveBeenCalled());
    expect(h.confirmCalls[0]).toEqual({
      title: k("network.recommendations.deleteConfirmTitle"),
      description: k("network.recommendations.deleteConfirmBody", { name: "Ewa Autorka" }),
      confirmLabel: k("network.recommendations.remove"),
      destructive: true,
    });
    expect(respond().lastVars()?.action).toBe("delete");
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.recommendations.toastDeleted"));
  });

  it("anulowane potwierdzenie nie usuwa niczego", async () => {
    h.confirm = false;
    h.respond = succeedingVoidMutation<RespondVars>();
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.remove") }));
    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(respond().mutate).not.toHaveBeenCalled();
  });

  it("akcje w locie są zablokowane", () => {
    h.respond = pendingMutation<RespondVars, void>();
    renderSection();
    expect(
      screen.getByRole("button", { name: k("network.recommendations.publish") }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: k("network.recommendations.hide") })).toBeDisabled();
  });

  it("wiersz bez rodzaju relacji nie pokazuje pustej etykiety", () => {
    h.rows = [recommendationRow({ id: "p1", status: "pending", relationship: null })];
    renderSection();
    expect(
      screen.queryByText(k("network.recommendations.relationshipOptions.colleague")),
    ).not.toBeInTheDocument();
  });
});

describe("RecommendationsSection - mapowanie kodów błędów RPC", () => {
  beforeEach(() => {
    h.user = { id: NETWORK_IDS.peer };
    h.rows = [recommendationRow({ id: "p1", status: "pending" })];
  });

  const CASES: ReadonlyArray<[string, string]> = [
    ["must_be_connected", "network.recommendations.errors.notConnected"],
    ["tenant_mismatch", "network.recommendations.errors.tenantMismatch"],
    ["not_your_recommendation", "network.recommendations.errors.notYours"],
    ["invalid_action", "network.recommendations.errors.invalidAction"],
    ["auth_required", "network.recommendations.errors.authRequired"],
  ];

  for (const [code, key] of CASES) {
    it(`kod ${code} dostaje własny komunikat`, () => {
      h.respond = failingMutation<RespondVars, void>(`respond_recommendation: ${code}`);
      renderSection();
      fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.publish") }));
      expect(h.toastError).toHaveBeenCalledWith(k(key));
    });
  }

  it("błąd ukrycia też przechodzi przez mapper (każda akcja ma własny callback)", () => {
    h.respond = failingMutation<RespondVars, void>("respond_recommendation: invalid_action");
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.hide") }));
    expect(h.toastError).toHaveBeenCalledWith(k("network.recommendations.errors.invalidAction"));
  });

  it("błąd usunięcia po potwierdzeniu też przechodzi przez mapper", async () => {
    h.respond = failingMutation<RespondVars, void>(
      "respond_recommendation: not_your_recommendation",
    );
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.remove") }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError).toHaveBeenCalledWith(k("network.recommendations.errors.notYours"));
  });

  it("nieznany kod pokazujemy surowo - lepiej techniczny tekst niż zjedzony błąd", () => {
    h.respond = failingMutation<RespondVars, void>("42501: coś zupełnie nowego");
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.publish") }));
    expect(h.toastError).toHaveBeenCalledWith("42501: coś zupełnie nowego");
  });
});

describe("RecommendationsSection - pisanie rekomendacji", () => {
  beforeEach(() => {
    connectedToRecipient();
  });

  const VALID_BODY = "x".repeat(RECOMMENDATION_BODY_MIN);

  function fillForm(body: string): void {
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(
      screen.getByRole("option", { name: k("network.recommendations.relationshipOptions.mentor") }),
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: body } });
  }

  it("mutacja jest wiązana z profilem odbiorcy", () => {
    renderSection();
    expect(h.writeRecipients).toContain(NETWORK_IDS.peer);
  });

  it("dialog: tytuł z nazwą odbiorcy i zapowiedź akceptacji", () => {
    renderSection();
    openWriteDialog();
    expect(
      screen.getByText(k("network.recommendations.dialogTitle", { name: PEER_NAME })),
    ).toBeInTheDocument();
    expect(screen.getByText(k("network.recommendations.dialogDescription"))).toBeInTheDocument();
    expect(
      screen.getByText(k("network.recommendations.minChars", { count: RECOMMENDATION_BODY_MIN })),
    ).toBeInTheDocument();
  });

  it("relacja jest domkniętym słownikiem (siedem opcji z bazy)", () => {
    renderSection();
    openWriteDialog();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(
      ["colleague", "manager", "report", "client", "mentor", "partner", "other"].map((v) =>
        k(`network.recommendations.relationshipOptions.${v}`),
      ),
    );
  });

  it("bez relacji albo za krótkiej treści wysyłka jest zablokowana", () => {
    renderSection();
    openWriteDialog();
    const submit = screen.getByRole("button", { name: k("network.recommendations.submit") });
    expect(submit).toBeDisabled();

    // Treść w porządku, ale relacja niewybrana.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: VALID_BODY } });
    expect(submit).toBeDisabled();
  });

  it("za krótka treść przy wybranej relacji nadal blokuje wysyłkę", () => {
    renderSection();
    openWriteDialog();
    fillForm("x".repeat(RECOMMENDATION_BODY_MIN - 1));
    expect(
      screen.getByRole("button", { name: k("network.recommendations.submit") }),
    ).toBeDisabled();
  });

  it("treść ma limit z bazy i licznik znaków", () => {
    renderSection();
    openWriteDialog();
    const body = screen.getByRole("textbox");
    expect(body).toHaveAttribute("maxlength", String(RECOMMENDATION_BODY_MAX));
    fireEvent.change(body, { target: { value: VALID_BODY } });
    expect(
      screen.getByText(`${RECOMMENDATION_BODY_MIN}/${RECOMMENDATION_BODY_MAX}`),
    ).toBeInTheDocument();
  });

  it("wysyłka: RPC dostaje treść bez białych znaków i wybraną relację", () => {
    h.write = succeedingMutation<WriteVars, string>("rec-9");
    renderSection();
    openWriteDialog();
    fillForm(`  ${VALID_BODY}  `);
    fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.submit") }));

    expect(write().lastVars()).toEqual({ body: VALID_BODY, relationship: "mentor" });
    expect(h.toastSuccess).toHaveBeenCalledWith(k("network.recommendations.toastSent"));
    // Sukces zamyka dialog i czyści formularz.
    expect(
      screen.queryByText(k("network.recommendations.dialogDescription")),
    ).not.toBeInTheDocument();
  });

  it("błąd wysyłki: komunikat z mapy kodów, dialog zostaje otwarty", () => {
    h.write = failingMutation<WriteVars, string>("write_recommendation: invalid_body_length");
    renderSection();
    openWriteDialog();
    fillForm(VALID_BODY);
    fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.submit") }));

    expect(h.toastError).toHaveBeenCalledWith(k("network.recommendations.errors.bodyLength"));
    expect(screen.getByText(k("network.recommendations.dialogDescription"))).toBeInTheDocument();
  });

  it("wysyłka w locie: spinner i blokada obu przycisków", () => {
    h.write = pendingMutation<WriteVars, string>();
    renderSection();
    openWriteDialog();
    fillForm(VALID_BODY);
    expect(
      screen.getByRole("button", { name: k("network.recommendations.submit") }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: k("network.recommendations.cancel") }),
    ).toBeDisabled();
  });

  it("anulowanie zamyka dialog bez wysyłki", () => {
    renderSection();
    openWriteDialog();
    fireEvent.click(screen.getByRole("button", { name: k("network.recommendations.cancel") }));
    expect(
      screen.queryByText(k("network.recommendations.dialogDescription")),
    ).not.toBeInTheDocument();
    expect(write().mutate).not.toHaveBeenCalled();
  });
});
