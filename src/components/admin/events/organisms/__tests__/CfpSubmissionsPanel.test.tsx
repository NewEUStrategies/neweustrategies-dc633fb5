// Ekran „Zgłoszenia" naboru: liczniki jako skróty filtra, filtry i strony,
// szuflada decyzji (prelegenci z CRM, oceny, decyzja, przyjęcie z planem,
// mail o decyzji) i zakładka materiałów.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// DOWODZIMY ładunków RPC po nazwie (filtr „wszystkie" nie wychodzi, strona
// -> offset, decyzja i przyjęcie w kształcie SQL-a), tego, że mail wychodzi
// tylko na żądanie i tylko dla stanów, o których się pisze, oraz że ponowienie
// CRM dotyczy osoby, a nie zgłoszenia.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: brak atrapy RPC");
      return h.rpc.rpc(name, args);
    },
  },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError, info: h.toastInfo },
}));
vi.mock("@/lib/i18n-admin-event-cfp", () => ({ ensureAdminEventCfpI18n: () => undefined }));
vi.mock("@/lib/i18n-event-cfp", () => ({ ensureEventCfpI18n: () => undefined }));
vi.mock("@/lib/events/adminCfpErrors", () => ({
  adminCfpErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("@/lib/events/cfpNotify.functions", () => ({ notifyCfpDecision: h.notify }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/events/cfpStubs")).routerLinkWithSearchStub(await import("react")),
}));
vi.mock("@/components/atoms/FormSelect", async () =>
  (await import("@/test/events/cfpStubs")).formSelectStubModule(await import("react")),
);
vi.mock("@/components/ui/datetime-picker", async () =>
  (await import("@/test/events/cfpStubs")).dateTimePickerStubModule(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/components/ui/tabs", async () =>
  (await import("@/test/reactStubs")).radixTabsStub(await import("react")),
);

const { CfpSubmissionsPanel } =
  await import("@/components/admin/events/organisms/CfpSubmissionsPanel");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

function payload(name: string): Record<string, unknown> {
  const value = stub().lastCall(name)?.arg("p_payload");
  if (typeof value !== "object" || value === null) throw new Error(`test: brak ${name}`);
  return value as Record<string, unknown>;
}

const SETTINGS = {
  event_id: "e1",
  event_timezone: "Europe/Warsaw",
  status: "open",
  phase: "open",
  formats: [{ key: "talk", label_pl: "Wykład", label_en: "Talk", duration_min: 30 }],
  min_reviews: 2,
  score_max: 5,
  options: {
    tracks: [{ id: "t1", key: "energy", name_pl: "Energia", name_en: "Energy" }],
    rooms: [
      { id: "r1", name: "Sala A" },
      { id: "r2", name: "Zamknięta", is_active: false },
    ],
    groups: [],
    tickets: [],
  },
};

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    status: "under_review",
    title_pl: "Energia jutra",
    title_en: "",
    talk_language: "pl",
    format_key: "talk",
    duration_min: 30,
    track_id: "t1",
    track_name_pl: "Energia",
    track_name_en: "Energy",
    speaker_name: "Anna Nowak",
    speaker_email: "anna@example.org",
    speakers_count: 3,
    reviews_count: 1,
    overall_avg: 4.5,
    weighted_avg: null,
    recommendations: {},
    submitted_at: "2026-09-03T10:00:00+00:00",
    decided_at: null,
    notified_status: null,
    session_id: null,
    updated_at: "2026-09-03T10:00:00+00:00",
    total_count: 30,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}, submission: Record<string, unknown> = {}) {
  return {
    submission: {
      id: "s1",
      event_id: "e1",
      status: "under_review",
      title_pl: "Energia jutra",
      title_en: "Energy of tomorrow",
      abstract_pl: "Streszczenie PL",
      abstract_en: "Abstract EN",
      talk_language: "en",
      format_key: "talk",
      track_id: "t1",
      topics: ["sieci", "OZE"],
      answers: { exp: "a", site: "https://example.org", ok: true },
      submitted_at: "2026-09-03T10:00:00+00:00",
      decision_note: "",
      feedback_to_speaker: "",
      decided_at: null,
      notified_status: null,
      notified_at: null,
      notify_error: null,
      session_id: null,
      ...submission,
    },
    event: { slug: "kongres", timezone: "Europe/Warsaw" },
    person: {
      id: "p1",
      email: "anna@example.org",
      consent_marketing_at: "2026-09-01",
      consent_withdrawn_at: null,
    },
    speakers: [
      {
        id: "sp1",
        person_id: "p1",
        is_primary: true,
        role: "speaker",
        first_name: "Anna",
        last_name: "Nowak",
        email: "anna@example.org",
        job_title: "CEO",
        company_text: "NES",
        crm: { sync_status: "error", synced_at: "2026-09-03T10:00:00+00:00" },
      },
      {
        id: "sp2",
        person_id: null,
        is_primary: false,
        role: "panelist",
        first_name: "Jan",
        last_name: "K",
        crm: null,
      },
      {
        id: "sp3",
        person_id: "p3",
        is_primary: false,
        role: "moderator",
        first_name: "Ola",
        last_name: "M",
        crm: null,
      },
      {
        id: "sp4",
        person_id: "p4",
        is_primary: false,
        role: "host",
        first_name: "Ewa",
        last_name: "Z",
        crm: { sync_status: "ok", synced_at: null },
      },
    ],
    fields: [
      {
        key: "exp",
        field_type: "select",
        label_pl: "Doświadczenie",
        label_en: "Experience",
        options: [{ value: "a", label_pl: "Duże", label_en: "Big" }],
      },
      { key: "site", field_type: "url", label_pl: "Strona", label_en: "Site" },
      { key: "ok", field_type: "checkbox", label_pl: "Zgoda", label_en: "Consent" },
    ],
    reviews: [
      {
        id: "r1",
        reviewer_name: "Recenzent 1",
        scores: { rel: 4 },
        overall: 4,
        recommendation: "accept",
        comment_private: "Mocne",
        comment_to_speaker: "Skrócić",
        conflict_of_interest: false,
        updated_at: "2026-09-04T10:00:00+00:00",
      },
      { id: "r2", reviewer_name: "Recenzent 2", conflict_of_interest: true },
      { id: "r3", reviewer_name: "Recenzent 3", overall: null, recommendation: null, scores: {} },
    ],
    summary: {
      reviews_count: 1,
      conflicts_count: 1,
      overall_avg: 4,
      weighted_avg: 4.2,
      recommendations: { accept: 1 },
    },
    settings: {
      score_max: 5,
      review_criteria: [
        { key: "rel", label_pl: "Trafność", label_en: "Relevance", weight: 2 },
        { key: "x", label_pl: "X", label_en: "X", weight: 1 },
      ],
      formats: [{ key: "talk", label_pl: "Wykład", label_en: "Talk", duration_min: 30 }],
      min_reviews: 2,
    },
    track: { id: "t1", name_pl: "Energia", name_en: "Energy" },
    session: null,
    ...overrides,
  };
}

async function renderPanel(options: { rows?: unknown[]; counts?: Record<string, unknown> } = {}) {
  stub().setData("admin_event_cfp_settings_get", SETTINGS);
  stub().setData("admin_event_cfp_submissions_counts", {
    total: 5,
    draft: 2,
    submitted: 1,
    under_review: 4,
    needs_reviews: 3,
    min_reviews: 2,
    ...options.counts,
  });
  stub().setData("admin_event_cfp_submissions_list", options.rows ?? [listRow()]);
  stub().setData("admin_event_cfp_submission_detail", detail());
  stub().setData("admin_event_cfp_materials_list", []);
  renderWithQueryClient(<CfpSubmissionsPanel eventId="e1" />);
  await screen.findByText("adminEventCfp.submissions.lead");
}

async function openSheet() {
  await screen.findByText("Anna Nowak");
  fireEvent.click(screen.getByRole("button", { name: "adminEventCfp.submissions.open" }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  for (const fn of [h.toastSuccess, h.toastError, h.toastInfo, h.notify]) fn.mockReset();
});
afterEach(cleanup);

describe("CfpSubmissionsPanel - lista", () => {
  it("ustawienia w locie i odmowa odczytu", async () => {
    stub().setResponse("admin_event_cfp_settings_get", () => new Promise(() => undefined) as never);
    renderWithQueryClient(<CfpSubmissionsPanel eventId="e1" />);
    expect(screen.getByText("adminEventCfp.common.loading")).toBeInTheDocument();
    cleanup();
    stub().setError("admin_event_cfp_settings_get", "forbidden: x");
    renderWithQueryClient(<CfpSubmissionsPanel eventId="e1" />);
    expect(await screen.findByText("odmowa:forbidden: x")).toBeInTheDocument();
  });

  it("wiersz: tytuł, prelegent z liczbą współprelegentów, ścieżka i forma, oceny względem minimum", async () => {
    await renderPanel();
    const row = (await screen.findByText("Anna Nowak")).closest("tr");
    if (row === null) throw new Error("test");
    expect(within(row).getByText("Energia jutra")).toBeInTheDocument();
    expect(
      within(row).getByText(/adminEventCfp\.submissions\.coSpeakers\(count=2\)/),
    ).toBeInTheDocument();
    expect(within(row).getByText("Energia")).toBeInTheDocument();
    expect(within(row).getByText("Wykład")).toBeInTheDocument();
    expect(within(row).getByText("adminEventCfp.submissions.belowMin")).toBeInTheDocument();
    expect(within(row).getByText("4,5")).toBeInTheDocument();
    expect(within(row).getByText("eventCfp.statuses.under_review")).toBeInTheDocument();
    expect(
      screen.getByText("adminEventCfp.submissions.counts.needsReviews(count=3,min=2)"),
    ).toBeInTheDocument();
  });

  it("wiersz bez ścieżki, formy i ocen; decyzja podjęta = bez znacznika minimum", async () => {
    await renderPanel({
      rows: [
        listRow({
          track_id: null,
          format_key: null,
          speakers_count: 1,
          overall_avg: null,
          weighted_avg: null,
          status: "accepted",
          reviews_count: 0,
        }),
      ],
    });
    const row = (await screen.findByText("Anna Nowak")).closest("tr");
    if (row === null) throw new Error("test");
    expect(within(row).getByText("adminEventCfp.submissions.noTrack")).toBeInTheDocument();
    expect(within(row).queryByText("adminEventCfp.submissions.belowMin")).not.toBeInTheDocument();
    expect(within(row).getByText("-")).toBeInTheDocument();
  });

  it("kafle stanów, filtry, wyszukiwanie i strony trafiają do ładunku listy", async () => {
    await renderPanel();
    await screen.findByText("Anna Nowak");
    expect(payload("admin_event_cfp_submissions_list")).toEqual({
      event_id: "e1",
      sort: "recent",
      limit: 25,
      offset: 0,
    });

    fireEvent.click(screen.getByRole("button", { name: /eventCfp\.statuses\.under_review/ }));
    await waitFor(() =>
      expect(payload("admin_event_cfp_submissions_list")).toMatchObject({ status: "under_review" }),
    );
    // Powrót do „wszystkich" czyta ten sam wpis cache, co pierwsze wczytanie.
    const total = screen.getByRole("button", { name: /adminEventCfp\.submissions\.counts\.total/ });
    fireEvent.click(total);
    await waitFor(() => expect(total).toHaveAttribute("aria-pressed", "true"));

    fireEvent.change(screen.getByLabelText("adminEventCfp.submissions.filters.status"), {
      target: { value: "waitlisted" },
    });
    await waitFor(() =>
      expect(payload("admin_event_cfp_submissions_list")).toMatchObject({ status: "waitlisted" }),
    );
    fireEvent.change(screen.getByLabelText("adminEventCfp.submissions.filters.status"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText("adminEventCfp.submissions.filters.track"), {
      target: { value: "t1" },
    });
    await waitFor(() =>
      expect(payload("admin_event_cfp_submissions_list")).toMatchObject({ track_id: "t1" }),
    );
    fireEvent.change(screen.getByLabelText("adminEventCfp.submissions.filters.sort"), {
      target: { value: "score" },
    });
    await waitFor(() =>
      expect(payload("admin_event_cfp_submissions_list")).toMatchObject({ sort: "score" }),
    );
    fireEvent.change(
      screen.getByLabelText("adminEventCfp.submissions.filters.search", { selector: "input" }),
      {
        target: { value: " nowak " },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "adminEventCfp.submissions.filters.search" }),
    );
    await waitFor(() =>
      expect(payload("admin_event_cfp_submissions_list")).toMatchObject({ q: "nowak" }),
    );

    expect(
      screen.getByText("adminEventCfp.submissions.pagination.range(from=1,to=25,total=30)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "adminEventCfp.submissions.pagination.previous" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "adminEventCfp.submissions.pagination.next" }),
    );
    await waitFor(() =>
      expect(payload("admin_event_cfp_submissions_list")).toMatchObject({ offset: 25 }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "adminEventCfp.submissions.pagination.next" }),
      ).toBeDisabled(),
    );
    expect(
      screen.getByText("adminEventCfp.submissions.pagination.range(from=26,to=30,total=30)"),
    ).toBeInTheDocument();
    // Pierwsza strona z tymi filtrami jest już w cache.
    fireEvent.click(
      screen.getByRole("button", { name: "adminEventCfp.submissions.pagination.previous" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("adminEventCfp.submissions.pagination.range(from=1,to=25,total=30)"),
      ).toBeInTheDocument(),
    );
  });

  it("pusta lista mówi, czy to brak zgłoszeń, czy efekt filtrów; odmowa listy ma własne zdanie", async () => {
    await renderPanel({
      rows: [],
      counts: { total: 0, submitted: 0, under_review: 0, needs_reviews: 0 },
    });
    expect(await screen.findByText("adminEventCfp.submissions.empty")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("adminEventCfp.submissions.filters.track"), {
      target: { value: "t1" },
    });
    expect(await screen.findByText("adminEventCfp.submissions.emptyFiltered")).toBeInTheDocument();
    stub().setError("admin_event_cfp_submissions_list", "forbidden: y");
    fireEvent.change(screen.getByLabelText("adminEventCfp.submissions.filters.sort"), {
      target: { value: "title" },
    });
    expect(await screen.findByText("odmowa:forbidden: y")).toBeInTheDocument();
  });

  it("zakładka materiałów", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "adminEventCfp.submissions.tabs.materials" }));
    expect(await screen.findByText("adminEventCfp.materials.empty")).toBeInTheDocument();
  });
});

describe("CfpSubmissionSheet - szczegół i decyzja", () => {
  it("pokazuje prelegentów z CRM, wystąpienie, odpowiedzi i oceny", async () => {
    await renderPanel();
    const sheet = await openSheet();
    await within(sheet).findByRole("heading", { name: "Energia jutra" });
    // Prelegenci: zgłaszający ze zgodą i błędem CRM, współprelegent bez karty,
    // współprelegent bez wpisu CRM i współprelegent zsynchronizowany.
    expect(within(sheet).getByText("adminEventCfp.detail.consentYes")).toBeInTheDocument();
    expect(within(sheet).getByText("adminEventCfp.crm.status.error")).toBeInTheDocument();
    expect(within(sheet).getByText("adminEventCfp.detail.pendingPerson")).toBeInTheDocument();
    expect(within(sheet).getByText("adminEventCfp.crm.none")).toBeInTheDocument();
    expect(within(sheet).getByText("adminEventCfp.crm.status.ok")).toBeInTheDocument();
    expect(within(sheet).getByText("CEO, NES")).toBeInTheDocument();
    expect(within(sheet).getAllByRole("button", { name: "adminEventCfp.crm.retry" })).toHaveLength(
      2,
    );
    // Wystąpienie i odpowiedzi.
    expect(within(sheet).getByText("Streszczenie PL")).toBeInTheDocument();
    expect(within(sheet).getByText("Abstract EN")).toBeInTheDocument();
    expect(within(sheet).getByText("sieci")).toBeInTheDocument();
    expect(within(sheet).getByText("Duże")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "https://example.org" })).toHaveAttribute(
      "rel",
      "noopener noreferrer nofollow",
    );
    expect(within(sheet).getByText("eventCfp.answers.yes")).toBeInTheDocument();
    expect(within(sheet).getByText("eventCfp.languages.en")).toBeInTheDocument();
    // Oceny: agregaty, konflikt, brak oceny ogólnej, uwagi prywatne.
    expect(
      within(sheet).getByText("adminEventCfp.detail.reviewsSummary(count=1,min=2)"),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText("adminEventCfp.detail.overallAvg(value=4,0)"),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText("adminEventCfp.detail.weightedAvg(value=4,2)"),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("adminEventCfp.detail.belowMin")).toBeInTheDocument();
    expect(within(sheet).getByText("adminEventCfp.detail.conflict")).toBeInTheDocument();
    expect(within(sheet).getByText(/adminEventCfp\.detail\.noOverall/)).toBeInTheDocument();
    expect(within(sheet).getByText("Mocne")).toBeInTheDocument();
    expect(within(sheet).getByText("Skrócić")).toBeInTheDocument();
    expect(within(sheet).getByText("Trafność: 4")).toBeInTheDocument();
    // Mail: decyzji jeszcze nie ma, więc nie ma czego wysłać.
    expect(within(sheet).getByText("adminEventCfp.notify.notApplicable")).toBeInTheDocument();
    expect(
      within(sheet).queryByRole("button", { name: "adminEventCfp.notify.send" }),
    ).not.toBeInTheDocument();
  });

  it("ponowienie CRM dotyczy osoby", async () => {
    await renderPanel();
    const sheet = await openSheet();
    await within(sheet).findByRole("heading", { name: "Energia jutra" });
    stub().setData("admin_event_person_crm_retry", {});
    fireEvent.click(
      within(sheet).getAllByRole("button", { name: "adminEventCfp.crm.retry" })[0] as HTMLElement,
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.crmRetried"),
    );
    expect(stub().lastCall("admin_event_person_crm_retry")?.arg("p_person_id")).toBe("p1");
    stub().setError("admin_event_person_crm_retry", "forbidden: z");
    fireEvent.click(
      within(sheet).getAllByRole("button", { name: "adminEventCfp.crm.retry" })[1] as HTMLElement,
    );
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:forbidden: z"));
  });

  it("odrzucenie bez notatki nie wychodzi; decyzja z notatką idzie w kształcie SQL-a", async () => {
    await renderPanel();
    const sheet = await openSheet();
    await within(sheet).findByRole("heading", { name: "Energia jutra" });
    fireEvent.change(within(sheet).getByLabelText("adminEventCfp.detail.decisionStatus"), {
      target: { value: "rejected" },
    });
    fireEvent.click(
      within(sheet).getByRole("button", { name: "adminEventCfp.detail.applyDecision" }),
    );
    expect(
      within(sheet).getByText("adminEventCfp.detail.validation.noteRequired"),
    ).toBeInTheDocument();
    expect(stub().callsFor("admin_event_cfp_submission_decide")).toHaveLength(0);

    fireEvent.change(within(sheet).getByLabelText("adminEventCfp.detail.decisionNote"), {
      target: { value: " Poza tematem " },
    });
    fireEvent.change(within(sheet).getByLabelText("adminEventCfp.detail.feedback"), {
      target: { value: "Dziękujemy" },
    });
    stub().setData("admin_event_cfp_submission_decide", {});
    fireEvent.click(
      within(sheet).getByRole("button", { name: "adminEventCfp.detail.applyDecision" }),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.decisionSaved"),
    );
    expect(payload("admin_event_cfp_submission_decide")).toEqual({
      id: "s1",
      status: "rejected",
      decision_note: "Poza tematem",
      feedback_to_speaker: "Dziękujemy",
    });

    fireEvent.change(within(sheet).getByLabelText("adminEventCfp.detail.feedback"), {
      target: { value: "x".repeat(4001) },
    });
    fireEvent.click(
      within(sheet).getByRole("button", { name: "adminEventCfp.detail.applyDecision" }),
    );
    expect(within(sheet).getByText("adminEventCfp.detail.validation.tooLong")).toBeInTheDocument();

    fireEvent.change(within(sheet).getByLabelText("adminEventCfp.detail.feedback"), {
      target: { value: "ok" },
    });
    stub().setError("admin_event_cfp_submission_decide", "invalid_transition: x");
    fireEvent.click(
      within(sheet).getByRole("button", { name: "adminEventCfp.detail.applyDecision" }),
    );
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:invalid_transition: x"));
  });

  it("przyjęcie z planem sesji: walidacja okna i ładunek; sala nieaktywna nie jest do wyboru", async () => {
    await renderPanel();
    const sheet = await openSheet();
    await within(sheet).findByRole("heading", { name: "Energia jutra" });
    fireEvent.click(within(sheet).getByRole("button", { name: "adminEventCfp.detail.accept" }));
    const dialog = await screen.findByRole("dialog", { name: "adminEventCfp.accept.title" });
    fireEvent.click(within(dialog).getByLabelText("adminEventCfp.accept.register"));
    fireEvent.click(within(dialog).getByLabelText("adminEventCfp.accept.schedule"));
    const roomOptions = within(
      within(dialog).getByLabelText("adminEventCfp.accept.room"),
    ).getAllByRole("option");
    expect(roomOptions.map((option) => option.textContent)).toEqual([
      "adminEventCfp.accept.noRoom",
      "Sala A",
    ]);
    // Ścieżka zgłoszenia jest podpowiedzią dla sesji.
    expect(within(dialog).getByLabelText("adminEventCfp.accept.track")).toHaveValue("t1");

    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.accept.confirm" }));
    expect(
      within(dialog).getByText("adminEventCfp.accept.validation.schedule"),
    ).toBeInTheDocument();
    expect(stub().callsFor("admin_event_cfp_submission_accept")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.accept.startsAt"), {
      target: { value: "2026-10-01T09:00:00.000Z" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.accept.endsAt"), {
      target: { value: "2026-10-01T09:30:00.000Z" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.accept.room"), {
      target: { value: "r1" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.accept.track"), {
      target: { value: "__none__" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.accept.format"), {
      target: { value: "hybrid" },
    });
    stub().setData("admin_event_cfp_submission_accept", { id: "s1", speakers_enrolled: 3 });
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.accept.confirm" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.accepted(count=3)"),
    );
    expect(payload("admin_event_cfp_submission_accept")).toEqual({
      id: "s1",
      decision_note: "",
      feedback_to_speaker: "",
      register: false,
      schedule: {
        starts_at: "2026-10-01T09:00:00.000Z",
        ends_at: "2026-10-01T09:30:00.000Z",
        room_id: "r1",
        track_id: null,
        format: "hybrid",
      },
    });
  });

  it("przyjęcie: zbyt długa notatka z formularza decyzji, odmowa bazy i anulowanie", async () => {
    await renderPanel();
    const sheet = await openSheet();
    await within(sheet).findByRole("heading", { name: "Energia jutra" });
    fireEvent.change(within(sheet).getByLabelText("adminEventCfp.detail.decisionNote"), {
      target: { value: "x".repeat(2001) },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "adminEventCfp.detail.accept" }));
    let dialog = await screen.findByRole("dialog", { name: "adminEventCfp.accept.title" });
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.accept.confirm" }));
    expect(within(dialog).getByText("adminEventCfp.detail.validation.tooLong")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.common.cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "adminEventCfp.accept.title" }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.change(within(sheet).getByLabelText("adminEventCfp.detail.decisionNote"), {
      target: { value: "ok" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "adminEventCfp.detail.accept" }));
    dialog = await screen.findByRole("dialog", { name: "adminEventCfp.accept.title" });
    stub().setError("admin_event_cfp_submission_accept", "room_conflict: x");
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.accept.confirm" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:room_conflict: x"));
    expect(payload("admin_event_cfp_submission_accept")).toEqual({
      id: "s1",
      decision_note: "ok",
      feedback_to_speaker: "",
      register: true,
    });
  });

  it("przyjęte zgłoszenie: bez decyzji, z sesją i z mailem do wysłania", async () => {
    stub().setData("admin_event_cfp_submission_detail", null);
    await renderPanel();
    stub().setData(
      "admin_event_cfp_submission_detail",
      detail(
        {
          session: {
            id: "ses1",
            title_pl: "Sesja PL",
            title_en: "Session",
            starts_at: "2026-10-01T09:00:00+00:00",
            status: "draft",
          },
          summary: { reviews_count: 3, overall_avg: null, weighted_avg: null },
          reviews: [],
          fields: [],
          track: null,
          person: { id: "p1", consent_marketing_at: null },
        },
        {
          status: "accepted",
          decided_at: "2026-09-10T10:00:00+00:00",
          notified_status: "rejected",
          notified_at: "2026-09-05T10:00:00+00:00",
          format_key: null,
          abstract_pl: "",
          abstract_en: "",
          topics: [],
        },
      ),
    );
    const sheet = await openSheet();
    await within(sheet).findByText("Sesja PL · 1 października 2026 11:00");
    expect(within(sheet).getByText("adminEventCfp.detail.notDecidable")).toBeInTheDocument();
    expect(
      within(sheet).getByRole("link", { name: "adminEventCfp.detail.openAgenda" }),
    ).toHaveAttribute("href", "/admin/events/e1/content/sessions");
    expect(within(sheet).getByText("adminEventCfp.detail.noReviews")).toBeInTheDocument();
    expect(within(sheet).getByText("adminEventCfp.detail.noAnswers")).toBeInTheDocument();
    expect(within(sheet).getByText("adminEventCfp.detail.noTrack")).toBeInTheDocument();
    expect(within(sheet).getByText("adminEventCfp.detail.noFormat")).toBeInTheDocument();
    expect(within(sheet).getByText("adminEventCfp.detail.consentNo")).toBeInTheDocument();
    expect(within(sheet).getByText("adminEventCfp.notify.pending")).toBeInTheDocument();
    expect(
      within(sheet).getByText(
        /adminEventCfp\.notify\.sentAt\(date=.*,status=eventCfp\.statuses\.rejected\)/,
      ),
    ).toBeInTheDocument();

    h.notify.mockResolvedValueOnce({ ok: true });
    fireEvent.click(within(sheet).getByRole("button", { name: "adminEventCfp.notify.send" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventCfp.toasts.notified"),
    );
    expect(h.notify).toHaveBeenCalledWith({ data: { submissionId: "s1" } });

    h.notify.mockResolvedValueOnce({ ok: true, skipped: "not_applicable" });
    fireEvent.click(within(sheet).getByRole("button", { name: "adminEventCfp.notify.send" }));
    await waitFor(() =>
      expect(h.toastInfo).toHaveBeenCalledWith("adminEventCfp.toasts.notifySkipped"),
    );

    h.notify.mockResolvedValueOnce({ ok: false, error: "smtp" });
    fireEvent.click(within(sheet).getByRole("button", { name: "adminEventCfp.notify.send" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminEventCfp.notify.failed"));

    h.notify.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(within(sheet).getByRole("button", { name: "adminEventCfp.notify.send" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(2));
  });

  it("mail o aktualnej decyzji już wyszedł - bez przycisku; zamknięcie szuflady", async () => {
    await renderPanel();
    stub().setData(
      "admin_event_cfp_submission_detail",
      detail(
        {},
        {
          status: "rejected",
          decided_at: "2026-09-10T10:00:00+00:00",
          notified_status: "rejected",
          notified_at: "2026-09-11T10:00:00+00:00",
          notify_error: null,
        },
      ),
    );
    const sheet = await openSheet();
    await within(sheet).findByText("adminEventCfp.notify.upToDate");
    expect(
      within(sheet).queryByRole("button", { name: "adminEventCfp.notify.send" }),
    ).not.toBeInTheDocument();
    // Odrzucone można jeszcze zmienić (np. na listę rezerwową).
    expect(within(sheet).getByLabelText("adminEventCfp.detail.decisionStatus")).toHaveValue(
      "rejected",
    );
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("szczegół bez tytułów, daty wysłania, kryteriów i godziny sesji", async () => {
    await renderPanel({ rows: [listRow({ track_name_pl: null, track_name_en: null })] });
    const row = (await screen.findByText("Anna Nowak")).closest("tr");
    if (row === null) throw new Error("test");
    // Ścieżka bez nazw w obu językach nie wywraca wiersza.
    expect(within(row).queryByText("adminEventCfp.submissions.noTrack")).not.toBeInTheDocument();
    const base = detail();
    stub().setData(
      "admin_event_cfp_submission_detail",
      detail(
        {
          settings: { ...base.settings, review_criteria: [] },
          session: {
            id: "ses1",
            title_pl: "Sesja bez godziny",
            title_en: "",
            starts_at: null,
            status: "draft",
          },
        },
        { title_pl: "", title_en: "", submitted_at: null },
      ),
    );
    const sheet = await openSheet();
    await within(sheet).findByText("Sesja bez godziny");
    expect(within(sheet).getAllByText("-")).toHaveLength(2);
    expect(within(sheet).queryByText(/adminEventCfp\.detail\.submittedAt/)).not.toBeInTheDocument();
    expect(within(sheet).queryByText("Trafność: 4")).not.toBeInTheDocument();
  });

  it("przyjęcie w toku blokuje przycisk i mówi „zapisuję”; wybór i zdjęcie sali, wybór ścieżki", async () => {
    await renderPanel();
    const sheet = await openSheet();
    await within(sheet).findByRole("heading", { name: "Energia jutra" });
    fireEvent.click(within(sheet).getByRole("button", { name: "adminEventCfp.detail.accept" }));
    const dialog = await screen.findByRole("dialog", { name: "adminEventCfp.accept.title" });
    fireEvent.click(within(dialog).getByLabelText("adminEventCfp.accept.schedule"));
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.accept.room"), {
      target: { value: "r1" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.accept.room"), {
      target: { value: "__none__" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.accept.track"), {
      target: { value: "__none__" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.accept.track"), {
      target: { value: "t1" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.accept.startsAt"), {
      target: { value: "2026-10-01T09:00:00.000Z" },
    });
    fireEvent.change(within(dialog).getByLabelText("adminEventCfp.accept.endsAt"), {
      target: { value: "2026-10-01T10:00:00.000Z" },
    });
    stub().setResponse(
      "admin_event_cfp_submission_accept",
      () => new Promise(() => undefined) as never,
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "adminEventCfp.accept.confirm" }));
    const saving = await within(dialog).findByRole("button", {
      name: "adminEventCfp.common.saving",
    });
    expect(saving).toBeDisabled();
    expect(payload("admin_event_cfp_submission_accept")).toMatchObject({
      schedule: { room_id: null, track_id: "t1", format: "onsite" },
    });
  });

  it("odmowa odczytu szczegółu", async () => {
    await renderPanel();
    stub().setError("admin_event_cfp_submission_detail", "not_found: x");
    const sheet = await openSheet();
    expect(await within(sheet).findByText("odmowa:not_found: x")).toBeInTheDocument();
  });
});
