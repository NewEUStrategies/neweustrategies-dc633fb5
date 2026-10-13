import { expect, it } from "vitest";
import { resolveBrandAccent } from "../brandAccent";
it("replaces the old conference orange with #FA9346", () => {
  expect(resolveBrandAccent("#C5652D")).toBe("#FA9346");
  expect(resolveBrandAccent("rgb(197, 101, 45)")).toBe("#FA9346");
});
it("replaces amber and dark brand inks with #FA9346", () => {
  for (const value of ["#a94e0b", "#f59e0b", "#d9b26a", "#c2410c"])
    expect(resolveBrandAccent(value)).toBe("#FA9346");
});
it("normalizes brand hex casing", () => {
  expect(resolveBrandAccent("#fa9346")).toBe("#FA9346");
});
it("preserves unrelated colors and missing values", () => {
  expect(resolveBrandAccent("#315f75")).toBe("#315f75");
  expect(resolveBrandAccent("#5c6744")).toBe("#5c6744");
  expect(resolveBrandAccent(null)).toBeNull();
});
