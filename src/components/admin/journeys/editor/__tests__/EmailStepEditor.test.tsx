// Edytor treści maila kroku ścieżki (S8.3c) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Zapis treści wymaga węzła w ZAPISANYM szkicu: `ensureNodeSaved(nodeId)`
//      (flush sesji S8.3a) idzie PRZED `saveJourneyEmailContent`; gdy się nie
//      uda, treść nie jest wysyłana (inaczej RPC odrzuci `node_not_email`).
//   2. Pola jak walidator zapisu: temat PL 1-200, EN i preheadery ≤ 200
//      (puste = NULL), przycięte brzegi; wartość spoza limitu = błąd przy polu
//      i brak zapisu (nic nie jest ucinane).
//   3. Odrzucenie przez serwer (`ok:false`) = zdanie z kodem i powodem.
//   4. Podgląd PL/EN z S8.3a: próbki zamiast danych kontaktu, EN bez tematu EN =
//      wersja polska z adnotacją, ostrzeżenie o nieznanych zmiennych.
//   5. Warianty A/B za testem A/B: B startuje od kopii A (z adnotacją
//      o fallbacku) i zapisuje się jako wariant B.
//   6. Paleta bloków bez „najnowszych wpisów”; tylko do odczytu; zakaz maili
//      przy windykacji; treść z szablonu. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  saveEmail: vi.fn(),
  guard: vi.fn(),
}));

// Fabryka niczego nie importuje (import `@/lib/i18n` z wnętrza fabryki
// `react-i18next` zakleszcza moduły) - prawdziwe `t` wpinamy po importach.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  saveJourneyEmailContent: (input: unknown) => h.saveEmail(input),
}));
vi.mock("@/hooks/useUnsavedChangesGuard", () => ({
  useUnsavedChangesGuard: (when: boolean) => h.guard(when),
}));
vi.mock("@/lib/newsletter-campaigns.functions", () => ({
  searchCampaignPosts: {},
  resolveCampaignDocPosts: {},
}));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: () => null,
}));

import { EmailStepEditor, emailDraftErrors, type EmailStepEditorProps } from "../EmailStepEditor";
import * as blockRules from "@/components/admin/newsletter/campaignBlocks";
import type { JourneyEmailContentDto } from "@/lib/admin/journeys/journeyEditor.functions";
import { JourneyGraphSchema, type JourneyGraph } from "@/lib/journeys/graph";
import { journeyLabelKey } from "@/lib/journeys/labels";
import { JOURNEY_VARIABLE_SAMPLES } from "@/lib/journeys/variables";
import { DEFAULT_EMAIL_DOC_STYLE, parseEmailDoc, type EmailDoc } from "@/lib/newsletter/emailDoc";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-editor";
import "@/lib/i18n-admin-journeys-list";
import "@/lib/i18n-admin-journeys-steps";
import "@/lib/i18n-newsletter-admin";

h.fixedT = realT;
const t = realT("pl");
const T = "11111111-1111-4111-8111-111111111111";
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const AT = "2026-10-20T09:57:10.333703+00:00";

/** Mail prosty: wyzwalacz -> mail -> koniec. */
const LINEAR: JourneyGraph = JourneyGraphSchema.parse({
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "m1", type: "send_email", params: {} },
    { id: "x", type: "exit", params: {} },
  ],
  edges: [
    { from: "t", to: "m1", branch: "next" },
    { from: "m1", to: "x", branch: "next" },
  ],
});

/** Mail za testem A/B (ramię A), ramię B kończy ścieżkę. */
const SPLIT: JourneyGraph = JourneyGraphSchema.parse({
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "ab", type: "ab_split", params: { weights: { A: 50, B: 50 }, winnerMetric: "click" } },
    { id: "m1", type: "send_email", params: {} },
    { id: "x1", type: "exit", params: {} },
    { id: "x2", type: "exit", params: {} },
  ],
  edges: [
    { from: "t", to: "ab", branch: "next" },
    { from: "ab", to: "m1", branch: "A" },
    { from: "ab", to: "x2", branch: "B" },
    { from: "m1", to: "x1", branch: "next" },
  ],
});

const DOC: EmailDoc = {
  version: 1,
  blocks: [
    {
      id: "b1",
      type: "paragraph",
      html: { pl: "Dzień dobry {{first_name}}!", en: "Hello {{first_name}}!" },
      align: "left",
    },
  ],
  style: { ...DEFAULT_EMAIL_DOC_STYLE },
};

const CONTENT_A: JourneyEmailContentDto = {
  nodeId: "m1",
  variant: "A",
  subjectPl: "Witaj {{first_name}}",
  subjectEn: null,
  preheaderPl: null,
  preheaderEn: null,
  doc: DOC,
  updatedAt: AT,
  matchesTemplate: false,
};

beforeEach(() => {
  h.saveEmail.mockReset().mockResolvedValue({ ok: true, data: { id: "c1", updatedAt: AT } });
  h.guard.mockReset();
});
afterEach(cleanup);

function mount(overrides: Partial<EmailStepEditorProps> = {}) {
  const ensureNodeSaved = vi.fn(async () => true);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: EmailStepEditorProps = {
    journeyId: J,
    tenantId: T,
    nodeId: "m1",
    graph: LINEAR,
    triggerEventType: "checkout.abandoned.v1",
    contents: [CONTENT_A],
    editable: true,
    ensureNodeSaved,
    ...overrides,
  };
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <EmailStepEditor {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, ensureNodeSaved: props.ensureNodeSaved as typeof ensureNodeSaved };
}

const field = (key: string) => screen.getByLabelText(t(key)) as HTMLInputElement;
const saveNow = () =>
  screen.getByRole("button", { name: t("adminJourneys.emailStep.saveNow") }) as HTMLButtonElement;

describe("EmailStepEditor - zapis treści", () => {
  it("najpierw zapisany węzeł (flush szkicu), potem treść: przycięta, puste jako NULL", async () => {
    const { ensureNodeSaved } = mount();
    expect(saveNow().disabled).toBe(true);
    fireEvent.change(field("adminJourneys.emailStep.subjectPl"), {
      target: { value: "  Dokończ zamówienie  " },
    });
    fireEvent.change(field("adminJourneys.emailStep.preheaderPl"), { target: { value: "   " } });
    expect(h.guard).toHaveBeenLastCalledWith(true);
    fireEvent.click(saveNow());

    await waitFor(() => expect(h.saveEmail).toHaveBeenCalledTimes(1));
    expect(ensureNodeSaved).toHaveBeenCalledWith("m1");
    expect(ensureNodeSaved.mock.invocationCallOrder[0]).toBeLessThan(
      h.saveEmail.mock.invocationCallOrder[0] ?? 0,
    );
    expect(h.saveEmail).toHaveBeenCalledWith({
      data: {
        journeyId: J,
        nodeId: "m1",
        variant: "A",
        subjectPl: "Dokończ zamówienie",
        subjectEn: null,
        preheaderPl: null,
        preheaderEn: null,
        // Dokument po parserze edytora - ten sam kształt, który przyjmie RPC.
        doc: parseEmailDoc(DOC),
      },
    });
    expect(await screen.findByText(t("adminJourneys.emailStep.saved"))).toBeTruthy();
  });

  it("węzeł nie zapisał się w szkicu - treść nie idzie do serwera", async () => {
    mount({ ensureNodeSaved: vi.fn(async () => false) });
    fireEvent.change(field("adminJourneys.emailStep.subjectPl"), { target: { value: "Nowy" } });
    fireEvent.click(saveNow());
    expect(await screen.findByText(t("adminJourneys.emailStep.nodeNotSaved"))).toBeTruthy();
    expect(h.saveEmail).not.toHaveBeenCalled();
  });

  it("temat ponad 200 znaków: błąd i licznik, przycisk wyłączony, nic nie ucięte", () => {
    mount();
    const subject = field("adminJourneys.emailStep.subjectPl");
    fireEvent.change(subject, { target: { value: "x".repeat(201) } });
    expect(subject.value).toHaveLength(201);
    expect(subject.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText(t("adminJourneys.sheetField.error.tooLong", { max: 200 })),
    ).toBeTruthy();
    expect(
      screen.getByText(t("adminJourneys.common.counter", { count: 201, max: 200 })),
    ).toBeTruthy();
    expect(saveNow().disabled).toBe(true);
    expect(h.saveEmail).not.toHaveBeenCalled();
  });

  it("pusty temat PL jest wymagany (wysyłka wstrzymałaby krok)", () => {
    const errors = emailDraftErrors({
      subjectPl: "  ",
      subjectEn: "",
      preheaderPl: "",
      preheaderEn: "x".repeat(201),
      doc: DOC,
    });
    expect(errors.subjectPl?.key).toBe("adminJourneys.sheetField.error.required");
    expect(errors.preheaderEn?.key).toBe("adminJourneys.sheetField.error.tooLong");
    expect(errors.subjectEn).toBeUndefined();
  });

  it("odrzucenie przez serwer: zdanie z kodem i powodem", async () => {
    h.saveEmail.mockResolvedValue({
      ok: false,
      error: "invalid",
      reason: "node_not_email",
      detail: null,
    });
    mount();
    fireEvent.change(field("adminJourneys.emailStep.subjectPl"), { target: { value: "Nowy" } });
    fireEvent.click(saveNow());
    const expected = `${t(journeyLabelKey("mutationError", "invalid"))} ${t(
      "adminJourneys.common.reason.node_not_email",
    )}`;
    expect(await screen.findByText(expected)).toBeTruthy();
  });
});

describe("EmailStepEditor - podgląd", () => {
  it("próbki zamiast danych kontaktu; EN bez tematu EN pokazuje wersję polską", async () => {
    mount();
    const sample = JOURNEY_VARIABLE_SAMPLES.pl;
    expect(screen.getByTestId("journey-email-preview-subject").textContent).toBe(
      `Witaj ${sample.first_name}`,
    );
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.emailStep.lang.en") }));
    expect(await screen.findByText(t("adminJourneys.editor.preview.fallbackLocale"))).toBeTruthy();
    expect(screen.getByTestId("journey-email-preview-subject").textContent).toBe(
      `Witaj ${sample.first_name}`,
    );
  });

  it("nieznana zmienna = ostrzeżenie (w wysyłce będzie pusta)", async () => {
    mount({ contents: [{ ...CONTENT_A, subjectPl: "Witaj {{imie}}" }] });
    expect(
      await screen.findByText(
        t("adminJourneys.editor.preview.unknownVariables", { list: "{{imie}}" }),
      ),
    ).toBeTruthy();
  });
});

describe("EmailStepEditor - warianty i bloki", () => {
  it("za testem A/B: zakładki A i B, B startuje od kopii A i zapisuje się jako B", async () => {
    mount({ graph: SPLIT });
    const tabs = screen.getByRole("tablist", { name: t("adminJourneys.emailStep.variants") });
    const tabB = within(tabs).getByRole("tab", { name: t(journeyLabelKey("branch", "B")) });
    fireEvent.mouseDown(tabB);
    const variantB = await waitFor(() => {
      const panel = screen
        .getAllByTestId("journey-email-variant")
        .find((candidate) => candidate.getAttribute("data-variant") === "B");
      if (!panel || panel.closest("[hidden]")) throw new Error("wariant B niewidoczny");
      return panel;
    });
    expect(within(variantB).getByText(t("adminJourneys.emailStep.variantFallback"))).toBeTruthy();
    const subjectB = within(variantB).getByLabelText(
      t("adminJourneys.emailStep.subjectPl"),
    ) as HTMLInputElement;
    expect(subjectB.value).toBe(CONTENT_A.subjectPl);
    fireEvent.change(subjectB, { target: { value: "Wariant B" } });
    fireEvent.click(
      within(variantB).getByRole("button", { name: t("adminJourneys.emailStep.saveNow") }),
    );
    await waitFor(() => expect(h.saveEmail).toHaveBeenCalledTimes(1));
    expect(h.saveEmail.mock.calls[0]?.[0]).toMatchObject({
      data: { nodeId: "m1", variant: "B", subjectPl: "Wariant B" },
    });
  });

  it("bez testu A/B jeden wariant (bez zakładek)", () => {
    mount();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getAllByTestId("journey-email-variant")).toHaveLength(1);
  });

  it("paleta bloków bez „najnowszych wpisów”; dodany blok trafia na listę", () => {
    mount();
    const palette = screen.getByRole("group", { name: t("adminJourneys.emailStep.addBlock") });
    const postList = blockRules.blockLabelKey("post-list");
    expect(postList).not.toBeNull();
    expect(within(palette).queryByText(new RegExp(t(postList ?? "")))).toBeNull();

    const heading = t(blockRules.blockLabelKey("heading") ?? "");
    fireEvent.click(
      within(palette).getByRole("button", {
        name: t("adminJourneys.emailStep.addBlockType", { type: heading }),
      }),
    );
    const list = screen.getByRole("list", { name: t("adminJourneys.emailStep.blocks") });
    expect(
      within(list).getByRole("button", {
        name: t("adminJourneys.emailStep.blockItem", { position: 2, label: heading }),
      }),
    ).toBeTruthy();
  });
});

describe("EmailStepEditor - stany", () => {
  it("tylko do odczytu: pola wyłączone, brak zapisu", () => {
    mount({ editable: false });
    expect(field("adminJourneys.emailStep.subjectPl").disabled).toBe(true);
    expect(saveNow().disabled).toBe(true);
  });

  it("windykacja: ścieżka nie wysyła maili - alert przy treści", () => {
    mount({ triggerEventType: "billing_subscription.payment_failed.v1" });
    expect(screen.getByRole("alert").textContent).toContain(
      t("adminJourneys.common.palette.emailForbidden"),
    );
  });

  it("treść identyczna z szablonem - adnotacja (blokada publikacji)", () => {
    mount({ templateMatches: { m1: true } });
    expect(screen.getByText(t("adminJourneys.common.issue.content_from_template"))).toBeTruthy();
  });

  it("axe bez naruszeń (warianty A/B)", async () => {
    const { container } = mount({ graph: SPLIT });
    // Ramka podglądu ma nazwę (`title` - sprawdzana niżej) i własny dokument
    // (`srcDoc`, sandbox), do którego axe-core nie wstrzyknie się pod happy-dom
    // („Respondable target must be a frame…”) - audyt dotyczy NASZEGO dokumentu.
    for (const frame of [...container.querySelectorAll("iframe")]) {
      expect(frame.getAttribute("title")).toBe(t("adminNewsletter.blocks.previewFrameTitle"));
      expect(frame.getAttribute("sandbox")).toBe("");
      frame.remove();
    }
    // Nieaktywny wariant ma `hidden` (poza drzewem dostępności w przeglądarce),
    // ale happy-dom nie stosuje arkusza UA dla `[hidden]` - wyjmujemy go jak ramkę.
    for (const panel of [...container.querySelectorAll('[role="tabpanel"][hidden]')]) {
      panel.remove();
    }
    // Panel właściwości bloku to komponent kreatora kampanii
    // (`CampaignBlockProperties`): jego listy wyboru nie mają nazwy dostępnej
    // (etykieta bez `htmlFor`) - zgłoszone integratorowi, poza tym plikiem.
    const blockPanel = (target: unknown) =>
      document.querySelector(String(target))?.closest('[data-testid="journey-email-block"]');
    const all = await axeViolations(container);
    const violations = all
      .map((violation) => ({
        ...violation,
        nodes: violation.nodes.filter((node) => !blockPanel(node.target[0])),
      }))
      .filter((violation) => violation.nodes.length > 0);
    // Wyjątek obejmuje WYŁĄCZNIE brak nazwy list wyboru w panelu kreatora.
    const excluded = all.filter((violation) =>
      violation.nodes.some((node) => blockPanel(node.target[0])),
    );
    expect(excluded.map((violation) => violation.id)).toEqual(
      excluded.length > 0 ? ["button-name"] : [],
    );
    expect(violations, summarize(violations)).toEqual([]);
  });
});
