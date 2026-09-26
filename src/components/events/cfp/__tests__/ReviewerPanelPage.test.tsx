// Panel recenzenta: kolejka, zgłoszenie i formularz oceny.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//   1. Ocena w ciemno pokazuje prelegentów - baza oddaje `speakers: null`,
//      a panel nie może tego „uzupełnić" ani wypisać pustego nagłówka.
//   2. Ocena bez oceny ogólnej (bez wstrzymania i konfliktu) wychodzi do bazy
//      i wraca odmową `score_required` zamiast zdania przy skali.
//   3. Zapis nie przenosi kompletu pól (kryteria bez oceny, rekomendacja,
//      oba komentarze, konflikt) - baza zastępuje ocenę w całości.
//   4. Osoba spoza recenzentów dostaje „awarię" zamiast zdania, że nie
//      jest recenzentem tego naboru.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  auth: { session: { user: { id: "u1" } } as null | { user: { id: string } }, loading: false },
  navigate: vi.fn(),
  openLogin: vi.fn(),
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
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/lib/loginPopupBus", () => ({ openLoginPopup: h.openLogin }));
// Nakładka PRAWDZIWA: mapa odmów sprawdza istnienie klucza (`i18n.exists`),
// a napisy w UI i tak zostają kluczami (atrapa `react-i18next`).
// Zdanie z mapy odmów ma własne testy; tu liczy się, że panel pokazuje TO,
// co mapa zwróciła (klucz), a rozpoznanie „nie jesteś recenzentem" zostaje prawdziwe.
vi.mock("@/lib/events/publicCfpErrors", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/events/publicCfpErrors")>();
  return { ...real, publicCfpErrorMessage: (error: unknown) => real.publicCfpFailure(error).key };
});
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/events/cfpStubs")).routerLinkWithSearchStub(await import("react")),
  useNavigate: () => h.navigate,
}));
vi.mock("@/components/ui/select", async () => (await import("@/test/reactStubs")).radixSelectStub(await import("react")));

const { ReviewerPanelPage } = await import("@/components/events/cfp/organisms/ReviewerPanelPage");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

function payload(name: string): Record<string, unknown> {
  const value = stub().lastCall(name)?.arg("p_payload");
  if (typeof value !== "object" || value === null) throw new Error(`test: brak ${name}`);
  return value as Record<string, unknown>;
}

const CRITERIA = [
  { key: "rel", label_pl: "Trafność", label_en: "Relevance", weight: 2 },
  { key: "depth", label_pl: "Głębia", label_en: "Depth", weight: 1 },
];

function queue(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "e1",
    event_slug: "kongres",
    timezone: "Europe/Warsaw",
    identity_visible: false,
    score_max: 5,
    review_criteria: CRITERIA,
    items: [
      {
        id: "s1",
        status: "submitted",
        title_pl: "Energia jutra",
        title_en: "",
        talk_language: "pl",
        format_key: "talk",
        track_name_pl: "Energia",
        track_name_en: "Energy",
        submitted_at: "2026-09-10T10:00:00+00:00",
        speakers: null,
        my_review: null,
      },
      {
        id: "s2",
        status: "under_review",
        title_pl: "Sieci",
        title_en: "Grids",
        talk_language: "en",
        format_key: null,
        track_name_pl: null,
        track_name_en: null,
        submitted_at: null,
        speakers: [{ first_name: "Anna", last_name: "Nowak", role: "speaker" }],
        my_review: { overall: 4, recommendation: "accept", conflict_of_interest: false },
      },
      {
        id: "s3",
        status: "under_review",
        title_pl: "Konflikt",
        talk_language: "pl",
        speakers: null,
        my_review: { overall: null, recommendation: null, conflict_of_interest: true },
      },
    ],
    ...overrides,
  };
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    submission: {
      id: "s1",
      status: "submitted",
      title_pl: "Energia jutra",
      title_en: "Energy of tomorrow",
      abstract_pl: "Streszczenie wystąpienia",
      abstract_en: "",
      talk_language: "pl",
      format_key: "talk",
      track_id: "t1",
      topics: ["sieci"],
      answers: { exp: "10 lat" },
      submitted_at: "2026-09-10T10:00:00+00:00",
    },
    identity_visible: false,
    speakers: null,
    fields: [{ key: "exp", field_type: "text", label_pl: "Doświadczenie", label_en: "Experience" }],
    formats: [{ key: "talk", label_pl: "Wykład", label_en: "Talk", duration_min: 30 }],
    track: { name_pl: "Energia", name_en: "Energy" },
    score_max: 5,
    review_criteria: CRITERIA,
    review: null,
    ...overrides,
  };
}

function renderPage(submissionId: string | null = null) {
  return renderWithQueryClient(<ReviewerPanelPage slug="kongres" submissionId={submissionId} />);
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.auth = { session: { user: { id: "u1" } }, loading: false };
  for (const fn of [h.navigate, h.openLogin, h.toastSuccess, h.toastError]) fn.mockReset();
});
afterEach(cleanup);

describe("ReviewerPanelPage - bramki", () => {
  it("wczytywanie sesji, gość, kolejka w locie", async () => {
    h.auth = { session: null, loading: true };
    const first = renderPage();
    expect(first.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    cleanup();
    h.auth = { session: null, loading: false };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.common.signIn" }));
    expect(h.openLogin).toHaveBeenCalledWith({
      mode: "signin",
      title: "eventCfp.review.signInTitle",
      description: "eventCfp.review.signInBody",
    });
    expect(stub().calls).toHaveLength(0);
    cleanup();
    h.auth = { session: { user: { id: "u1" } }, loading: false };
    stub().setResponse("event_cfp_review_queue", () => new Promise(() => undefined) as never);
    const pending = renderPage();
    expect(pending.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("nie-recenzent, awaria i brak wydarzenia mają różne zdania", async () => {
    stub().setError("event_cfp_review_queue", "not_reviewer: you are not a reviewer of this call");
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("eventCfp.review.notReviewer");
    cleanup();
    stub().setError("event_cfp_review_queue", "boom");
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("eventCfp.common.loadFailed");
    cleanup();
    stub().setData("event_cfp_review_queue", null);
    renderPage();
    expect(await screen.findByText("eventCfp.submit.notFound")).toBeInTheDocument();
  });
});

describe("ReviewerPanelPage - kolejka", () => {
  it("postęp, ocena w ciemno, stan własnej oceny i odnośnik do oceny", async () => {
    stub().setData("event_cfp_review_queue", queue());
    renderPage();
    expect(await screen.findByText("eventCfp.review.progress(count=2,total=3)")).toBeInTheDocument();
    expect(screen.getByText("eventCfp.review.blind")).toBeInTheDocument();
    const row = (title: string) => {
      const li = screen.getByText(title).closest("li");
      if (li === null) throw new Error("test");
      return within(li);
    };
    expect(row("Energia jutra").getByText("eventCfp.review.toReview")).toBeInTheDocument();
    expect(row("Energia jutra").getByText(/Energia · eventCfp\.languages\.pl · 10 września 2026/)).toBeInTheDocument();
    expect(row("Energia jutra").getByRole("link", { name: "eventCfp.review.open" })).toHaveAttribute(
      "href",
      "/events/kongres/review?id=s1",
    );
    expect(row("Sieci").getByText("eventCfp.review.reviewed")).toBeInTheDocument();
    expect(row("Sieci").getByText("Anna Nowak")).toBeInTheDocument();
    expect(row("Sieci").getByText("eventCfp.languages.en")).toBeInTheDocument();
    expect(row("Konflikt").getByText("eventCfp.review.conflictDeclared")).toBeInTheDocument();
  });

  it("pusta kolejka; recenzent z wglądem nie widzi znacznika oceny w ciemno", async () => {
    stub().setData("event_cfp_review_queue", queue({ items: [], identity_visible: true }));
    renderPage();
    expect(await screen.findByText("eventCfp.review.empty")).toBeInTheDocument();
    expect(screen.queryByText("eventCfp.review.blind")).not.toBeInTheDocument();
  });
});

describe("ReviewerPanelPage - ocena", () => {
  beforeEach(() => {
    stub().setData("event_cfp_review_queue", queue());
  });

  it("zgłoszenie w ciemno: bez prelegentów, ze streszczeniem, tematami i odpowiedziami", async () => {
    stub().setData("event_cfp_review_get", review());
    renderPage("s1");
    expect(await screen.findByRole("heading", { name: "Energia jutra" })).toBeInTheDocument();
    expect(screen.getByText("Energia · Wykład · eventCfp.languages.pl · 10 września 2026 12:00")).toBeInTheDocument();
    expect(screen.queryByText("eventCfp.review.speakers")).not.toBeInTheDocument();
    expect(screen.getAllByText("eventCfp.review.blind")).toHaveLength(1);
    expect(screen.getByText("Streszczenie wystąpienia")).toBeInTheDocument();
    expect(screen.getByText("sieci")).toBeInTheDocument();
    expect(screen.getByText("10 lat")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "eventCfp.review.back" })).toHaveAttribute("href", "/events/kongres/review");
    expect(stub().lastCall("event_cfp_review_get")?.arg("p_submission_id")).toBe("s1");
  });

  it("zgłoszenie z wglądem: prelegenci z rolą i afiliacją; brak pytań, ścieżki i formy", async () => {
    stub().setData(
      "event_cfp_review_get",
      review({
        identity_visible: true,
        speakers: [
          { first_name: "Anna", last_name: "Nowak", role: "speaker", job_title: "CEO", company_text: "NES" },
          { first_name: "Jan", last_name: "K", role: "panelist", job_title: null, company_text: null },
        ],
        fields: [],
        track: null,
        formats: [],
        submission: { ...review().submission, topics: [], submitted_at: null },
      }),
    );
    renderPage("s1");
    expect(await screen.findByText("eventCfp.review.speakers")).toBeInTheDocument();
    expect(screen.getByText(/eventCfp\.roles\.speaker · CEO, NES/)).toBeInTheDocument();
    expect(screen.getByText("eventCfp.roles.panelist")).toBeInTheDocument();
    expect(screen.getByText("eventCfp.review.noAnswers")).toBeInTheDocument();
    expect(screen.getByText("eventCfp.languages.pl")).toBeInTheDocument();
    expect(screen.queryByText("eventCfp.review.blind")).not.toBeInTheDocument();
  });

  it("ocena ogólna wymagana; komplet pól w ładunku; powrót do kolejki po zapisie", async () => {
    stub().setData("event_cfp_review_get", review());
    renderPage("s1");
    await screen.findByRole("heading", { name: "Energia jutra" });
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.review.save" }));
    expect(screen.getByText("eventCfp.review.validation.overall")).toBeInTheDocument();
    expect(stub().callsFor("event_cfp_review_save")).toHaveLength(0);

    const overall = screen.getByRole("group", { name: "eventCfp.review.overall" });
    fireEvent.click(within(overall).getByRole("button", { name: "eventCfp.review.scoreButton(label=eventCfp.review.overall,score=4)" }));
    expect(within(overall).getByRole("button", { name: /score=4/ })).toHaveAttribute("aria-pressed", "true");
    const relevance = screen.getByRole("group", { name: "Trafność" });
    fireEvent.click(within(relevance).getByRole("button", { name: /score=5/ }));
    fireEvent.click(within(relevance).getByRole("button", { name: "eventCfp.review.clearScore" }));
    fireEvent.click(within(relevance).getByRole("button", { name: /score=3/ }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "maybe" } });
    fireEvent.change(screen.getByLabelText("eventCfp.review.commentPrivate"), { target: { value: " Mocne dane " } });
    fireEvent.change(screen.getByLabelText("eventCfp.review.commentToSpeaker"), { target: { value: "x".repeat(4001) } });
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.review.save" }));
    expect(screen.getByText("eventCfp.review.validation.comments")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("eventCfp.review.commentToSpeaker"), { target: { value: "Skrócić wstęp" } });

    stub().setData("event_cfp_review_save", { id: "r1" });
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.review.save" }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.review.saved"));
    expect(payload("event_cfp_review_save")).toEqual({
      submission_id: "s1",
      scores: { rel: 3 },
      overall: 4,
      recommendation: "maybe",
      comment_private: "Mocne dane",
      comment_to_speaker: "Skrócić wstęp",
      conflict_of_interest: false,
    });
    expect(h.navigate).toHaveBeenCalledWith({ to: "/events/$slug/review", params: { slug: "kongres" }, search: {} });
  });

  it("konflikt interesów zwalnia z oceny ogólnej; zdjęcie rekomendacji; odmowa bazy", async () => {
    stub().setData(
      "event_cfp_review_get",
      review({
        review: {
          scores: { rel: 2 },
          overall: 2,
          recommendation: "reject",
          comment_private: "",
          comment_to_speaker: "",
          conflict_of_interest: false,
        },
      }),
    );
    renderPage("s1");
    await screen.findByRole("heading", { name: "Energia jutra" });
    expect(screen.getByRole("combobox")).toHaveValue("reject");
    fireEvent.click(within(screen.getByRole("group", { name: "eventCfp.review.overall" })).getByRole("button", { name: "eventCfp.review.clearScore" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /eventCfp\.review\.conflict/ }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__none__" } });
    stub().setError("event_cfp_review_save", "not_found: x");
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.review.save" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("eventCfp.errors.notFound"));
    expect(payload("event_cfp_review_save")).toMatchObject({
      overall: null,
      recommendation: null,
      conflict_of_interest: true,
      scores: { rel: 2 },
    });
    expect(h.navigate).not.toHaveBeenCalled();
    // Odznaczenie konfliktu przywraca wymóg oceny ogólnej.
    fireEvent.click(screen.getByRole("checkbox", { name: /eventCfp\.review\.conflict/ }));
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.review.save" }));
    expect(screen.getByText("eventCfp.review.validation.overall")).toBeInTheDocument();
  });

  it("zapis w toku blokuje przycisk; kryteriów może nie być", async () => {
    stub().setData("event_cfp_review_get", review({ review_criteria: [] }));
    renderPage("s1");
    await screen.findByRole("heading", { name: "Energia jutra" });
    expect(screen.queryByText("eventCfp.review.criteria")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "eventCfp.review.overall" })).getByRole("button", { name: /score=1/ }));
    stub().setResponse("event_cfp_review_save", () => new Promise(() => undefined) as never);
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.review.save" }));
    expect(await screen.findByRole("button", { name: "eventCfp.common.saving" })).toBeDisabled();
  });

  it("zgłoszenie spoza kolejki i szczegół w locie", async () => {
    stub().setError("event_cfp_review_get", "not_found: submission is not in your review queue");
    renderPage("s9");
    expect(await screen.findByRole("alert")).toHaveTextContent("eventCfp.errors.notFound");
    expect(screen.getByRole("link", { name: "eventCfp.review.back" })).toBeInTheDocument();
    cleanup();
    stub().setResponse("event_cfp_review_get", () => new Promise(() => undefined) as never);
    const pending = renderPage("s1");
    await waitFor(() => expect(pending.container.querySelector('[aria-busy="true"]')).not.toBeNull());
  });
});
