import { describe, it, expect } from "vitest";
import { classifyError, errorCopy } from "../errorCopy";

describe("errorCopy", () => {
  it("returns Polish copy by default when currentLang is pl", () => {
    const copy = errorCopy();
    expect(copy.unauthorized.title).toBe("Wymagane logowanie");
    expect(copy.network.title).toBe("Problem z połączeniem");
    expect(copy.tryAgain).toBe("Spróbuj ponownie");
  });

  it("exposes all required error scenarios", () => {
    const copy = errorCopy();
    expect(copy.unauthorized.steps).toHaveLength(3);
    expect(copy.sessionExpired.steps).toHaveLength(3);
    expect(copy.network.steps).toHaveLength(3);
    expect(copy.generic.steps).toHaveLength(3);
  });
});

describe("classifyError", () => {
  it("classifies 401 as unauthorized", () => {
    expect(classifyError({ status: 401 })).toBe("unauthorized");
    expect(classifyError({ statusCode: 401 })).toBe("unauthorized");
  });

  it("classifies 302/307/308 as sessionExpired", () => {
    expect(classifyError({ status: 302 })).toBe("sessionExpired");
    expect(classifyError({ status: 307 })).toBe("sessionExpired");
    expect(classifyError({ status: 308 })).toBe("sessionExpired");
  });

  it("classifies auth/session messages", () => {
    expect(classifyError({ message: "Unauthorized access" })).toBe("unauthorized");
    expect(classifyError({ message: "Session expired" })).toBe("sessionExpired");
  });

  it("classifies network errors", () => {
    expect(classifyError({ message: "Failed to fetch" })).toBe("network");
    expect(classifyError({ message: "Network error occurred" })).toBe("network");
    expect(classifyError({ name: "TypeError", message: "Load failed" })).toBe("network");
    // Nieudany lazy-load chunka trasy - komunikaty różnią się per przeglądarka
    // i nie każdy zawiera "fetch" (Firefox) czy "load failed" (Safari).
    expect(
      classifyError({
        name: "TypeError",
        message: "Failed to fetch dynamically imported module: /assets/route.js",
      }),
    ).toBe("network");
    expect(
      classifyError({
        name: "TypeError",
        message: "error loading dynamically imported module: /assets/route.js",
      }),
    ).toBe("network");
    expect(classifyError({ name: "TypeError", message: "Importing a module script failed." })).toBe(
      "network",
    );
  });

  it("does not mistake render-time TypeErrors for network problems", () => {
    // Błąd renderu (dostęp do undefined) też jest TypeError - karta
    // "sprawdź łącze internetowe" byłaby mylącą diagnozą błędu w kodzie.
    expect(
      classifyError({
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'slice')",
      }),
    ).toBe("generic");
    expect(classifyError({ name: "TypeError", message: "x.map is not a function" })).toBe(
      "generic",
    );
  });

  it("falls back to generic for unknown errors", () => {
    expect(classifyError({ status: 500, message: "Internal server error" })).toBe("generic");
    expect(classifyError(null)).toBe("generic");
    expect(classifyError("oops")).toBe("generic");
  });
});
