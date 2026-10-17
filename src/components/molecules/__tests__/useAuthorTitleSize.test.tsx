import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { AuthorByline } from "../AuthorByline";

afterEach(cleanup);

function Card({ name, titlePx = 18 }: { name: string; titlePx?: number }) {
  return (
    <article data-w-id="author-test">
      <h2 className="cms-post-title" style={{ fontSize: titlePx }}>
        Article
      </h2>
      <AuthorByline name={name} />
    </article>
  );
}

function measured(container: HTMLElement) {
  return container.querySelector<HTMLElement>("[data-author-byline-name]")?.style.fontSize;
}

describe("author follows material title after asynchronous updates", () => {
  it("measures an author that appears only after its data arrives", async () => {
    const { container, rerender } = render(<Card name="" />);
    rerender(<Card name="Jan Kowalski" />);
    await waitFor(() => expect(measured(container)).toBe("16px"));
  });

  it("updates after the CMS changes title sizing", async () => {
    const { container, rerender } = render(<Card name="Jan Kowalski" />);
    await waitFor(() => expect(measured(container)).toBe("16px"));
    rerender(<Card name="Jan Kowalski" titlePx={17} />);
    await waitFor(() => expect(measured(container)).toBe("15px"));
  });

  it("remeasures when Theme Design adds a stylesheet later", async () => {
    const { container } = render(
      <article data-w-id="author-test">
        <h2 className="cms-post-title">Article</h2>
        <AuthorByline name="Jan Kowalski" />
      </article>,
    );
    const style = document.createElement("style");
    style.textContent = '[data-w-id="author-test"] .cms-post-title { font-size: 17px; }';
    document.head.appendChild(style);
    try {
      await waitFor(() => expect(measured(container)).toBe("15px"));
      style.textContent = '[data-w-id="author-test"] .cms-post-title { font-size: 18px; }';
      await waitFor(() => expect(measured(container)).toBe("16px"));
    } finally {
      style.remove();
    }
  });
});

const byline = (container: HTMLElement, index = 0) =>
  container.querySelectorAll<HTMLElement>("[data-author-byline]")[index];

describe("author title lookup stays inside the byline's own card or widget", () => {
  it("falls back to the CMS size when its widget has no title, ignoring headings outside", async () => {
    const { container } = render(
      <main>
        <h1 style={{ fontSize: 42 }}>Article headline</h1>
        <figure data-w-id="quote">
          <blockquote>Quote</blockquote>
          <AuthorByline name="Jan Kowalski" />
        </figure>
      </main>,
    );
    await waitFor(() =>
      expect(byline(container).hasAttribute("data-author-title-relative")).toBe(false),
    );
    expect(measured(container)).toBe("12px");
  });

  it("measures each slide against its own title, never a sibling slide", async () => {
    const { container } = render(
      <section data-w-id="slider">
        <div data-author-title-scope="">
          <AuthorByline name="Bez Tytułu" />
        </div>
        <div data-author-title-scope="">
          <h3 className="cms-post-title" style={{ fontSize: 17 }}>
            Slide
          </h3>
          <AuthorByline name="Jan Kowalski" />
        </div>
      </section>,
    );
    await waitFor(() => expect(byline(container, 1).style.fontSize).toBe("15px"));
    expect(byline(container, 0).hasAttribute("data-author-title-relative")).toBe(false);
    expect(byline(container, 1).hasAttribute("data-author-title-relative")).toBe(true);
    expect(byline(container, 1).style.getPropertyValue("--abl-title-relative-size")).toBe("15px");
  });

  it("skips an author name styled as a title and screen-reader-only headings", async () => {
    const { container } = render(
      <article data-w-id="card">
        <h1 className="sr-only">Hidden page heading</h1>
        <div className="cms-post-title" data-author-title-ignore="" style={{ fontSize: 18 }}>
          Jan Kowalski
        </div>
        <h3 style={{ fontSize: 17 }}>Real title</h3>
        <AuthorByline name="Jan Kowalski" />
      </article>,
    );
    await waitFor(() => expect(measured(container)).toBe("15px"));
  });

  it("starts following a title that mounts after the byline", async () => {
    function Late({ withTitle }: { withTitle: boolean }) {
      return (
        <article data-w-id="late">
          {withTitle ? (
            <h3 className="cms-post-title" style={{ fontSize: 17 }}>
              Title
            </h3>
          ) : null}
          <AuthorByline name="Jan Kowalski" />
        </article>
      );
    }
    const { container, rerender } = render(<Late withTitle={false} />);
    await waitFor(() =>
      expect(byline(container).hasAttribute("data-author-title-relative")).toBe(false),
    );
    rerender(<Late withTitle />);
    await waitFor(() => expect(measured(container)).toBe("15px"));
    expect(byline(container).hasAttribute("data-author-title-relative")).toBe(true);
  });

  it("keeps the CSS fallback (no inline size variable) until the first measurement", () => {
    const html = renderToString(<Card name="Jan Kowalski" />);
    expect(html).toContain("data-author-title-relative");
    expect(html).not.toContain("--abl-title-relative-size");
  });
});

describe("author follows Theme Design sheets rendered in <body>", () => {
  it("remeasures when a body <style> (Theme Design, font sizes) changes the title size", async () => {
    const { container } = render(
      <article data-w-id="author-body-sheet">
        <h2 className="cms-post-title">Article</h2>
        <AuthorByline name="Jan Kowalski" />
      </article>,
    );
    const style = document.createElement("style");
    style.textContent = '[data-w-id="author-body-sheet"] .cms-post-title { font-size: 17px; }';
    document.body.appendChild(style);
    try {
      await waitFor(() => expect(measured(container)).toBe("15px"));
      style.textContent = '[data-w-id="author-body-sheet"] .cms-post-title { font-size: 13px; }';
      await waitFor(() => expect(measured(container)).toBe("11px"));
    } finally {
      style.remove();
    }
  });
});

describe("hero-size titles keep the standard byline size", () => {
  it("a 26 px slider headline gives the same 16 px name as an 18 px card title", async () => {
    const { container } = render(
      <section data-w-id="hero">
        <div data-author-title-scope="">
          <h3 className="cms-post-title" style={{ fontSize: 26 }}>
            Hero
          </h3>
          <AuthorByline name="Jan Kowalski" />
        </div>
        <div data-author-title-scope="">
          <h3 className="cms-post-title" style={{ fontSize: 18 }}>
            Card
          </h3>
          <AuthorByline name="Jan Kowalski" />
        </div>
      </section>,
    );
    await waitFor(() => expect(byline(container, 0).style.fontSize).toBe("16px"));
    expect(byline(container, 1).style.fontSize).toBe("16px");
  });
});
