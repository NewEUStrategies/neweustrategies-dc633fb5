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
  });

  it("falls back to generic for unknown errors", () => {
    expect(classifyError({ status: 500, message: "Internal server error" })).toBe("generic");
    expect(classifyError(null)).toBe("generic");
    expect(classifyError("oops")).toBe("generic");
  });
});
