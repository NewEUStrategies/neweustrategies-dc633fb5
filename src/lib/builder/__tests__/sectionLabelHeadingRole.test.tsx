// Etykieta sekcji a hierarchia nagłówków (audyt Lighthouse „heading-order").
//
// Tytuły kart pod etykietą to `h3`, a strona ma jeden `h1`. Bez poziomu
// pośredniego czytnik ekranu widzi skok h1 -> h3. Każdy wariant etykiety
// oznacza więc swój tytuł rolą nagłówka drugiego stopnia - rolą ARIA, nie
// znacznikiem `h2`, żeby globalna typografia nagłówków nie ruszyła geometrii.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { SECTION_LABEL_VARIANTS, SectionLabelRender } from "@/lib/builder/sectionLabelVariants";

afterEach(cleanup);

describe("Etykieta sekcji - rola nagłówka", () => {
  it.each(SECTION_LABEL_VARIANTS.map((v) => v.value))(
    "wariant %s ma dokładnie jeden nagłówek 2. stopnia z tekstem etykiety",
    (variant) => {
      const { container } = render(
        <SectionLabelRender label="Najnowszy raport" accent="#FA9346" variant={variant} />,
      );
      const headings = container.querySelectorAll('[role="heading"]');
      expect(headings).toHaveLength(1);
      expect(headings[0].getAttribute("aria-level")).toBe("2");
      expect(headings[0].hasAttribute("data-title-root")).toBe(true);
      expect(headings[0].textContent).toContain("Najnowszy raport");
      expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    },
  );

  it("miniatura panelu (sm) nie jest nagłówkiem", () => {
    const { container } = render(
      <SectionLabelRender label="Najnowszy raport" accent="#FA9346" variant="left-bar" size="sm" />,
    );
    expect(container.querySelector('[role="heading"]')).toBeNull();
  });

  it("pusta etykieta nie zostawia pustego nagłówka", () => {
    const { container } = render(
      <SectionLabelRender label="" accent="#FA9346" variant="left-bar" />,
    );
    expect(container.querySelector('[role="heading"]')).toBeNull();
  });
});
