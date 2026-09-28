import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  calls: [] as Array<{ input: unknown; lang: unknown }>,
  language: "pl",
  error: null as Error | null,
}));

vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  return {
    useTranslation: () => ({
      t: translateKey,
      i18n: { language: h.language, exists: () => true, changeLanguage: () => Promise.resolve() },
    }),
    initReactI18next: { type: "3rdParty", init: () => undefined },
  };
});

vi.mock("@/lib/builder/speakersQuery", () => ({
  speakersQueryOptions: (input: unknown, lang: unknown) => {
    h.calls.push({ input, lang });
    return {
      queryKey: ["speakers", JSON.stringify(input), lang],
      queryFn: () => {
        if (h.error !== null) throw h.error;
        return h.rows;
      },
    };
  },
}));

const { EventSpeakersGrid } =
  await import("@/components/events/public/organisms/EventSpeakersGrid");
const { publicEventErrorMessage } = await import("@/lib/events/publicEventErrors");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function speaker(overrides: Partial<PublicSpeakerRow> = {}): PublicSpeakerRow {
  return {
    user_id: "u1",
    slug: "anna-kowalska",
    display_name: "Anna Kowalska",
    avatar_url: null,
    job_title: "Dyrektor",
    company: "NASK",
    headline_pl: "Prezes",
    headline_en: "President",
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: false,
    has_speaker_profile: true,
    sort_order: 0,
    ...overrides,
  };
}

describe("EventSpeakersGrid", () => {
  beforeEach(() => {
    h.rows = [];
    h.calls = [];
    h.language = "pl";
    h.error = null;
  });

  it("pyta o prelegentów właściwego wydarzenia", async () => {
    h.rows = [speaker()];
    render(<EventSpeakersGrid eventId="e1" limit={12} />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(h.calls[0]?.input).toEqual({ source: "event", eventId: "e1", limit: 12 });
  });

  it("pusta lista nie rysuje pustej sekcji", async () => {
    const { container } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("pokazuje pełne wartości stanowiska i instytucji", async () => {
    h.rows = [
      speaker({
        display_name: "Lech Kurkliński",
        headline_pl: "Profesor",
        company: "Szkoła Główna Handlowa w Warszawie",
      }),
    ];
    render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    expect((await screen.findByText("Lech Kurkliński")).textContent).toBe("Lech Kurkliński");
    expect(screen.getByText("Profesor").getAttribute("title")).toBe("Profesor");
    expect(screen.getByText("Szkoła Główna Handlowa w Warszawie").getAttribute("title")).toBe(
      "Szkoła Główna Handlowa w Warszawie",
    );
  });

  it("bez zdjęcia pokazuje inicjały", async () => {
    h.rows = [speaker()];
    const { container } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AK")).toBeTruthy();
  });

  it("klik w interaktywną kartę przekazuje cały wiersz", async () => {
    const row = speaker();
    h.rows = [row];
    const onSelect = vi.fn();
    render(<EventSpeakersGrid eventId="e1" onSelect={onSelect} />, { wrapper });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "eventFront.speakers.card.openProfile(lng=pl,name=Anna Kowalska)",
      }),
    );
    expect(onSelect).toHaveBeenCalledWith(row);
  });

  it("zmienia treść zgodnie z językiem interfejsu", async () => {
    h.language = "en";
    h.rows = [speaker()];
    render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    expect(await screen.findByText("President")).toBeTruthy();
    expect(screen.queryByText("Prezes")).toBeNull();
    expect(h.calls[0]?.lang).toBe("en");
  });

  it("podczas wczytywania zachowuje stabilne miejsce na portrety", () => {
    const { container } = render(<EventSpeakersGrid eventId="e1" enabled={false} />, { wrapper });
    const busy = screen.getByLabelText("eventFront.speakers.loading");
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll('[aria-busy="true"] > div')).toHaveLength(8);
    expect(container.querySelector(".aspect-\[8\/11\]")).not.toBeNull();
  });

  it("błąd danych pokazuje bezpieczny komunikat", async () => {
    h.error = new Error("violates check constraint");
    const { container } = render(<EventSpeakersGrid eventId="e1" />, { wrapper });
    expect(await screen.findByText(publicEventErrorMessage(h.error))).toBeTruthy();
    expect(container.textContent).not.toContain("violates check constraint");
  });
});