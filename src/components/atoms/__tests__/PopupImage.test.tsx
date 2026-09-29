import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PopupImage } from "../PopupImage";

afterEach(cleanup);

describe("popup media delivery", () => {
  it("uses the current environment and responsive eager images for admin uploads", () => {
    const { container } = render(
      <PopupImage
        src="https://neweuropeanstrategies.com/media/tenant/photo.jpg"
        sizes="300px"
        alt=""
      />,
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/media/tenant/photo.jpg");
    expect(img.getAttribute("srcset")).toContain(
      "/media/tenant/photo.jpg?width=320&resize=contain&quality=78 320w",
    );
    expect(img.getAttribute("sizes")).toBe("300px");
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("decoding")).toBe("async");
  });

  it("retries the original on a transform error, then keeps the reserved frame if missing", () => {
    const { container } = render(
      <PopupImage
        src="/media/photo.jpg"
        sizes="300px"
        alt=""
        className="absolute inset-0 h-full w-full"
      />,
    );
    const img = container.querySelector("img")!;
    fireEvent.error(img);
    expect(img.hasAttribute("srcset")).toBe(false);
    expect(img.getAttribute("src")).toBe("/media/photo.jpg");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("span")).toHaveClass("block", "absolute", "h-full", "w-full");
  });

  it("renders a new admin-selected image after the old one failed", () => {
    const view = render(<PopupImage src="/media/missing.jpg" sizes="300px" alt="" />);
    fireEvent.error(view.container.querySelector("img")!);
    fireEvent.error(view.container.querySelector("img")!);
    view.rerender(<PopupImage src="/media/replacement.jpg" sizes="300px" alt="" />);
    expect(view.container.querySelector("img")?.getAttribute("srcset")).toContain(
      "replacement.jpg?width=320",
    );
  });

  it.each([
    "https://cdn.example.test/media/photo.jpg",
    "https://cdn.example.test/logo.svg",
    "/media/animation.gif",
  ])("preserves unsupported transform sources: %s", (src) => {
    const { container } = render(<PopupImage src={src} sizes="200px" alt="" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(src);
    expect(container.querySelector("img")?.hasAttribute("srcset")).toBe(false);
  });
});
