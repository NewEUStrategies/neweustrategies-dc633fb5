// `errorMessageOf` - komunikat z wartości rzuconej do granicy błędu (`unknown`).
import { describe, expect, it } from "vitest";
import { errorMessageOf } from "@/lib/errors/errorMessage";

describe("errorMessageOf", () => {
  it("czyta `message` z `Error` i jego podklas", () => {
    expect(errorMessageOf(new Error("padło"))).toBe("padło");
    expect(errorMessageOf(new TypeError("zły typ"))).toBe("zły typ");
    class PostgrestLikeError extends Error {
      code = "42501";
    }
    expect(errorMessageOf(new PostgrestLikeError("brak uprawnień"))).toBe("brak uprawnień");
  });

  it("zachowuje pusty komunikat `Error` (to nie to samo co brak komunikatu)", () => {
    expect(errorMessageOf(new Error(""))).toBe("");
  });

  it("czyta tekstowe `message` zwykłego obiektu (np. błąd po serializacji)", () => {
    expect(errorMessageOf({ message: "Row not found", code: "PGRST116" })).toBe("Row not found");
  });

  it("zwraca `null`, gdy `message` nie jest tekstem", () => {
    expect(errorMessageOf({ message: 42 })).toBeNull();
    expect(errorMessageOf({ message: undefined })).toBeNull();
    expect(errorMessageOf({ code: "E_X" })).toBeNull();
  });

  it("zwraca `null` dla wartości bez pola `message` (string, liczba, null, undefined)", () => {
    expect(errorMessageOf("tekst")).toBeNull();
    expect(errorMessageOf(404)).toBeNull();
    expect(errorMessageOf(null)).toBeNull();
    expect(errorMessageOf(undefined)).toBeNull();
  });
});
