// KONTRAKT ROZMIARU BYLINU MUSI PRZETRWAĆ KASKADĘ.
//
// REGRESJA, KTÓRĄ TEN TEST ZAMYKA
// Byline dostawał rozmiar stylem inline (12 px / 20 px), ale warstwa typografii
// widgetu generuje reguły z `!important`:
//
//   [data-w-id="…"] span:not(.cms-post-title):not(.cms-post-excerpt)
//     :not([data-typography-exempt]):not(…){font-size:22px !important}
//
// `!important` z arkusza BIJE styl inline, a wyłączony z tego był wyłącznie
// zewnętrzny element bylinu - nie wewnętrzny `<span>` z nazwiskiem. Efekt na
// stronie: nazwisko renderowało się w rozmiarze typografii sekcji (16-22 px)
// zamiast 12 px, a suwak w panelu wyglądał na „dekoracyjny".
//
// JAK TO JEST MIERZONE - I DLACZEGO NIE `getComputedStyle`
// jsdom NIE stosuje tych reguł (nie rozwiązuje wygenerowanych selektorów), więc
// asercja na wyliczonym stylu przechodziłaby także PRZED naprawą - byłaby pusta.
// Zamiast tego konfrontujemy DOM z prawdziwymi selektorami generatora przez
// `Element.matches`: żaden węzeł bylinu nie może pasować do reguły, która
// ustawia `font-size`. Próba kontrolna (zwykły span) musi pasować - inaczej
// test mierzyłby własną pomyłkę w parsowaniu, a nie kod.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AuthorByline } from "../AuthorByline";
import { buildWidgetTypographyCss } from "@/lib/builder/typographyCss";
import { resolveAuthorDisplay } from "@/lib/builder/authorDisplay";
import type { WidgetTypography } from "@/lib/builder/types";

const WIDGET_ID = "w-byline";

/** Typografia sekcji, która wcześniej przejmowała byline. */
const AGGRESSIVE: WidgetTypography = {
  // `fontSize` jest responsywne (`ResponsiveValue`), więc próbka musi mieć
  // kształt, jaki naprawdę zapisuje panel - inaczej generator nie wyprodukuje
  // reguły `font-size` i test mierzyłby pustkę (pilnuje tego próba kontrolna).
  fontSize: { desktop: "22px", tablet: "22px", mobile: "22px" },
  fontWeight: "800",
  lineHeight: "2",
  letterSpacing: "3px",
};

/** Selektory reguł generatora, które ustawiają `font-size`. */
function fontSizeSelectors(css: string): string[] {
  const out: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [, selectorList, body] = match;
    if (!/font-size\s*:/.test(body)) continue;
    // matches() accepts a whole selector list. Splitting at commas would
    // break :is(p,span,...) into invalid selectors and invalidate the control.
    // Placeholder rules are separate and do not target byline elements.
    const trimmed = selectorList.trim();
    if (trimmed && !trimmed.includes("::")) out.push(trimmed);
  }
  return out;
}

function renderInWidget(content: Record<string, unknown>) {
  const view = render(
    <div data-w-id={WIDGET_ID}>
      {/* PRÓBA KONTROLNA: zwykły span BEZ wyłączenia - MUSI pasować do reguły
          typografii. Bez niej test mierzyłby własne parsowanie, nie kod. */}
      <span data-control-span>kontrola</span>
      <AuthorByline
        name="Anna Autorka"
        avatarUrl="https://cdn.example.com/anna.png"
        display={resolveAuthorDisplay(content, "pl")}
      />
    </div>,
  );
  const selectors = fontSizeSelectors(buildWidgetTypographyCss(WIDGET_ID, AGGRESSIVE, "desktop"));
  expect(selectors.length, "generator typografii musi realnie coś wyprodukować").toBeGreaterThan(0);

  const control = view.container.querySelector<HTMLElement>("[data-control-span]");
  expect(
    selectors.some((sel) => (control as HTMLElement).matches(sel)),
    "próba kontrolna nie łapie się na żadną regułę - test nic by nie dowodził",
  ).toBe(true);

  const byline = view.container.querySelector<HTMLElement>("[data-author-byline]");
  expect(byline).not.toBeNull();
  const bylineNodes: HTMLElement[] = [
    byline as HTMLElement,
    ...Array.from((byline as HTMLElement).querySelectorAll<HTMLElement>("*")),
  ];
  return { ...view, selectors, bylineNodes, byline: byline as HTMLElement };
}

afterEach(cleanup);

describe("AuthorByline - typografia widgetu nie ma jak przejąć bylinu", () => {
  it("żadna reguła `font-size !important` nie trafia w węzeł bylinu", () => {
    const { selectors, bylineNodes } = renderInWidget({});
    const captured = bylineNodes
      .filter((el) => selectors.some((sel) => el.matches(sel)))
      .map((el) => el.outerHTML.slice(0, 90));
    expect(
      captured,
      "węzeł bylinu łapie się na regułę typografii - `!important` zbije rozmiar inline",
    ).toEqual([]);
  });

  it("to samo dla trybu etykiety (prefiks i nazwisko to osobne węzły)", () => {
    const { selectors, bylineNodes } = renderInWidget({ showAuthorAvatar: false });
    expect(bylineNodes.filter((el) => selectors.some((sel) => el.matches(sel)))).toEqual([]);
  });

  it("KAŻDY węzeł bylinu nosi `data-typography-exempt`", () => {
    const { bylineNodes } = renderInWidget({});
    const unguarded = bylineNodes
      .filter((el) => !el.hasAttribute("data-typography-exempt"))
      .map((el) => el.outerHTML.slice(0, 90));
    expect(unguarded).toEqual([]);
  });
});

describe("AuthorByline - rozmiar jest wymuszony na każdym węźle tekstowym", () => {
  it("nazwisko i prefiks mają rozmiar inline, nie dziedziczony", () => {
    const { container } = render(
      <AuthorByline
        name="Anna Autorka"
        display={resolveAuthorDisplay({ showAuthorAvatar: false, authorSizePx: 14 }, "pl")}
      />,
    );
    expect(container.querySelector<HTMLElement>("[data-author-byline]")?.style.fontSize).toBe(
      "14px",
    );
    expect(container.querySelector<HTMLElement>("[data-author-byline-name]")?.style.fontSize).toBe(
      "14px",
    );
    expect(container.querySelector<HTMLElement>("[data-author-byline-label]")?.style.fontSize).toBe(
      "14px",
    );
  });
});

describe("AuthorByline - pudełko zdjęcia jest domknięte z obu stron", () => {
  const avatarStyleOf = (content: Record<string, unknown>): CSSStyleDeclaration => {
    const { container } = render(
      <AuthorByline
        name="Anna Autorka"
        avatarUrl="https://cdn.example.com/anna.png"
        display={resolveAuthorDisplay(content, "pl")}
      />,
    );
    const el = container.querySelector<HTMLElement>("[data-author-byline-avatar]");
    expect(el).not.toBeNull();
    return (el as HTMLElement).style;
  };

  it("domyślnie 20 px i 6 px zaokrąglenia, nie do ściśnięcia przez kontener", () => {
    const s = avatarStyleOf({});
    // `min-*` broni przed zgnieceniem przez flexa, `max-*` przed rozdęciem
    // przez `max-width:100%` z globalnych reguł obrazów.
    expect([s.width, s.minWidth, s.maxWidth, s.height, s.minHeight, s.maxHeight]).toEqual([
      "20px",
      "20px",
      "20px",
      "20px",
      "20px",
      "20px",
    ]);
    expect(s.flex).toBe("0 0 auto");
    expect(s.borderRadius).toBe("6px");
  });

  it("własny rozmiar zdjęcia domyka wszystkie cztery wymiary", () => {
    const s = avatarStyleOf({ authorAvatarSizePx: 44 });
    expect([s.width, s.minWidth, s.maxWidth, s.height, s.minHeight, s.maxHeight]).toEqual([
      "44px",
      "44px",
      "44px",
      "44px",
      "44px",
      "44px",
    ]);
  });

  it("kafelek z inicjałem (brak zdjęcia) trzyma ten sam kontrakt", () => {
    const { container } = render(
      <AuthorByline name="Anna Autorka" display={resolveAuthorDisplay({}, "pl")} />,
    );
    const box = container.querySelector<HTMLElement>("[data-author-byline-avatar]");
    expect(box?.style.width).toBe("20px");
    expect(box?.style.borderRadius).toBe("6px");
    expect(box?.hasAttribute("data-typography-exempt")).toBe(true);
  });
});
