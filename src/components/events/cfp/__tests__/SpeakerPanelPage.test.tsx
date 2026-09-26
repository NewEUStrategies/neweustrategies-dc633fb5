// Panel prelegenta: zgłoszenia z krokami, profil sceniczny, wystąpienia
// i materiały.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//   1. SSR wpisałby do HTML-a dane konta albo panel rozjechałby hydratację -
//      pierwszy render musi być szkieletem, a dane przychodzą po montażu.
//   2. Przycisk kroku niezgodny ze stanem (wycofanie odrzuconego, odpowiedź
//      na nieprzyjęte) - baza odbije go zdaniem, które prelegentowi nic nie mówi.
//   3. Nieodwracalne kroki (wycofanie, usunięcie szkicu, rezygnacja, usunięcie
//      materiału) bez potwierdzenia.
//   4. Formularz profilu albo materiału wysyłający ładunek, którego baza nie
//      przyjmie (`invalid_profile`, `invalid_url`), zamiast zdania przy polu.
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  session: { user: { id: "u1" } } as null | { user: { id: string } },
  confirm: vi.fn(async () => true),
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
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session, loading: false }) }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: h.confirm }));
vi.mock("@/lib/loginPopupBus", () => ({ openLoginPopup: h.openLogin }));
vi.mock("@/lib/i18n-event-cfp", () => ({ ensureEventCfpI18n: () => undefined }));
vi.mock("@/lib/events/publicCfpErrors", () => ({
  publicCfpErrorMessage: (error: unknown) =>
    `odmowa:${error instanceof Error ? error.message : String(error)}`,
}));
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/events/cfpStubs")).routerLinkWithSearchStub(await import("react")),
}));
vi.mock("@/components/ui/tabs", async () =>
  (await import("@/test/reactStubs")).radixTabsStub(await import("react")),
);
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);

const { SpeakerPanelPage } = await import("@/components/events/cfp/organisms/SpeakerPanelPage");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

function payload(name: string): Record<string, unknown> {
  const value = stub().lastCall(name)?.arg("p_payload");
  if (typeof value !== "object" || value === null) throw new Error(`test: brak ${name}`);
  return value as Record<string, unknown>;
}

const PROFILE = {
  speaker_profile_id: "sp1",
  headline_pl: "Ekspertka",
  headline_en: "",
  bio_pl: "Biogram",
  bio_en: "",
  topics_pl: ["energia"],
  topics_en: [],
  languages: ["pl"],
  card_photo_url: "",
};

function panel(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "e1",
    event_slug: "kongres",
    timezone: "Europe/Warsaw",
    is_reviewer: false,
    submissions_count: 2,
    person: { id: "p1" },
    profile: PROFILE,
    sessions: [
      {
        session_id: "ses1",
        title_pl: "Sesja otwarcia",
        title_en: "Opening",
        starts_at: "2026-10-01T08:00:00+00:00",
        ends_at: "2026-10-01T09:00:00+00:00",
        status: "published",
        role: "moderator",
        room_name: "Sala A",
        track_name_pl: "Energia",
        track_name_en: "Energy",
      },
      {
        session_id: "ses2",
        title_pl: "Panel roboczy",
        title_en: "",
        starts_at: null,
        ends_at: null,
        status: "draft",
        role: "speaker",
        room_name: null,
        track_name_pl: null,
        track_name_en: null,
      },
    ],
    materials: [
      {
        id: "m1",
        kind: "slides",
        title_pl: "Slajdy",
        title_en: "Slides",
        url: "https://example.org/s.pdf",
        visibility: "public",
        is_published: true,
        submission_id: null,
        session_id: "ses1",
      },
      {
        id: "m2",
        kind: "video",
        title_pl: "Nagranie",
        title_en: "",
        url: "https://example.org/v",
        visibility: "registered",
        is_published: false,
        submission_id: null,
        session_id: null,
      },
    ],
    ...overrides,
  };
}

function sub(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status,
    title_pl: `Wystąpienie ${id}`,
    title_en: "",
    submitted_at: status === "draft" ? null : "2026-09-10T10:00:00+00:00",
    updated_at: "2026-09-09T10:00:00+00:00",
    feedback_to_speaker: "",
    speakers: [],
    review_summary: { reviews_count: 0, overall_avg: null },
    ...overrides,
  };
}

function mine(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    event_id: "e1",
    event_slug: "kongres",
    timezone: "Europe/Warsaw",
    max_per_submitter: 3,
    score_max: 5,
    person: null,
    items,
    ...overrides,
  };
}

async function renderPanel(
  options: { panelData?: unknown; mineData?: unknown; phase?: string } = {},
) {
  stub().setData(
    "event_my_speaker_panel",
    options.panelData === undefined ? panel() : options.panelData,
  );
  stub().setData(
    "event_my_cfp_submissions",
    options.mineData === undefined ? mine([]) : options.mineData,
  );
  stub().setData("event_cfp_public", { phase: options.phase ?? "open" });
  const view = renderWithQueryClient(<SpeakerPanelPage slug="kongres" />);
  return view;
}

function openTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.session = { user: { id: "u1" } };
  for (const fn of [h.openLogin, h.toastSuccess, h.toastError]) fn.mockReset();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("SpeakerPanelPage - bramki", () => {
  it("SSR i pierwszy render: szkielet bez zapytań, hydratacja bez rozjazdu", async () => {
    stub().setData("event_my_speaker_panel", panel());
    stub().setData("event_my_cfp_submissions", mine([]));
    stub().setData("event_cfp_public", { phase: "open" });
    const host = document.createElement("div");
    host.innerHTML = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <SpeakerPanelPage slug="kongres" />
      </QueryClientProvider>,
    );
    document.body.append(host);
    expect(host.innerHTML).toContain('aria-busy="true"');
    expect(stub().calls).toHaveLength(0);
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(
        host,
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <SpeakerPanelPage slug="kongres" />
        </QueryClientProvider>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    try {
      expect(errors).toEqual([]);
      await waitFor(() => expect(host.textContent).toContain("eventCfp.speaker.title"));
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("gość dostaje okno logowania z kontekstem, bez zapytań", async () => {
    h.session = null;
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.common.signIn" }));
    expect(h.openLogin).toHaveBeenCalledWith({
      mode: "signin",
      title: "eventCfp.speaker.signInTitle",
      description: "eventCfp.speaker.signInBody",
    });
    expect(stub().calls).toHaveLength(0);
  });

  it("wczytywanie, awaria i brak wydarzenia", async () => {
    stub().setResponse("event_my_speaker_panel", () => new Promise(() => undefined) as never);
    stub().setData("event_my_cfp_submissions", mine([]));
    stub().setData("event_cfp_public", { phase: "open" });
    const { container } = renderWithQueryClient(<SpeakerPanelPage slug="kongres" />);
    await waitFor(() => expect(stub().callsFor("event_my_speaker_panel")).toHaveLength(1));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    cleanup();
    stub().setError("event_my_speaker_panel", "boom");
    renderWithQueryClient(<SpeakerPanelPage slug="kongres" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("eventCfp.common.loadFailed");
    cleanup();
    await renderPanel({ panelData: null });
    expect(await screen.findByRole("alert")).toHaveTextContent("eventCfp.common.loadFailed");
    cleanup();
    await renderPanel({ mineData: null });
    expect(await screen.findByRole("alert")).toHaveTextContent("eventCfp.common.loadFailed");
  });
});

describe("SpeakerPanelPage - zgłoszenia", () => {
  it("stan, informacja od organizatora, średnia ocen i kroki zgodne ze stanem", async () => {
    await renderPanel({
      panelData: panel({ is_reviewer: true }),
      mineData: mine([
        sub("s1", "draft", { title_pl: "" }),
        sub("s2", "changes_requested", { feedback_to_speaker: "Prosimy skrócić." }),
        sub("s3", "accepted", { review_summary: { reviews_count: 3, overall_avg: 4.33 } }),
        sub("s4", "confirmed"),
        sub("s5", "rejected"),
        sub("s6", "withdrawn"),
      ]),
    });
    expect(await screen.findByText("eventCfp.speaker.title")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "eventCfp.speaker.reviewerLink" })).toHaveAttribute(
      "href",
      "/events/kongres/review",
    );
    // Limit liczy wszystko poza wycofanymi.
    expect(
      screen.getByText("eventCfp.speaker.submissions.limit(count=5,max=3)"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "eventCfp.speaker.submissions.new" }),
    ).not.toBeInTheDocument();

    const card = (id: string) => {
      const heading = screen.getByRole("heading", {
        name: id === "s1" ? "-" : `Wystąpienie ${id}`,
      });
      const li = heading.closest("li");
      if (li === null) throw new Error("test");
      return within(li);
    };
    expect(
      card("s1").getByRole("link", { name: "eventCfp.speaker.submissions.continueDraft" }),
    ).toHaveAttribute("href", "/events/kongres/cfp-submit?id=s1");
    expect(
      card("s1").getByRole("button", { name: "eventCfp.speaker.submissions.deleteDraft" }),
    ).toBeInTheDocument();
    expect(card("s1").getByText(/eventCfp\.speaker\.submissions\.updatedAt/)).toBeInTheDocument();
    expect(card("s2").getByText("Prosimy skrócić.")).toBeInTheDocument();
    expect(
      card("s2").getByRole("link", { name: "eventCfp.speaker.submissions.edit" }),
    ).toBeInTheDocument();
    expect(card("s3").getByText("eventCfp.speaker.submissions.acceptedHint")).toBeInTheDocument();
    expect(
      card("s3").getByText("eventCfp.speaker.submissions.reviewsInfo(avg=4,3,count=3,max=5)"),
    ).toBeInTheDocument();
    expect(
      card("s3").getByRole("button", { name: "eventCfp.speaker.submissions.confirm" }),
    ).toBeInTheDocument();
    expect(
      card("s3").queryByRole("button", { name: "eventCfp.speaker.submissions.withdraw" }),
    ).not.toBeInTheDocument();
    expect(card("s4").getByText("eventCfp.speaker.submissions.confirmedHint")).toBeInTheDocument();
    expect(
      card("s4").getByRole("button", { name: "eventCfp.speaker.submissions.withdraw" }),
    ).toBeInTheDocument();
    expect(card("s5").queryByRole("button")).not.toBeInTheDocument();
    expect(card("s6").queryByRole("button")).not.toBeInTheDocument();
  });

  it("pusta lista i nowe zgłoszenie przy otwartym naborze pod limitem", async () => {
    await renderPanel({ panelData: panel({ submissions_count: 0 }), mineData: mine([]) });
    expect(await screen.findByText("eventCfp.speaker.submissions.empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "eventCfp.speaker.submissions.new" })).toHaveAttribute(
      "href",
      "/events/kongres/cfp-submit",
    );
    expect(
      screen.queryByRole("link", { name: "eventCfp.speaker.reviewerLink" }),
    ).not.toBeInTheDocument();
    cleanup();
    await renderPanel({ mineData: mine([]), phase: "closed" });
    await screen.findByText("eventCfp.speaker.submissions.empty");
    expect(
      screen.queryByRole("link", { name: "eventCfp.speaker.submissions.new" }),
    ).not.toBeInTheDocument();
  });

  it("wycofanie i usunięcie szkicu: potwierdzenie, wynik i odmowa", async () => {
    await renderPanel({ mineData: mine([sub("s1", "draft"), sub("s2", "submitted")]) });
    await screen.findByText("eventCfp.speaker.title");
    h.confirm.mockResolvedValueOnce(false);
    fireEvent.click(
      screen.getByRole("button", { name: "eventCfp.speaker.submissions.deleteDraft" }),
    );
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    expect(h.confirm.mock.calls[0]?.[0 as number]).toMatchObject({
      title: "eventCfp.speaker.submissions.deleteDraftTitle",
      destructive: true,
    });
    expect(stub().callsFor("event_cfp_submission_withdraw")).toHaveLength(0);

    stub().setData("event_cfp_submission_withdraw", { id: "s1", status: "deleted" });
    fireEvent.click(
      screen.getByRole("button", { name: "eventCfp.speaker.submissions.deleteDraft" }),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.speaker.submissions.deleted"),
    );
    expect(payload("event_cfp_submission_withdraw")).toEqual({ id: "s1" });

    stub().setData("event_cfp_submission_withdraw", { id: "s2", status: "withdrawn" });
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.speaker.submissions.withdraw" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.speaker.submissions.withdrawn"),
    );
    expect(h.confirm.mock.lastCall?.[0 as number]).toMatchObject({
      title: "eventCfp.speaker.submissions.withdrawTitle",
    });

    stub().setError("event_cfp_submission_withdraw", "invalid_transition: x");
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.speaker.submissions.withdraw" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:invalid_transition: x"));
  });

  it("odpowiedź na przyjęcie: potwierdzenie bez pytania, rezygnacja z pytaniem", async () => {
    await renderPanel({ mineData: mine([sub("s3", "accepted")]) });
    await screen.findByText("eventCfp.speaker.title");
    stub().setData("event_cfp_submission_respond", { id: "s3", status: "confirmed" });
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.speaker.submissions.confirm" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.speaker.submissions.confirmed"),
    );
    expect(payload("event_cfp_submission_respond")).toEqual({ id: "s3", confirm: true });
    expect(h.confirm).not.toHaveBeenCalled();

    h.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.speaker.submissions.decline" }));
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    expect(stub().callsFor("event_cfp_submission_respond")).toHaveLength(1);

    stub().setData("event_cfp_submission_respond", { id: "s3", status: "declined" });
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.speaker.submissions.decline" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.speaker.submissions.declined"),
    );
    expect(payload("event_cfp_submission_respond")).toEqual({ id: "s3", confirm: false });

    stub().setError("event_cfp_submission_respond", "invalid_transition: y");
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.speaker.submissions.confirm" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:invalid_transition: y"));
  });
});

describe("SpeakerPanelPage - profil", () => {
  it("bez wpisu w rejestrze profil i materiały mówią, kiedy się pojawią", async () => {
    await renderPanel({ panelData: panel({ profile: null }) });
    await screen.findByText("eventCfp.speaker.title");
    openTab("eventCfp.speaker.tabs.profile");
    expect(screen.getByText("eventCfp.speaker.profile.noProfile")).toBeInTheDocument();
    openTab("eventCfp.speaker.tabs.materials");
    expect(screen.getByText("eventCfp.speaker.profile.noProfile")).toBeInTheDocument();
  });

  it("zapis profilu: błąd przy polu, potem ładunek z tematami i językami jako listy", async () => {
    await renderPanel();
    await screen.findByText("eventCfp.speaker.title");
    openTab("eventCfp.speaker.tabs.profile");
    expect(screen.getByLabelText("eventCfp.speaker.profile.headlinePl")).toHaveValue("Ekspertka");
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.photo"), {
      target: { value: "http://x.pl/a.jpg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.common.save" }));
    expect(screen.getByText("eventCfp.speaker.profile.validation.photo")).toBeInTheDocument();
    expect(stub().callsFor("event_my_speaker_profile_set")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.photo"), {
      target: { value: "https://x.pl/a.jpg" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.headlineEn"), {
      target: { value: "Expert" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.bioPl"), {
      target: { value: "Nowy biogram" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.bioEn"), {
      target: { value: "Bio" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.topicsPl"), {
      target: { value: "energia, sieci" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.topicsEn"), {
      target: { value: "grids" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.languages"), {
      target: { value: "PL, en" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.headlinePl"), {
      target: { value: "Prezeska" },
    });
    stub().setData("event_my_speaker_profile_set", {});
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.common.save" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.speaker.profile.saved"),
    );
    expect(payload("event_my_speaker_profile_set")).toEqual({
      slug: "kongres",
      headline_pl: "Prezeska",
      headline_en: "Expert",
      bio_pl: "Nowy biogram",
      bio_en: "Bio",
      topics_pl: ["energia", "sieci"],
      topics_en: ["grids"],
      languages: ["pl", "en"],
      card_photo_url: "https://x.pl/a.jpg",
    });
    expect(screen.queryByText("eventCfp.speaker.profile.validation.photo")).not.toBeInTheDocument();

    stub().setError("event_my_speaker_profile_set", "invalid_profile: x");
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.common.save" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:invalid_profile: x"));
  });

  it("każda reguła profilu ma swoje zdanie przy polu", async () => {
    await renderPanel();
    await screen.findByText("eventCfp.speaker.title");
    openTab("eventCfp.speaker.tabs.profile");
    const save = () =>
      fireEvent.click(screen.getByRole("button", { name: "eventCfp.common.save" }));
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.headlinePl"), {
      target: { value: "x".repeat(201) },
    });
    save();
    expect(screen.getByText("eventCfp.speaker.profile.validation.headline")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.headlinePl"), {
      target: { value: "ok" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.bioPl"), {
      target: { value: "x".repeat(4001) },
    });
    expect(screen.getByText("eventCfp.speaker.profile.validation.bio")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.bioPl"), {
      target: { value: "ok" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.topicsPl"), {
      target: { value: "x".repeat(61) },
    });
    expect(screen.getByText("eventCfp.speaker.profile.validation.topics")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.topicsPl"), {
      target: { value: "a" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.speaker.profile.languages"), {
      target: { value: "polski" },
    });
    expect(screen.getByText("eventCfp.speaker.profile.validation.languages")).toBeInTheDocument();
  });
});

describe("SpeakerPanelPage - wystąpienia", () => {
  it("godzina w strefie wydarzenia, sala, ścieżka, rola i szkic; pusta lista", async () => {
    await renderPanel();
    await screen.findByText("eventCfp.speaker.title");
    openTab("eventCfp.speaker.tabs.sessions");
    const first = screen.getByRole("heading", { name: "Sesja otwarcia" }).closest("li");
    if (first === null) throw new Error("test");
    expect(within(first).getByText("1 października 2026 10:00")).toBeInTheDocument();
    expect(
      within(first).getByText("eventCfp.speaker.sessions.room(room=Sala A)"),
    ).toBeInTheDocument();
    expect(
      within(first).getByText("eventCfp.speaker.sessions.track(track=Energia)"),
    ).toBeInTheDocument();
    expect(within(first).getByText("eventCfp.roles.moderator")).toBeInTheDocument();
    const second = screen.getByRole("heading", { name: "Panel roboczy" }).closest("li");
    if (second === null) throw new Error("test");
    expect(within(second).getByText("eventCfp.speaker.sessions.noTime")).toBeInTheDocument();
    expect(within(second).getByText("eventCfp.speaker.sessions.draft")).toBeInTheDocument();
    expect(within(second).queryByText(/sessions\.room/)).not.toBeInTheDocument();
    cleanup();
    await renderPanel({ panelData: panel({ sessions: [] }) });
    await screen.findByText("eventCfp.speaker.title");
    openTab("eventCfp.speaker.tabs.sessions");
    expect(screen.getByText("eventCfp.speaker.sessions.empty")).toBeInTheDocument();
  });
});

describe("SpeakerPanelPage - materiały", () => {
  it("lista: rodzaj, widoczność, stan publikacji i bezpieczny odnośnik", async () => {
    await renderPanel();
    await screen.findByText("eventCfp.speaker.title");
    openTab("eventCfp.speaker.tabs.materials");
    const row = screen.getByText("Slajdy").closest("li");
    if (row === null) throw new Error("test");
    expect(within(row).getByText("eventCfp.materialKinds.slides")).toBeInTheDocument();
    expect(within(row).getByText("eventCfp.materialVisibility.public")).toBeInTheDocument();
    expect(within(row).getByText("eventCfp.speaker.materials.published")).toBeInTheDocument();
    expect(
      within(row).getByRole("link", { name: "eventCfp.speaker.materials.open" }),
    ).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByText("eventCfp.speaker.materials.pending")).toBeInTheDocument();
  });

  it("nowy materiał: walidacja, ładunek i zamknięcie okna; odmowa bazy", async () => {
    await renderPanel({ panelData: panel({ materials: [] }) });
    await screen.findByText("eventCfp.speaker.title");
    openTab("eventCfp.speaker.tabs.materials");
    expect(screen.getByText("eventCfp.speaker.materials.empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.speaker.materials.add" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "eventCfp.common.save" }));
    expect(
      within(dialog).getByText("eventCfp.speaker.materials.validation.title"),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("eventCfp.speaker.materials.titlePl"), {
      target: { value: "Prezentacja" },
    });
    fireEvent.change(within(dialog).getByLabelText("eventCfp.speaker.materials.titleEn"), {
      target: { value: "Deck" },
    });
    fireEvent.change(within(dialog).getByLabelText("eventCfp.speaker.materials.url *"), {
      target: { value: "ftp://x" },
    });
    expect(
      within(dialog).getByText("eventCfp.speaker.materials.validation.url"),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("eventCfp.speaker.materials.url *"), {
      target: { value: "https://example.org/deck.pdf" },
    });
    const selects = within(dialog).getAllByRole("combobox");
    fireEvent.change(selects[0] as HTMLElement, { target: { value: "document" } });
    fireEvent.change(selects[1] as HTMLElement, { target: { value: "registered" } });
    fireEvent.change(selects[2] as HTMLElement, { target: { value: "ses1" } });
    fireEvent.change(selects[2] as HTMLElement, { target: { value: "__none__" } });
    fireEvent.change(selects[2] as HTMLElement, { target: { value: "ses2" } });
    expect(
      within(selects[2] as HTMLElement)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["eventCfp.speaker.materials.noSession", "Sesja otwarcia", "Panel roboczy"]);

    stub().setError("event_my_speaker_material_upsert", "too_many_materials: 20");
    fireEvent.click(within(dialog).getByRole("button", { name: "eventCfp.common.save" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:too_many_materials: 20"));

    stub().setData("event_my_speaker_material_upsert", "m9");
    fireEvent.click(within(dialog).getByRole("button", { name: "eventCfp.common.save" }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.speaker.materials.saved"),
    );
    expect(payload("event_my_speaker_material_upsert")).toEqual({
      slug: "kongres",
      kind: "document",
      title_pl: "Prezentacja",
      title_en: "Deck",
      url: "https://example.org/deck.pdf",
      visibility: "registered",
      session_id: "ses2",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("edycja zaczyna od materiału; anulowanie; wydarzenie bez wystąpień nie pyta o sesję", async () => {
    await renderPanel({ panelData: panel({ sessions: [] }) });
    await screen.findByText("eventCfp.speaker.title");
    openTab("eventCfp.speaker.tabs.materials");
    const row = screen.getByText("Slajdy").closest("li");
    if (row === null) throw new Error("test");
    fireEvent.click(within(row).getByRole("button", { name: "eventCfp.common.edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("eventCfp.speaker.materials.titlePl")).toHaveValue(
      "Slajdy",
    );
    expect(within(dialog).getAllByRole("combobox")).toHaveLength(2);
    stub().setData("event_my_speaker_material_upsert", "m1");
    fireEvent.click(within(dialog).getByRole("button", { name: "eventCfp.common.save" }));
    await waitFor(() =>
      expect(payload("event_my_speaker_material_upsert")).toMatchObject({
        id: "m1",
        session_id: "ses1",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(within(row).getByRole("button", { name: "eventCfp.common.edit" }));
    const again = await screen.findByRole("dialog");
    fireEvent.click(within(again).getByRole("button", { name: "eventCfp.common.cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("zapis w toku blokuje przycisk", async () => {
    await renderPanel();
    await screen.findByText("eventCfp.speaker.title");
    openTab("eventCfp.speaker.tabs.materials");
    fireEvent.click(
      screen.getAllByRole("button", { name: "eventCfp.common.edit" })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole("dialog");
    stub().setResponse(
      "event_my_speaker_material_upsert",
      () => new Promise(() => undefined) as never,
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "eventCfp.common.save" }));
    expect(
      await within(dialog).findByRole("button", { name: "eventCfp.common.saving" }),
    ).toBeDisabled();
  });

  it("usunięcie materiału: potwierdzenie, wynik i odmowa", async () => {
    await renderPanel();
    await screen.findByText("eventCfp.speaker.title");
    openTab("eventCfp.speaker.tabs.materials");
    h.confirm.mockResolvedValueOnce(false);
    fireEvent.click(
      screen.getAllByRole("button", { name: "eventCfp.common.delete" })[0] as HTMLElement,
    );
    await waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1));
    expect(stub().callsFor("event_my_speaker_material_delete")).toHaveLength(0);
    stub().setData("event_my_speaker_material_delete", true);
    fireEvent.click(
      screen.getAllByRole("button", { name: "eventCfp.common.delete" })[1] as HTMLElement,
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("eventCfp.speaker.materials.deleted"),
    );
    expect(stub().lastCall("event_my_speaker_material_delete")?.arg("p_material_id")).toBe("m2");
    stub().setError("event_my_speaker_material_delete", "not_found: x");
    fireEvent.click(
      screen.getAllByRole("button", { name: "eventCfp.common.delete" })[0] as HTMLElement,
    );
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("odmowa:not_found: x"));
  });
});
