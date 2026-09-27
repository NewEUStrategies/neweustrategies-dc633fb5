// Filtr ruchu nieludzkiego dla beaconów pomiaru (`botFilter.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Każde przepuszczone trafienie
// robota to fałszywe wyświetlenie w raporcie, za które sponsor płaci; każde
// odrzucone trafienie człowieka to wyświetlenie, którego raport nie pokaże.
// Stąd dwie strony tabeli: agenci i nagłówki, które MUSZĄ odpaść, i zwykła
// przeglądarka (także bez `Origin`, pod aliasem www i na porcie serwera
// deweloperskiego), która MUSI przejść. `Origin` porównujemy z ZAUFANYM hostem
// strony (bez portu, jak oddaje go `currentTenantHost()`) - nie z hostem
// adresu żądania, który za pośrednikiem jest wewnętrzny.
import { describe, expect, it } from "vitest";

import { isBotUserAgent, isLikelyBotRequest } from "@/lib/http/botFilter";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const HOST = "nes.example";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("isLikelyBotRequest", () => {
  it("zwykła przeglądarka z własnym Origin albo bez niego przechodzi", () => {
    expect(isLikelyBotRequest(headers({ "user-agent": CHROME }), HOST)).toBe(false);
    expect(
      isLikelyBotRequest(headers({ "user-agent": CHROME, origin: "https://NES.example" }), HOST),
    ).toBe(false);
    expect(isLikelyBotRequest(headers({ "user-agent": CHROME, origin: "" }), HOST)).toBe(false);
  });

  it("alias www/apex, port i wielkość liter po obu stronach to ta sama strona", () => {
    const pass = (origin: string, host: string) =>
      expect(isLikelyBotRequest(headers({ "user-agent": CHROME, origin }), host), origin).toBe(
        false,
      );
    pass("https://www.nes.example", HOST);
    pass("https://nes.example", "www.nes.example");
    pass("https://WWW.Nes.Example", "NES.example");
    // Serwer deweloperski: zaufany host nie niesie portu, `Origin` niesie.
    pass("http://localhost:8080", "localhost");
    pass("https://nes.example:8443", HOST);
  });

  it("pusty albo brakujący agent to robot", () => {
    expect(isLikelyBotRequest(headers({}), HOST)).toBe(true);
    expect(isLikelyBotRequest(headers({ "user-agent": "   " }), HOST)).toBe(true);
  });

  it.each([
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "Mozilla/5.0 HeadlessChrome/140.0",
    "Mozilla/5.0 Chrome-Lighthouse",
    "facebookexternalhit/1.1",
    "curl/8.5.0",
    "Wget/1.21",
    "python-requests/2.31",
    "Go-http-client/2.0",
    "node-fetch/1.0",
    "axios/1.7",
    "okhttp/4.12",
    "Java/21",
    "Scrapy/2.11",
    "Mozilla/5.0 (X11) Playwright/1.45",
    "UptimeRobot/2.0",
  ])("agent „%s” to robot", (userAgent) => {
    expect(isLikelyBotRequest(headers({ "user-agent": userAgent }), HOST)).toBe(true);
  });

  it("prefetch i prerender spekulacyjny to nie wyświetlenie", () => {
    expect(
      isLikelyBotRequest(headers({ "user-agent": CHROME, "sec-purpose": "prefetch" }), HOST),
    ).toBe(true);
    expect(
      isLikelyBotRequest(
        headers({ "user-agent": CHROME, "sec-purpose": "prefetch;prerender" }),
        HOST,
      ),
    ).toBe(true);
    expect(isLikelyBotRequest(headers({ "user-agent": CHROME, purpose: "Prefetch" }), HOST)).toBe(
      true,
    );
  });

  it("Origin cudzej strony albo niepoprawny Origin to odrzucenie", () => {
    const reject = (origin: string, host = HOST) =>
      expect(isLikelyBotRequest(headers({ "user-agent": CHROME, origin }), host), origin).toBe(
        true,
      );
    reject("https://obca.example");
    // Poddomena inna niż www to inna strona (inny najemca może ją zająć).
    reject("https://kongres.nes.example");
    reject("https://www.obca.example");
    // Nieprzezroczysty origin (piaskownica, `data:`) i origin bez hosta.
    reject("null");
    reject("file:///tmp/strona.html");
    // Pusty zaufany host nie jest zgodą na każdy Origin.
    reject("https://nes.example", "");
  });
});

describe("isBotUserAgent", () => {
  it("roboty, podglądy linków i brak nagłówka to automat", () => {
    for (const ua of [
      null,
      undefined,
      "  ",
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "Slackbot-LinkExpanding 1.0",
      "TelegramBot (like TwitterBot)",
      "WhatsApp/2.23.20.0 A",
      "Quora Link Preview/1.0",
      "facebookexternalhit/1.1",
      "Mozilla/5.0 HeadlessChrome/120",
      "Mozilla/5.0 Chrome-Lighthouse PageSpeed",
      "curl/8.0",
    ]) {
      expect(isBotUserAgent(ua), String(ua)).toBe(true);
    }
  });

  it("zwykła przeglądarka, także wbudowana w Telegrama, to człowiek", () => {
    expect(
      isBotUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1",
      ),
    ).toBe(false);
    expect(
      isBotUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 Telegram-Android/11.2.0",
      ),
    ).toBe(false);
  });
});
