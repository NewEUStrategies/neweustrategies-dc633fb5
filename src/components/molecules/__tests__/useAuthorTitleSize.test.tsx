import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
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
    rerender(<Card name="Jan Kowalski" titlePx={26} />);
    await waitFor(() => expect(measured(container)).toBe("24px"));
  });

  it("remeasures when Theme Design adds a stylesheet later", async () => {
    const { container } = render(
      <article data-w-id="author-test">
        <h2 className="cms-post-title">Article</h2>
        <AuthorByline name="Jan Kowalski" />
      </article>,
    );
    const style = document.createElement("style");
    style.textContent = '[data-w-id="author-test"] .cms-post-title { font-size: 22px; }';
    document.head.appendChild(style);
    try {
      await waitFor(() => expect(measured(container)).toBe("20px"));
      style.textContent = '[data-w-id="author-test"] .cms-post-title { font-size: 18px; }';
      await waitFor(() => expect(measured(container)).toBe("16px"));
    } finally {
      style.remove();
    }
  });
});
