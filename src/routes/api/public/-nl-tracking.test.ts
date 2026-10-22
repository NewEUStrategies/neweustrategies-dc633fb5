// Piksel otwarcia i przekierowanie kliknięcia w mailu kampanii.
//
// PO CO. To dwa PUBLICZNE endpointy, których adresy trafiają do każdej wysłanej
// wiadomości - czyli do skrzynek, archiwów pocztowych i skanerów. Niosą dwie
// reguły, których pomyłka jest cicha i kosztowna w zupełnie różny sposób:
//
//   1. PIKSEL MUSI ZAWSZE ODDAĆ OBRAZEK. Piksel, który oddaje 500, w kliencie
//      pocztowym pokazuje się jako złamana grafika w treści maila - odbiorca
//      widzi wiadomość „uszkodzoną", a nadawca nie ma o tym pojęcia.
//   2. PRZEKIEROWANIE KLIKNIĘCIA MUSI PILNOWAĆ CELU. Endpoint bierze docelowy
//      adres z parametru, więc bez podpisu byłby OTWARTYM PRZEKIEROWANIEM na
//      zaufanej domenie redakcji - gotowym narzędziem phishingowym, roznoszonym
//      w mailu z prawidłowym SPF i DKIM. Dlatego testy liczą PRAWDZIWE podpisy
//      HMAC (tak jak potok wysyłki), a nie podstawiają atrapy weryfikacji:
//      atrapa dowodziłaby tylko tego, że gałąź istnieje.
//
// Trzecia, wspólna: jedno otwarcie to JEDEN wiersz. Zapis idzie ze źródłem
// `first_party`, żeby nie policzyć tego samego zdarzenia razem z webhookiem
// dostawcy.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ recordCampaignEvent: vi.fn(), recordJourneyMessageEvent: vi.fn() }));

vi.mock("@/lib/newsletter/trackingEvents.server", () => ({
  recordCampaignEvent: h.recordCampaignEvent,
}));
// Ścieżki komunikacji (S5): zapis zdarzeń maila 1:1 - atrapa samego zapisu,
// rozpoznawanie serwerów pośredniczących poczty zostaje prawdziwe.
vi.mock("@/lib/journeys/tracking.server", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@/lib/journeys/tracking.server")),
  recordJourneyMessageEvent: h.recordJourneyMessageEvent,
}));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route as OpenRoute } from "@/routes/api/public/nl-open";
import { Route as ClickRoute } from "@/routes/api/public/nl-click";
import {
  signJourneyLink,
  signJourneyMessageToken,
  signJourneyUnsubscribeToken,
  signTrackingLink,
  signTrackingToken,
} from "@/lib/newsletter/trackingToken.server";

const CAMPAIGN = "11111111-2222-3333-4444-555555555555";
const SUBSCRIBER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TARGET = "https://example.test/analiza/eu-2026";

const openHandler = routeServerHandlers(OpenRoute).GET!;
const clickHandler = routeServerHandlers(ClickRoute).GET!;

/** Żądanie z unikalnym adresem klienta - limiter jest wspólny dla modułu. */
let ipCounter = 0;
function request(path: string): Request {
  ipCounter += 1;
  return new Request(`https://redakcja.example.test${path}`, {
    headers: { "x-forwarded-for": `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` },
  });
}

const token = () => signTrackingToken(CAMPAIGN, SUBSCRIBER);
const linkSig = (target = TARGET) => signTrackingLink(CAMPAIGN, SUBSCRIBER, target);

beforeEach(() => {
  h.recordCampaignEvent.mockReset();
  h.recordCampaignEvent.mockResolvedValue(undefined);
  h.recordJourneyMessageEvent.mockReset();
  h.recordJourneyMessageEvent.mockResolvedValue({ ok: true, recorded: true, known: true });
});

// ---------------------------------------------------------------------------
describe("piksel otwarcia", () => {
  it("oddaje PRZEZROCZYSTY GIF, nie pustą odpowiedź", async () => {
    const res = await openHandler({
      request: request(`/api/public/nl-open?c=${CAMPAIGN}&s=${token()}`),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
  });

  it("obrazek NIE JEST CACHOWANY - inaczej drugie otwarcie nie dotrze do serwera", async () => {
    const res = await openHandler({
      request: request(`/api/public/nl-open?c=${CAMPAIGN}&s=${token()}`),
    });

    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Pragma")).toBe("no-cache");
  });

  it("prawidłowy token zapisuje otwarcie jako źródło PIERWSZEJ STRONY", async () => {
    // Źródło rozstrzyga, czy to samo otwarcie nie policzy się dwa razy - raz z
    // piksela, raz z webhooka dostawcy.
    await openHandler({ request: request(`/api/public/nl-open?c=${CAMPAIGN}&s=${token()}`) });

    expect(h.recordCampaignEvent).toHaveBeenCalledWith({
      campaignId: CAMPAIGN,
      subscriberId: SUBSCRIBER,
      kind: "open",
      url: null,
      source: "first_party",
    });
    // Jedno wejście w piksel to JEDNO otwarcie.
    expect(h.recordCampaignEvent).toHaveBeenCalledTimes(1);
  });

  it("PODROBIONY podpis nie zapisuje niczego, ale obrazek nadal wychodzi", async () => {
    const res = await openHandler({
      request: request(`/api/public/nl-open?c=${CAMPAIGN}&s=${SUBSCRIBER}.${"0".repeat(32)}`),
    });

    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("token z INNEJ kampanii nie liczy się w tej", async () => {
    // Bez wiązania podpisu z kampanią jeden wyciekły piksel podbijałby otwarcia
    // wszystkich wysyłek.
    const inna = "99999999-8888-7777-6666-555555555555";

    const res = await openHandler({
      request: request(`/api/public/nl-open?c=${inna}&s=${token()}`),
    });

    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
    // Piksel nadal się zwraca - inaczej w mailu widniałby połamany obrazek,
    // który sam jest sygnałem dla odbiorcy, że coś jest nie tak.
    expect(res.status).toBe(200);
  });

  it("BRAK parametrów oddaje obrazek i nic nie zapisuje", async () => {
    const res = await openHandler({ request: request("/api/public/nl-open") });

    expect(res.status).toBe(200);
    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
  });

  it("AWARIA zapisu nie psuje obrazka - odbiorca nie zobaczy złamanej grafiki", async () => {
    h.recordCampaignEvent.mockRejectedValue(new Error("baza padla"));

    const res = await openHandler({
      request: request(`/api/public/nl-open?c=${CAMPAIGN}&s=${token()}`),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
  });

  it("obrazek ma niezerową długość i deklaruje ją w nagłówku", async () => {
    const res = await openHandler({
      request: request(`/api/public/nl-open?c=${CAMPAIGN}&s=${token()}`),
    });
    const bytes = new Uint8Array(await res.arrayBuffer());

    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(res.headers.get("Content-Length")).toBe(String(bytes.byteLength));
  });
});

// ---------------------------------------------------------------------------
describe("przekierowanie kliknięcia - ochrona przed otwartym przekierowaniem", () => {
  it("PODPISANY adres jest honorowany", async () => {
    const res = await clickHandler({
      request: request(
        `/api/public/nl-click?c=${CAMPAIGN}&s=${token()}&u=${encodeURIComponent(TARGET)}&k=${linkSig()}`,
      ),
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(TARGET);
  });

  it("adres BEZ podpisu linku wraca na naszą domenę, nie na cel", async () => {
    // To jest sedno: bez tej reguły endpoint byłby gotowym narzędziem
    // phishingowym na zaufanej domenie redakcji.
    const zly = "https://phishing.example.test/podaj-haslo";

    const res = await clickHandler({
      request: request(
        `/api/public/nl-click?c=${CAMPAIGN}&s=${token()}&u=${encodeURIComponent(zly)}`,
      ),
    });

    expect(res.headers.get("Location")).not.toContain("phishing.example.test");
    expect(res.headers.get("Location")).toContain("redakcja.example.test");
  });

  it("PODMIENIONY adres z podpisem innego adresu też nie przechodzi", async () => {
    // Podpis wiąże KAMPANIĘ, ODBIORCĘ i DOKŁADNY adres - podstawienie samego
    // `u` przy zachowanym `k` musi odpaść.
    const zly = "https://phishing.example.test/podaj-haslo";

    const res = await clickHandler({
      request: request(
        `/api/public/nl-click?c=${CAMPAIGN}&s=${token()}&u=${encodeURIComponent(zly)}&k=${linkSig()}`,
      ),
    });

    expect(res.headers.get("Location")).not.toContain("phishing.example.test");
    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
  });

  it("podpis linku z INNEJ kampanii nie przechodzi", async () => {
    const inna = "99999999-8888-7777-6666-555555555555";

    const res = await clickHandler({
      request: request(
        `/api/public/nl-click?c=${inna}&s=${signTrackingToken(inna, SUBSCRIBER)}&u=${encodeURIComponent(TARGET)}&k=${linkSig()}`,
      ),
    });

    expect(res.headers.get("Location")).not.toBe(TARGET);
    // Kliknięcie z obcym podpisem nie liczy się też w statystykach.
    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
  });

  it("adres w schemacie NIE-HTTP odpada, nawet z prawidłowym podpisem", async () => {
    // `javascript:` w mailu nie zadziała, ale `data:` i `file:` w przeglądarce
    // owszem - dopuszczamy wyłącznie http(s).
    const zly = "javascript:alert(1)";

    const res = await clickHandler({
      request: request(
        `/api/public/nl-click?c=${CAMPAIGN}&s=${token()}&u=${encodeURIComponent(zly)}&k=${signTrackingLink(CAMPAIGN, SUBSCRIBER, zly)}`,
      ),
    });

    expect(res.headers.get("Location")).not.toContain("javascript");
    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
  });

  it("BRAK parametrów przekierowuje na naszą domenę, nie zwraca błędu", async () => {
    // Błąd w kliencie pocztowym to martwy link w wysłanym już mailu.
    const res = await clickHandler({ request: request("/api/public/nl-click") });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("redakcja.example.test");
  });
});

// ---------------------------------------------------------------------------
describe("przekierowanie kliknięcia - zapis zdarzenia", () => {
  it("zapisuje kliknięcie razem z ADRESEM celu i źródłem pierwszej strony", async () => {
    await clickHandler({
      request: request(
        `/api/public/nl-click?c=${CAMPAIGN}&s=${token()}&u=${encodeURIComponent(TARGET)}&k=${linkSig()}`,
      ),
    });

    expect(h.recordCampaignEvent).toHaveBeenCalledWith({
      campaignId: CAMPAIGN,
      subscriberId: SUBSCRIBER,
      kind: "click",
      url: TARGET,
      source: "first_party",
    });
    expect(h.recordCampaignEvent).toHaveBeenCalledTimes(1);
  });

  it("AWARIA zapisu nie blokuje przekierowania - link w mailu musi działać", async () => {
    h.recordCampaignEvent.mockRejectedValue(new Error("baza padla"));

    const res = await clickHandler({
      request: request(
        `/api/public/nl-click?c=${CAMPAIGN}&s=${token()}&u=${encodeURIComponent(TARGET)}&k=${linkSig()}`,
      ),
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(TARGET);
  });

  it("niezaufany adres NIE zapisuje kliknięcia - inaczej statystyki liczyłyby obce linki", async () => {
    const res = await clickHandler({
      request: request(
        `/api/public/nl-click?c=${CAMPAIGN}&s=${token()}&u=${encodeURIComponent(TARGET)}`,
      ),
    });

    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
  });
});

// ---------------------------------------------------------------------------
// Ścieżki komunikacji (S5): `m=<message_id>.<podpis>` - tracking 1:1 po
// wiadomości. Te same dwie reguły: obrazek zawsze, cel wyłącznie podpisany
// (podpis wiąże wiadomość, numer linku i DOKŁADNY adres).
const MESSAGE = "adcf4729-2d9b-4ef2-bf9a-bdd0cbfe79f9";
const mToken = () => signJourneyMessageToken(MESSAGE);
const jLink = (target = TARGET, index = 0) =>
  `/api/public/nl-click?m=${mToken()}&i=${index}&u=${encodeURIComponent(target)}&k=${signJourneyLink(MESSAGE, target, index)}`;

function requestWithUa(path: string, userAgent: string): Request {
  ipCounter += 1;
  return new Request(`https://redakcja.example.test${path}`, {
    headers: {
      "x-forwarded-for": `10.1.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
      "user-agent": userAgent,
    },
  });
}

describe("ścieżki: piksel otwarcia", () => {
  it("ważny token wiadomości zapisuje otwarcie (człowiek), kampania nie jest dotykana", async () => {
    const res = await openHandler({
      request: requestWithUa(`/api/public/nl-open?m=${mToken()}`, "Mozilla/5.0 Safari/605"),
    });
    expect(res.headers.get("Content-Type")).toBe("image/gif");
    expect(h.recordJourneyMessageEvent).toHaveBeenCalledWith({
      messageId: MESSAGE,
      kind: "open",
      machine: false,
    });
    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
  });

  it("otwarcie przez proxy obrazków poczty oznaczone jako maszynowe", async () => {
    await openHandler({
      request: requestWithUa(`/api/public/nl-open?m=${mToken()}`, "Mozilla/5.0 GoogleImageProxy"),
    });
    expect(h.recordJourneyMessageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ machine: true }),
    );
  });

  it("podrobiony podpis, token wypisu w miejscu trackingu i awaria zapisu - obrazek wychodzi", async () => {
    for (const m of [`${MESSAGE}.${"0".repeat(32)}`, signJourneyUnsubscribeToken(MESSAGE), "x"]) {
      const res = await openHandler({
        request: request(`/api/public/nl-open?m=${encodeURIComponent(m)}`),
      });
      expect(res.status).toBe(200);
    }
    expect(h.recordJourneyMessageEvent).not.toHaveBeenCalled();
    h.recordJourneyMessageEvent.mockRejectedValueOnce(new Error("baza padla"));
    const res = await openHandler({ request: request(`/api/public/nl-open?m=${mToken()}`) });
    expect(res.status).toBe(200);
  });
});

describe("ścieżki: przekierowanie kliknięcia", () => {
  it("podpisany link: 302 na cel i zapis kliknięcia z numerem linku", async () => {
    const res = await clickHandler({ request: request(jLink(TARGET, 2)) });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(TARGET);
    expect(h.recordJourneyMessageEvent).toHaveBeenCalledWith({
      messageId: MESSAGE,
      kind: "click",
      linkIndex: 2,
      url: TARGET,
    });
    expect(h.recordCampaignEvent).not.toHaveBeenCalled();
  });

  it("podmieniony cel, podmieniony numer, brak podpisu - powrót na naszą domenę bez zapisu", async () => {
    const zly = "https://phishing.example.test/podaj-haslo";
    const tampered = [
      jLink(TARGET, 0).replace(encodeURIComponent(TARGET), encodeURIComponent(zly)),
      jLink(TARGET, 0).replace("&i=0&", "&i=1&"),
      `/api/public/nl-click?m=${mToken()}&i=0&u=${encodeURIComponent(zly)}`,
      `/api/public/nl-click?m=${mToken()}&i=abc&u=${encodeURIComponent(TARGET)}&k=${signJourneyLink(MESSAGE, TARGET, 0)}`,
      `/api/public/nl-click?m=${MESSAGE}.${"0".repeat(32)}&i=0&u=${encodeURIComponent(TARGET)}&k=${signJourneyLink(MESSAGE, TARGET, 0)}`,
    ];
    for (const path of tampered) {
      const res = await clickHandler({ request: request(path) });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("https://redakcja.example.test/");
    }
    expect(h.recordJourneyMessageEvent).not.toHaveBeenCalled();
  });

  it("podpis kampanii nie otwiera przekierowania ścieżki (inna domena HMAC)", async () => {
    const res = await clickHandler({
      request: request(
        `/api/public/nl-click?m=${mToken()}&i=0&u=${encodeURIComponent(TARGET)}&k=${linkSig()}`,
      ),
    });
    expect(res.headers.get("Location")).not.toBe(TARGET);
  });

  it("adres nie-http z poprawnym podpisem odpada", async () => {
    const res = await clickHandler({ request: request(jLink("javascript:alert(1)", 0)) });
    expect(res.headers.get("Location")).not.toContain("javascript");
    expect(h.recordJourneyMessageEvent).not.toHaveBeenCalled();
  });
});
