import { describe, expect, it } from "vitest";
import {
  AUTHOR_NAME_TITLE_RELATIVE_MAX_PX,
  authorSizeFromTitle,
  resolveAuthorDisplay,
  widgetAuthorDisplayDefaults,
} from "../authorDisplay";
describe("CMS author title sizing", () => {
  it.each(["pl", "en"] as const)("uses title minus 2 px in %s", (lang) => {
    expect(resolveAuthorDisplay({ authorSizePx: 16 }, lang).relativeToTitle).toBe(true);
    expect(authorSizeFromTitle(16)).toBe(14);
    expect(authorSizeFromTitle(18)).toBe(16);
    expect(authorSizeFromTitle(17.5)).toBe(15.5);
  });
  it("persists fixed-size mode from the CMS", () => {
    const value = resolveAuthorDisplay(
      { authorSizeRelativeToTitle: false, authorSizePx: 13 },
      "pl",
    );
    expect(value.relativeToTitle).toBe(false);
    expect(value.nameSizePx).toBe(13);
  });
});

describe("widgets without a paired title keep the CMS size", () => {
  it.each(["testimonial", "post-meta", "post-author-card"])(
    "%s never follows a title, even with a stored switch",
    (type) => {
      const content = { authorSizeRelativeToTitle: true, authorSizePx: 15 };
      const value = resolveAuthorDisplay(content, "pl", widgetAuthorDisplayDefaults(type, content));
      expect(value.relativeToTitle).toBe(false);
      expect(value.nameSizePx).toBe(15);
    },
  );

  it.each(["post-list", "rated-list", "slider", "tailored-must-reads", "news-ticker"])(
    "%s follows its card title by default",
    (type) => {
      expect(
        resolveAuthorDisplay({}, "en", widgetAuthorDisplayDefaults(type, {})).relativeToTitle,
      ).toBe(true);
    },
  );
});

describe("display-size titles do not inflate the author name", () => {
  it.each([26, 24, 42])("a %ipx headline keeps the standard 16 px byline", (title) => {
    expect(authorSizeFromTitle(title)).toBe(AUTHOR_NAME_TITLE_RELATIVE_MAX_PX);
    expect(AUTHOR_NAME_TITLE_RELATIVE_MAX_PX).toBe(16);
  });
});
