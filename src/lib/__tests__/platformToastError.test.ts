import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toastError, type ToastErrorKind } from "../toastError";

const h = vi.hoisted(() => ({ lang: "en", toast: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: h.toast } }));
vi.mock("@/lib/i18n/localeRuntime", () => ({ currentLang: () => h.lang }));
beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "en";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("safe error messages at the database and transport boundary", () => {
  it.each([
    ["23505", "This item already exists."],
    ["23503", "Can't delete — this item is still in use."],
    ["23502", "Please fill in the required fields."],
    ["23514", "That value isn't allowed."],
    ["42501", "You don't have permission to do that."],
    ["PGRST301", "Your session expired. Please sign in again."],
  ])("maps database code %s without exposing the private diagnostic", (code, copy) => {
    const error = { code, message: "private table and SQL details" };
    toastError(error);
    expect(h.toast).toHaveBeenCalledExactlyOnceWith(copy);
    expect(console.error).toHaveBeenCalledWith("[toastError]", error);
  });
  it.each([
    { status: 413 },
    { statusCode: 413 },
    { message: "Maximum allowed size exceeded" },
    { message: "Payload too large: private-object-key" },
  ])("recognizes storage size errors: %j", (error) => {
    toastError(error, "upload");
    expect(h.toast).toHaveBeenCalledWith("This file is too large.");
  });
  it.each([
    { status: 401 },
    { status: 403 },
    { message: "row-level security violation" },
    { message: "Permission denied for sensitive_table" },
  ])("recognizes authorization errors: %j", (error) => {
    toastError(error);
    expect(h.toast).toHaveBeenCalledWith("You don't have permission to do that.");
  });
  it.each([
    "Failed to fetch",
    "NetworkError when attempting resource",
    "Load failed",
    "Network request failed",
  ])("recognizes browser transport error %s", (message) => {
    toastError(new TypeError(message));
    expect(h.toast).toHaveBeenCalledWith("Connection problem. Check your internet and try again.");
  });
  it.each([null, undefined, 7, "private exception", { code: 7, status: "413", message: 42 }])(
    "handles an unstructured rejection %j without leaking it",
    (error) => {
      toastError(error);
      expect(h.toast).toHaveBeenCalledWith("Something went wrong. Please try again.");
    },
  );
  it.each([
    ["save", "Couldn't save your changes."],
    ["load", "Couldn't load the data."],
    ["delete", "Couldn't delete that."],
    ["upload", "Couldn't upload the file."],
  ] satisfies [ToastErrorKind, string][])("preserves the call site's %s fallback", (kind, copy) => {
    toastError(new Error("private"), kind);
    expect(h.toast).toHaveBeenCalledWith(copy);
  });
  it("uses Polish copy for a Polish render and gives explicit status priority", () => {
    h.lang = "pl";
    toastError({ status: 413, statusCode: 403 });
    expect(h.toast).toHaveBeenCalledWith("Plik jest za duży.");
  });
});
