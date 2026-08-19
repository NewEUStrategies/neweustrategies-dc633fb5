// Dialog profilu prelegenta.
//
// 278 linii, zero wykonanych. Ten dialog spina trzy niezależne źródła (profil
// sceniczny, profil eksperta, lista wystąpień) i wisi na agendzie wydarzenia,
// gdzie prelegentów bywa kilkudziesięciu. Stąd dwie reguły, które są tu pod
// bramką, bo obie łamie się bez śladu w typach:
//
//   1. DIALOG NIGDY NIE JEST PUSTY. Widget niesie własne dane awaryjne (imię,
//      rola, zdjęcie z treści). Gdy profilu w bazie nie ma - albo jeszcze nie
//      doszedł - użytkownik ma zobaczyć to, co widział na kafelku, a nie białe
//      okno.
//   2. ZAPYTANIA ŚPIĄ, DOPÓKI DIALOG JEST ZAMKNIĘTY. Agenda montuje dialog dla
//      KAŻDEGO prelegenta; bez `enabled` wejście na stronę wydarzenia z 30
//      prelegentami odpaliłoby 60 zapytań naraz.
//
// Trzecia rzecz: dwujęzyczność z fallbackiem SYMETRYCZNYM. Prelegent, który
// wypełnił tylko wersję angielską, ma być czytelny na polskiej stronie - i
// odwrotnie. Dotyczy to również tematów, gdzie fallback łatwo pominąć, bo to
// tablica, a nie napis.
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSpeakerRow, SpeakerEngagement } from "@/lib/builder/speakersQuery";

const h = vi.hoisted(() => ({
  profile: null as PublicSpeakerRow | null,
  engagements: [] as SpeakerEngagement[],
  profileOptions: [] as unknown[],
  engagementOptions: [] as unknown[],
  /** Zapytania, które NAPRAWDĘ poszły do sieci (queryFn wywołany). */
  fetched: [] as string[],
  loading: false,
}));

vi.mock("@/lib/builder/speakersQuery", () => ({
  speakerProfileQueryOptions: (userId: string) => {
    h.profileOptions.push(userId);
    return {
      queryKey: ["speaker-profile", userId],
      queryFn: () => {
        h.fetched.push(`profile:${userId}`);
        return h.loading ? new Promise(() => {}) : h.profile;
      },
    };
  },
  speakerEngagementsQueryOptions: (userId: string) => {
    h.engagementOptions.push(userId);
    return {
      queryKey: ["speaker-engagements", userId],
      queryFn: () => {
        h.fetched.push(`engagements:${userId}`);
        return h.engagements;
      },
    };
  },
}));

const { SpeakerProfileDialog } = await import("@/components/events/SpeakerProfileDialog");

const USER = "11111111-1111-4111-8111-111111111111";

function profileRow(overrides: Partial<PublicSpeakerRow> = {}): PublicSpeakerRow {
  return {
    user_id: USER,
    slug: null,
    display_name: "Anna Kowalska",
    avatar_url: null,
    job_title: null,
    company: null,
    headline_pl: null,
    headline_en: null,
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

function engagement(overrides: Partial<SpeakerEngagement> = {}): SpeakerEngagement {
  return {
    id: "e1",
    slug: "szczyt-energetyczny",
    title_pl: "Szczyt energetyczny",
    title_en: "Energy summit",
    starts_at: "2030-05-01T09:00:00Z",
    kind: "conference",
    location: null,
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function dialog(
  opts: {
    profile?: PublicSpeakerRow | null;
    engagements?: SpeakerEngagement[];
    lang?: "pl" | "en";
    open?: boolean;
    fallback?: { name?: string; role?: string; photo?: string };
    loading?: boolean;
  } = {},
) {
  h.profile = opts.profile ?? null;
  h.engagements = opts.engagements ?? [];
  h.loading = opts.loading ?? false;
  const view = render(
    <Wrapper>
      <SpeakerProfileDialog
        userId={USER}
        lang={opts.lang ?? "pl"}
        open={opts.open ?? true}
        onOpenChange={() => {}}
        fallback={opts.fallback}
      />
    </Wrapper>,
  );
  if (opts.open !== false) {
    await screen.findByRole("dialog");
    // Zapytanie rozwiązuje się mikrozadaniem, więc pierwsza klatka to zawsze
    // szkielet - czekamy, aż zniknie, inaczej każda asercja mierzyłaby atrapę.
    if (!opts.loading) {
      await waitFor(() =>
        expect(screen.getByRole("dialog").querySelector(".animate-pulse")).toBeNull(),
      );
    }
  }
  return view;
}

/** Treść okna - Radix renderuje je w portalu poza kontenerem testu. */
function panel() {
  return screen.getByRole("dialog");
}

beforeEach(() => {
  h.profile = null;
  h.engagements = [];
  h.profileOptions = [];
  h.engagementOptions = [];
  h.fetched = [];
  h.loading = false;
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SpeakerProfileDialog - zapytania śpią przy zamkniętym oknie", () => {
  it("zamknięty dialog NIE odpytuje bazy", () => {
    // Agenda montuje ten komponent raz na prelegenta. Bez `enabled` wejście
    // na wydarzenie z 30 nazwiskami to 60 równoległych zapytań.
    render(
      <Wrapper>
        <SpeakerProfileDialog userId={USER} lang="pl" open={false} onOpenChange={() => {}} />
      </Wrapper>,
    );
    expect(h.fetched).toEqual([]);
  });

  it("otwarcie odpytuje o profil i o wystąpienia", async () => {
    await dialog({ profile: profileRow() });
    expect(h.fetched).toContain(`profile:${USER}`);
    expect(h.fetched).toContain(`engagements:${USER}`);
  });

  it("puste id nie odpala zapytań, nawet gdy okno jest otwarte", () => {
    render(
      <Wrapper>
        <SpeakerProfileDialog userId="" lang="pl" open onOpenChange={() => {}} />
      </Wrapper>,
    );
    expect(h.fetched).toEqual([]);
  });
});

describe("SpeakerProfileDialog - dialog nigdy nie jest pusty", () => {
  it("bez profilu w bazie pokazuje dane awaryjne z kafelka", async () => {
    await dialog({ profile: null, fallback: { name: "Jan Nowak", role: "Moderator" } });
    // Nazwisko stoi w dwóch miejscach: w widocznym nagłówku profilu i w
    // tytule okna dla czytnika ekranu (też nagłówek) - stąd wskazanie poziomu.
    expect(
      within(panel()).getByRole("heading", { level: 3, name: "Jan Nowak" }),
    ).toBeInTheDocument();
    expect(within(panel()).getByText("Moderator")).toBeInTheDocument();
  });

  it("profil z bazy WYGRYWA z danymi awaryjnymi", async () => {
    await dialog({
      profile: profileRow({ display_name: "Anna Kowalska", headline_pl: "Analityczka" }),
      fallback: { name: "Jan Nowak", role: "Moderator" },
    });
    expect(
      within(panel()).getByRole("heading", { level: 3, name: "Anna Kowalska" }),
    ).toBeInTheDocument();
    expect(within(panel()).queryByText("Jan Nowak")).not.toBeInTheDocument();
  });

  it("ładowanie pokazuje szkielet, nie puste okno", async () => {
    await dialog({ loading: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(panel().querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("okno ma tytuł i opis dla czytnika ekranu, mimo braku widocznego nagłówka", async () => {
    // Radix ostrzega o dialogu bez tytułu; tu tytuł jest `sr-only`, więc musi
    // istnieć w drzewie dostępności, choć na ekranie go nie widać.
    await dialog({ profile: profileRow() });
    expect(panel()).toHaveAccessibleName("Anna Kowalska");
    expect(panel()).toHaveAccessibleDescription(/biogramem/);
  });

  it("bez nazwiska tytuł okna jest ogólny i przetłumaczony", async () => {
    await dialog({ profile: null, lang: "en" });
    expect(panel()).toHaveAccessibleName("Speaker profile");
  });
});

describe("SpeakerProfileDialog - dwujęzyczność z fallbackiem symetrycznym", () => {
  it("polska strona bierze polski nagłówek", async () => {
    await dialog({ profile: profileRow({ headline_pl: "Analityczka", headline_en: "Analyst" }) });
    expect(within(panel()).getByText("Analityczka")).toBeInTheDocument();
  });

  it("brak wersji polskiej spada na angielską, zamiast zostawić pustkę", async () => {
    await dialog({ profile: profileRow({ headline_pl: null, headline_en: "Analyst" }) });
    expect(within(panel()).getByText("Analyst")).toBeInTheDocument();
  });

  it("fallback działa też w drugą stronę", async () => {
    await dialog({
      lang: "en",
      profile: profileRow({ headline_pl: "Analityczka", headline_en: null }),
    });
    expect(within(panel()).getByText("Analityczka")).toBeInTheDocument();
  });

  it("brak nagłówka spada na stanowisko", async () => {
    await dialog({ profile: profileRow({ job_title: "Dyrektorka programowa" }) });
    expect(within(panel()).getByText("Dyrektorka programowa")).toBeInTheDocument();
  });

  it("TEMATY też mają fallback - to tablica, więc łatwo go pominąć", async () => {
    await dialog({ profile: profileRow({ topics_pl: [], topics_en: ["Energy", "Security"] }) });
    expect(within(panel()).getByText("Energy")).toBeInTheDocument();
    expect(within(panel()).getByText("Security")).toBeInTheDocument();
  });

  it("wypełnione tematy w języku strony wygrywają", async () => {
    await dialog({ profile: profileRow({ topics_pl: ["Energetyka"], topics_en: ["Energy"] }) });
    expect(within(panel()).getByText("Energetyka")).toBeInTheDocument();
    expect(within(panel()).queryByText("Energy")).not.toBeInTheDocument();
  });

  it("biogram idzie w języku strony", async () => {
    await dialog({ lang: "en", profile: profileRow({ bio_pl: "Polski", bio_en: "English bio" }) });
    expect(within(panel()).getByText("English bio")).toBeInTheDocument();
  });
});

describe("SpeakerProfileDialog - tożsamość i odznaki", () => {
  it("odznaka eksperta pojawia się tylko dla eksperta", async () => {
    const { unmount } = await dialog({ profile: profileRow({ is_expert: true }) });
    expect(within(panel()).getByText("Ekspert")).toBeInTheDocument();
    unmount();

    await dialog({ profile: profileRow({ is_expert: false }) });
    expect(within(panel()).queryByText("Ekspert")).not.toBeInTheDocument();
  });

  it("odznaka eksperta jest przetłumaczona", async () => {
    await dialog({ lang: "en", profile: profileRow({ is_expert: true }) });
    expect(within(panel()).getByText("Expert")).toBeInTheDocument();
  });

  it("linia firmy NIE dubluje nagłówka", async () => {
    // Gdy redaktor wpisał to samo w nagłówek i w stanowisko, druga linijka
    // byłaby dosłownym powtórzeniem pierwszej.
    await dialog({
      profile: profileRow({ headline_pl: "Analityczka", job_title: "Analityczka" }),
    });
    expect(within(panel()).getAllByText("Analityczka")).toHaveLength(1);
  });

  it("firma dopisuje się do stanowiska, gdy niesie coś nowego", async () => {
    await dialog({
      profile: profileRow({ headline_pl: "O energii", job_title: "Analityczka", company: "NES" }),
    });
    expect(within(panel()).getByText("Analityczka · NES")).toBeInTheDocument();
  });

  it("języki prelegenta pokazują się WIELKIMI literami", async () => {
    await dialog({ profile: profileRow({ languages: ["pl", "en"] }) });
    expect(within(panel()).getByText("Języki: PL, EN")).toBeInTheDocument();
  });

  it("brak języków nie zostawia pustej linijki", async () => {
    const { container } = await dialog({ profile: profileRow() });
    expect(container.textContent).not.toContain("Języki");
  });

  it("pełny profil linkuje po slugu; bez sluga linku nie ma", async () => {
    const { unmount } = await dialog({ profile: profileRow({ slug: "anna-kowalska" }) });
    expect(within(panel()).getByRole("link", { name: /Zobacz pełny profil/ })).toHaveAttribute(
      "href",
      "/author/anna-kowalska",
    );
    unmount();

    await dialog({ profile: profileRow({ slug: null }) });
    expect(within(panel()).queryByRole("link", { name: /profil/ })).not.toBeInTheDocument();
  });
});

describe("SpeakerProfileDialog - statystyki", () => {
  it("blok statystyk znika, gdy wszystkie są zerowe", async () => {
    const { container } = await dialog({ profile: profileRow() });
    expect(container.textContent).not.toContain("wystąpień");
  });

  it("wystarczy jedna niezerowa, żeby blok się pojawił", async () => {
    await dialog({ profile: profileRow({ reviews_count: 3 }) });
    expect(within(panel()).getByText("opinii")).toBeInTheDocument();
  });

  it("ocena zero pokazuje kreskę, a nie „0,0”", async () => {
    // „0.0" czyta się jak najgorsza możliwa ocena; brak ocen to co innego.
    await dialog({ profile: profileRow({ talks_count: 5 }) });
    expect(within(panel()).getByText("-")).toBeInTheDocument();
  });

  it("ocena jest zaokrąglana do jednego miejsca", async () => {
    await dialog({ profile: profileRow({ talks_count: 5, rating: 4.6666 }) });
    expect(within(panel()).getByText("4.7")).toBeInTheDocument();
  });

  it("etykiety statystyk są przetłumaczone", async () => {
    await dialog({ lang: "en", profile: profileRow({ talks_count: 5, reviews_count: 2 }) });
    expect(within(panel()).getByText("talks")).toBeInTheDocument();
    expect(within(panel()).getByText("reviews")).toBeInTheDocument();
  });
});

describe("SpeakerProfileDialog - wystąpienia", () => {
  const past = (id: string, over: Partial<SpeakerEngagement> = {}) =>
    engagement({ id, starts_at: "2020-01-01T09:00:00Z", title_pl: `Przeszłe ${id}`, ...over });
  const future = (id: string, over: Partial<SpeakerEngagement> = {}) =>
    engagement({ id, starts_at: "2030-01-01T09:00:00Z", title_pl: `Przyszłe ${id}`, ...over });

  it("nadchodzące idą PRZED przeszłymi", async () => {
    // Lista przychodzi z bazy posortowana od najnowszych; bez rozdzielenia
    // najbliższe wystąpienie lądowałoby w środku archiwum.
    await dialog({ engagements: [past("p1"), future("f1")], profile: profileRow() });
    const titles = within(panel())
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(titles[0]).toContain("Przyszłe f1");
    expect(titles[1]).toContain("Przeszłe p1");
  });

  it("lista jest przycięta do pięciu pozycji", async () => {
    // Dialog ma się mieścić na ekranie telefonu bez przewijania w nieskończoność.
    await dialog({
      profile: profileRow(),
      engagements: Array.from({ length: 12 }, (_, i) => past(`p${i}`)),
    });
    expect(within(panel()).getAllByRole("listitem")).toHaveLength(5);
  });

  it("nadchodzące zjadają limit przeszłych, ale same nie są ucinane", async () => {
    await dialog({
      profile: profileRow(),
      engagements: [
        ...Array.from({ length: 6 }, (_, i) => future(`f${i}`)),
        ...Array.from({ length: 6 }, (_, i) => past(`p${i}`)),
      ],
    });
    const titles = within(panel())
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(titles).toHaveLength(6);
    expect(titles.every((t) => t.includes("Przyszłe"))).toBe(true);
  });

  it("wystąpienie prowadzi na stronę wydarzenia", async () => {
    await dialog({ profile: profileRow(), engagements: [future("f1")] });
    expect(within(panel()).getByRole("link", { name: /Przyszłe f1/ })).toHaveAttribute(
      "href",
      "/events/szczyt-energetyczny",
    );
  });

  it("tytuł wystąpienia ma fallback językowy", async () => {
    await dialog({
      lang: "en",
      profile: profileRow(),
      engagements: [future("f1", { title_pl: "Tylko po polsku", title_en: "" })],
    });
    expect(within(panel()).getByText("Tylko po polsku")).toBeInTheDocument();
  });

  it("miejsce pokazuje się tylko, gdy jest podane", async () => {
    const { unmount } = await dialog({
      profile: profileRow(),
      engagements: [future("f1", { location: "Bruksela" })],
    });
    expect(within(panel()).getByText("Bruksela")).toBeInTheDocument();
    unmount();

    await dialog({ profile: profileRow(), engagements: [future("f2", { location: null })] });
    expect(within(panel()).queryByText("Bruksela")).not.toBeInTheDocument();
  });

  it("USZKODZONA data wypada z listy, zamiast wypisać „Invalid Date”", async () => {
    // Kolumna jest tekstem; jeden zły wiersz importu nie może zabrudzić okna.
    // Wiersz z niepoprawną datą nie należy ani do przyszłych, ani do
    // przeszłych (porównania z NaN są fałszywe w obie strony), więc po prostu
    // znika - a reszta listy zostaje.
    await dialog({
      profile: profileRow(),
      engagements: [future("f1", { starts_at: "to-nie-jest-data" }), future("f2")],
    });
    expect(within(panel()).queryByText(/Invalid/i)).not.toBeInTheDocument();
    expect(within(panel()).getAllByRole("listitem")).toHaveLength(1);
    expect(within(panel()).getByText("Przyszłe f2")).toBeInTheDocument();
  });

  it("bez wystąpień nagłówek sekcji się nie pojawia", async () => {
    const { container } = await dialog({ profile: profileRow(), engagements: [] });
    expect(container.textContent).not.toContain("Wystąpienia");
  });

  it("nagłówek sekcji jest przetłumaczony", async () => {
    await dialog({ lang: "en", profile: profileRow(), engagements: [future("f1")] });
    expect(within(panel()).getByText("Engagements")).toBeInTheDocument();
  });
});
