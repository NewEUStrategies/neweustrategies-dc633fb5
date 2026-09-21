// CO TEN PLIK DOWODZI
// -------------------
// Nagłówek profilu organizacji trzyma JEDEN kontrakt: BRAK DANEJ = ELEMENT
// ZNIKA. Nie ma pigułki „Branża: -", nie ma pustego `<span>` po adresie WWW,
// nie ma karty „O organizacji" z samym nagłówkiem. To nie jest kosmetyka:
// pusty slot czyta się jak informacja („ta organizacja nie ma branży"), choć
// znaczy tylko tyle, że kartoteka CRM nie zna tej nazwy.
//
// Poza tym: logo z kartoteki ma pierwszeństwo przed grafiką termu, adres WWW
// pokazuje domenę, a prowadzi pod pełny URL (kartoteka bywa wypełniona bez
// protokołu - wtedy przeglądarka potraktowałaby wartość jako ścieżkę), a lista
// publikacji jest DELEGOWANA do wspólnego organizmu archiwum, zamiast być
// przepisaną siatką.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
// ---------------------------
// Sekcji osób (`organizationPeople.test.tsx`), nagłówka SEO i JSON-LD trasy
// (`src/routes/__tests__/organizationRoute.test.tsx`), warstwy zapytań
// (`src/lib/queries/__tests__/organization.test.ts`) ani samej siatki kart i
// paginacji - `PaginatedPostGrid` i `ArchivePagination` mają własne testy,
// dlatego są tu atrapą echującą propsy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ lang: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => state.lang),
);
vi.mock("@/lib/i18n-organizations", () => ({ ensureI18n: () => undefined }));
// Siatka wpisów ma własne testy; tu dowodzimy WYŁĄCZNIE tego, że profil jej
// używa i podaje jej prawdziwe wartości, zamiast rysować własną listę.
vi.mock("@/components/archive/PaginatedPostGrid", () => ({
  PaginatedPostGrid: (props: Record<string, unknown>) => (
    <div
      data-testid="paginated-post-grid"
      data-page={String(props.page)}
      data-total-pages={String(props.totalPages)}
      data-posts={String((props.posts as unknown[]).length)}
      data-empty={String(props.emptyText)}
    />
  ),
}));

import { OrganizationPosts } from "@/components/organizations/OrganizationPosts";
import {
  OrganizationProfile,
  prettyWebsite,
  websiteHref,
} from "@/components/organizations/OrganizationProfile";
import type { OrganizationData } from "@/lib/queries/organization";

const TERM = {
  id: "org-1",
  slug: "nato",
  name_pl: "NATO",
  name_en: "North Atlantic Treaty Organization",
  description_pl: "Sojusz polityczno-wojskowy.",
  description_en: null,
  logo_url: "https://cdn.example/term.svg",
  color: null,
};

const BRAND = {
  name: "NATO",
  logoUrl: "https://cdn.example/crm.svg",
  website: "www.nato.int/",
  branch: "Bezpieczeństwo",
};

function dane(over: Partial<OrganizationData> = {}): OrganizationData {
  return { term: TERM, brand: BRAND, ...over };
}

function pokaz(data: OrganizationData, total = 7, lang: "pl" | "en" = "pl") {
  return render(<OrganizationProfile data={data} lang={lang} total={total} />);
}

/** Logo w nagłówku - obrazek z atrybutem `alt` równym nazwie organizacji. */
function logo(): HTMLImageElement | null {
  return document.querySelector<HTMLImageElement>('img[alt="NATO"]');
}

afterEach(() => {
  cleanup();
  state.lang = "pl";
});

describe("tożsamość organizacji w nagłówku", () => {
  it("pokazuje nazwę w języku strony i logo z kartoteki CRM", () => {
    pokaz(dane());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("NATO");
    // Kartoteka jest utrzymywana przez redakcję; term bywa zasiany bez grafiki.
    expect(logo()?.getAttribute("src")).toBe(BRAND.logoUrl);
  });

  it("bez marki CRM logo schodzi do grafiki termu", () => {
    pokaz(dane({ brand: null }));
    expect(logo()?.getAttribute("src")).toBe(TERM.logo_url);
  });

  it("bez żadnego logo zostaje inicjał, a nie zepsuty obrazek", () => {
    pokaz(dane({ term: { ...TERM, logo_url: null }, brand: null }));
    expect(logo()).toBeNull();
    expect(screen.getByText("N")).toBeTruthy();
  });

  it("wersja angielska bierze nazwę angielską", () => {
    state.lang = "en";
    pokaz(dane(), 7, "en");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(TERM.name_en);
  });

  it("nazwa spada na drugi język, gdy w języku strony jej nie ma", () => {
    pokaz(dane({ term: { ...TERM, name_pl: "" } }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(TERM.name_en);
  });
});

describe("pigułki meta: brak danej = element znika", () => {
  it("komplet danych daje branżę, adres i licznik publikacji", () => {
    pokaz(dane());
    expect(screen.getByText("Bezpieczeństwo")).toBeTruthy();
    expect(screen.getByText("nato.int")).toBeTruthy();
    expect(screen.getByText("organization.postsCount(count=7)")).toBeTruthy();
  });

  it("bez branży pigułka branży nie renderuje się w ogóle", () => {
    pokaz(dane({ brand: { ...BRAND, branch: null } }));
    expect(screen.queryByText("Bezpieczeństwo")).toBeNull();
    // Pozostałe pigułki zostają - brak jednej danej nie gasi całego wiersza.
    expect(screen.getByText("nato.int")).toBeTruthy();
  });

  it("bez adresu WWW nie ma ani odnośnika, ani pustego slotu po nim", () => {
    pokaz(dane({ brand: { ...BRAND, website: null } }));
    expect(screen.queryByText("nato.int")).toBeNull();
    expect(document.querySelectorAll("a[href]").length).toBe(0);
  });

  it("zero publikacji chowa licznik - „0 publikacji” to komunikat, nie dana", () => {
    pokaz(dane(), 0);
    expect(screen.queryByText(/postsCount/)).toBeNull();
  });

  it("bez marki CRM nie zostaje po pigułkach żaden ślad", () => {
    pokaz(dane({ brand: null }), 0);
    expect(screen.queryByText("Bezpieczeństwo")).toBeNull();
    expect(screen.queryByText("nato.int")).toBeNull();
    expect(screen.queryByText(/postsCount/)).toBeNull();
  });

  it("adres pokazuje domenę, a prowadzi pod pełny URL z protokołem", () => {
    // Kartoteka bywa wypełniona bez „https://" - bez normalizacji przeglądarka
    // potraktowałaby wartość jako ścieżkę względną na naszej domenie.
    pokaz(dane());
    const link = screen.getByText("nato.int").closest("a");
    expect(link?.getAttribute("href")).toBe("https://www.nato.int/");
  });

  it("czyste reguły adresu obsługują obie postaci zapisu", () => {
    expect(prettyWebsite("https://www.example.com/")).toBe("example.com");
    expect(prettyWebsite("example.com")).toBe("example.com");
    expect(websiteHref("example.com")).toBe("https://example.com");
    expect(websiteHref("http://example.com")).toBe("http://example.com");
  });
});

describe("opis organizacji", () => {
  it("renderuje kartę „O organizacji”, gdy opis jest", () => {
    pokaz(dane());
    expect(screen.getByText("Sojusz polityczno-wojskowy.")).toBeTruthy();
    expect(screen.getByText("organization.aboutHeading")).toBeTruthy();
  });

  it("bez opisu znika CAŁA karta, nie tylko jej treść", () => {
    pokaz(dane({ term: { ...TERM, description_pl: null, description_en: null } }));
    expect(screen.queryByText("organization.aboutHeading")).toBeNull();
  });

  it("opis w drugim języku jest lepszy niż brak opisu", () => {
    state.lang = "en";
    pokaz(dane(), 7, "en");
    expect(screen.getByText("Sojusz polityczno-wojskowy.")).toBeTruthy();
  });
});

describe("lista publikacji", () => {
  it("delegowana do wspólnego organizmu archiwum z prawdziwą paginacją", () => {
    render(
      <OrganizationPosts
        posts={[]}
        page={2}
        totalPages={3}
        lang="pl"
        heading="organization.postsHeading"
        emptyText="organization.postsEmpty"
        isPending={false}
        onPageChange={() => undefined}
        hrefFor={(p) => `/organization/nato?page=${p}`}
      />,
    );
    const grid = screen.getByTestId("paginated-post-grid");
    expect(grid.getAttribute("data-page")).toBe("2");
    expect(grid.getAttribute("data-total-pages")).toBe("3");
    expect(screen.getByText("organization.postsHeading")).toBeTruthy();
  });

  it("zero treści nie chowa sekcji - pusta lista ma własny komunikat", () => {
    // Inaczej niż osoby: brak wpisów jest STANEM ARCHIWUM, o którym czytelnik
    // ma się dowiedzieć, a nie brakiem danych do pokazania.
    render(
      <OrganizationPosts
        posts={[]}
        page={1}
        totalPages={1}
        lang="pl"
        heading="organization.postsHeading"
        emptyText="organization.postsEmpty"
        isPending={false}
        onPageChange={() => undefined}
        hrefFor={() => "/organization/nato"}
      />,
    );
    expect(screen.getByTestId("paginated-post-grid").getAttribute("data-empty")).toBe(
      "organization.postsEmpty",
    );
  });
});
