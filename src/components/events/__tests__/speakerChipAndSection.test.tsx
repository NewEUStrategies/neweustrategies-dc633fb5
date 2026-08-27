// Chip prelegenta i sekcja „Prelegenci" na stronie wydarzenia.
//
// SpeakerChip ma jedną regułę, która decyduje o dostępności całej agendy:
// ten sam wygląd występuje w TRZECH semantykach - jako przycisk (otwiera
// profil), jako link (prowadzi na stronę) i jako martwy wpis. Pomylenie ich
// daje albo przycisk, którego klawiatura nie osiąga, albo link prowadzący
// donikąd. Stąd asercje na ROLE, nie na klasy CSS.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n-event-front";
import { realT } from "@/test/i18nReal";
import { sectionHeadingKey } from "@/lib/events/eventSections";
import { SpeakerChip } from "@/components/events/SpeakerChip";

const h = vi.hoisted(() => ({
  speakers: [] as Array<Record<string, unknown>>,
  optionsCalls: [] as Array<{ input: unknown; lang: unknown }>,
}));

vi.mock("@/lib/builder/speakersQuery", () => ({
  speakersQueryOptions: (input: unknown, lang: unknown) => {
    h.optionsCalls.push({ input, lang });
    return { queryKey: ["speakers", JSON.stringify(input), lang], queryFn: () => h.speakers };
  },
}));

vi.mock("@/components/events/SpeakerProfileDialog", () => ({
  // Atrapa wystawia przycisk zamknięcia, żeby test mógł przejść PEŁNĄ ścieżkę
  // `onOpenChange(false)` -> wyczyszczenie stanu sekcji, a nie tylko sprawdzić,
  // że dialog się pojawił.
  SpeakerProfileDialog: ({
    userId,
    onOpenChange,
  }: {
    userId: string;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div data-testid="dialog-prelegenta">
      {userId}
      <button type="button" onClick={() => onOpenChange(false)}>
        Zamknij profil
      </button>
    </div>
  ),
}));

const { EventSpeakersSection } = await import("@/components/events/EventSpeakersSection");

const t = realT("pl");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function speaker(overrides: Record<string, unknown> = {}) {
  return {
    user_id: "u1",
    display_name: "Anna Kowalska",
    avatar_url: null,
    headline_pl: "Analityczka",
    headline_en: "Analyst",
    job_title: "Ekspertka",
    is_expert: false,
    ...overrides,
  };
}

beforeEach(() => {
  h.speakers = [];
  h.optionsCalls = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SpeakerChip - semantyka", () => {
  it("z `onClick` jest PRZYCISKIEM osiągalnym z klawiatury", () => {
    const onClick = vi.fn();
    render(<SpeakerChip name="Anna Kowalska" onClick={onClick} />);
    const button = screen.getByRole("button", { name: /Anna Kowalska/ });
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("z samym `href` jest LINKIEM", () => {
    render(<SpeakerChip name="Anna Kowalska" href="/author/anna" />);
    expect(screen.getByRole("link", { name: /Anna Kowalska/ })).toHaveAttribute(
      "href",
      "/author/anna",
    );
  });

  it("`onClick` WYGRYWA z `href` - jedno zachowanie, nie dwa naraz", () => {
    // Element, który jest jednocześnie przyciskiem i linkiem, zachowuje się
    // różnie pod myszą i pod klawiaturą. Pierwszeństwo musi być rozstrzygnięte.
    render(<SpeakerChip name="Anna Kowalska" href="/author/anna" onClick={vi.fn()} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("bez akcji jest martwym wpisem - nie udaje elementu interaktywnego", () => {
    // Chip w agendzie bez profilu nie może wyglądać na klikalny; czytnik
    // ekranu nie ma ogłaszać przycisku, który nic nie robi.
    render(<SpeakerChip name="Anna Kowalska" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Anna Kowalska")).toBeInTheDocument();
  });

  it("pokazuje rolę pod nazwiskiem, gdy jest", () => {
    render(<SpeakerChip name="Anna Kowalska" role="Analityczka" />);
    expect(screen.getByText("Analityczka")).toBeInTheDocument();
  });

  it("bez roli nie zostawia pustego wiersza", () => {
    const { container } = render(<SpeakerChip name="Anna Kowalska" />);
    expect(container.querySelectorAll("span.block")).toHaveLength(1);
  });

  it("renderuje dodatkową treść po prawej", () => {
    render(<SpeakerChip name="Anna" trailing={<span data-testid="odznaka" />} />);
    expect(screen.getByTestId("odznaka")).toBeInTheDocument();
  });
});

describe("EventSpeakersSection", () => {
  it("bez prelegentów sekcja ZNIKA, zamiast pokazywać pusty nagłówek", async () => {
    const { container } = render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  it("pokazuje nagłówek i listę prelegentów", async () => {
    h.speakers = [speaker(), speaker({ user_id: "u2", display_name: "Bogdan Nowak" })];
    render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    // Nagłówek idzie z klucza SEKCJI - tego samego, którego trasa używa nad
    // kartą zamka. Dwa słowniki na jeden <h2> pozwalały zmienić nazwę sekcji
    // wyłącznie dla gości bez dostępu.
    expect(await screen.findByText(t(sectionHeadingKey("speakers")))).toBeInTheDocument();
    expect(screen.getByText("Anna Kowalska")).toBeInTheDocument();
    expect(screen.getByText("Bogdan Nowak")).toBeInTheDocument();
  });

  it("rola prelegenta schodzi po języku, a na końcu na stanowisko", async () => {
    // Łańcuch: nagłówek w języku strony -> nagłówek polski -> angielski ->
    // stanowisko. Pusty podpis pod nazwiskiem wygląda jak brakujące dane.
    h.speakers = [
      speaker({ user_id: "u1", headline_pl: "", headline_en: "Analyst" }),
      speaker({ user_id: "u2", display_name: "Bogdan", headline_pl: "", headline_en: "" }),
    ];
    render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    expect(await screen.findByText("Analyst")).toBeInTheDocument();
    expect(screen.getByText("Ekspertka")).toBeInTheDocument();
  });

  it("wersja angielska bierze nagłówek angielski", async () => {
    h.speakers = [speaker()];
    render(<EventSpeakersSection eventId="e1" lang="en" />, { wrapper });
    expect(await screen.findByText("Analyst")).toBeInTheDocument();
  });

  it("ekspert dostaje odznakę, zwykły prelegent nie", async () => {
    h.speakers = [speaker({ is_expert: true })];
    const { container } = render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("kliknięcie w prelegenta otwiera jego profil", async () => {
    h.speakers = [speaker()];
    render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: /Anna Kowalska/ }));
    expect(screen.getByTestId("dialog-prelegenta")).toHaveTextContent("u1");
  });

  it("zamknięcie profilu USUWA dialog i pozwala otworzyć go ponownie", async () => {
    // Bez wyczyszczenia stanu drugi klik w tego samego prelegenta nic by nie
    // zrobił - dialog jest renderowany warunkowo z tej samej wartości.
    h.speakers = [speaker()];
    render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: /Anna Kowalska/ }));
    expect(screen.getByTestId("dialog-prelegenta")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zamknij profil" }));
    expect(screen.queryByTestId("dialog-prelegenta")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Anna Kowalska/ }));
    expect(screen.getByTestId("dialog-prelegenta")).toBeInTheDocument();
  });

  it("pyta o prelegentów WŁAŚNIE tego wydarzenia", async () => {
    h.speakers = [speaker()];
    render(<EventSpeakersSection eventId="wydarzenie-42" lang="pl" />, { wrapper });
    await screen.findByText("Anna Kowalska");
    expect(h.optionsCalls[0]).toMatchObject({
      input: { source: "event", eventId: "wydarzenie-42", limit: 50 },
      lang: "pl",
    });
  });

  it("prelegent bez nazwiska nie wywraca listy", async () => {
    h.speakers = [speaker({ display_name: null })];
    render(<EventSpeakersSection eventId="e1" lang="pl" />, { wrapper });
    expect(await screen.findByText(t(sectionHeadingKey("speakers")))).toBeInTheDocument();
  });
});
