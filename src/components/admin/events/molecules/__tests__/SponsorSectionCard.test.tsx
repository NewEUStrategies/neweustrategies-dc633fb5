// Molekuła „KARTA SEKCJI SPONSORÓW" - jeden wiersz tablicy „Sponsorzy i reklama":
// tytuł sekcji, nazwa jej układu (baner albo siatka logo), logotypy przypiętych
// firm oraz przyciski edycji i zmiany kolejności.
//
// CO TEN PLIK DOWODZI.
//   1. UKŁAD JEST NAZWANY SŁOWEM. Pod tytułem stoi nazwa układu, bo po samych
//      logotypach organizator nie odróżni baneru z jednym obrazem od siatki
//      z jedną firmą.
//   2. BANER POKAZUJE JEDEN OBRAZ. Sekcja baneru z kilkoma firmami (np. po
//      zmianie układu z siatki) rysuje tylko pierwszą - podgląd na tablicy nie
//      obiecuje więcej, niż pomieści baner.
//   3. SIATKA POKAZUJE KAŻDĄ FIRMĘ, a firma bez logotypu jest podpisana nazwą,
//      zamiast zostawiać pusty kafelek z pękniętym obrazem.
//   4. ADRES OBRAZU IDZIE PRZEZ DOMENĘ MARKI (`brandedMediaUrl`) - techniczny
//      host magazynu nie trafia do znacznika `img`; adres spoza magazynu
//      zostaje taki, jaki jest.
//   5. PUSTA SEKCJA MÓWI, ŻE JEST PUSTA, zamiast rysować puste miejsce.
//   6. PRZYCISKI KOLEJNOŚCI ZNAJĄ KRAWĘDŹ: pierwsza sekcja nie jedzie wyżej,
//      ostatnia niżej, a kliknięcie oddaje kierunek (-1 / +1). Edycja ma nazwę
//      z tytułem sekcji, bo przy kilku kartach samo „Edytuj" jest dla czytnika
//      ekranu nierozróżnialne.
//   7. KAŻDY NAPIS KARTY MA TŁUMACZENIE PL I EN. Karta nie rozgałęzia się po
//      języku (zna tylko klucze), więc dowodem dwujęzyczności jest to, że każdy
//      klucz, który rysuje, rozwiązuje się w PRAWDZIWYM słowniku w obu językach.
//   8. Karta z logotypami nie ma naruszeń dostępności (axe).
//   9. LOGO NIEOGŁOSZONE JEST WIDAĆ JAKO NIEOGŁOSZONE. Tablica zapisuje nowe
//      logo jako nieogłoszone, a strona wydarzenia pokazuje tylko ogłoszonych -
//      karta przygasza takie logo, podpisuje je plakietką i mówi w nagłówku,
//      ile logotypów sekcji czeka na ogłoszenie (także tych, których baner nie
//      rysuje).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguł `brandedMediaUrl` - mają tabele
// w `lib/media/__tests__/publicUrl.test.ts`; tutaj funkcja jest PRAWDZIWA, liczy
// się tylko to, że karta przez nią przechodzi. (2) Grupowania i kolejności
// logotypów oraz wyboru tytułu PL/EN - to robi tablica
// (`organisms/__tests__/SponsorSectionsBoard.test.tsx`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { PUBLIC_MEDIA_ORIGIN } from "@/lib/media/publicUrl";
import type { SponsorSectionLayout } from "@/lib/events/sponsorBoardApi";
import type { SponsorLogo } from "@/components/admin/events/molecules/SponsorSectionCard";

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  edycje: 0,
  ruchy: [] as number[],
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

import { SponsorSectionCard } from "@/components/admin/events/molecules/SponsorSectionCard";

const S = "sponsorBoard.sponsors";
const MAGAZYN = "https://projekt.supabase.co/storage/v1/object/public/media";

function logo(patch: Partial<SponsorLogo> = {}): SponsorLogo {
  return {
    id: "s1",
    name: "Alfa Energia",
    logoUrl: `${MAGAZYN}/sponsorzy/alfa.png`,
    isPublished: true,
    ...patch,
  };
}

function karta(
  props: {
    title?: string;
    layout?: SponsorSectionLayout;
    logos?: SponsorLogo[];
    isFirst?: boolean;
    isLast?: boolean;
  } = {},
) {
  return render(
    <SponsorSectionCard
      title={props.title ?? "Partnerzy strategiczni"}
      layout={props.layout ?? "grid"}
      logos={props.logos ?? []}
      isFirst={props.isFirst ?? false}
      isLast={props.isLast ?? false}
      onEdit={() => {
        h.edycje += 1;
      }}
      onMove={(dir) => {
        h.ruchy.push(dir);
      }}
    />,
  );
}

const obrazy = (): HTMLImageElement[] =>
  screen
    .queryAllByRole("img")
    .filter((el): el is HTMLImageElement => el instanceof HTMLImageElement);

const przycisk = (nazwa: string): HTMLElement => screen.getByRole("button", { name: nazwa });

beforeEach(() => {
  h.lang = "pl";
  h.edycje = 0;
  h.ruchy = [];
});

describe("nagłówek karty", () => {
  it("pokazuje tytuł sekcji i nazwę układu siatki", () => {
    karta({ layout: "grid" });
    expect(screen.getByRole("heading", { name: "Partnerzy strategiczni" })).toBeTruthy();
    expect(screen.getByText(`${S}.grid`)).toBeTruthy();
    expect(screen.queryByText(`${S}.banner`)).toBeNull();
  });

  it("sekcja baneru ma własną nazwę układu", () => {
    karta({ layout: "banner" });
    expect(screen.getByText(`${S}.banner`)).toBeTruthy();
    expect(screen.queryByText(`${S}.grid`)).toBeNull();
  });
});

describe("logotypy", () => {
  it.each<SponsorSectionLayout>(["grid", "banner"])(
    "pusta sekcja (%s) mówi, że nie ma logotypów, i nie rysuje obrazów ani listy",
    (layout) => {
      karta({ layout, logos: [] });
      expect(screen.getByText(`${S}.noLogos`)).toBeTruthy();
      expect(obrazy()).toEqual([]);
      expect(screen.queryByRole("list")).toBeNull();
    },
  );

  it("baner rysuje tylko PIERWSZĄ firmę, pod domeną marki i z nazwą w tekście alternatywnym", () => {
    karta({
      layout: "banner",
      logos: [
        logo(),
        logo({ id: "s2", name: "Beta Logistyka", logoUrl: `${MAGAZYN}/sponsorzy/beta.png` }),
      ],
    });
    const lista = obrazy();
    expect(lista).toHaveLength(1);
    expect(lista[0]?.getAttribute("alt")).toBe("Alfa Energia");
    expect(lista[0]?.getAttribute("src")).toBe(`${PUBLIC_MEDIA_ORIGIN}/media/sponsorzy/alfa.png`);
    expect(screen.queryByAltText("Beta Logistyka")).toBeNull();
    expect(screen.queryByText(`${S}.noLogos`)).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("siatka rysuje każdą firmę jako kafelek z nazwą w podpowiedzi", () => {
    karta({
      layout: "grid",
      logos: [
        logo(),
        logo({ id: "s2", name: "Beta Logistyka", logoUrl: "https://cdn.example.org/beta.svg" }),
      ],
    });
    const kafelki = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(kafelki.map((el) => el.getAttribute("title"))).toEqual([
      "Alfa Energia",
      "Beta Logistyka",
    ]);
    expect(obrazy().map((el) => [el.getAttribute("alt"), el.getAttribute("src")])).toEqual([
      ["Alfa Energia", `${PUBLIC_MEDIA_ORIGIN}/media/sponsorzy/alfa.png`],
      // Adres spoza magazynu nie jest przepisywany na domenę marki.
      ["Beta Logistyka", "https://cdn.example.org/beta.svg"],
    ]);
  });

  it("firma bez logotypu w siatce jest podpisana nazwą zamiast pękniętego obrazu", () => {
    karta({ layout: "grid", logos: [logo({ id: "s3", name: "Gamma Consulting", logoUrl: "" })] });
    const kafelek = within(screen.getByRole("list")).getByRole("listitem");
    expect(kafelek.textContent).toBe("Gamma Consulting");
    expect(obrazy()).toEqual([]);
  });
});

describe("stan ogłoszenia", () => {
  it("ogłoszone logotypy nie mają plakietki ani licznika w nagłówku", () => {
    karta({ layout: "grid", logos: [logo(), logo({ id: "s2", name: "Beta Logistyka" })] });
    expect(screen.queryByText(`${S}.draftBadge`)).toBeNull();
    expect(screen.queryByText(/draftCount/)).toBeNull();
    expect(obrazy().every((el) => !el.closest(".opacity-60"))).toBe(true);
  });

  it("siatka: logo nieogłoszone jest przygaszone i podpisane, nagłówek liczy nieogłoszone", () => {
    karta({
      layout: "grid",
      logos: [
        logo(),
        logo({ id: "s2", name: "Beta Logistyka", isPublished: false }),
        logo({ id: "s3", name: "Gamma Consulting", logoUrl: "", isPublished: false }),
      ],
    });
    const [alfa, beta, gamma] = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(within(alfa).queryByText(`${S}.draftBadge`)).toBeNull();
    expect(within(beta).getByText(`${S}.draftBadge`)).toBeTruthy();
    expect(within(gamma).getByText(`${S}.draftBadge`)).toBeTruthy();
    expect(within(beta).getByRole("img").closest(".opacity-60")).not.toBeNull();
    expect(within(alfa).getByRole("img").closest(".opacity-60")).toBeNull();
    // Licznik jedzie PARAMETREM klucza - a liczy obie nieogłoszone firmy.
    expect(screen.getByText(`${S}.draftCount(count=2)`)).toBeTruthy();
    // Podpowiedź kafla dalej niesie nazwę firmy - plakietka jej nie zastępuje.
    expect(beta.getAttribute("title")).toBe("Beta Logistyka");
  });

  it("baner: nieogłoszona pierwsza firma dostaje plakietkę pod obrazem", () => {
    karta({ layout: "banner", logos: [logo({ isPublished: false })] });
    expect(screen.getByText(`${S}.draftBadge`)).toBeTruthy();
    expect(obrazy()[0]?.className).toContain("opacity-60");
    expect(screen.getByText(`${S}.draftCount(count=1)`)).toBeTruthy();
  });

  it("baner: nieogłoszona DRUGA firma liczy się w nagłówku, choć baner jej nie rysuje", () => {
    karta({
      layout: "banner",
      logos: [logo(), logo({ id: "s2", name: "Beta Logistyka", isPublished: false })],
    });
    expect(screen.queryByText(`${S}.draftBadge`)).toBeNull();
    expect(obrazy()[0]?.className).not.toContain("opacity-60");
    expect(screen.getByText(`${S}.draftCount(count=1)`)).toBeTruthy();
  });

  it("plakietka i licznik mają tłumaczenie PL i EN, a licznik wstawia liczbę", () => {
    const pl = realT("pl");
    const en = realT("en");
    for (const klucz of [`${S}.draftBadge`, `${S}.draftCount`]) {
      expect(pl(klucz), `PL: ${klucz}`).not.toBe(klucz);
      expect(en(klucz), `EN: ${klucz}`).not.toBe(klucz);
      expect(en(klucz)).not.toBe(pl(klucz));
    }
    expect(pl(`${S}.draftCount`, { count: 3 })).toContain("3");
    expect(en(`${S}.draftCount`, { count: 3 })).toContain("3");
  });
});

describe("przyciski karty", () => {
  it("edycja ma w nazwie tytuł sekcji i woła edycję tej karty", () => {
    karta({ title: "Patroni medialni" });
    fireEvent.click(przycisk(`${S}.edit: Patroni medialni`));
    expect(h.edycje).toBe(1);
    expect(h.ruchy).toEqual([]);
  });

  it("pierwsza sekcja nie jedzie wyżej, ale może zjechać niżej", () => {
    karta({ isFirst: true });
    expect(przycisk(`${S}.moveUp`)).toHaveProperty("disabled", true);
    expect(przycisk(`${S}.moveDown`)).toHaveProperty("disabled", false);
    fireEvent.click(przycisk(`${S}.moveUp`));
    fireEvent.click(przycisk(`${S}.moveDown`));
    expect(h.ruchy).toEqual([1]);
  });

  it("ostatnia sekcja nie zjeżdża niżej, ale może pojechać wyżej", () => {
    karta({ isLast: true });
    expect(przycisk(`${S}.moveUp`)).toHaveProperty("disabled", false);
    expect(przycisk(`${S}.moveDown`)).toHaveProperty("disabled", true);
    fireEvent.click(przycisk(`${S}.moveDown`));
    fireEvent.click(przycisk(`${S}.moveUp`));
    expect(h.ruchy).toEqual([-1]);
  });

  it("jedyna sekcja ma oba przyciski kolejności zgaszone", () => {
    karta({ isFirst: true, isLast: true });
    fireEvent.click(przycisk(`${S}.moveUp`));
    fireEvent.click(przycisk(`${S}.moveDown`));
    expect(przycisk(`${S}.moveUp`)).toHaveProperty("disabled", true);
    expect(przycisk(`${S}.moveDown`)).toHaveProperty("disabled", true);
    expect(h.ruchy).toEqual([]);
  });

  it("sekcja ze środka listy jedzie w obie strony", () => {
    karta();
    fireEvent.click(przycisk(`${S}.moveUp`));
    fireEvent.click(przycisk(`${S}.moveDown`));
    expect(h.ruchy).toEqual([-1, 1]);
  });
});

describe("słownik i dostępność", () => {
  it("każdy klucz, który karta rysuje, ma tłumaczenie PL i EN", () => {
    const { container, unmount } = karta({ layout: "banner" });
    const zBaneru = container.innerHTML.match(/sponsorBoard\.[\w.]+/g) ?? [];
    unmount();
    const zSiatki = karta({ layout: "grid" }).container.innerHTML.match(/sponsorBoard\.[\w.]+/g);
    const klucze = [...new Set([...zBaneru, ...(zSiatki ?? [])])].sort();
    expect(klucze).toEqual([
      `${S}.banner`,
      `${S}.edit`,
      `${S}.grid`,
      `${S}.moveDown`,
      `${S}.moveUp`,
      `${S}.noLogos`,
    ]);
    const pl = realT("pl");
    const en = realT("en");
    for (const klucz of klucze) {
      expect(pl(klucz), `PL: ${klucz}`).not.toBe(klucz);
      expect(en(klucz), `EN: ${klucz}`).not.toBe(klucz);
      expect(en(klucz), `PL i EN nie mogą być tym samym napisem: ${klucz}`).not.toBe(pl(klucz));
    }
  });

  it.each<SponsorSectionLayout>(["grid", "banner"])(
    "karta (%s) z logotypami nie ma naruszeń dostępności",
    async (layout) => {
      const { container } = karta({
        layout,
        logos: [
          logo({ isPublished: false }),
          logo({ id: "s3", name: "Gamma Consulting", logoUrl: "", isPublished: false }),
        ],
      });
      const naruszenia = await axeViolations(container);
      expect(naruszenia, summarize(naruszenia)).toEqual([]);
    },
  );
});
