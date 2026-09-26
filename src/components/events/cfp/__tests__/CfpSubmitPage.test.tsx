// Formularz zgłoszenia wystąpienia.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// DOWODZIMY: (1) bez konta nie ma formularza, tylko zaproszenie do logowania,
// (2) `?id=` otwiera wyłącznie własne i edytowalne zgłoszenie, (3) nowy szkic
// i szkic wymagają otwartego naboru, prośba o zmiany - nie, (4) „Wyślij"
// najpierw zapisuje, potem wysyła, a potwierdzenie mailem jest „przy okazji",
// (5) walidacja mówi przy polu, czego brakuje, zanim cokolwiek pójdzie do bazy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  openLogin: vi.fn(),
  rpc: null as SupabaseRpcStub | null,
  auth: { session: null as null | { user: { id: string; email?: string } }, loading: false },
  navigate: vi.fn(),
  confirmEmail: vi.fn(async () => ({ ok: true })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/lib/loginPopupBus", () => ({ openLoginPopup: h.openLogin }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/i18n-event-cfp", () => ({ ensureEventCfpI18n: () => undefined }));
vi.mock("@/lib/i18n-event-registration", () => ({ ensureEventRegistrationI18n: () => undefined }));
vi.mock("@/lib/events/publicCfpErrors", () => ({
  publicCfpErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("@/lib/events/cfpNotify.functions", () => ({ confirmCfpSubmissionEmail: h.confirmEmail }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/events/cfpStubs")).routerLinkWithSearchStub(await import("react")),
  useNavigate: () => h.navigate,
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);

const { CfpSubmitPage } = await import("@/components/events/cfp/organisms/CfpSubmitPage");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

function payload(name: string): Record<string, unknown> {
  const value = stub().lastCall(name)?.arg("p_payload");
  if (typeof value !== "object" || value === null) throw new Error(`test: brak ${name}`);
  return value as Record<string, unknown>;
}

const ID = "11111111-1111-4111-8111-111111111111";

function cfp(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "e1",
    event_slug: "kongres",
    timezone: "Europe/Warsaw",
    phase: "open",
    is_open: true,
    formats: [{ key: "talk", label_pl: "Wykład", label_en: "Talk", duration_min: 30 }],
    tracks: [{ id: "t1", key: "e", name_pl: "Energia", name_en: "Energy" }],
    fields: [
      {
        id: "f1",
        key: "exp",
        field_type: "text",
        label_pl: "Doświadczenie",
        label_en: "Experience",
        is_required: true,
      },
    ],
    allow_co_speakers: true,
    max_per_submitter: 2,
    ...overrides,
  };
}

function mine(items: unknown[] = [], person: unknown = null) {
  return {
    event_id: "e1",
    event_slug: "kongres",
    timezone: "Europe/Warsaw",
    max_per_submitter: 2,
    score_max: 5,
    person,
    items,
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    status: "draft",
    title_pl: "Energia jutra",
    title_en: "",
    abstract_pl: "Streszczenie wystąpienia dłuższe niż dwadzieścia znaków",
    abstract_en: "",
    talk_language: "pl",
    format_key: "talk",
    track_id: "t1",
    topics: ["sieci"],
    answers: { exp: "10 lat" },
    feedback_to_speaker: "",
    speakers: [{ is_primary: true, role: "speaker", first_name: "Anna", last_name: "Nowak" }],
    ...overrides,
  };
}

const PERSON = {
  id: "p1",
  first_name: "Anna",
  last_name: "Nowak",
  email: "anna@example.org",
  job_title: "CEO",
  company_text: "NES",
  consent_marketing: false,
};

function renderPage(submissionId: string | null = null) {
  return renderWithQueryClient(<CfpSubmitPage slug="kongres" submissionId={submissionId} />);
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.auth = { session: { user: { id: "u1", email: "anna@example.org" } }, loading: false };
  for (const fn of [h.navigate, h.toastSuccess, h.toastError]) fn.mockReset();
  h.confirmEmail.mockReset();
  h.confirmEmail.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe("CfpSubmitPage - bramki", () => {
  it("wczytywanie sesji i gość bez konta", async () => {
    h.auth = { session: null, loading: true };
    const { container } = renderPage();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    cleanup();
    h.auth = { session: null, loading: false };
    renderPage();
    expect(screen.getByText("eventCfp.submit.signInTitle")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.common.signIn" }));
    expect(h.openLogin).toHaveBeenCalledWith({
      mode: "signin",
      title: "eventCfp.submit.signInTitle",
      description: "eventCfp.submit.signInBody",
    });
    expect(stub().calls).toHaveLength(0);
  });

  it("odczyt w toku, awaria, brak naboru", async () => {
    stub().setResponse("event_cfp_public", () => new Promise(() => undefined) as never);
    stub().setData("event_my_cfp_submissions", mine());
    const { container } = renderPage();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    cleanup();
    stub().setError("event_cfp_public", "boom");
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("eventCfp.common.loadFailed");
    cleanup();
    stub().setData("event_cfp_public", { phase: "none" });
    renderPage();
    expect(await screen.findByText("eventCfp.submit.notFound")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "eventCfp.submit.backToCall" })).toHaveAttribute(
      "href",
      "/events/kongres/cfp",
    );
    expect(screen.getByRole("link", { name: "eventCfp.submit.toPanel" })).toHaveAttribute(
      "href",
      "/events/kongres/speaker",
    );
    cleanup();
    stub().setData("event_cfp_public", cfp());
    stub().setData("event_my_cfp_submissions", null);
    renderPage();
    expect(await screen.findByText("eventCfp.submit.notFound")).toBeInTheDocument();
  });

  it("cudze albo nieistniejące zgłoszenie, zgłoszenie po wysłaniu i zamknięty nabór", async () => {
    stub().setData("event_cfp_public", cfp());
    stub().setData("event_my_cfp_submissions", mine([item({ id: "inne" })]));
    renderPage(ID);
    expect(await screen.findByText("eventCfp.submit.draftNotFound")).toBeInTheDocument();
    cleanup();
    stub().setData("event_my_cfp_submissions", mine([item({ status: "submitted" })]));
    renderPage(ID);
    expect(await screen.findByText("eventCfp.submit.notEditable")).toBeInTheDocument();
    cleanup();
    stub().setData("event_cfp_public", cfp({ phase: "closed", is_open: false }));
    stub().setData("event_my_cfp_submissions", mine());
    renderPage();
    expect(await screen.findByText("eventCfp.submit.closed")).toBeInTheDocument();
    cleanup();
    stub().setData("event_my_cfp_submissions", mine([item()]));
    renderPage(ID);
    expect(await screen.findByText("eventCfp.submit.closed")).toBeInTheDocument();
  });

  it("świeżo zapisany szkic w trakcie odświeżania listy to nie „nie znaleziono”", async () => {
    stub().setData("event_cfp_public", cfp());
    stub().setData("event_my_cfp_submissions", mine());
    const { container, queryClient } = renderPage(ID);
    expect(await screen.findByText("eventCfp.submit.draftNotFound")).toBeInTheDocument();
    stub().setResponse("event_my_cfp_submissions", () => new Promise(() => undefined) as never);
    void queryClient.invalidateQueries();
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
  });
});

describe("CfpSubmitPage - nowe zgłoszenie", () => {
  beforeEach(() => {
    stub().setData("event_cfp_public", cfp());
    stub().setData("event_my_cfp_submissions", mine([], PERSON));
  });

  it("dane osoby i adres konta są wypełnione; limit zgłoszeń", async () => {
    renderPage();
    expect(await screen.findByText("eventCfp.submit.title")).toBeInTheDocument();
    expect(screen.getByLabelText("eventCfp.submit.fields.firstName *")).toHaveValue("Anna");
    expect(screen.getByLabelText("eventCfp.submit.fields.email")).toHaveValue("anna@example.org");
    expect(screen.getByLabelText("eventCfp.submit.fields.jobTitle")).toHaveValue("CEO");
    expect(screen.getByText("eventCfp.submit.limitInfo(count=0,max=2)")).toBeInTheDocument();
  });

  it("zapis szkicu wymaga nazwiska, zapisuje ze slugiem i przypina `?id=` do adresu", async () => {
    renderPage();
    await screen.findByText("eventCfp.submit.title");
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.lastName *"), {
      target: { value: " " },
    });
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.saveDraft" }));
    expect(await screen.findByText("eventCfp.submit.validation.lastName")).toBeInTheDocument();
    expect(stub().callsFor("event_cfp_submission_save")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.lastName *"), {
      target: { value: "Nowak" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.firstName *"), {
      target: { value: "Anna Maria" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.jobTitle"), {
      target: { value: "Prezes" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.company"), {
      target: { value: "NES SA" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "eventCfp.submit.fields.marketingConsent" }),
    );
    stub().setData("event_cfp_submission_save", { id: ID, status: "draft" });
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.saveDraft" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.submit.saved"));
    expect(payload("event_cfp_submission_save")).toMatchObject({
      slug: "kongres",
      notify_lang: "pl",
      speaker: {
        first_name: "Anna Maria",
        last_name: "Nowak",
        job_title: "Prezes",
        company_text: "NES SA",
        consent_marketing: true,
      },
      talk_language: "pl",
      format_key: null,
      track_id: null,
      co_speakers: [],
    });
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/events/$slug/cfp-submit",
      params: { slug: "kongres" },
      search: { id: ID },
      replace: true,
    });

    // Drugi zapis tego samego szkicu idzie już po identyfikatorze, bez sluga.
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.saveDraft" }));
    await waitFor(() => expect(stub().callsFor("event_cfp_submission_save")).toHaveLength(2));
    expect(payload("event_cfp_submission_save")).toMatchObject({ id: ID });
    expect(payload("event_cfp_submission_save")).not.toHaveProperty("slug");
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });

  it("wysłanie: błędy przy polach, potem zapis, wysłanie, mail i przejście do panelu", async () => {
    renderPage();
    await screen.findByText("eventCfp.submit.title");
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.send" }));
    for (const key of [
      "eventCfp.submit.validation.title",
      "eventCfp.submit.validation.abstract",
      "eventCfp.submit.validation.format",
      "eventCfp.submit.validation.track",
      "eventCfp.submit.validation.answer",
    ]) {
      expect(await screen.findByText(key)).toBeInTheDocument();
    }
    expect(stub().callsFor("event_cfp_submission_save")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.titlePl"), {
      target: { value: "Energia jutra" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.titleEn"), {
      target: { value: "Energy" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.abstractPl"), {
      target: { value: "Streszczenie wystąpienia dłuższe niż dwadzieścia znaków" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.abstractEn"), {
      target: { value: "EN" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.topics"), {
      target: { value: "sieci, OZE" },
    });
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0] as HTMLElement, { target: { value: "en" } });
    fireEvent.change(selects[1] as HTMLElement, { target: { value: "talk" } });
    fireEvent.change(selects[2] as HTMLElement, { target: { value: "t1" } });
    expect(
      screen.getByRole("option", { name: "Wykład (eventCfp.page.formatDuration(count=30))" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Doświadczenie/), { target: { value: "10 lat" } });

    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.coSpeaker.add" }));
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.send" }));
    expect(await screen.findByText("eventCfp.submit.validation.coSpeakers")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("eventCfp.submit.coSpeaker.firstName *"), {
      target: { value: "Jan" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.coSpeaker.lastName *"), {
      target: { value: "K" },
    });

    stub().setData("event_cfp_submission_save", { id: ID, status: "draft" });
    stub().setData("event_cfp_submission_submit", { id: ID, status: "submitted" });
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.send" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.submit.submitted"));
    expect(
      stub()
        .names()
        .filter((name) => name.startsWith("event_cfp_submission_")),
    ).toEqual(["event_cfp_submission_save", "event_cfp_submission_submit"]);
    expect(payload("event_cfp_submission_save")).toMatchObject({
      title_pl: "Energia jutra",
      title_en: "Energy",
      talk_language: "en",
      format_key: "talk",
      track_id: "t1",
      topics: ["sieci", "OZE"],
      answers: { exp: "10 lat" },
      co_speakers: [
        {
          first_name: "Jan",
          last_name: "K",
          email: null,
          job_title: "",
          company_text: "",
          role: "speaker",
        },
      ],
    });
    expect(payload("event_cfp_submission_submit")).toEqual({ id: ID });
    expect(h.confirmEmail).toHaveBeenCalledWith({ data: { submissionId: ID } });
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/events/$slug/speaker",
      params: { slug: "kongres" },
    });
  });

  it("odmowa zapisu i odmowa wysłania; mail, który padł, nie cofa wysłania", async () => {
    stub().setData(
      "event_cfp_public",
      cfp({ formats: [], tracks: [], fields: [], allow_co_speakers: false }),
    );
    renderPage();
    await screen.findByText("eventCfp.submit.title");
    expect(screen.queryByText("eventCfp.submit.sections.coSpeakers")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.titlePl"), {
      target: { value: "Tytuł" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.abstractPl"), {
      target: { value: "x".repeat(30) },
    });

    stub().setError("event_cfp_submission_save", "limit_reached: 2");
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.saveDraft" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:limit_reached: 2"));

    stub().setData("event_cfp_submission_save", { id: ID, status: "draft" });
    stub().setError("event_cfp_submission_submit", "cfp_closed: x");
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.send" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:cfp_closed: x"));
    expect(h.navigate).not.toHaveBeenCalled();

    stub().setError("event_cfp_submission_save", "rate_limited: x");
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.send" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:rate_limited: x"));

    stub().setData("event_cfp_submission_save", { id: ID, status: "draft" });
    stub().setData("event_cfp_submission_submit", { id: ID, status: "submitted" });
    h.confirmEmail.mockRejectedValueOnce(new Error("smtp"));
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.send" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.submit.submitted"));
  });

  it("wysłanie w toku blokuje oba przyciski i mówi „wysyłam”", async () => {
    stub().setData("event_cfp_public", cfp({ formats: [], tracks: [], fields: [] }));
    renderPage();
    await screen.findByText("eventCfp.submit.title");
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.titlePl"), {
      target: { value: "Tytuł" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.fields.abstractPl"), {
      target: { value: "x".repeat(30) },
    });
    stub().setData("event_cfp_submission_save", { id: ID, status: "draft" });
    stub().setResponse("event_cfp_submission_submit", () => new Promise(() => undefined) as never);
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.send" }));
    expect(await screen.findByRole("button", { name: "eventCfp.submit.sending" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "eventCfp.submit.saveDraft" })).toBeDisabled();
  });

  it("konto bez adresu w sesji bierze adres z karty uczestnika", async () => {
    h.auth = { session: { user: { id: "u1" } }, loading: false };
    renderPage();
    expect(await screen.findByLabelText("eventCfp.submit.fields.email")).toHaveValue(
      "anna@example.org",
    );
    cleanup();
    stub().setData("event_my_cfp_submissions", mine([], null));
    renderPage();
    expect(await screen.findByLabelText("eventCfp.submit.fields.email")).toHaveValue("");
  });
});

describe("CfpSubmitPage - edycja", () => {
  it("prośba o zmiany: edycja także po zamknięciu naboru, z informacją od organizatora", async () => {
    stub().setData("event_cfp_public", cfp({ phase: "closed", is_open: false }));
    stub().setData(
      "event_my_cfp_submissions",
      mine(
        [item({ status: "changes_requested", feedback_to_speaker: "Prosimy skrócić." })],
        PERSON,
      ),
    );
    renderPage(ID);
    expect(await screen.findByText("eventCfp.submit.editTitle")).toBeInTheDocument();
    const notice = screen.getByText("eventCfp.submit.changesRequested").closest("section");
    if (notice === null) throw new Error("test");
    expect(within(notice).getByText("Prosimy skrócić.")).toBeInTheDocument();
    expect(screen.getByLabelText("eventCfp.submit.fields.titlePl")).toHaveValue("Energia jutra");
    stub().setData("event_cfp_submission_save", { id: ID, status: "changes_requested" });
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.saveDraft" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.submit.saved"));
    expect(payload("event_cfp_submission_save")).toMatchObject({ id: ID });
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("prośba o zmiany bez informacji zwrotnej", async () => {
    stub().setData("event_cfp_public", cfp());
    stub().setData(
      "event_my_cfp_submissions",
      mine([item({ status: "changes_requested" })], PERSON),
    );
    renderPage(ID);
    const notice = (await screen.findByText("eventCfp.submit.changesRequested")).closest("section");
    if (notice === null) throw new Error("test");
    expect(notice.querySelectorAll("p")).toHaveLength(0);
  });
});
