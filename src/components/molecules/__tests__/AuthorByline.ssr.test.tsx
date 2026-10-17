// HTML z serwera = strona po hydratacji - byline „tytuł minus 2 px”.
//
// CO TEN PLIK DOWODZI:
//  1. Serwer i render hydratacji dają IDENTYCZNY znacznik (`pending`, bez
//     zmierzonego rozmiaru w stylu) - React nie zgłasza rozjazdu, a pomiar
//     przychodzi dopiero w efekcie layoutowym po hydratacji.
//  2. Miejsca bez tytułu (`authorDisplayWithoutTitle`) mają rozmiar z panelu
//     już w HTML-u z serwera, a hydratacja niczego w nim nie zmienia.
//  3. Szacunek CSS sprzed pomiaru używa TYCH SAMYCH tokenów i progów co tytuł
//     karty (`.cms-post-title`, `tfs`), więc pomiar potwierdza rozmiar z HTML-u,
//     zamiast go przestawiać. Reguły czytamy jako dane (`@/test/cssRules`).
import { readFileSync } from "node:fs";
import { act } from "@testing-library/react";
import type { ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorByline } from "../AuthorByline";
import {
  AUTHOR_NAME_SIZE_PX_DEFAULT,
  authorDisplayWithoutTitle,
  resolveAuthorDisplay,
} from "@/lib/builder/authorDisplay";
import { parseCssRules, type CssRule } from "@/test/cssRules";

async function hydrate(view: ReactElement) {
  const host = document.createElement("div");
  host.innerHTML = renderToString(view);
  document.body.append(host);
  const serverHtml = host.innerHTML;
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
  });
  return { host, serverHtml, errors, unmount: () => act(() => root?.unmount()) };
}

const byline = (root: ParentNode) => root.querySelector<HTMLElement>("[data-author-byline]")!;

describe("byline - serwer i hydratacja", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("karta z tytułem: serwer = render hydratacji, pomiar dopiero po niej", async () => {
    const view = (
      <article data-w-id="card">
        <h3 className="cms-post-title" style={{ fontSize: 20 }}>
          Tytuł
        </h3>
        <AuthorByline name="Jan Kowalski" />
      </article>
    );
    const server = renderToString(view);
    expect(server).toContain('data-author-title-relative="pending"');
    expect(server).not.toContain("--abl-title-relative-size");

    const { host, errors, unmount } = await hydrate(view);
    expect(errors).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(byline(host).getAttribute("data-author-title-relative")).toBe("measured");
    expect(byline(host).style.getPropertyValue("--abl-title-relative-size")).toBe("18px");
    await unmount();
  });

  it("miejsce bez tytułu: rozmiar z panelu w HTML-u z serwera, hydratacja go nie zmienia", async () => {
    const display = authorDisplayWithoutTitle(resolveAuthorDisplay({}, "pl"));
    const view = (
      <figure data-w-id="quote">
        <AuthorByline name="Jan Kowalski" display={display} />
      </figure>
    );
    const { host, serverHtml, errors, unmount } = await hydrate(view);
    expect(serverHtml).not.toContain("data-author-title-relative");
    expect(errors).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    // Żadnego zapisu po hydratacji - DOM jest tym, co przysłał serwer.
    expect(host.innerHTML).toBe(serverHtml);
    expect(byline(host).style.fontSize).toBe(`${AUTHOR_NAME_SIZE_PX_DEFAULT}px`);
    await unmount();
  });
});

describe("byline - szacunek CSS sprzed pomiaru mówi tym samym językiem co tytuł", () => {
  const RULES = parseCssRules(readFileSync("src/styles.css", "utf8"));
  const ruleFor = (selector: string, context: string[] = []) =>
    RULES.filter(
      (rule: CssRule) =>
        rule.selectors.includes(selector) && rule.context.join("|") === context.join("|"),
    );
  const declared = (selector: string, property: string, context: string[] = []) =>
    ruleFor(selector, context)
      .map((rule) => rule.declarations.get(property))
      .filter(Boolean);
  const MOBILE = ["@media (max-width: 640px)"];

  it("desktop i ≤ 640 px: te same tokeny i wartości zastępcze co `.cms-post-title`", () => {
    const titleDesktop = declared(".cms-post-title.cms-post-title", "font-size");
    const titleMobile = declared(".cms-post-title.cms-post-title", "font-size", MOBILE);
    expect(titleDesktop).toEqual(["var(--td-pt-size, 15px)"]);
    expect(titleMobile).toEqual(["var(--td-pt-size-sm, 14px)"]);
    expect(declared("[data-author-title-relative]", "--abl-title-estimate")).toEqual([
      `calc(var(--abl-title-fs, ${titleDesktop[0]}) - 2px)`,
    ]);
    expect(declared("[data-author-title-relative]", "--abl-title-estimate", MOBILE)).toEqual([
      `calc(var(--abl-title-fs, ${titleMobile[0]}) - 2px)`,
    ]);
  });

  it("typografia widgetu (`tfs`): byline bierze tę samą zmienną co tytuł", () => {
    expect(declared('[data-wt~="tfs"][data-w-id][data-w-id] .cms-post-title', "font-size")).toEqual(
      ["var(--wt-tfs) !important"],
    );
    expect(
      declared(
        '[data-wt~="tfs"][data-w-id][data-w-id] [data-author-title-relative]',
        "--abl-title-fs",
      ),
    ).toEqual(["var(--wt-tfs)"]);
  });

  it('tytuł `h3` bez klasy rozmiaru (`data-author-title-scope="h3"`): skala H3 motywu', () => {
    const themeH3 = RULES.filter(
      (rule) =>
        rule.context.length === 0 &&
        rule.selectors.some((s) => /h3:not\(\[class\*="text-"\]\)$/.test(s)) &&
        rule.selectors.some((s) => s.includes("[data-theme-typography]")),
    ).map((rule) => rule.declarations.get("--tt-heading-fs"));
    expect(themeH3).toEqual(["var(--fs-h3, 26px)"]);
    expect(
      declared(
        ':is([data-theme-typography], [data-club-typography]) [data-author-title-scope="h3"] [data-author-title-relative]',
        "--abl-title-fs",
      ),
    ).toEqual(themeH3);
  });

  it("zmierzony rozmiar wygrywa, a do pomiaru obowiązuje szacunek - nigdy `unset`", () => {
    for (const selector of [
      "[data-author-title-relative]",
      "[data-author-title-relative] [data-author-byline-name]",
      "[data-author-title-relative] [data-author-byline-name] span",
    ]) {
      expect(declared(selector, "font-size")).toEqual([
        "var(--abl-title-relative-size, var(--abl-title-estimate)) !important",
      ]);
    }
  });

  it("publiczny arkusz nie używa `:has()` (koszt przeliczenia stylu)", () => {
    expect(RULES.flatMap((rule) => rule.selectors).filter((s) => s.includes(":has("))).toEqual([]);
  });
});
