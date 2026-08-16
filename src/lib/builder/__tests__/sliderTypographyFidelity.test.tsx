// Bramka wierności typografii slidera: rozmiar tytułu, rozmiar opisu i odstęp
// tytuł-opis muszą trafiać do DOM jako reguły `!important` scopowane do
// instancji - inline-style przegrywał z `!important` z `WidgetView`.
import { describe, it, expect, vi } from "vitest";
import { renderWithQueryClient as render } from "@/test/renderWithQueryClient";
import { SliderRender } from "@/lib/builder/sliderVariants";

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => null,
  Link: (p: { children?: React.ReactNode }) => <>{p.children}</>,
}));

const items = [
  {
    image: "https://example.org/a.jpg",
    title_pl: "Stub tytuł",
    title_en: "Stub title",
    subtitle_pl: "Stub zajawka.",
    subtitle_en: "Stub excerpt.",
    href: "",
  },
];

function styleText(container: HTMLElement): string {
  return [...container.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
}

describe("SliderRender - typografia editorial-hero", () => {
  it("emituje rozmiar tytułu, opisu i odstęp jako reguły instancji", () => {
    const { container } = render(
      <SliderRender
        config={{
          variant: "editorial-hero",
          items,
          typography: {
            fontSize: { desktop: "26px", tablet: "26px", mobile: "26px" },
            descriptionFontSize: { desktop: "16px", tablet: "16px", mobile: "16px" },
            titleDescriptionGapPx: 0,
          },
        }}
        lang="pl"
      />,
    );
    const css = styleText(container);
    expect(css).toMatch(/\.cms-post-title\{font-size:26px !important;\}/);
    expect(css).toMatch(/\.cms-post-excerpt\{font-size:16px !important;\}/);
    expect(css).toMatch(/\[data-eh-gap\]\{margin-top:0px !important;\}/);
    expect(container.querySelector("[data-eh-gap]")).not.toBeNull();
  });

  it("gdy brak typografii, używa rozmiarów z panelu slidera", () => {
    const { container } = render(
      <SliderRender
        config={{ variant: "editorial-hero", items, titleSizePx: 30, subtitleSizePx: 14 }}
        lang="pl"
      />,
    );
    const css = styleText(container);
    expect(css).toContain("font-size:30px !important;");
    expect(css).toContain("font-size:14px !important;");
  });

  it("odsiewa znaki mogące rozerwać regułę CSS", () => {
    const { container } = render(
      <SliderRender
        config={{
          variant: "editorial-hero",
          items,
          typography: { fontSize: { desktop: "26px}<script>" } },
        }}
        lang="pl"
      />,
    );
    const css = styleText(container);
    expect(css).not.toContain("script");
    expect(css).not.toMatch(/font-size:[^;]*[<>{}]/);
  });
});

describe("SliderRender - osobny rozmiar mobilny", () => {
  it("emituje media query z mobilnym rozmiarem tytułu i opisu", () => {
    const { container } = render(
      <SliderRender
        config={{
          variant: "editorial-hero",
          items,
          typography: {
            fontSize: { desktop: "34px", tablet: "34px", mobile: "26px" },
            descriptionFontSize: { desktop: "16px", tablet: "16px", mobile: "14px" },
          },
        }}
        lang="pl"
      />,
    );
    const css = styleText(container);
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toMatch(/@media \(max-width: 767px\)\{[^}]*font-size:26px !important;/);
    expect(css).toContain("font-size:14px !important;");
    expect(css).toContain('[data-builder-renderer][data-device="mobile"]');
  });
});
