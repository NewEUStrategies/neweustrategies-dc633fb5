// Adres wypisu z newslettera - kontrakt nagłówka RFC 8058.
//
// Regresja, której ten plik pilnuje: nagłówek `List-Unsubscribe` wskazywał
// STRONĘ `/newsletter/unsubscribe` (bez handlera POST), więc one-click z Gmaila
// i Yahoo kończył się na trasie, która niczego nie wypisuje.
import { describe, expect, it } from "vitest";
import {
  NEWSLETTER_UNSUBSCRIBE_API_PATH,
  NEWSLETTER_UNSUBSCRIBE_PAGE_PATH,
  newsletterUnsubscribeUrl,
} from "@/lib/newsletter/unsubscribeUrl";

describe("newsletterUnsubscribeUrl", () => {
  it("wskazuje ENDPOINT API (handler POST), nie stronę SPA", () => {
    const url = new URL(newsletterUnsubscribeUrl("https://nes.example", "abc123"));
    expect(url.pathname).toBe(NEWSLETTER_UNSUBSCRIBE_API_PATH);
    // Strona nie ma handlera POST - klient pocztowy POST-ujący one-click
    // trafiłby w próżnię.
    expect(url.pathname).not.toBe(NEWSLETTER_UNSUBSCRIBE_PAGE_PATH);
  });

  it("niesie token w query - ciało one-click to wyłącznie `List-Unsubscribe=One-Click`", () => {
    const url = new URL(newsletterUnsubscribeUrl("https://nes.example", "abc123"));
    expect(url.searchParams.get("token")).toBe("abc123");
    // Jedyny parametr - nic poza tokenem nie może zmienić znaczenia adresu.
    expect([...url.searchParams.keys()]).toEqual(["token"]);
  });

  it("jest absolutny - względny adres w nagłówku jest dla klienta poczty nieużywalny", () => {
    const url = newsletterUnsubscribeUrl("https://nes.example", "t");
    expect(url).toBe("https://nes.example/api/public/newsletter/unsubscribe?token=t");
    expect(new URL(url).origin).toBe("https://nes.example");
  });

  it("nie skleja podwójnego ukośnika przy originie z końcowym `/`", () => {
    const url = newsletterUnsubscribeUrl("https://nes.example//", "t");
    expect(url).toBe("https://nes.example/api/public/newsletter/unsubscribe?token=t");
    expect(url).not.toContain("//api");
  });

  it("koduje token - znaki spoza URL-a nie rozrywają parametru", () => {
    const url = new URL(newsletterUnsubscribeUrl("https://nes.example", "a&b=c d"));
    expect(url.searchParams.get("token")).toBe("a&b=c d");
    expect(url.searchParams.has("b")).toBe(false);
  });
});
