// @vitest-environment node
// DETERMINISTYCZNY WARIANT ZAPISU (fala 3, P3.6a, R6 diagnozy `faza3/diagnoza/cache-dokumentu.md`).
//
// Klucz cache'u dokumentów nie rozróżnia user-agenta, a router renderuje automatom (isbot) inny
// wariant dokumentu (buforowany `allReady` zamiast strumienia). Odświeżenie w tle kopiowało UA
// żądania, które je wyzwoliło - STALE albo zdegradowany MISS z Lighthouse'a/PSI zasiewał wpis
// wariantem bota dla wszystkich czytelników. Ten plik sprawdza PRAWDZIWY driver rewalidacji
// z `src/server.ts` (atrapą jest tylko wirtualne entry frameworka, którego test nie ma): żądanie
// syntetyczne ma zawsze ten sam, przeglądarkowy UA, a reszta wąskiej listy nagłówków jedzie dalej.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isBotUserAgent } from "../botFilter";
import type { DocumentRevalidator } from "../documentCache.server";
import { classifyUserAgent } from "../ssrTiming";

const hoisted = vi.hoisted(() => ({
  /** Żądania, z którymi `src/server.ts` zawołał entry frameworka. */
  requests: [] as Request[],
  /** Driver rewalidacji przechwycony z `setDocumentRevalidator`. */
  revalidator: null as DocumentRevalidator | null,
}));

vi.mock("@tanstack/react-start/server-entry", () => ({
  default: {
    fetch: (request: Request) => {
      hoisted.requests.push(request);
      return new Response("<html><body>ok</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  },
}));

vi.mock("@/lib/http/documentCache.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http/documentCache.server")>();
  return {
    ...actual,
    setDocumentRevalidator: (revalidator: DocumentRevalidator | null): void => {
      hoisted.revalidator = revalidator;
      actual.setDocumentRevalidator(revalidator);
    },
  };
});

const { default: serverEntry } = await import("../../../server");

const TRIGGERS: ReadonlyArray<readonly [string, string | null]> = [
  [
    "Lighthouse (PSI)",
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
  ],
  ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ["curl", "curl/8.5.0"],
  ["Firefox", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0"],
  ["brak nagłówka", null],
];

function trigger(userAgent: string | null): Request {
  return new Request("https://tenant-a.eu/blog?page=2", {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "pl-PL,pl;q=0.9",
      "x-forwarded-host": "tenant-a.eu",
      cookie: "nes_lang=pl; sb-access-token=tajne",
      ...(userAgent ? { "user-agent": userAgent } : {}),
    },
  });
}

beforeEach(() => {
  hoisted.requests.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("odświeżenie w tle (`src/server.ts`): stały przeglądarkowy user-agent", () => {
  it("każdy wyzwalacz - bot, Lighthouse, przeglądarka, brak UA - daje ten sam UA przeglądarki", async () => {
    expect(hoisted.revalidator).toBeTypeOf("function");
    for (const [, userAgent] of TRIGGERS) {
      await hoisted.revalidator!(trigger(userAgent));
    }

    expect(hoisted.requests).toHaveLength(TRIGGERS.length);
    const sent = new Set(hoisted.requests.map((request) => request.headers.get("user-agent")));
    expect(sent.size).toBe(1);
    const [userAgent] = [...sent];
    // Wariant strumieniowy: ani isbot-podobna lista automatów, ani klasa Lighthouse.
    expect(isBotUserAgent(userAgent)).toBe(false);
    expect(classifyUserAgent(userAgent)).toBe("browser");
  });

  it("reszta wąskiej listy nagłówków jedzie bez zmian; sesja nigdy", async () => {
    await hoisted.revalidator!(trigger("curl/8.5.0"));
    const synthetic = hoisted.requests.at(-1)!;
    expect(synthetic.headers.get("accept")).toBe("text/html,application/xhtml+xml");
    expect(synthetic.headers.get("accept-language")).toBe("pl-PL,pl;q=0.9");
    expect(synthetic.headers.get("x-forwarded-host")).toBe("tenant-a.eu");
    expect(synthetic.headers.get("cookie")).toBe("nes_lang=pl");
  });

  it("żądanie czytelnika NIE jest przepisywane - stały UA dotyczy wyłącznie odświeżenia", async () => {
    const googlebot = TRIGGERS[1]![1]!;
    const response = await serverEntry.fetch(trigger(googlebot));
    await response.text();
    expect(hoisted.requests.at(-1)!.headers.get("user-agent")).toBe(googlebot);
  });
});
