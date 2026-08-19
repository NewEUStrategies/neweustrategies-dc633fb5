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

const h = vi.hoisted(() => ({ recordCampaignEvent: vi.fn() }));

vi.mock("@/lib/newsletter/trackingEvents.server", () => ({
  recordCampaignEvent: h.recordCampaignEvent,
}));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route as OpenRoute } from "@/routes/api/public/nl-open";
import { Route as ClickRoute } from "@/routes/api/public/nl-click";
import { signTrackingLink, signTrackingToken } from "@/lib/newsletter/trackingToken.server";

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
