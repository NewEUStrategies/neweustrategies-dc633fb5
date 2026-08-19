// Blok tożsamości eksperta i piktogramy presetów układu.
//
// `ExpertHubDetails` decyduje, JAKIE DANE KONTAKTOWE trafiają na publiczną
// stronę eksperta - a to jest granica prywatności, nie kosmetyka. Karta
// kontaktu ma zniknąć w całości, gdy nie ma czego pokazać; pusta ramka
// z nagłówkiem „Kontakt" sugeruje, że dane są, tylko się nie wczytały.
//
// `ExpertPresetThumb` jest jedynym miejscem, po którym wybierający (admin
// i sam ekspert) poznaje strukturę wariantu bez ładowania podglądu - każdy
// preset musi mieć WŁASNY piktogram, inaczej wybór jest zgadywaniem.
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { EXPERT_LAYOUT_PRESETS } from "@/lib/expertLayouts";
import type { ExpertHubData } from "@/lib/experts/types";

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub };
});

const { ExpertHubDetails } = await import("@/components/experts/ExpertHubDetails");
const { ExpertPresetThumb } = await import("@/components/experts/ExpertPresetThumb");

const t = realT("pl");

function hub(overrides: Partial<ExpertHubData> = {}): ExpertHubData {
  return {
    expert: {
      id: "u1",
      tenant_id: "t1",
      slug: "anna",
      display_name: "Anna Kowalska",
      avatar_url: null,
      cover_url: null,
      job_title: null,
      company: null,
      bio_pl: null,
      bio_en: null,
      full_bio_pl: null,
      full_bio_en: null,
      org_functions: [],
      verified_at: null,
      updated_at: null,
      is_expert: true,
      expert_requests_enabled: true,
      contact_email: null,
      website_url: null,
      twitter_url: null,
      linkedin_url: null,
      media_contact_name: null,
      media_contact_email: null,
      ...(overrides.expert ?? {}),
    },
    programs: [],
    areas: [],
    mediaMentions: [],
    materials: [],
    facets: { programs: [], regions: [], categories: [], tags: [] },
    ...overrides,
  } as ExpertHubData;
}

function program(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    slug: "klimat",
    name_pl: "Klimat",
    name_en: "Climate",
    kind: "research",
    role_pl: "Kierowniczka",
    role_en: "Lead",
    description_pl: "Opis programu",
    description_en: "Program description",
    ...over,
  };
}

afterEach(async () => {
  await i18n.changeLanguage("pl");
  vi.clearAllMocks();
});

describe("ExpertHubDetails - kontakt jako granica prywatności", () => {
  it("bez ANI JEDNEJ danej kontaktowej karta w ogóle się nie pojawia", () => {
    // Pusta ramka z nagłówkiem „Kontakt" sugeruje, że dane są, tylko się nie
    // wczytały - a ekspert po prostu ich nie udostępnił.
    render(<ExpertHubDetails data={hub()} lang="pl" />);
    expect(screen.queryByText(String(t("expert.contactHeading")))).not.toBeInTheDocument();
  });

  it("sam adres e-mail wystarczy, żeby karta się pojawiła", () => {
    render(
      <ExpertHubDetails
        data={hub({ expert: { contact_email: "anna@nes.example" } as never })}
        lang="pl"
      />,
    );
    expect(screen.getByText(String(t("expert.contactHeading")))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /anna@nes.example/ })).toHaveAttribute(
      "href",
      "mailto:anna@nes.example",
    );
  });

  it("adres strony skraca się o protokół, ale link prowadzi pod pełny adres", () => {
    render(
      <ExpertHubDetails
        data={hub({ expert: { website_url: "https://anna.example/blog" } as never })}
        lang="pl"
      />,
    );
    const link = screen.getByRole("link", { name: /anna.example/ });
    expect(link).toHaveAttribute("href", "https://anna.example/blog");
    expect(link).toHaveTextContent("anna.example/blog");
    expect(link).not.toHaveTextContent("https://");
  });

  it("link do strony eksperta nie przekazuje odsyłacza zwrotnego", () => {
    render(
      <ExpertHubDetails
        data={hub({ expert: { website_url: "https://anna.example" } as never })}
        lang="pl"
      />,
    );
    const link = screen.getByRole("link", { name: /anna.example/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });
});

describe("ExpertHubDetails - obszary i programy", () => {
  it("bez obszarów sekcja ekspertyzy nie powstaje", () => {
    render(<ExpertHubDetails data={hub()} lang="pl" />);
    expect(screen.queryByText(String(t("expert.expertiseHeading")))).not.toBeInTheDocument();
  });

  it("obszar prowadzi do katalogu ekspertów PRZEFILTROWANEGO tym obszarem", () => {
    // To jedyne wejście z profilu do katalogu; bez parametru filtra klik
    // wysypuje pełną listę i użytkownik traci kontekst.
    render(
      <ExpertHubDetails
        data={hub({
          areas: [{ id: "a1", slug: "energia", name_pl: "Energia", name_en: "Energy" }],
        })}
        lang="pl"
      />,
    );
    expect(screen.getByRole("link", { name: "Energia" })).toHaveAttribute("href", "/experts");
  });

  it("nazwa obszaru idzie w języku strony", async () => {
    render(
      <ExpertHubDetails
        data={hub({ areas: [{ id: "a1", slug: "e", name_pl: "Energia", name_en: "Energy" }] })}
        lang="en"
      />,
    );
    expect(screen.getByRole("link", { name: "Energy" })).toBeInTheDocument();
  });

  it("DZIAŁY i PROGRAMY to dwie różne sekcje", () => {
    // `kind === "department"` rozdziela jednostkę organizacyjną od projektu
    // badawczego. Zlanie ich w jedno mieszałoby strukturę firmy z dorobkiem.
    render(
      <ExpertHubDetails
        data={hub({
          programs: [
            program(),
            program({ id: "d1", kind: "department", name_pl: "Dział analiz" }),
          ] as never,
        })}
        lang="pl"
      />,
    );
    expect(screen.getByText(String(t("expert.programsHeading")))).toBeInTheDocument();
    expect(screen.getByText(String(t("expert.departmentsHeading")))).toBeInTheDocument();
    expect(screen.getByText("Klimat")).toBeInTheDocument();
    expect(screen.getByText("Dział analiz")).toBeInTheDocument();
  });

  it("same działy nie tworzą pustej sekcji programów", () => {
    render(
      <ExpertHubDetails
        data={hub({ programs: [program({ kind: "department" })] as never })}
        lang="pl"
      />,
    );
    expect(screen.queryByText(String(t("expert.programsHeading")))).not.toBeInTheDocument();
    expect(screen.getByText(String(t("expert.departmentsHeading")))).toBeInTheDocument();
  });

  it("program pokazuje funkcję i opis, gdy są", () => {
    render(<ExpertHubDetails data={hub({ programs: [program()] as never })} lang="pl" />);
    expect(screen.getByText("Kierowniczka")).toBeInTheDocument();
    expect(screen.getByText("Opis programu")).toBeInTheDocument();
  });

  it("program bez funkcji i opisu renderuje samą nazwę", () => {
    const { container } = render(
      <ExpertHubDetails
        data={hub({
          programs: [program({ role_pl: null, description_pl: null })] as never,
        })}
        lang="pl"
      />,
    );
    expect(screen.getByText("Klimat")).toBeInTheDocument();
    expect(container.querySelectorAll("li p")).toHaveLength(1);
  });

  it("bez programów i działów blok nie renderuje pustych nagłówków", () => {
    render(<ExpertHubDetails data={hub()} lang="pl" />);
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });
});

describe("ExpertPresetThumb", () => {
  it.each(EXPERT_LAYOUT_PRESETS.map((p) => p.id))("preset %s ma własny piktogram", (id) => {
    const { container } = render(<ExpertPresetThumb id={id} />);
    expect(container.firstElementChild).toBeInTheDocument();
    expect(container.querySelectorAll("div").length).toBeGreaterThan(1);
  });

  it("piktogramy RÓŻNIĄ SIĘ między presetami", () => {
    // Gdyby dwa warianty rysowały ten sam schemat, wybór układu byłby
    // zgadywaniem - a to jest jedyny podgląd, jaki wybierający dostaje.
    const markup = EXPERT_LAYOUT_PRESETS.map(
      (p) => render(<ExpertPresetThumb id={p.id} />).container.innerHTML,
    );
    expect(new Set(markup).size).toBe(EXPERT_LAYOUT_PRESETS.length);
  });

  it("nie używa ikon zewnętrznych - sam układ na tokenach motywu", () => {
    // Warunek z nagłówka pliku: piktogram ma wyglądać identycznie w light
    // i dark, więc nie wolno mu wciągać biblioteki ikon.
    const { container } = render(<ExpertPresetThumb id="classic" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("nieznany preset daje pustą ramkę zamiast wywalić panel wyboru", () => {
    // Kolumna `default_preset` jest tekstem; wiersz sprzed usunięcia wariantu
    // dalej niesie jego identyfikator, a panel wyboru musi się wyrenderować.
    const { container } = render(<ExpertPresetThumb id={"nieistniejacy" as never} />);
    expect(container.firstElementChild).toBeInTheDocument();
    expect(container.querySelectorAll("div")).toHaveLength(1);
  });

  it("domyślnie ma wysokość siatki admina, a klasa jest nadpisywalna", () => {
    const { container: def } = render(<ExpertPresetThumb id="classic" />);
    expect(def.firstElementChild).toHaveClass("h-20");
    const { container: custom } = render(<ExpertPresetThumb id="classic" className="h-32" />);
    expect(custom.firstElementChild).toHaveClass("h-32");
    expect(custom.firstElementChild).not.toHaveClass("h-20");
  });
});
