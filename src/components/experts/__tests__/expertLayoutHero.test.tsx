// Hero strony eksperta - osiem presetów, jedna umowa.
//
// `ExpertLayoutHero` to największa funkcja w module 7 (ok. 420 linii) i to
// ona decyduje, co czytelnik zobaczy w pierwszej sekundzie: nazwisko,
// stanowisko, odznakę weryfikacji i biogram. Preset zmienia UKŁAD, ale nie
// wolno mu zmieniać UMOWY - każdy wariant musi wystawić dokładnie jeden
// nagłówek pierwszego poziomu z nazwiskiem i linię roli. Regresja, którą to
// łapie, jest cicha: nowy preset renderuje się ładnie, a nagłówek H1 znika
// albo dubluje się i strona traci sens dla wyszukiwarki i czytnika ekranu.
//
// Drugi filar: tryb `showPlaceholders` obsługuje WYŁĄCZNIE podgląd w
// adminie. Wszystko, co ten tryb dosypuje - przykładowe nazwisko, biogram,
// rola, plakietki „Zalecane: 400×400 px" - na publicznej stronie musi być
// nieobecne. Każda z tych rzeczy ma tu parę asercji: „w podglądzie jest",
// „publicznie nie ma".
//
// PUŁAPKA HARNESSU: hero montuje `SocialRow`/`ContactInline`, a te ciągną
// `BrandIcon` przez `useQuery`. Bez `renderWithQueryClient` leci „No
// QueryClient set"; katalog ikon zwracamy pusty (ścieżka fallbacku Lucide).
import type { ReactNode } from "react";
import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { renderWithQueryClient as render } from "@/test/renderWithQueryClient";
import { EXPERT_LAYOUT_PRESETS } from "@/lib/expertLayouts";
import type { ExpertLayoutPresetId, ExpertLayoutSettings } from "@/lib/expertLayouts";
import { expertHub, expertSettings, type ExpertProfile } from "@/test/experts/fixtures";

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub };
});

vi.mock("@/lib/iconLibrary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/iconLibrary")>()),
  listIcons: async () => [],
}));

const { ExpertLayoutHero, LABELS, PLACEHOLDER } =
  await import("@/components/experts/ExpertLayoutRenderer");

const t = realT("pl");
const ph = PLACEHOLDER.pl;
const PRESET_IDS = EXPERT_LAYOUT_PRESETS.map((p) => p.id);

/** Hero z domyślnym presetem; `preset` przełącza wariant układu. */
function hero(
  opts: {
    preset?: ExpertLayoutPresetId;
    expert?: Partial<ExpertProfile>;
    settings?: Partial<ExpertLayoutSettings>;
    lang?: "pl" | "en";
    showPlaceholders?: boolean;
    action?: ReactNode;
  } = {},
) {
  return render(
    <ExpertLayoutHero
      hub={expertHub({ expert: opts.expert })}
      settings={expertSettings({
        ...(opts.preset ? { default_preset: opts.preset } : {}),
        ...opts.settings,
      })}
      lang={opts.lang ?? "pl"}
      showPlaceholders={opts.showPlaceholders}
      action={opts.action}
    />,
  );
}

afterEach(async () => {
  await i18n.changeLanguage("pl");
  vi.clearAllMocks();
});

describe("ExpertLayoutHero - umowa wspólna dla wszystkich presetów", () => {
  it.each(PRESET_IDS)("preset %s daje DOKŁADNIE JEDEN nagłówek z nazwiskiem", (preset) => {
    const { container } = hero({ preset });
    const h1 = container.querySelectorAll("h1");
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent("Anna Kowalska");
  });

  it.each(PRESET_IDS)("preset %s pokazuje linię stanowiska i firmy", (preset) => {
    hero({ preset, expert: { job_title: "Analityczka", company: "NES" } });
    expect(screen.getByText("Analityczka · NES")).toBeInTheDocument();
  });

  it.each(PRESET_IDS)("preset %s niesie odznakę weryfikacji przy nazwisku", (preset) => {
    // Komentarz w kodzie mówi wprost, że odznaka „znikała przy layoutach bez
    // paska nad hero" - stąd asercja dla KAŻDEGO wariantu, nie dla jednego.
    const { container } = hero({ preset, expert: { verified_at: "2026-01-01T00:00:00Z" } });
    const h1 = container.querySelector("h1")!;
    expect(within(h1).getByText(String(t("expert.verifiedBadge")))).toBeInTheDocument();
  });

  it.each(PRESET_IDS)("preset %s bez weryfikacji nie pokazuje odznaki", (preset) => {
    hero({ preset });
    expect(screen.queryByText(String(t("expert.verifiedBadge")))).not.toBeInTheDocument();
  });

  it.each(PRESET_IDS)("preset %s wpina przekazaną akcję (np. przycisk zapytania)", (preset) => {
    hero({ preset, action: <button type="button">Zapytaj eksperta</button> });
    expect(screen.getByRole("button", { name: "Zapytaj eksperta" })).toBeInTheDocument();
  });

  it.each(PRESET_IDS)("preset %s bez akcji nie zostawia pustego paska", (preset) => {
    hero({ preset });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ExpertLayoutHero - linia roli", () => {
  it("samo stanowisko bez firmy nie zostawia wiszącego separatora", () => {
    hero({ expert: { job_title: "Analityczka" } });
    expect(screen.getByText("Analityczka")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("sama firma bez stanowiska działa tak samo", () => {
    hero({ expert: { company: "NES" } });
    expect(screen.getByText("NES")).toBeInTheDocument();
  });

  it("PUBLICZNIE brak stanowiska daje neutralne „Ekspert”, nie pustą linię", () => {
    hero({});
    expect(screen.getByText(LABELS.pl.roleFallback)).toBeInTheDocument();
  });

  it("PUBLICZNIE nie pojawia się przykładowa rola z podglądu", () => {
    const { container } = hero({});
    expect(container.textContent).not.toContain(ph.role);
  });

  it("w PODGLĄDZIE brak stanowiska daje rolę przykładową", () => {
    hero({ showPlaceholders: true });
    expect(screen.getByText(ph.role)).toBeInTheDocument();
  });

  it("prawdziwe stanowisko wygrywa z przykładowym nawet w podglądzie", () => {
    const { container } = hero({ showPlaceholders: true, expert: { job_title: "Analityczka" } });
    expect(container.textContent).not.toContain(ph.role);
  });

  it("angielska wersja bierze angielski tekst zapasowy", () => {
    hero({ lang: "en" });
    expect(screen.getByText(LABELS.en.roleFallback)).toBeInTheDocument();
  });
});

describe("ExpertLayoutHero - nazwisko", () => {
  it("PUBLICZNIE pusty profil NIE dostaje przykładowego nazwiska", () => {
    // Gdyby dosypanie działało publicznie, strona bez uzupełnionego profilu
    // przedstawiałaby czytelnikowi wymyśloną osobę.
    const { container } = hero({ expert: { display_name: "" } });
    expect(container.querySelector("h1")).toHaveTextContent("");
    expect(container.textContent).not.toContain("Przykładowy Ekspert");
  });

  it("w PODGLĄDZIE pusty profil dostaje nazwisko przykładowe", () => {
    hero({ expert: { display_name: "" }, showPlaceholders: true });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Przykładowy Ekspert");
  });

  it("przykładowe nazwisko jest tłumaczone", () => {
    hero({ expert: { display_name: "" }, showPlaceholders: true, lang: "en" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sample Expert");
  });

  it("nazwisko z samych spacji traktujemy jak brak", () => {
    hero({ expert: { display_name: "   " }, showPlaceholders: true });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Przykładowy Ekspert");
  });
});

describe("ExpertLayoutHero - biogram jako punktory", () => {
  function bullets(container: HTMLElement) {
    return [...container.querySelectorAll("li")].map((li) => li.textContent);
  }

  it("biogram wielolinijkowy rozbija się na punkty", () => {
    const { container } = hero({ expert: { bio_pl: "Pierwsza linia\nDruga linia" } });
    expect(bullets(container)).toEqual(["Pierwsza linia", "Druga linia"]);
  });

  it("myślniki i kropki na początku linii są ścinane", () => {
    // Redaktorzy wklejają listy z Worda; bez tego punktor pojawiłby się dwa
    // razy - raz nasz, raz z tekstu.
    const { container } = hero({ expert: { bio_pl: "- Pierwsza\n• Druga\n* Trzecia\n· Czwarta" } });
    expect(bullets(container)).toEqual(["Pierwsza", "Druga", "Trzecia", "Czwarta"]);
  });

  it("jedna linia rozbija się na ZDANIA", () => {
    const { container } = hero({ expert: { bio_pl: "Pierwsze zdanie. Drugie zdanie! Trzecie?" } });
    expect(bullets(container)).toEqual(["Pierwsze zdanie.", "Drugie zdanie!", "Trzecie?"]);
  });

  it("maksymalnie pięć punktów - hero nie może urosnąć na cały ekran", () => {
    const { container } = hero({
      expert: { bio_pl: Array.from({ length: 12 }, (_, i) => `Linia ${i}`).join("\n") },
    });
    expect(bullets(container)).toHaveLength(5);
  });

  it("limit pięciu obowiązuje też przy podziale na zdania", () => {
    const { container } = hero({
      expert: { bio_pl: Array.from({ length: 9 }, (_, i) => `Zdanie ${i}.`).join(" ") },
    });
    expect(bullets(container)).toHaveLength(5);
  });

  it("HTML z edytora schodzi do czystego tekstu", () => {
    // Biogram bywa zapisany jako HTML z edytora; wypuszczenie znaczników do
    // punktora pokazałoby czytelnikowi surowe tagi.
    const { container } = hero({ expert: { bio_pl: "<p>Akapit <b>pogrubiony</b></p>" } });
    expect(bullets(container)[0]).toBe("Akapit pogrubiony");
    expect(container.innerHTML).not.toContain("<b>");
  });

  it("biogram idzie w języku strony", () => {
    const { container } = hero({
      lang: "en",
      expert: { bio_pl: "Wersja polska", bio_en: "English version" },
    });
    expect(bullets(container)).toEqual(["English version"]);
  });

  it("PUBLICZNIE brak biogramu NIE dosypuje przykładowego", () => {
    const { container } = hero({});
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.textContent).not.toContain(ph.bio[0]);
  });

  it("w PODGLĄDZIE brak biogramu daje pięć punktów przykładowych", () => {
    const { container } = hero({ showPlaceholders: true });
    expect(bullets(container)).toEqual([...ph.bio].slice(0, 5));
  });

  it("wariant editorial też renderuje punktory, tylko innym blokiem", () => {
    // Editorial ma własną gałąź renderującą listę (cytat z lewą kreską) -
    // bez tej asercji jej regresja przechodzi niezauważona.
    const { container } = hero({ preset: "editorial", expert: { bio_pl: "Jedno\nDrugie" } });
    expect(bullets(container)).toEqual(["Jedno", "Drugie"]);
    expect(container.querySelector("ul")).toHaveClass("border-l-4");
  });

  it("editorial bez biogramu nie zostawia pustej kreski cytatu", () => {
    const { container } = hero({ preset: "editorial" });
    expect(container.querySelector("ul.border-l-4")).toBeNull();
  });
});

describe("ExpertLayoutHero - awatar i okładka", () => {
  it("prawdziwe zdjęcie ma tekst alternatywny z nazwiskiem", () => {
    const { container } = hero({ expert: { avatar_url: "https://cdn.example/a.jpg" } });
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://cdn.example/a.jpg");
    expect(img).toHaveAttribute("alt", "Anna Kowalska");
  });

  it("brak zdjęcia daje atrapę z inicjałami, nie puste miejsce", () => {
    const { container } = hero({});
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AK")).toBeInTheDocument();
  });

  it("PUBLICZNIE nie ma podpowiedzi o zalecanym rozmiarze", () => {
    // „Zalecane: 400×400 px" to instrukcja dla redakcji. Na stronie eksperta
    // wygląda jak usterka.
    const { container } = hero({});
    expect(container.textContent).not.toContain("Zalecane");
  });

  it("w PODGLĄDZIE brak zdjęcia daje podpowiedź o rozmiarze", () => {
    hero({ showPlaceholders: true });
    expect(screen.getByText(/Zalecane: 600×600 px/)).toBeInTheDocument();
  });

  it("zalecany rozmiar zależy od presetu - kadr jest inny w każdym układzie", () => {
    // Preset klasyczny prowadzi awatar na 176 px, wyśrodkowany na 96 px.
    // Jedna wspólna liczba wysyłałaby redakcję po zbyt małe pliki.
    hero({ preset: "centered", showPlaceholders: true });
    expect(screen.getByText(/Zalecane: 400×400 px/)).toBeInTheDocument();
  });

  it("podpowiedź znika, gdy zdjęcie już jest", () => {
    const { container } = hero({
      showPlaceholders: true,
      expert: { avatar_url: "https://cdn.example/a.jpg" },
    });
    expect(container.textContent).not.toContain("Zalecane");
  });

  it("podpowiedź o rozmiarze jest tłumaczona", () => {
    hero({ showPlaceholders: true, lang: "en" });
    expect(screen.getByText(/Recommended: 600×600 px/)).toBeInTheDocument();
  });

  it("preset z okładką wstawia ją jako tło, nie jako obrazek", () => {
    // Okładka jest dekoracją: jako `<img>` trafiłaby do czytnika ekranu i do
    // wyników wyszukiwania grafik jako treść.
    const { container } = hero({
      preset: "magazine",
      expert: { cover_url: "https://cdn.example/c.jpg" },
    });
    expect(container.querySelector('[style*="background-image"]')).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("brak okładki daje atrapę ukrytą przed czytnikiem", () => {
    const { container } = hero({ preset: "magazine" });
    expect(container.querySelector("[aria-hidden]")).toBeInTheDocument();
  });

  it("PUBLICZNIE brak okładki nie pokazuje zalecanego rozmiaru", () => {
    const { container } = hero({ preset: "magazine" });
    expect(container.textContent).not.toContain("1600×600 px");
  });

  it("w PODGLĄDZIE brak okładki pokazuje zalecany rozmiar", () => {
    hero({ preset: "magazine", showPlaceholders: true });
    expect(screen.getByText(/Zalecane: 1600×600 px/)).toBeInTheDocument();
  });

  it("editorial ma WŁASNY zalecany rozmiar okładki", () => {
    hero({ preset: "editorial", showPlaceholders: true });
    expect(screen.getByText(/Zalecane: 1600×720 px/)).toBeInTheDocument();
  });

  it("wgrana okładka usuwa podpowiedź także w podglądzie", () => {
    const { container } = hero({
      preset: "magazine",
      showPlaceholders: true,
      expert: { cover_url: "https://cdn.example/c.jpg" },
    });
    expect(container.textContent).not.toContain("1600×600 px");
  });
});

describe("ExpertLayoutHero - wyśrodkowanie i szerokość", () => {
  it("ustawienie center_hero centruje układ nawet w presecie lewostronnym", () => {
    const { container } = hero({ preset: "classic", settings: { center_hero: true } });
    expect(container.querySelector(".md\\:justify-center")).toBeInTheDocument();
  });

  it("bez center_hero preset klasyczny zostaje wyrównany do lewej", () => {
    const { container } = hero({ preset: "classic" });
    expect(container.querySelector(".md\\:justify-center")).toBeNull();
  });

  it("maksymalna szerokość z ustawień schodzi na kontener", () => {
    const { container } = hero({ preset: "classic", settings: { max_width: 880 } });
    expect(container.querySelector(".mx-auto")).toHaveStyle({ maxWidth: "880px" });
  });

  it.each(["sidebar-left", "sidebar-right"] as const)(
    "preset %s układa kolumny po swojej stronie",
    (id) => {
      const { container } = hero({ preset: id });
      const aside = container.querySelector("aside")!;
      expect(aside.className.includes("md:order-2")).toBe(id === "sidebar-right");
    },
  );
});
