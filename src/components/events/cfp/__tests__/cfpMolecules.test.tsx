// Drobne klocki naboru po stronie uczestnika: plakietka stanu, odpowiedź,
// odliczanie, pola formularza, współprelegenci, pozycja w pasku zakładek
// i odnośniki w panelu „Moje".
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - pilnowane niżej:
// Najważniejsze zobowiązania: (1) odliczanie i zakładka NIE rysują niczego
// przed montażem (SSR = pierwszy render), (2) zakładka jest tylko przy
// otwartym naborze (faza z bazy), (3) odnośniki paneli widzi tylko osoba z rolą.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { freezeClock } from "@/test/time";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({ rpc: null as SupabaseRpcStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: brak atrapy RPC");
      return h.rpc.rpc(name, args);
    },
  },
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-event-cfp", () => ({ ensureEventCfpI18n: () => undefined }));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/events/cfpStubs")).routerLinkWithSearchStub(await import("react")),
}));

const { CfpStatusBadge } = await import("@/components/events/cfp/atoms/CfpStatusBadge");
const { CFP_STATUS_VARIANT } = await import("@/lib/events/cfpRows");
const { CfpAnswerValue } = await import("@/components/events/cfp/atoms/CfpAnswerValue");
const { CfpCountdown } = await import("@/components/events/cfp/molecules/CfpCountdown");
const { CfpSelectField, CfpTextField } =
  await import("@/components/events/cfp/molecules/CfpFormFields");
const { CfpCoSpeakersEditor } =
  await import("@/components/events/cfp/molecules/CfpCoSpeakersEditor");
const { EventCfpTabItem } = await import("@/components/events/cfp/molecules/EventCfpTabItem");
const { EventMeCfpLinks } = await import("@/components/events/cfp/molecules/EventMeCfpLinks");

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

const FIELD = {
  id: "f",
  key: "k",
  fieldType: "text" as const,
  labelPl: "P",
  labelEn: "E",
  helpPl: "",
  helpEn: "",
  isRequired: false,
  isActive: true,
  options: [],
};

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});
afterEach(cleanup);

describe("CfpStatusBadge", () => {
  it("etykieta stanu i tonacja z tokenów", () => {
    render(<CfpStatusBadge status="rejected" />);
    const badge = screen.getByText("eventCfp.statuses.rejected");
    expect(badge).toHaveAttribute("data-status", "rejected");
    expect(CFP_STATUS_VARIANT.accepted).toBe("default");
    expect(CFP_STATUS_VARIANT.rejected).toBe("destructive");
  });
});

describe("CfpAnswerValue", () => {
  it.each([
    [{ ...FIELD, fieldType: "checkbox" as const }, true, "eventCfp.answers.yes"],
    [{ ...FIELD, fieldType: "checkbox" as const }, false, "eventCfp.answers.no"],
    [FIELD, "", "eventCfp.answers.empty"],
    [FIELD, "Tekst odpowiedzi", "Tekst odpowiedzi"],
    [
      {
        ...FIELD,
        fieldType: "multiselect" as const,
        options: [{ value: "a", labelPl: "Opcja A", labelEn: "A" }],
      },
      ["a", "b"],
      "Opcja A, b",
    ],
  ])("%#", (field, value, text) => {
    render(<CfpAnswerValue field={field} value={value} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("adres https jest odnośnikiem w nowej karcie", () => {
    render(<CfpAnswerValue field={{ ...FIELD, fieldType: "url" }} value="https://example.org/x" />);
    const link = screen.getByRole("link", { name: "https://example.org/x" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });
});

describe("CfpCountdown", () => {
  freezeClock("2026-09-01T10:00:00.000Z");

  it("dni, godziny i minuty do celu - dopiero po montażu", () => {
    render(<CfpCountdown target="2026-09-03T13:05:00Z" mode="toClose" />);
    expect(
      screen.getByText(
        "eventCfp.page.countdown.toClose(value=eventCfp.page.countdown.value(days=2,hours=3,minutes=5))",
      ),
    ).toBeInTheDocument();
  });

  it("do otwarcia; cel w przeszłości albo brak celu = nic", () => {
    const { container, rerender } = render(
      <CfpCountdown target="2026-09-01T11:00:00Z" mode="toOpen" />,
    );
    expect(screen.getByText(/^eventCfp\.page\.countdown\.toOpen/)).toBeInTheDocument();
    rerender(<CfpCountdown target="2026-08-01T00:00:00Z" mode="toOpen" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CfpCountdown target={null} mode="toOpen" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<CfpCountdown target="nie-data" mode="toOpen" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CfpTextField / CfpSelectField", () => {
  it("etykieta, gwiazdka wymagania, podpowiedź i błąd powiązane z polem", () => {
    const onChange = vi.fn();
    render(
      <>
        <CfpTextField
          label="Imię"
          value=""
          required
          hint="Podpowiedź"
          error="Błąd"
          onChange={onChange}
        />
        <CfpTextField label="Opis" value="x" rows={3} onChange={onChange} />
        <CfpTextField label="Tylko odczyt" value="a@b.pl" readOnly />
      </>,
    );
    const input = screen.getByLabelText("Imię *");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
    fireEvent.change(input, { target: { value: "Anna" } });
    expect(onChange).toHaveBeenCalledWith("Anna");
    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "y" } });
    expect(onChange).toHaveBeenLastCalledWith("y");
    expect(screen.getByLabelText("Tylko odczyt")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Tylko odczyt")).not.toHaveAttribute("aria-describedby");
    // Pole tylko do odczytu bez `onChange` nie wywraca się przy zmianie.
    fireEvent.change(screen.getByLabelText("Tylko odczyt"), { target: { value: "z" } });
  });

  it("droplista przepuszcza wyłącznie wartości z listy", () => {
    const onChange = vi.fn();
    render(
      <CfpSelectField<"a" | "b">
        label="Wybór"
        value=""
        required
        error="Wybierz"
        options={["a", "b"]}
        labelFor={(option) => option.toUpperCase()}
        onChange={onChange}
      />,
    );
    const select = screen.getByRole("combobox");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["A", "B"]);
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
    // Wartość spoza listy (droplista nie ma takiej opcji) nie dojeżdża do stanu.
    fireEvent.change(select, { target: { value: "zzz" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Wybierz");
  });
});

describe("CfpCoSpeakersEditor", () => {
  it("dodaje, edytuje i usuwa współprelegentów; limit pięciu osób", () => {
    const onChange = vi.fn();
    const speaker = {
      firstName: "Jan",
      lastName: "K",
      email: "",
      jobTitle: "",
      companyText: "",
      role: "speaker" as const,
    };
    const { rerender } = render(
      <CfpCoSpeakersEditor speakers={[speaker]} onChange={onChange} error="Błąd" />,
    );
    expect(screen.getByText("eventCfp.submit.coSpeaker.legend(index=1)")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Błąd");
    fireEvent.change(screen.getByLabelText("eventCfp.submit.coSpeaker.firstName *"), {
      target: { value: "Janek" },
    });
    expect(onChange).toHaveBeenLastCalledWith([{ ...speaker, firstName: "Janek" }]);
    fireEvent.change(screen.getByLabelText("eventCfp.submit.coSpeaker.lastName *"), {
      target: { value: "L" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.coSpeaker.email"), {
      target: { value: "j@x.pl" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.coSpeaker.jobTitle"), {
      target: { value: "CTO" },
    });
    fireEvent.change(screen.getByLabelText("eventCfp.submit.coSpeaker.company"), {
      target: { value: "NES" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "moderator" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...speaker, role: "moderator" }]);
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.coSpeaker.remove" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole("button", { name: "eventCfp.submit.coSpeaker.add" }));
    expect(onChange.mock.lastCall?.[0]).toHaveLength(2);

    // Edycja drugiej osoby nie rusza pierwszej.
    const other = { ...speaker, firstName: "Ola" };
    rerender(<CfpCoSpeakersEditor speakers={[speaker, other]} onChange={onChange} error={null} />);
    fireEvent.change(
      screen.getAllByLabelText("eventCfp.submit.coSpeaker.lastName *")[1] as HTMLElement,
      {
        target: { value: "Z" },
      },
    );
    expect(onChange).toHaveBeenLastCalledWith([speaker, { ...other, lastName: "Z" }]);

    rerender(
      <CfpCoSpeakersEditor
        speakers={Array.from({ length: 5 }, () => speaker)}
        onChange={onChange}
        error={null}
      />,
    );
    expect(screen.getByRole("button", { name: "eventCfp.submit.coSpeaker.add" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("EventCfpTabItem", () => {
  const props = {
    slug: "kongres",
    className: "tab",
    activeClassName: "on",
    inactiveClassName: "off",
  };

  it("pozycja przy otwartym naborze prowadzi na stronę naboru", async () => {
    stub().setData("event_cfp_public", { phase: "open", is_open: true });
    renderWithQueryClient(
      <ul>
        <EventCfpTabItem {...props} />
      </ul>,
    );
    const link = await screen.findByRole("link", { name: "eventCfp.tab" });
    expect(link).toHaveAttribute("href", "/events/kongres/cfp");
    expect(stub().lastCall("event_cfp_public")?.arg("p_slug")).toBe("kongres");
  });

  it("zamknięty, zaplanowany albo nieistniejący nabór = brak pozycji", async () => {
    for (const data of [{ phase: "closed" }, { phase: "scheduled" }, null]) {
      stub().setData("event_cfp_public", data);
      const { container } = renderWithQueryClient(
        <ul>
          <EventCfpTabItem {...props} />
        </ul>,
      );
      await waitFor(() => expect(stub().callsFor("event_cfp_public").length).toBeGreaterThan(0));
      expect(container.querySelector("a")).toBeNull();
      cleanup();
      stub().reset();
    }
  });
});

describe("EventMeCfpLinks", () => {
  function panel(overrides: Record<string, unknown>) {
    return {
      event_id: "e1",
      event_slug: "kongres",
      timezone: "Europe/Warsaw",
      is_reviewer: false,
      submissions_count: 0,
      profile: null,
      sessions: [],
      materials: [],
      ...overrides,
    };
  }

  it("prelegent i recenzent dostają oba odnośniki", async () => {
    stub().setData("event_my_speaker_panel", panel({ is_reviewer: true, submissions_count: 1 }));
    renderWithQueryClient(<EventMeCfpLinks slug="kongres" signedIn />);
    expect(await screen.findByRole("link", { name: "eventCfp.me.speakerPanel" })).toHaveAttribute(
      "href",
      "/events/kongres/speaker",
    );
    expect(screen.getByRole("link", { name: "eventCfp.me.reviewerPanel" })).toHaveAttribute(
      "href",
      "/events/kongres/review",
    );
  });

  it("prelegent z rejestru (profil albo wystąpienie) bez zgłoszeń", async () => {
    stub().setData("event_my_speaker_panel", panel({ sessions: [{ session_id: "s" }] }));
    renderWithQueryClient(<EventMeCfpLinks slug="kongres" signedIn />);
    expect(
      await screen.findByRole("link", { name: "eventCfp.me.speakerPanel" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "eventCfp.me.reviewerPanel" }),
    ).not.toBeInTheDocument();
    cleanup();
    stub().setData(
      "event_my_speaker_panel",
      panel({ profile: { speaker_profile_id: "sp" }, is_reviewer: true }),
    );
    renderWithQueryClient(<EventMeCfpLinks slug="kongres" signedIn />);
    expect(
      await screen.findByRole("link", { name: "eventCfp.me.reviewerPanel" }),
    ).toBeInTheDocument();
  });

  it("sam recenzent (bez zgłoszeń i wpisu) dostaje tylko panel recenzenta", async () => {
    stub().setData("event_my_speaker_panel", panel({ is_reviewer: true }));
    renderWithQueryClient(<EventMeCfpLinks slug="kongres" signedIn />);
    expect(
      await screen.findByRole("link", { name: "eventCfp.me.reviewerPanel" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "eventCfp.me.speakerPanel" }),
    ).not.toBeInTheDocument();
  });

  it("uczestnik bez ról, gość i brak wydarzenia - nic", async () => {
    stub().setData("event_my_speaker_panel", panel({}));
    const first = renderWithQueryClient(<EventMeCfpLinks slug="kongres" signedIn />);
    await waitFor(() =>
      expect(first.queryClient.getQueryState(["event-cfp-me", "kongres", "panel"])?.status).toBe(
        "success",
      ),
    );
    expect(first.container.querySelector("a")).toBeNull();
    cleanup();
    const guest = renderWithQueryClient(<EventMeCfpLinks slug="kongres" signedIn={false} />);
    expect(guest.container).toBeEmptyDOMElement();
    expect(stub().callsFor("event_my_speaker_panel")).toHaveLength(1);
  });
});
