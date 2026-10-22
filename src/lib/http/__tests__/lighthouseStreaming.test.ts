// Parytet strumienia SSR dla Lighthouse'a (`lighthouseStreaming.ts` + handler
// strumienia w `lib/ssr/serverEntry.tsx`).
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW. Gdy PSI znów dostanie wariant automatu,
// pierwszy bajt dokumentu czeka na render całej strony i Speed Index wraca do
// sekund doliczanych za sekcje spod zgięcia. Gdy z kolei zmienimy decyzję dla
// prawdziwego crawlera, Googlebot przestanie dostawać dokument kompletny.
// Dlatego obie strony: Lighthouse (mobile i desktop) MUSI przestać być
// automatem dla `isbot`, a każdy inny UA - przeglądarka, crawler, brak
// nagłówka - MUSI przejść nietknięty (ta sama tożsamość obiektu).
import { isbot } from "isbot";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lighthouseBrowserAgent, streamDecisionRequest } from "@/lib/http/lighthouseStreaming";

const hoisted = vi.hoisted(() => ({
  /** Żądania, które handler strumienia przekazał do `renderRouterToStream`. */
  rendered: [] as Request[],
}));

vi.mock("@tanstack/react-router/ssr/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router/ssr/server")>();
  return {
    ...actual,
    renderRouterToStream: (options: { request: Request }) => {
      hoisted.rendered.push(options.request);
      return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    },
  };
});

const PSI_MOBILE =
  "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse";
const PSI_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Chrome-Lighthouse";
const CHROME =
  "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";
const GOOGLEBOT =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function documentRequest(userAgent: string | null, init: RequestInit = {}): Request {
  const headers = new Headers({ accept: "text/html", "accept-language": "pl-PL,pl;q=0.9" });
  if (userAgent !== null) headers.set("user-agent", userAgent);
  return new Request("https://neweuropeanstrategies.com/?utm_source=psi", { ...init, headers });
}

beforeEach(() => {
  hoisted.rendered.length = 0;
});

describe("lighthouseBrowserAgent", () => {
  it.each([
    ["PSI mobile", PSI_MOBILE],
    ["PSI desktop", PSI_DESKTOP],
  ])("%s: UA emulowanej przeglądarki, którego isbot nie uznaje za automat", (_, userAgent) => {
    expect(isbot(userAgent)).toBe(true);
    const browserAgent = lighthouseBrowserAgent(userAgent);
    expect(browserAgent).toBe(userAgent.replace(" Chrome-Lighthouse", ""));
    expect(isbot(browserAgent)).toBe(false);
  });

  it.each([
    ["przeglądarka", CHROME],
    ["Googlebot", GOOGLEBOT],
    ["brak nagłówka", null],
    ["sam token (pusty UA byłby automatem)", "Chrome-Lighthouse"],
  ])("%s: bez zmiany (null)", (_, userAgent) => {
    expect(lighthouseBrowserAgent(userAgent)).toBeNull();
  });
});

describe("streamDecisionRequest", () => {
  it("Lighthouse: natywny Request z UA przeglądarki, tym samym adresem i nagłówkami", () => {
    const request = documentRequest(PSI_MOBILE);
    const decision = streamDecisionRequest(request);

    expect(decision).not.toBe(request);
    expect(isbot(decision.headers.get("user-agent"))).toBe(false);
    expect(decision.url).toBe(request.url);
    expect(decision.headers.get("accept-language")).toBe("pl-PL,pl;q=0.9");
    // Oryginał nietknięty - aplikacja, cache i log czytają klasę "lighthouse" z niego.
    expect(request.headers.get("user-agent")).toBe(PSI_MOBILE);
  });

  it("zerwanie połączenia nadal przerywa render (ten sam sygnał)", () => {
    const controller = new AbortController();
    const decision = streamDecisionRequest(
      documentRequest(PSI_MOBILE, { signal: controller.signal }),
    );
    expect(decision.signal.aborted).toBe(false);
    controller.abort(new Error("klient się rozłączył"));
    expect(decision.signal.aborted).toBe(true);
  });

  it.each([
    ["przeglądarka", CHROME],
    ["Googlebot (crawler dostaje dokument kompletny)", GOOGLEBOT],
    ["brak nagłówka", null],
  ])("%s: to samo żądanie (ta sama tożsamość)", (_, userAgent) => {
    const request = documentRequest(userAgent);
    expect(streamDecisionRequest(request)).toBe(request);
  });
});

describe("handler strumienia entry (lib/ssr/serverEntry.tsx)", () => {
  async function render(request: Request): Promise<Request> {
    const { streamHandler } = await import("@/lib/ssr/serverEntry");
    const router = {} as Parameters<typeof streamHandler>[0]["router"];
    await streamHandler({ request, router, responseHeaders: new Headers() });
    const rendered = hoisted.rendered.at(-1);
    if (!rendered) throw new Error("handler nie wywołał renderRouterToStream");
    return rendered;
  }

  it("Lighthouse renderuje się wariantem strumieniowym przeglądarki", async () => {
    const rendered = await render(documentRequest(PSI_DESKTOP));
    expect(isbot(rendered.headers.get("user-agent"))).toBe(false);
  });

  it("Googlebot dalej dostaje wariant automatu (dokument kompletny)", async () => {
    const request = documentRequest(GOOGLEBOT);
    const rendered = await render(request);
    expect(rendered).toBe(request);
    expect(isbot(rendered.headers.get("user-agent"))).toBe(true);
  });
});
