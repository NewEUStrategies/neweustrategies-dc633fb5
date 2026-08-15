// Karta profilu autora: ODWZOROWANIE wzorca + parytet obu edytorów.
//
// Dwie klasy defektu, które ten plik zamyka:
//
//  1. „ODWZOROWANIE" ROZJEŻDŻAJĄCE SIĘ Z WZORCEM. Karta ma mieć duże kwadratowe
//     zdjęcie, kartę nachodzącą na nie od prawej, mocny cień i wypełnione
//     przyciski social - ale z platformowym zaokrągleniem 6 px zamiast
//     `rounded-3xl` z wklejonego kodu. Test pilnuje jednego i drugiego naraz,
//     bo „poprawka" w dowolną stronę psuje ustalenie.
//
//  2. DWA EDYTORY, DWA WYGLĄDY. Ten sam zestaw ustawień jedzie przez widget
//     `author-profile-card` (builder Elementor-like) i przez wariant `profile`
//     bloku `author-bio` (block editor / Gutenberg). Gdyby któraś ścieżka
//     przestała czytać wspólny czytnik ustawień, dokument przeniesiony między
//     edytorami wyglądałby inaczej - test porównuje realny DOM obu ścieżek.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfileCard, PROFILE_CARD_DEFAULTS } from "@/components/ui/profile-card";
import {
  PROFILE_CARD_STYLE_KEYS,
  readProfileCardStyle,
} from "@/lib/content-model/profileCardStyle";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { AuthorProfileCardWidget } from "@/components/builder/organisms/widget-view/AuthorProfileCardWidget";
import { AuthorBioView } from "@/components/blocks/PostContextViews";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";
import { filterInternalExperts, type InternalExpertEntry } from "@/lib/experts/internalBase";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit", "maybeSingle"])
    b[m] = () => b;
  b.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
  return { supabase: { from: () => b, rpc: async () => ({ data: [], error: null }) } };
});

afterEach(cleanup);

function draw(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Karta desktopowa = element z animacją wejścia / nakładką na zdjęcie. */
function desktopCard(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>("[data-profile-card] .md\\:flex > div:nth-child(2)");
  if (!el) throw new Error("nie znaleziono karty desktopowej");
  return el;
}

function photoBox(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>("[data-profile-card] .md\\:flex > div:nth-child(1)");
  if (!el) throw new Error("nie znaleziono kadru zdjęcia");
  return el;
}

const BASE = {
  name: "Anna Kowalska",
  title: "Senior Fellow, Energy Security",
  description: "Ekspertka New European Strategies.",
  imageUrl: "https://example.org/anna.jpg",
  socials: [{ key: "x", href: "https://x.com/nes", label: "X" }],
};

describe("ProfileCard - odwzorowanie wzorca", () => {
  it("trzyma platformowe 6 px zamiast rounded-3xl / rounded-full ze wzorca", () => {
    const { container } = draw(<ProfileCard {...BASE} />);
    const card = container.querySelector("[data-profile-card]")!;
    expect(card.innerHTML).not.toMatch(/rounded-3xl|rounded-full/);
    expect(photoBox(container).className).toContain("rounded-[6px]");
    expect(desktopCard(container).className).toContain("rounded-[6px]");
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="X"]')!;
    expect(link.className).toContain("rounded-[6px]");
  });

  it("odwzorowuje układ: duże zdjęcie, karta nachodząca, mocny cień, wypełnione social", () => {
    const { container } = draw(<ProfileCard {...BASE} />);
    expect(photoBox(container).style.width).toBe(`${PROFILE_CARD_DEFAULTS.imageSize}px`);
    expect(photoBox(container).style.maxWidth).toBe("46%");
    expect(desktopCard(container).style.marginLeft).toBe(`-${PROFILE_CARD_DEFAULTS.overlap}px`);
    expect(desktopCard(container).className).toContain("shadow-2xl");
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="X"]')!;
    expect(link.className).toContain("bg-foreground");
    expect(link.style.width).toBe(`${PROFILE_CARD_DEFAULTS.socialSize}px`);
  });

  it("animuje wejście karty (CSS, bez framer-motion)", () => {
    const { container } = draw(<ProfileCard {...BASE} />);
    expect(desktopCard(container).className).toContain("pc-rise-x");
    cleanup();
    const off = draw(<ProfileCard {...BASE} animate={false} />);
    expect(desktopCard(off.container).className).not.toContain("pc-rise-x");
  });

  it("honoruje ustawienia prezentacji", () => {
    const { container } = draw(
      <ProfileCard
        {...BASE}
        imageSize={320}
        overlap={0}
        maxWidth={800}
        shadow="none"
        socialStyle="outline"
        socialSize={32}
        align="left"
      />,
    );
    expect(photoBox(container).style.width).toBe("320px");
    expect(desktopCard(container).style.marginLeft).toBe("0px");
    expect(desktopCard(container).className).not.toMatch(/shadow-(sm|md|lg|2xl)/);
    expect(container.querySelector<HTMLElement>("[data-profile-card]")!.style.maxWidth).toBe(
      "800px",
    );
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="X"]')!;
    expect(link.className).toContain("border-border");
    expect(link.className).not.toContain("bg-foreground");
    expect(link.style.width).toBe("32px");
  });

  it("wartość spoza zakresu wraca do granicy zamiast rozjeżdżać układ", () => {
    const { container } = draw(<ProfileCard {...BASE} imageSize={5000} overlap={-40} />);
    expect(photoBox(container).style.width).toBe("720px");
    expect(desktopCard(container).style.marginLeft).toBe("0px");
  });
});

describe("readProfileCardStyle", () => {
  it("czyta klucze panelu i zostawia puste pola domyślnym", () => {
    expect(readProfileCardStyle({ imageSize: 300, overlap: "20", cardMaxWidth: "" })).toMatchObject(
      {
        imageSize: 300,
        overlap: 20,
        maxWidth: undefined,
      },
    );
  });

  it("nieznany cień nie przechodzi do karty", () => {
    expect(readProfileCardStyle({ shadow: "glow" }).shadow).toBeUndefined();
    expect(readProfileCardStyle({ shadow: "lg" }).shadow).toBe("lg");
  });

  it("`animate` jest domyślnie włączone i gasi je dopiero jawne false", () => {
    expect(readProfileCardStyle({}).animate).toBe(true);
    expect(readProfileCardStyle({ animate: false }).animate).toBe(false);
  });

  it("każde ustawienie prezentacji ma pole w panelu widgetu", () => {
    const keys = new Set((WIDGET_SCHEMAS["author-profile-card"] ?? []).map((f) => f.key));
    for (const k of PROFILE_CARD_STYLE_KEYS) {
      expect(keys.has(k), `brak pola „${k}" w panelu widgetu`).toBe(true);
    }
  });
});

describe("parytet builder <-> block editor", () => {
  const SETTINGS = {
    imageSize: 360,
    overlap: 24,
    cardMaxWidth: 900,
    shadow: "md",
    socialStyle: "outline",
    socialSize: 36,
    mobileAlign: "left",
    animate: false,
  };

  it("te same ustawienia dają tę samą kartę w obu edytorach", () => {
    const node: WidgetNode = {
      id: "w1",
      kind: "widget",
      type: "author-profile-card",
      content: {
        name: BASE.name,
        photo: BASE.imageUrl,
        position_pl: BASE.title,
        description_pl: BASE.description,
        ...SETTINGS,
      } as unknown as WidgetContent,
    };
    const widget = draw(<AuthorProfileCardWidget node={node} lang="pl" />);

    const ctx: CurrentPostCtx = {
      author: {
        name: BASE.name,
        avatarUrl: BASE.imageUrl,
        jobTitle: BASE.title,
        bio_pl: BASE.description,
      },
    } as unknown as CurrentPostCtx;
    const block = draw(
      <CurrentPostProvider value={ctx}>
        <AuthorBioView
          variant="profile"
          showPostsCount={false}
          lang="pl"
          profileStyle={readProfileCardStyle(SETTINGS)}
        />
      </CurrentPostProvider>,
    );

    expect(photoBox(block.container).style.width).toBe(photoBox(widget.container).style.width);
    expect(desktopCard(block.container).style.marginLeft).toBe(
      desktopCard(widget.container).style.marginLeft,
    );
    expect(desktopCard(block.container).className).toBe(desktopCard(widget.container).className);
    expect(block.container.querySelector<HTMLElement>("[data-profile-card]")!.style.maxWidth).toBe(
      "900px",
    );
  });
});

describe("filtr bazy wewnętrznej ekspertów", () => {
  const base: InternalExpertEntry[] = [
    {
      id: "1",
      name: "Anna Kowalska",
      slug: "anna-kowalska",
      avatarUrl: null,
      jobTitle: "Senior Fellow",
      company: "New European Strategies",
      isExpert: true,
      isPublic: true,
    },
    {
      id: "2",
      name: "Piotr Nowak",
      slug: null,
      avatarUrl: null,
      jobTitle: "Analityk energetyczny",
      company: null,
      isExpert: false,
      isPublic: false,
    },
  ];

  it("szuka po nazwisku, stanowisku i organizacji", () => {
    expect(filterInternalExperts(base, "nowak").map((e) => e.id)).toEqual(["2"]);
    expect(filterInternalExperts(base, "energet").map((e) => e.id)).toEqual(["2"]);
    expect(filterInternalExperts(base, "european").map((e) => e.id)).toEqual(["1"]);
  });

  it("pusty filtr zwraca całą bazę", () => {
    expect(filterInternalExperts(base, "  ")).toHaveLength(2);
  });
});
