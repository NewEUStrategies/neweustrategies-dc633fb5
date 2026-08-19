// Sekcje huba eksperta - jedna reguła powtórzona dziewięć razy.
//
// `ExpertSectionRenderer` to `switch` po kluczu sekcji, a każda gałąź
// odpowiada na to samo pytanie: co pokazać, gdy ekspert TEJ danej nie ma?
// Odpowiedź produktowa jest jedna i jest twarda:
//   - na publicznej stronie sekcja bez danych ZNIKA (pusty nagłówek wygląda
//     jak awaria wczytywania, nie jak brak treści),
//   - w podglądzie w adminie sekcja pokazuje treść przykładową i JAWNIE
//     oznacza ją plakietką „Przykładowa treść", żeby redaktor nie wziął jej
//     za dane wgrane.
// Każda gałąź dostaje tu parę: „publicznie null" i „w podglądzie z
// plakietką". Bez tej pary łatwo dodać sekcję, która wypuszcza wymyślone
// wzmianki prasowe na stronę realnego eksperta.
//
// PUŁAPKA HARNESSU: karta kontaktu ciągnie `BrandIcon` → `useQuery`, więc
// montujemy przez `renderWithQueryClient` z pustym katalogiem ikon.
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { renderWithQueryClient as render } from "@/test/renderWithQueryClient";
import {
  expertArea,
  expertHub,
  expertMaterial,
  expertMention,
  expertProgram,
  expertSettings,
  type ExpertHubOverrides,
} from "@/test/experts/fixtures";
import type { ExpertLayoutSettings, ExpertSectionKey } from "@/lib/expertLayouts";

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub };
});

vi.mock("@/lib/iconLibrary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/iconLibrary")>()),
  listIcons: async () => [],
}));

const { ExpertSectionRenderer, LABELS, PLACEHOLDER } =
  await import("@/components/experts/ExpertLayoutRenderer");

const t = LABELS.pl;
const ph = PLACEHOLDER.pl;

function section(
  k: ExpertSectionKey,
  opts: {
    hub?: ExpertHubOverrides;
    settings?: Partial<ExpertLayoutSettings>;
    lang?: "pl" | "en";
    showPlaceholders?: boolean;
  } = {},
) {
  return render(
    <ExpertSectionRenderer
      k={k}
      hub={expertHub(opts.hub)}
      settings={expertSettings(opts.settings)}
      lang={opts.lang ?? "pl"}
      showPlaceholders={opts.showPlaceholders ?? false}
    />,
  );
}

/** Sekcje, które na publicznej stronie znikają bez danych. */
const HIDES_WHEN_EMPTY: ExpertSectionKey[] = [
  "expertise_bar",
  "details",
  "social_row",
  "contact_card",
  "media_mentions",
  "podcast_strip",
  "cv",
  "programs",
];

afterEach(async () => {
  await i18n.changeLanguage("pl");
  vi.clearAllMocks();
});

describe("ExpertSectionRenderer - reguła wspólna", () => {
  it.each(HIDES_WHEN_EMPTY)("sekcja %s PUBLICZNIE znika, gdy nie ma danych", (k) => {
    const { container } = section(k);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(HIDES_WHEN_EMPTY)("sekcja %s w podglądzie ma plakietkę treści przykładowej", (k) => {
    const { container } = section(k, { showPlaceholders: true });
    expect(container).not.toBeEmptyDOMElement();
    expect(container.textContent).toContain(t.placeholder);
  });

  it("nieznany klucz sekcji nie wywraca strony", () => {
    // Kolejność sekcji siedzi w bazie jako tablica tekstów; wiersz sprzed
    // usunięcia jakiegoś klucza dalej go niesie.
    const { container } = section("nieistniejaca" as ExpertSectionKey);
    expect(container).toBeEmptyDOMElement();
  });

  it("preset kartowy zamyka sekcję w ramce, pozostałe nie", () => {
    const { container: karta } = section("details", {
      hub: { expert: { bio_pl: "Biogram" } },
      settings: { default_preset: "card-stack" },
    });
    const { container: zwykla } = section("details", {
      hub: { expert: { bio_pl: "Biogram" } },
    });
    expect(karta.querySelector("section")).toHaveClass("border");
    expect(zwykla.querySelector("section")).not.toHaveClass("border");
  });

  it("ustawienie center_details centruje treść, nie nagłówek", () => {
    // Nagłówek zostaje z ikoną po lewej - centrowanie dotyczy tylko ciała
    // sekcji, inaczej ikona odklejałaby się od tytułu.
    const { container } = section("details", {
      hub: { expert: { bio_pl: "Biogram" } },
      settings: { center_details: true },
    });
    expect(container.querySelector(".text-center")).toBeInTheDocument();
    expect(container.querySelector("h2")).not.toHaveClass("text-center");
  });
});

describe("sekcja: pasek ekspertyzy", () => {
  it("pokazuje obszary eksperta w języku strony", () => {
    const hub = {
      areas: [expertArea()],
    } satisfies ExpertHubOverrides;
    const { rerender } = section("expertise_bar", { hub });
    expect(screen.getByText("Energia")).toBeInTheDocument();
    rerender(
      <ExpertSectionRenderer
        k="expertise_bar"
        hub={expertHub(hub)}
        settings={expertSettings()}
        lang="en"
        showPlaceholders={false}
      />,
    );
    expect(screen.getByText("Energy")).toBeInTheDocument();
  });

  it("prawdziwe obszary NIE dostają plakietki „przykładowe”", () => {
    const { container } = section("expertise_bar", {
      showPlaceholders: true,
      hub: { areas: [expertArea()] },
    });
    expect(container.textContent).not.toContain(t.placeholder);
    expect(container.textContent).not.toContain(ph.areas[0]);
  });
});

describe("sekcja: biogram", () => {
  it("pełny biogram wygrywa ze skróconym", () => {
    // `full_bio_*` to wersja rozwinięta; skrócona idzie do hero. Odwrotna
    // kolejność dawałaby dwa razy ten sam akapit na jednej stronie.
    section("details", {
      hub: { expert: { bio_pl: "Skrót", full_bio_pl: "Pełna wersja" } },
    });
    expect(screen.getByText("Pełna wersja")).toBeInTheDocument();
  });

  it("brak pełnej wersji spada na skróconą", () => {
    section("details", { hub: { expert: { bio_pl: "Skrót" } } });
    expect(screen.getByText("Skrót")).toBeInTheDocument();
  });

  it("HTML z edytora schodzi do czystego tekstu", () => {
    const { container } = section("details", {
      hub: { expert: { full_bio_pl: "<p>Akapit <b>wytłuszczony</b></p>" } },
    });
    expect(screen.getByText("Akapit wytłuszczony")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("<b>");
  });

  it("biogram idzie w języku strony", () => {
    section("details", {
      lang: "en",
      hub: { expert: { full_bio_pl: "Polski", full_bio_en: "English" } },
    });
    expect(screen.getByText("English")).toBeInTheDocument();
  });
});

describe("sekcja: kanały i kontakt", () => {
  it("SAM telefon prasowy wystarczy, żeby pasek kanałów się pojawił", () => {
    // `media_contact_phone` jest jedynym polem spoza listy social, które
    // decyduje o widoczności - łatwo je zgubić przy refaktorze warunku.
    const { container } = section("social_row", {
      hub: { expert: { media_contact_phone: "+48 22 111 11 11" } },
    });
    expect(container).not.toBeEmptyDOMElement();
    expect(container.textContent).not.toContain(t.placeholder);
  });

  it("karta kontaktu reaguje na e-mail albo stronę, ale nie na sam telefon", () => {
    const { container: zTelefonem } = section("contact_card", {
      hub: { expert: { media_contact_phone: "+48 22 111 11 11" } },
    });
    expect(zTelefonem).toBeEmptyDOMElement();

    const { container: zeStroną } = section("contact_card", {
      hub: { expert: { website_url: "https://anna.example" } },
    });
    expect(zeStroną).not.toBeEmptyDOMElement();
  });

  it("adres strony w karcie kontaktu traci protokół", () => {
    section("contact_card", {
      hub: { expert: { website_url: "https://anna.example/blog" } },
    });
    expect(screen.getByText("anna.example/blog")).toBeInTheDocument();
  });

  it("karta z samym e-mailem nie wypisuje przykładowej strony", () => {
    const { container } = section("contact_card", {
      hub: { expert: { contact_email: "anna@nes.example" } },
    });
    expect(screen.getByText("anna@nes.example")).toBeInTheDocument();
    expect(container.textContent).not.toContain(ph.website);
  });
});

describe("sekcja: wzmianki prasowe", () => {
  it("pokazuje NAJWYŻEJ cztery wzmianki", () => {
    // Sekcja jest zajawką; pełna lista mieszka w „W mediach" niżej.
    const { container } = section("media_mentions", {
      hub: {
        mediaMentions: Array.from({ length: 9 }, (_, i) =>
          expertMention({ id: `m${i}`, outlet: `Tytuł ${i}` }),
        ),
      },
    });
    expect(container.querySelectorAll("li")).toHaveLength(4);
  });

  it("prawdziwe wzmianki wypierają przykładowe nawet w podglądzie", () => {
    const { container } = section("media_mentions", {
      showPlaceholders: true,
      hub: { mediaMentions: [expertMention()] },
    });
    expect(container.textContent).not.toContain(t.placeholder);
    expect(container.textContent).not.toContain(ph.mentions[0].title);
  });
});

describe("sekcja: pasek podcastów", () => {
  it("bierze WYŁĄCZNIE materiały typu podcast", () => {
    const { container } = section("podcast_strip", {
      hub: {
        materials: [
          expertMaterial({ id: "a", kind: "article", title_pl: "Artykuł" }),
          expertMaterial({ id: "p", kind: "podcast", title_pl: "Odcinek" }),
        ],
      },
    });
    expect(screen.getByText("Odcinek")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Artykuł");
  });

  it("materiały bez podcastu traktujemy jak brak sekcji", () => {
    const { container } = section("podcast_strip", {
      hub: { materials: [expertMaterial({ kind: "article" })] },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("pokazuje najwyżej trzy odcinki", () => {
    const { container } = section("podcast_strip", {
      hub: {
        materials: Array.from({ length: 6 }, (_, i) =>
          expertMaterial({ id: `p${i}`, kind: "podcast", title_pl: `Odcinek ${i}` }),
        ),
      },
    });
    expect(container.querySelectorAll(".grid > div")).toHaveLength(3);
  });

  it("odcinek bez daty nie zostawia pustego wiersza", () => {
    const { container } = section("podcast_strip", {
      hub: { materials: [expertMaterial({ kind: "podcast", date: null })] },
    });
    expect(container.querySelectorAll(".text-xs")).toHaveLength(0);
  });

  it("tytuł odcinka idzie w języku strony", () => {
    section("podcast_strip", {
      lang: "en",
      hub: {
        materials: [expertMaterial({ kind: "podcast", title_pl: "Odcinek", title_en: "Episode" })],
      },
    });
    expect(screen.getByText("Episode")).toBeInTheDocument();
  });
});

describe("sekcja: programy", () => {
  it("pokazuje nazwę i funkcję", () => {
    section("programs", { hub: { programs: [expertProgram()] } });
    expect(screen.getByText("Klimat")).toBeInTheDocument();
    expect(screen.getByText("Kierowniczka")).toBeInTheDocument();
  });

  it("program bez funkcji nie zostawia pustego wiersza", () => {
    const { container } = section("programs", {
      hub: { programs: [expertProgram({ role_pl: null })] },
    });
    expect(container.querySelectorAll("li div")).toHaveLength(1);
  });

  it("pokazuje najwyżej sześć pozycji", () => {
    const { container } = section("programs", {
      hub: {
        programs: Array.from({ length: 11 }, (_, i) =>
          expertProgram({ id: `p${i}`, name_pl: `Program ${i}` }),
        ),
      },
    });
    expect(container.querySelectorAll("li")).toHaveLength(6);
  });

  it("nazwa idzie w języku strony", () => {
    section("programs", { lang: "en", hub: { programs: [expertProgram()] } });
    expect(screen.getByText("Climate")).toBeInTheDocument();
  });
});

describe("sekcje bez treści produkcyjnej", () => {
  it("materiały NIE są renderowane przez tę listę", () => {
    // Kafle materiałów rysuje `ExpertMaterialsExplorer` z własnym filtrem
    // i stronicowaniem. Gdyby lista sekcji też je wypuszczała, ekspert
    // miałby na stronie dwie różne listy tych samych publikacji.
    const { container } = section("materials", {
      showPlaceholders: true,
      hub: { materials: [expertMaterial()] },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("CV istnieje WYŁĄCZNIE jako zapowiedź w podglądzie", () => {
    // Nie mamy jeszcze modelu danych CV; sekcja pokazuje redakcji, jak
    // będzie wyglądać, ale publicznie nie może pojawić się nigdy - nawet
    // przy komplecie innych danych.
    const { container } = section("cv", {
      hub: { expert: { job_title: "Analityczka", company: "NES" } },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("zapowiedź CV pokazuje cztery atrapy stanowisk", () => {
    const { container } = section("cv", { showPlaceholders: true });
    expect(container.querySelectorAll(".grid > div")).toHaveLength(4);
    expect(screen.getByText("Stanowisko 1")).toBeInTheDocument();
  });

  it("zapowiedź CV jest przetłumaczona", () => {
    section("cv", { showPlaceholders: true, lang: "en" });
    expect(screen.getByText("Position 1")).toBeInTheDocument();
    expect(screen.getAllByText("Institution · 2020 - 2024")).toHaveLength(4);
  });
});
