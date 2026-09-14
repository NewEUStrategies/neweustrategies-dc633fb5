// Podgląd JEDNEJ karty udostępniania. Ekran /admin/seo/social renderuje pięć
// takich kart obok siebie i CAŁA jego wartość polega na tym, że one się RÓŻNIĄ
// - kadrem miniatury, progiem przycięcia i miejscem, w którym stoi host.
//
// Testy trasy podmieniają ten komponent na marker zapisujący propy (dowodzą, CO
// dostaje każda sieć). Tutaj dowodzimy, co komponent z tym ROBI - bo gdyby
// rysował wszystkie karty jednakowo, tamte testy nadal byłyby zielone, a ekran
// pokazywałby pięć kopii tego samego i kłamał na temat przycięcia.
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SocialCardPreview } from "@/components/admin/seo/SocialCardPreview";
import { socialNetworkSpec, type SocialNetworkSpec } from "@/lib/seo/socialNetworks";

afterEach(() => cleanup());

const base = {
  imageUrl: "https://cdn.example/og.jpg",
  title: "Krótki tytuł",
  description: "Krótki opis karty.",
  host: "neweuropeanstrategies.com",
  imageAlt: "Karta marki",
  emptyImageLabel: "Brak obrazka",
};

const spec = (overrides: Partial<SocialNetworkSpec> = {}): SocialNetworkSpec => ({
  ...socialNetworkSpec("facebook"),
  ...overrides,
});

describe("SocialCardPreview", () => {
  it("kadr miniatury bierze proporcję ZE SPECYFIKACJI sieci", () => {
    // To jest jedyne miejsce, w którym widać, ile z obrazka sieć faktycznie
    // pokaże. Zaszyty kadr 1200x630 czyniłby podgląd X-a nieprawdziwym.
    const { container } = render(<SocialCardPreview {...base} spec={spec({ aspect: "2 / 1" })} />);
    const frame = container.querySelector("[style*='aspect-ratio']") as HTMLElement | null;
    expect(frame?.getAttribute("style")).toContain("2 / 1");
  });

  it("tytuł jest przycinany do progu SWOJEJ sieci", () => {
    render(<SocialCardPreview {...base} title={"a".repeat(200)} spec={spec({ titleLimit: 20 })} />);
    const shown = screen.getByText(/a+…/);
    expect(shown.textContent).toHaveLength(20);
  });

  it("sieć BEZ opisu (próg 0) nie rysuje pustego akapitu", () => {
    // W prawdziwym unfurlu tej linii po prostu NIE MA - pusty akapit
    // rezerwowałby miejsce, którego sieć nie rezerwuje.
    render(<SocialCardPreview {...base} spec={spec({ descriptionLimit: 0 })} />);
    expect(screen.queryByText(base.description)).toBeNull();
  });

  it("host stoi NAD tytułem przy `above`, a POD nim przy `below`", () => {
    // Jedyna widoczna różnica między unfurlem Facebooka a kartą X-a poza
    // przycięciem - i powód, dla którego `hostPosition` w ogóle istnieje.
    const { container: above } = render(
      <SocialCardPreview {...base} spec={spec({ hostPosition: "above" })} />,
    );
    const aboveText = above.textContent ?? "";
    expect(aboveText.indexOf(base.host)).toBeLessThan(aboveText.indexOf(base.title));
    cleanup();
    const { container: below } = render(
      <SocialCardPreview {...base} spec={spec({ hostPosition: "below" })} />,
    );
    const belowText = below.textContent ?? "";
    expect(belowText.indexOf(base.host)).toBeGreaterThan(belowText.indexOf(base.title));
  });

  it("pusty adres obrazka rysuje placeholder z PODANYM napisem", () => {
    // Komponent nie tłumaczy niczego sam - napis podaje rodzic, bo to on zna
    // język podglądu.
    render(<SocialCardPreview {...base} imageUrl="" spec={spec()} />);
    expect(screen.getByText("Brak obrazka")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("obrazek dostaje przekazany opis alternatywny", () => {
    render(<SocialCardPreview {...base} spec={spec()} />);
    expect(screen.getByRole("img").getAttribute("alt")).toBe("Karta marki");
  });

  it("nazwa sieci jest podpisem karty - stąd wiadomo, na co się patrzy", () => {
    render(<SocialCardPreview {...base} spec={spec({ label: "LinkedIn" })} />);
    expect(screen.getByText("LinkedIn")).toBeTruthy();
  });

  it("tekst mieszczący się w progu NIE dostaje wielokropka", () => {
    render(<SocialCardPreview {...base} spec={spec({ titleLimit: 200 })} />);
    expect(screen.getByText("Krótki tytuł")).toBeTruthy();
  });
});
