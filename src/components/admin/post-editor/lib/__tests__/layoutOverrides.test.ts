import { describe, it, expect } from "vitest";
import type { LayoutOverrides } from "@/lib/postLayouts";
import type { PostForm } from "../../types";
import {
  readLayoutOverrides,
  nextLayoutOverrides,
  resolvePostFormat,
  overridePatch,
} from "../layoutOverrides";

describe("readLayoutOverrides", () => {
  it("returns an empty object when the column is null", () => {
    expect(readLayoutOverrides({ layout_overrides: null })).toEqual({});
  });

  it("passes an existing override object through", () => {
    const ov: LayoutOverrides = { layout: "wide", center_header: true };
    expect(readLayoutOverrides({ layout_overrides: ov })).toBe(ov);
  });
});

describe("nextLayoutOverrides", () => {
  it("merges a patch onto the current overrides", () => {
    expect(nextLayoutOverrides({ center_header: true }, { show_author_card: false })).toEqual({
      center_header: true,
      show_author_card: false,
    });
  });

  it("collapses an all-empty result back to null so the column stays clean", () => {
    // Clearing the only meaningful key leaves nothing worth persisting.
    expect(nextLayoutOverrides({ layout: "wide" }, { layout: undefined })).toBeNull();
  });

  it("treats empty string, null and undefined as 'no value'", () => {
    expect(nextLayoutOverrides({}, { layout: "" })).toBeNull();
    expect(nextLayoutOverrides({}, { has_sidebar: null })).toBeNull();
  });

  it("keeps the object when at least one field carries a value", () => {
    expect(nextLayoutOverrides({}, { show_prev_next: false })).toEqual({ show_prev_next: false });
  });

  it("does not mutate the input override object", () => {
    const current: LayoutOverrides = { center_header: true };
    nextLayoutOverrides(current, { layout: "wide" });
    expect(current).toEqual({ center_header: true });
  });
});

describe("resolvePostFormat", () => {
  const form = { post_format: "video" } as Pick<PostForm, "post_format">;

  it("prefers the per-post override format", () => {
    expect(resolvePostFormat({ format: "gallery" }, form)).toBe("gallery");
  });

  it("falls back to the stored post format when no override is set", () => {
    expect(resolvePostFormat({}, form)).toBe("video");
  });

  it("falls back to 'standard' when neither is present", () => {
    expect(resolvePostFormat({}, { post_format: "standard" })).toBe("standard");
  });
});

describe("overridePatch", () => {
  it("builds a single-field patch object", () => {
    expect(overridePatch("center_header", true)).toEqual({ center_header: true });
  });

  it("can carry an 'undefined' clear so nextLayoutOverrides collapses it", () => {
    const patch = overridePatch("layout", undefined);
    expect(nextLayoutOverrides({ layout: "wide" }, patch)).toBeNull();
  });
});
