// Panel "jesteś już zapisany" - to jedyne miejsce, w którym zalogowany
// użytkownik widzi, CZY i OD KIEDY jego adres jest na liście, oraz jedyne,
// z którego może dołożyć kolejne tematy.
//
// Testy pilnują konsekwencji, nie mechaniki: wpis potwierdzony nie może
// wyglądać jak wpis czekający na potwierdzenie (inaczej ktoś drugi raz
// przechodzi zapis), pusty wybór nie może wysłać zapisu (żądanie bez treści),
// a nieudany zapis nie może udawać udanego (użytkownik traci wybór tematów
// i nie wie, że lista się nie zmieniła).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { InterestItem } from "@/hooks/useInterests";
import type { MyNewsletterStatus } from "@/lib/newsletter-status.functions";

type TopicsResult = { ok: boolean; error?: string };
type MutateOptions = {
  onSuccess?: (res: TopicsResult) => void;
  onError?: (err: unknown) => void;
};

const h = vi.hoisted(() => ({
  items: [] as Array<{ id: string; type: "tag"; label: string; slug: string }>,
  mutate:
    vi.fn<(input: { topics: string[]; mailingLists: string[] }, opts: MutateOptions) => void>(),
  pending: false,
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({
  toast: { success: h.toastSuccess, error: h.toastError },
}));

vi.mock("@/hooks/useMyNewsletterStatus", () => ({
  useUpdateMyNewsletterTopics: () => ({ mutate: h.mutate, isPending: h.pending }),
}));

// Droplista tematów ma własne testy - tutaj zastępujemy ją najprostszą
// kontrolką, która wywołuje DOKŁADNIE te same wywołania zwrotne co oryginał.
// Dzięki temu test mierzy decyzje panelu, a nie portal z zakładkami.
vi.mock("@/components/interests/TopicsDroplist", () => ({
  useInterestGroups: () => ({ allItems: h.items, groups: [] }),
  TopicsDroplist: ({
    allItems,
    picked,
    onToggle,
    onClear,
  }: {
    allItems: InterestItem[];
    picked: Set<string>;
    onToggle: (id: string) => void;
    onClear: () => void;
  }) => (
    <div data-testid="topics-droplist" data-picked={[...picked].join(",")}>
      {allItems.map((item) => (
        <button key={item.id} type="button" onClick={() => onToggle(item.id)}>
          {item.label}
        </button>
      ))}
      <button type="button" onClick={() => onToggle("temat-spoza-katalogu")}>
        widmo
      </button>
      <button type="button" onClick={onClear}>
        wyczyść
      </button>
    </div>
  ),
}));

import { NewsletterSubscribedPanel } from "@/components/newsletter/NewsletterSubscribedPanel";

function status(over: Partial<MyNewsletterStatus> = {}): MyNewsletterStatus {
  return {
    subscribed: true,
    status: "subscribed",
    email: "jan@firma.pl",
    listName: "Newsletter tygodniowy",
    mailingLists: [],
    topics: [],
    since: null,
    ...over,
  };
}

const CATALOG: Array<{ id: string; type: "tag"; label: string; slug: string }> = [
  { id: "t1", type: "tag", label: "Energetyka", slug: "energetyka" },
  { id: "t2", type: "tag", label: "Klimat", slug: "klimat" },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
  h.items = [...CATALOG];
  h.pending = false;
  h.mutate.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// `@testing-library/user-event` nie jest zależnością tego repozytorium, więc
// interakcje jadą przez `fireEvent` - te same zdarzenia DOM, które wywołuje
// klikający człowiek, tylko bez warstwy symulacji wskaźnika.
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

describe("NewsletterSubscribedPanel: co użytkownik wie o swojej subskrypcji", () => {
  it("wpis potwierdzony nie wygląda jak wpis czekający na potwierdzenie", () => {
    render(<NewsletterSubscribedPanel status={status()} lang="pl" />);

    expect(screen.getByText("newsletterStatus.title")).toBeInTheDocument();
    expect(screen.getByText("newsletterStatus.hint")).toBeInTheDocument();
    expect(screen.queryByText("newsletterStatus.pendingTitle")).toBeNull();
    expect(screen.queryByText("newsletterStatus.pendingHint")).toBeNull();
  });

  it("wpis czekający na potwierdzenie mówi to wprost, więc nikt nie czeka na wydanie na próżno", () => {
    render(<NewsletterSubscribedPanel status={status({ status: "pending" })} lang="pl" />);

    expect(screen.getByText("newsletterStatus.pendingTitle")).toBeInTheDocument();
    expect(screen.getByText("newsletterStatus.pendingHint")).toBeInTheDocument();
    expect(screen.queryByText("newsletterStatus.title")).toBeNull();
  });

  it("nazwa listy pochodzi z danych, a jej brak nie zostawia pustego miejsca", () => {
    const { rerender } = render(<NewsletterSubscribedPanel status={status()} lang="pl" />);
    expect(screen.getByText("Newsletter tygodniowy")).toBeInTheDocument();

    rerender(<NewsletterSubscribedPanel status={status({ listName: null })} lang="pl" />);
    expect(screen.getByText("newsletterStatus.listFallback")).toBeInTheDocument();
  });

  it("adres bez wartości nie renderuje pustego wiersza z etykietą", () => {
    const { rerender } = render(<NewsletterSubscribedPanel status={status()} lang="pl" />);
    expect(screen.getByText("newsletterStatus.emailLabel")).toBeInTheDocument();
    expect(screen.getByText("jan@firma.pl")).toBeInTheDocument();

    rerender(<NewsletterSubscribedPanel status={status({ email: null })} lang="pl" />);
    expect(screen.queryByText("newsletterStatus.emailLabel")).toBeNull();
  });

  it("data zapisu jest czytana w języku interfejsu, a nie w formacie bazy", () => {
    const { rerender } = render(
      <NewsletterSubscribedPanel
        status={status({ since: "2026-03-08T09:15:00.000Z" })}
        lang="pl"
      />,
    );
    expect(screen.getByText("newsletterStatus.sinceLabel")).toBeInTheDocument();
    expect(screen.getByText("08 marca 2026")).toBeInTheDocument();

    rerender(
      <NewsletterSubscribedPanel
        status={status({ since: "2026-03-08T09:15:00.000Z" })}
        lang="en"
      />,
    );
    expect(screen.getByText("08 March 2026")).toBeInTheDocument();
  });

  it("uszkodzona data z bazy znika z panelu zamiast pokazać `Invalid Date`", () => {
    render(<NewsletterSubscribedPanel status={status({ since: "nie-data" })} lang="pl" />);
    expect(screen.queryByText("newsletterStatus.sinceLabel")).toBeNull();
    expect(screen.queryByText(/Invalid/i)).toBeNull();
  });

  it("brak daty zapisu nie dokłada wiersza", () => {
    render(<NewsletterSubscribedPanel status={status({ since: null })} lang="pl" />);
    expect(screen.queryByText("newsletterStatus.sinceLabel")).toBeNull();
  });

  it("dodatkowe listy wysyłkowe są wymienione, a ich brak nie zostawia etykiety", () => {
    const { rerender } = render(
      <NewsletterSubscribedPanel
        status={status({ mailingLists: ["Wydarzenia", "Raporty"] })}
        lang="pl"
      />,
    );
    expect(screen.getByText("newsletterStatus.listsLabel")).toBeInTheDocument();
    expect(screen.getByText("Wydarzenia, Raporty")).toBeInTheDocument();

    rerender(<NewsletterSubscribedPanel status={status({ mailingLists: [] })} lang="pl" />);
    expect(screen.queryByText("newsletterStatus.listsLabel")).toBeNull();
  });

  it("tematy zapisane wcześniej są widoczne, a puste wpisy z bazy nie robią pustych pigułek", () => {
    render(
      <NewsletterSubscribedPanel
        status={status({ topics: ["  Energetyka  ", "   ", "", "Klimat"] })}
        lang="pl"
      />,
    );
    const chips = screen.getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Energetyka", "Klimat"]);
  });

  it("brak tematów nie renderuje pustej listy", () => {
    render(<NewsletterSubscribedPanel status={status({ topics: [] })} lang="pl" />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("klasa z zewnątrz dokłada się do panelu, zamiast go nadpisywać", () => {
    render(<NewsletterSubscribedPanel status={status()} lang="pl" className="mt-10" />);
    const panel = screen.getByTestId("newsletter-subscribed-panel");
    expect(panel).toHaveClass("mt-10");
    expect(panel).toHaveClass("grid");
  });
});

describe("NewsletterSubscribedPanel: dokładanie tematów", () => {
  it("bez wyboru tematu przycisk jest zablokowany - pusty zapis nigdy nie leci na serwer", () => {
    render(<NewsletterSubscribedPanel status={status()} lang="pl" />);
    const save = screen.getByRole("button", { name: "newsletterStatus.saveTopics" });

    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("wybór i ponowne kliknięcie tego samego tematu odznacza go, więc nie da się wysłać duplikatu", () => {
    render(<NewsletterSubscribedPanel status={status()} lang="pl" />);

    click("Energetyka");
    expect(screen.getByTestId("topics-droplist")).toHaveAttribute("data-picked", "t1");

    click("Energetyka");
    expect(screen.getByTestId("topics-droplist")).toHaveAttribute("data-picked", "");
    expect(screen.getByRole("button", { name: "newsletterStatus.saveTopics" })).toBeDisabled();
  });

  it("wyczyszczenie wyboru blokuje zapis, zamiast wysłać poprzedni stan", () => {
    render(<NewsletterSubscribedPanel status={status()} lang="pl" />);

    click("Energetyka");
    click("Klimat");
    expect(screen.getByRole("button", { name: "newsletterStatus.saveTopics" })).toBeEnabled();

    click("wyczyść");
    expect(screen.getByTestId("topics-droplist")).toHaveAttribute("data-picked", "");
    expect(screen.getByRole("button", { name: "newsletterStatus.saveTopics" })).toBeDisabled();
  });

  it("na serwer idą ETYKIETY tematów, nie ich identyfikatory - w bazie zapis ma być czytelny", () => {
    render(<NewsletterSubscribedPanel status={status()} lang="pl" />);

    click("Energetyka");
    click("Klimat");
    click("newsletterStatus.saveTopics");

    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0][0]).toEqual({
      topics: ["Energetyka", "Klimat"],
      mailingLists: [],
    });
  });

  it("wybór, którego nie ma w katalogu, nie wysyła pustego zapisu", () => {
    render(<NewsletterSubscribedPanel status={status()} lang="pl" />);

    click("widmo");
    expect(screen.getByRole("button", { name: "newsletterStatus.saveTopics" })).toBeEnabled();

    click("newsletterStatus.saveTopics");
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("udany zapis potwierdza się komunikatem i zwalnia wybór do kolejnej rundy", () => {
    h.mutate.mockImplementation((_input, opts) => opts.onSuccess?.({ ok: true }));
    render(<NewsletterSubscribedPanel status={status()} lang="pl" />);

    click("Energetyka");
    click("newsletterStatus.saveTopics");

    expect(h.toastSuccess).toHaveBeenCalledWith("newsletterStatus.topicsSaved");
    expect(h.toastError).not.toHaveBeenCalled();
    expect(screen.getByTestId("topics-droplist")).toHaveAttribute("data-picked", "");
  });

  it("odmowa serwera NIE udaje sukcesu i zostawia wybór, żeby dało się spróbować ponownie", () => {
    h.mutate.mockImplementation((_input, opts) =>
      opts.onSuccess?.({ ok: false, error: "not_subscribed" }),
    );
    render(<NewsletterSubscribedPanel status={status()} lang="pl" />);

    click("Energetyka");
    click("newsletterStatus.saveTopics");

    expect(h.toastError).toHaveBeenCalledWith("newsletterStatus.topicsFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId("topics-droplist")).toHaveAttribute("data-picked", "t1");
  });

  it("błąd sieci kończy się tym samym komunikatem porażki, a nie ciszą", () => {
    h.mutate.mockImplementation((_input, opts) => opts.onError?.(new Error("Failed to fetch")));
    render(<NewsletterSubscribedPanel status={status()} lang="pl" />);

    click("Energetyka");
    click("newsletterStatus.saveTopics");

    expect(h.toastError).toHaveBeenCalledWith("newsletterStatus.topicsFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("w trakcie zapisu przycisk jest zablokowany, więc jeden wybór nie leci dwa razy", () => {
    h.pending = true;
    render(<NewsletterSubscribedPanel status={status()} lang="pl" />);

    const save = screen.getByRole("button", { name: "…" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-busy", "true");
  });
});
