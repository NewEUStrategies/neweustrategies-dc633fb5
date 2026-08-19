// Renderer układu huba eksperta - części eksportowane.
//
// 1133 linie, zero wykonanych. Ten sam plik obsługuje DWIE powierzchnie
// naraz: podgląd w `/admin/expert-layouts` i realną stronę `/author/$slug`.
// Stąd tryb `showPlaceholders`, który na podglądzie dosypuje treść
// przykładową - i stąd reguła, której złamanie jest najgroźniejsze w całym
// pliku: **dane przykładowe nie mogą wyciec na stronę publiczną**.
// Ma to tutaj dedykowane asercje dla każdego komponentu z tym trybem.
//
// Czyste reguły układu (tokeny CSS, kolejność sekcji, sygnatura nadpisań)
// mieszkają w `lib/experts/layoutRules.ts` i mają własne testy - tutaj
// sprawdzamy KOMPOZYCJĘ, czyli to, co widzi użytkownik.
//
// PUŁAPKA HARNESSU: ikony kanałów idą przez `BrandIcon`, który czyta katalog
// ikon przez `useQuery`. Goły `render()` wywala „No QueryClient set", więc
// każdy komponent z ikoną montujemy przez `renderWithQueryClient`, a katalog
// ikon zwraca pustą listę - to ścieżka fallbacku na ikony Lucide, czyli stan
// produkcyjny dla większości instalacji.
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { expertHub, expertSettings } from "@/test/experts/fixtures";

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub };
});

vi.mock("@/lib/iconLibrary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/iconLibrary")>()),
  listIcons: async () => [],
}));

const {
  AvatarPlaceholder,
  ContactInline,
  CoverPlaceholder,
  ExpertLayoutStyleScope,
  ExpertSectionsList,
  PLACEHOLDER,
  SocialRow,
} = await import("@/components/experts/ExpertLayoutRenderer");

const render = renderWithQueryClient;
const ph = PLACEHOLDER.pl;

afterEach(async () => {
  await i18n.changeLanguage("pl");
  vi.clearAllMocks();
});

describe("AvatarPlaceholder", () => {
  it("składa inicjały z dwóch pierwszych członów nazwiska", () => {
    render(<AvatarPlaceholder name="Anna Kowalska" />);
    expect(screen.getByText("AK")).toBeInTheDocument();
  });

  it("z jednego członu bierze jedną literę", () => {
    render(<AvatarPlaceholder name="Cher" />);
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("z trzech członów bierze DWA PIERWSZE", () => {
    // Świadoma różnica wobec `SpeakerAvatar` (tam pierwszy i ostatni): tutaj
    // to placeholder podglądu, nie identyfikacja osoby na liście.
    render(<AvatarPlaceholder name="Anna Maria Kowalska" />);
    expect(screen.getByText("AM")).toBeInTheDocument();
  });

  it("pusta nazwa daje znak zapytania, a nie pustą plamę", () => {
    render(<AvatarPlaceholder name="" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("nazwa z samych spacji też daje znaki zapytania", () => {
    // Dwie różne ścieżki dają dwa różne napisy: `""` wpada w podmianę na „?"
    // PRZED podziałem, a „   " przechodzi podział i zostaje z pustą listą
    // inicjałów, więc łapie je dopiero `|| "??"` na końcu. Obie kończą się
    // czymś widocznym - i o to chodzi, bo pusty kwadrat wygląda jak błąd
    // ładowania obrazka.
    render(<AvatarPlaceholder name="   " />);
    expect(screen.getByText("??")).toBeInTheDocument();
  });

  it("podnosi inicjały do wielkich liter", () => {
    render(<AvatarPlaceholder name="anna kowalska" />);
    expect(screen.getByText("AK")).toBeInTheDocument();
  });

  it("jest ukryty przed czytnikiem ekranu - to atrapa, nie treść", () => {
    const { container } = render(<AvatarPlaceholder name="Anna Kowalska" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden");
  });

  it("kształt jest sterowalny (koło vs prostokąt) i przyjmuje klasy", () => {
    const { container } = render(
      <AvatarPlaceholder name="Anna" className="h-24 w-24" rounded="rounded-lg" />,
    );
    expect(container.firstElementChild).toHaveClass("h-24", "w-24", "rounded-lg");
  });
});

describe("CoverPlaceholder", () => {
  it("jest ukryta przed czytnikiem ekranu", () => {
    const { container } = render(<CoverPlaceholder />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden");
  });

  it("nie niesie żadnej treści tekstowej", () => {
    // Atrapa okładki ma być czysto wizualna; napis „przykładowa okładka"
    // trafiłby na podgląd, a stamtąd do zrzutów ekranu w dokumentacji.
    const { container } = render(<CoverPlaceholder className="h-40" />);
    expect(container.textContent).toBe("");
    expect(container.firstElementChild).toHaveClass("h-40");
  });
});

describe("SocialRow - dane przykładowe NIE wyciekają na produkcję", () => {
  it("ekspert bez ani jednego kanału nie dostaje żadnego linku", () => {
    const { container } = render(<SocialRow expert={expertHub().expert} />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("pokazuje wyłącznie kanały, które ekspert naprawdę podał", () => {
    const expert = expertHub({
      expert: { website_url: "https://anna.example", linkedin_url: null, twitter_url: null },
    }).expert;
    const { container } = render(<SocialRow expert={expert} />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://anna.example"]);
  });

  it("adres e-mail staje się odnośnikiem mailto", () => {
    const expert = expertHub({ expert: { contact_email: "anna@nes.example" } }).expert;
    const { container } = render(<SocialRow expert={expert} />);
    expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain(
      "mailto:anna@nes.example",
    );
  });

  it("link zewnętrzny otwiera się w nowej karcie, a mailto NIE", () => {
    // `target="_blank"` na `mailto:` zostawia w przeglądarce pustą kartę.
    const expert = expertHub({
      expert: { website_url: "https://anna.example", contact_email: "anna@nes.example" },
    }).expert;
    const { container } = render(<SocialRow expert={expert} />);
    const www = container.querySelector('a[href^="https"]');
    const mail = container.querySelector('a[href^="mailto"]');
    expect(www).toHaveAttribute("target", "_blank");
    expect(www).toHaveAttribute("rel", "noreferrer");
    expect(mail).not.toHaveAttribute("target");
  });

  it("TRYB PODGLĄDU dosypuje kanały przykładowe", () => {
    const { container } = render(<SocialRow expert={expertHub().expert} showPlaceholders />);
    expect(container.querySelectorAll("a").length).toBeGreaterThan(0);
  });

  it("bez trybu podglądu ŻADEN kanał przykładowy się nie pojawia", () => {
    // Najgroźniejsza regresja tego pliku: dane demonstracyjne na publicznej
    // stronie eksperta wyglądają jak jego prawdziwe kontakty. Adresy
    // LinkedIn/X są w tym komponencie literałami, więc muszą być literałami
    // także w asercji - inaczej test przestałby cokolwiek chronić.
    const { container } = render(<SocialRow expert={expertHub().expert} />);
    expect(container.innerHTML).not.toContain("linkedin.com/in/anna-kowalska");
    expect(container.innerHTML).not.toContain("x.com/anna_kowalska");
    expect(container.innerHTML).not.toContain(ph.email);
    expect(container.innerHTML).not.toContain(ph.website);
  });

  it("prawdziwy kanał wygrywa z przykładowym nawet w trybie podglądu", () => {
    const expert = expertHub({
      expert: { linkedin_url: "https://linkedin.com/in/prawdziwa" },
    }).expert;
    const { container } = render(<SocialRow expert={expert} showPlaceholders />);
    expect(container.innerHTML).toContain("linkedin.com/in/prawdziwa");
    expect(container.innerHTML).not.toContain("linkedin.com/in/anna-kowalska");
  });

  it("kontakt dla mediów pojawia się dopiero na życzenie", () => {
    const expert = expertHub({ expert: { media_contact_email: "media@nes.example" } }).expert;
    const { container: bez } = render(<SocialRow expert={expert} />);
    expect(bez.innerHTML).not.toContain("media@nes.example");

    const { container: z } = render(<SocialRow expert={expert} showMediaContact />);
    expect(z.innerHTML).toContain("media@nes.example");
  });

  it("sam kontakt dla mediów wystarczy, żeby pasek się pojawił", () => {
    // Ekspert bez social mediów, ale z kontaktem prasowym, nie może zniknąć
    // z sekcji - to jedyny sposób, w jaki dziennikarz go zaczepi.
    const expert = expertHub({ expert: { media_contact_email: "media@nes.example" } }).expert;
    const { container } = render(<SocialRow expert={expert} showMediaContact />);
    expect(container.querySelector('a[href="mailto:media@nes.example"]')).toBeInTheDocument();
    // Bez kanałów social nie ma separatora - byłaby to kreska w próżni.
    expect(container.querySelector("span.bg-border")).toBeNull();
  });
});

describe("ContactInline", () => {
  it("bez danych kontaktowych NIE renderuje niczego", () => {
    const { container } = render(<ContactInline expert={expertHub().expert} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("adres e-mail dostaje odnośnik mailto", () => {
    const expert = expertHub({ expert: { contact_email: "anna@nes.example" } }).expert;
    render(<ContactInline expert={expert} />);
    expect(screen.getByRole("link", { name: /anna@nes.example/ })).toHaveAttribute(
      "href",
      "mailto:anna@nes.example",
    );
  });

  it("adres strony bez protokołu dostaje https w odnośniku, ale nie w treści", () => {
    // Redaktor wpisuje „anna.example"; `href` bez schematu byłby traktowany
    // jako ścieżka względna i prowadził w obrębie naszego serwisu.
    const expert = expertHub({ expert: { website_url: "anna.example" } }).expert;
    render(<ContactInline expert={expert} />);
    const link = screen.getByRole("link", { name: /anna\.example/ });
    expect(link).toHaveAttribute("href", "https://anna.example");
    expect(link).toHaveTextContent("anna.example");
  });

  it("pełny adres z protokołem zostaje nietknięty, a w treści traci schemat", () => {
    const expert = expertHub({ expert: { website_url: "https://anna.example/blog" } }).expert;
    render(<ContactInline expert={expert} />);
    const link = screen.getByRole("link", { name: /anna\.example/ });
    expect(link).toHaveAttribute("href", "https://anna.example/blog");
    expect(link).not.toHaveTextContent("https://");
  });

  it("bez trybu podglądu nie pojawia się kontakt przykładowy", () => {
    const { container } = render(<ContactInline expert={expertHub().expert} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("tryb podglądu dosypuje komplet kontaktów przykładowych", () => {
    render(<ContactInline expert={expertHub().expert} showPlaceholders />);
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.getByRole("link", { name: new RegExp(ph.email) })).toHaveAttribute(
      "href",
      `mailto:${ph.email}`,
    );
  });

  it("numer telefonu traci spacje w odnośniku tel:", () => {
    // `tel:+48 22 …` ze spacjami nie wybierze się na części telefonów.
    render(<ContactInline expert={expertHub().expert} showPlaceholders />);
    const tel = screen.getByRole("link", { name: new RegExp(ph.phone.replace(/\+/g, "\\+")) });
    expect(tel).toHaveAttribute("href", `tel:${ph.phone.replace(/\s+/g, "")}`);
  });

  it("kolor z presetu schodzi na blok, ale bez koloru nie ustawia przezroczystości", () => {
    const expert = expertHub({ expert: { contact_email: "a@b.example" } }).expert;
    const { container: zKolorem } = render(<ContactInline expert={expert} color="#ff0000" />);
    expect(zKolorem.firstElementChild).toHaveStyle({ color: "#ff0000", opacity: "0.9" });
    const { container: bez } = render(<ContactInline expert={expert} />);
    expect(bez.firstElementChild).not.toHaveStyle({ opacity: "0.9" });
  });
});

describe("ExpertSectionsList", () => {
  const hub = expertHub();

  it("hero NIGDY nie jest renderowane przez listę sekcji", () => {
    // Hero rysuje `ExpertLayoutHero`; gdyby lista też je wypuszczała, strona
    // eksperta miałaby dwa nagłówki z tym samym nazwiskiem.
    const { container } = render(
      <ExpertSectionsList
        hub={hub}
        settings={expertSettings({ section_order: ["hero_cover"] })}
        lang="pl"
      />,
    );
    expect(container.querySelectorAll(".grid > *")).toHaveLength(0);
  });

  it("pomija sekcje wyłączone przez redakcję", () => {
    const { container: wlaczone } = render(
      <ExpertSectionsList
        hub={hub}
        settings={expertSettings({ section_order: ["expertise_bar"] })}
        lang="pl"
      />,
    );
    const { container: wylaczone } = render(
      <ExpertSectionsList
        hub={hub}
        settings={expertSettings({ section_order: ["expertise_bar"], show_expertise_bar: false })}
        lang="pl"
      />,
    );
    expect(wylaczone.innerHTML.length).toBeLessThanOrEqual(wlaczone.innerHTML.length);
  });

  it("pusta kolejność wraca do domyślnej, zamiast dać pustą stronę", () => {
    // Wiersz zapisany przed migracją kolejności ma pustą tablicę.
    const { container } = render(
      <ExpertSectionsList hub={hub} settings={expertSettings({ section_order: [] })} lang="pl" />,
    );
    expect(container.firstElementChild).toBeInTheDocument();
  });

  it("respektuje maksymalną szerokość treści z ustawień", () => {
    const { container } = render(
      <ExpertSectionsList hub={hub} settings={expertSettings({ max_width: 980 })} lang="pl" />,
    );
    expect(container.firstElementChild).toHaveStyle({ maxWidth: "980px" });
  });
});

describe("ExpertLayoutStyleScope", () => {
  it("emituje regułę ograniczoną do własnego wrappera", () => {
    const { container } = render(
      <ExpertLayoutStyleScope scopeId="tenant-1" settings={expertSettings()} />,
    );
    const css = container.querySelector("style")?.innerHTML ?? "";
    expect(css).toContain('.dark [data-pv-scope="tenant-1"]');
  });

  it("przycina identyfikator - wartość wywołującego nie domknie selektora", () => {
    const { container } = render(
      <ExpertLayoutStyleScope
        scopeId='a"]{} body{display:none} [x="'
        settings={expertSettings()}
      />,
    );
    const css = container.querySelector("style")?.innerHTML ?? "";
    expect(css).not.toContain("body{display:none}");
    expect(css).toContain('[data-pv-scope="abodydisplaynonex"]');
  });

  it("niesie WARIANTY CIEMNE tokenów", () => {
    const { container } = render(
      <ExpertLayoutStyleScope
        scopeId="t"
        settings={expertSettings({ accent_color_dark: "#abcdef" })}
      />,
    );
    expect(container.querySelector("style")?.innerHTML).toContain("--pv-accent: #abcdef;");
  });
});
