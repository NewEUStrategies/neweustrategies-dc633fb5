// @vitest-environment node
// `langCookie` po stronie serwera: bez `document`. Node >= 21 (i workerd) ma
// jednak globalny `navigator` - w Node z językiem LOCALE PROCESU, nie
// czytelnika - więc helpery „tylko dla klienta" nie mogą rozpoznawać SSR po
// samym `navigator`.
import { describe, expect, it } from "vitest";

import {
  detectBrowserLang,
  readLangCookieClient,
  readLangCookieFromHeader,
  writeLangCookieClient,
} from "../langCookie";

describe("langCookie na serwerze", () => {
  it("helpery document.cookie są no-opem", () => {
    expect(typeof document).toBe("undefined");
    expect(readLangCookieClient()).toBeNull();
    expect(() => writeLangCookieClient("en")).not.toThrow();
  });

  it("detectBrowserLang nie zgaduje z locale procesu serwera", () => {
    // Wynik nie może zależeć od tego, czy runtime wystawia `navigator`.
    expect(detectBrowserLang()).toBeNull();
  });

  it("nagłówek Cookie z zepsutą wartością nie rzuca w ścieżce żądania", () => {
    expect(readLangCookieFromHeader("nes_lang=%E0%A4%A")).toBeNull();
    expect(readLangCookieFromHeader("nes_lang=%; lovable_lang=en")).toBe("en");
  });
});
