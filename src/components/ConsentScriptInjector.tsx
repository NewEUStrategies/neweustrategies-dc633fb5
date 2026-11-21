// Runtime consent-gated script injector.
// - Reads site_settings["analytics"] and ["marketing"].
// - Only mounts a category's scripts when useEffectiveConsent() grants it,
//   so nothing loads before the visitor accepts (also honours preview mode).
// - Cleans up on revocation: removes injected <script>/<meta> and blanks any
//   custom snippets.
// SSR-safe: no side effects until the client is mounted.
import { useEffect, useRef } from "react";
import { useSiteSetting } from "@/lib/useSiteSetting";
import {
  AnalyticsConfigSchema,
  defaultAnalyticsConfig,
  MarketingConfigSchema,
  defaultMarketingConfig,
  type AnalyticsConfig,
  type MarketingConfig,
} from "@/lib/analytics/config";
import { hasConsentDecision, subscribeConsentChange, useEffectiveConsent } from "@/lib/ads/consent";
import {
  bootstrapGa4,
  ga4ConfigureAds,
  ga4ConsentUpdate,
  resolveBrowserGa4Id,
} from "@/lib/analytics/ga4Client";
import { configureGoogleAds, extractGoogleAdsId } from "@/lib/analytics/googleAdsGoals";
import type { AdPlatform } from "@/lib/analytics/adPixels";
import { X_PIXEL_MARKER } from "@/lib/analytics/xPixelId";

type CleanupFn = () => void;

const MARK_ATTR = "data-consent-owner";

/**
 * Polityka dociągania gtag.js ładowana LENIWIE - celowo bez statycznego
 * importu (P1.1, poprawka po dowodzie A/B). Statyczna krawędź wciągała
 * `gtagLoadPolicy.ts`, a z nim prymitywy P0.3 (`whenQuiescent`,
 * `postInteractionQueue`, `firstInteraction`), do zamknięcia bootu
 * (`__root.tsx` -> ten komponent): +2,4 KB gzip w chunku `index`, a na mobile
 * fixture ten przyrost przekraczał próg rundy TCP w symulacji Lanterna
 * (ok. +155 ms LCP). `import()` z efektu po hydratacji daje osobny chunk
 * `gtagLoadPolicy-*.js`: nieosiągalny statycznie z wejścia, bez
 * `modulepreload` w dokumencie, pobierany dopiero po montażu.
 *
 * NIC NIE GINIE (PÓŹNY IMPORT w `whenQuiescent.ts`): detektor ciszy czyta
 * zbuforowane wpisy `PerformanceObserver` (`resource`, `longtask`) i liczy
 * minimum od `loadEventStart`, a kliknięcie, klawisz albo dotknięcie sprzed
 * importu łapie lepka aktywacja w `firstInteraction.ts`. Samo przewinięcie
 * sprzed importu (bez aktywacji) czeka na kolejną interakcję albo na punkt
 * ciszy; zapisana decyzja o zgodzie podjęta po imporcie idzie jak dotąd
 * (`release: "immediate"`).
 */
const loadGtagLoadPolicy = () => import("@/lib/analytics/gtagLoadPolicy");

/**
 * Jawna decyzja o zgodzie jako sygnał dla polityki dociągania gtag.js
 * (`scheduleGtagLoad`, sygnał (b): wpis kolejki P0.3 z `release: "immediate"`).
 * `subscribeConsentChange` budzi się też przy podglądzie, GPC i zmianie w innej
 * karcie - filtrem jest `hasConsentDecision`: liczy się wyłącznie ZAPISANA
 * decyzja odwiedzającego (baner, panel preferencji, ta sama decyzja z innej
 * karty). Decyzja zastana przy montażu (powracający odwiedzający) NIE jest
 * sygnałem - inaczej skrypt wracałby do okna hydratacji dokładnie dla tych,
 * którzy zgodzili się już wcześniej.
 */
function onConsentDecision(fire: () => void): () => void {
  return subscribeConsentChange(() => {
    if (hasConsentDecision()) fire();
  });
}

function removeMarked(owner: string) {
  if (typeof document === "undefined") return;
  document
    .querySelectorAll<HTMLElement>(`[${MARK_ATTR}="${owner}"]`)
    .forEach((el) => el.parentElement?.removeChild(el));
}

function injectExternalScript(
  src: string,
  owner: string,
  extra: Partial<HTMLScriptElement> = {},
): void {
  if (typeof document === "undefined") return;
  const s = document.createElement("script");
  s.src = src;
  s.async = true;
  s.setAttribute(MARK_ATTR, owner);
  Object.assign(s, extra);
  document.head.appendChild(s);
}

function injectInlineScript(code: string, owner: string): void {
  if (typeof document === "undefined" || !code.trim()) return;
  const s = document.createElement("script");
  s.text = code;
  s.setAttribute(MARK_ATTR, owner);
  document.head.appendChild(s);
}

/**
 * Injects arbitrary HTML from admin (head/body). Runs any nested <script>
 * tags so pixel snippets work. Parented off a container div so cleanup is
 * O(1). Do NOT expose to untrusted users - only admins can edit site_settings.
 */
function injectCustomHtml(html: string, owner: string, target: HTMLElement): void {
  if (!html.trim()) return;
  const holder = document.createElement("div");
  holder.setAttribute(MARK_ATTR, owner);
  holder.style.display = "none";
  holder.innerHTML = html;
  // Re-create <script> nodes so the browser executes them
  holder.querySelectorAll("script").forEach((old) => {
    const s = document.createElement("script");
    Array.from(old.attributes).forEach((a) => s.setAttribute(a.name, a.value));
    s.text = old.textContent ?? "";
    old.replaceWith(s);
  });
  target.appendChild(holder);
}

// ---------------- Analytics loaders ----------------

/**
 * Typy tagów GTM wyłączone w kontenerze. Wszystko, co mierzy, ładuje strona
 * sama, z właściwą bramką zgody - kontener nie może tego powielać ani obejść:
 * - `bzi`: LinkedIn Insight (pomiar marketingowy, ładuje `loadMarketing`);
 * - `gclidw`: Linker konwersji - łączenie kliknięć robi już tag Google
 *   z `config AW` po zgodzie marketingowej;
 * - `html`: własny kod HTML/JS, który omija bramki zgody (Clarity i weryfikacja
 *   Bing są w kodzie strony; dawny tag "consent default" po zgodzie cofał ją).
 */
export const GTM_BLOCKLIST: readonly string[] = ["bzi", "gclidw", "html"];

type ClarityFn = (...args: unknown[]) => void;

function readClarity(): ClarityFn | null {
  if (typeof window === "undefined") return null;
  const candidate: unknown = (window as Window & { clarity?: unknown }).clarity;
  return typeof candidate === "function" ? (candidate as ClarityFn) : null;
}

/** Consent API v2 Clarity: analityka i reklama osobno, wprost z decyzji odwiedzającego. */
export function clarityConsent(analytics: boolean, marketing: boolean): void {
  const clarity = readClarity();
  if (!clarity) return;
  try {
    clarity("consentv2", {
      ad_Storage: marketing ? "granted" : "denied",
      analytics_Storage: analytics ? "granted" : "denied",
    });
  } catch {
    /* Clarity niedostępna - nic do zaktualizowania */
  }
}

function loadAnalytics(cfg: AnalyticsConfig): CleanupFn {
  const owner = "consent-analytics";
  removeMarked(owner);

  // GA4 NIE jest tu ładowany: pracuje w trybie domyślnej odmowy Google i jest
  // uruchamiany niezależnie od tej bramki (patrz `Ga4ConsentBridge` niżej).

  if (cfg.gtm_container_id) {
    // `gtm.blocklist` (przed wczytaniem kontenera) wyłącza w GTM szablon
    // LinkedIn Insight (`bzi`): kontener startuje już po zgodzie analitycznej,
    // a LinkedIn jest pomiarem marketingowym - ładuje go wyłącznie
    // `loadMarketing` po zgodzie na marketing, bez podwójnych odsłon.
    injectInlineScript(
      `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.blocklist':${JSON.stringify(GTM_BLOCKLIST)}});w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;j.setAttribute('data-consent-owner','${owner}');f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(cfg.gtm_container_id)});`,
      owner,
    );
  }

  // Microsoft Clarity (mapy cieplne, nagrania sesji) po zgodzie analitycznej.
  // Oficjalny stub kolejkuje `consentv2` przed dociągnięciem skryptu.
  if (cfg.clarity_project_id && !readClarity()) {
    injectInlineScript(
      `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;t.setAttribute('data-consent-owner','${owner}');y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",${JSON.stringify(cfg.clarity_project_id)});`,
      owner,
    );
  }

  if (cfg.plausible_domain && cfg.plausible_script_url) {
    injectExternalScript(cfg.plausible_script_url, owner, {
      defer: true,
    });
    const s = document.querySelector<HTMLScriptElement>(
      `script[${MARK_ATTR}="${owner}"][src="${cfg.plausible_script_url}"]`,
    );
    if (s) s.setAttribute("data-domain", cfg.plausible_domain);
  }

  if (cfg.custom_head_html && typeof document !== "undefined") {
    injectCustomHtml(cfg.custom_head_html, owner, document.head);
  }
  if (cfg.custom_body_html && typeof document !== "undefined") {
    injectCustomHtml(cfg.custom_body_html, owner, document.body);
  }

  return () => removeMarked(owner);
}

// ---------------- Marketing loaders ----------------

function loadMarketing(cfg: MarketingConfig): CleanupFn {
  const owner = "consent-marketing";
  removeMarked(owner);

  if (cfg.meta_pixel_id) {
    // Snippet tylko inicjuje piksel. `disablePushState` wyłącza automatyczne
    // odsłony przejść SPA, które piksel wysyłałby BEZ `eventID` (nie do
    // zdeduplikowania z API konwersji); odsłony - pierwszą i każde przejście -
    // wysyła `trackMetaPageView` z `eventID` i kopią serwerową.
    injectInlineScript(
      `if(window.fbq){window.fbq('consent','grant');}!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];n.disablePushState=!0;t=b.createElement(e);t.async=!0;t.src=v;t.setAttribute('data-consent-owner','${owner}');s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(cfg.meta_pixel_id)},{},{agent:'lovable'});`,
      owner,
    );
  }

  if (cfg.linkedin_partner_id) {
    injectInlineScript(
      // Oficjalny stub `lintrk` z kolejką: konwersje zgłoszone przed dociągnięciem
      // insight.min.js nie przepadają (skrypt odczytuje `lintrk.q`).
      `_linkedin_partner_id=${JSON.stringify(cfg.linkedin_partner_id)};window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}})(window.lintrk);`,
      owner,
    );
    injectExternalScript("https://snap.licdn.com/li.lms-analytics/insight.min.js", owner);
  }

  if (cfg.x_pixel_id) {
    // Oficjalny kod bazowy X (kolejka `twq.queue` do startu uwt.js). Znacznik
    // na `window` blokuje drugie `config` (czyli drugą odsłonę) przy ponownym
    // przebiegu efektu; zdejmuje go `resetXPixel` przy wycofaniu zgody.
    // Przejścia SPA liczy `trackXPageView`.
    injectInlineScript(
      `!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',u.setAttribute('data-consent-owner','${owner}'),a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');if(window.${X_PIXEL_MARKER}!==${JSON.stringify(cfg.x_pixel_id)}){window.${X_PIXEL_MARKER}=${JSON.stringify(cfg.x_pixel_id)};twq('config',${JSON.stringify(cfg.x_pixel_id)});}`,
      owner,
    );
  }

  if (cfg.tiktok_pixel_id) {
    injectInlineScript(
      `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t,o.setAttribute('data-consent-owner','${owner}');var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load(${JSON.stringify(cfg.tiktok_pixel_id)});ttq.page();}(window,document,'ttq');`,
      owner,
    );
  }

  if (cfg.custom_head_html && typeof document !== "undefined") {
    injectCustomHtml(cfg.custom_head_html, owner, document.head);
  }
  if (cfg.custom_body_html && typeof document !== "undefined") {
    injectCustomHtml(cfg.custom_body_html, owner, document.body);
  }

  return () => removeMarked(owner);
}

// ---------------- Component ----------------

/** Nieprawidłowy wpis w site_settings degraduje do domyślnych - nie wywraca strony. */
function parseOrDefault<T>(
  parse: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  raw: unknown,
  fallback: () => T,
): T {
  const result = parse.safeParse(raw);
  return result.success && result.data !== undefined ? result.data : fallback();
}

export function ConsentScriptInjector() {
  const analyticsRaw = useSiteSetting("analytics", defaultAnalyticsConfig());
  const marketingRaw = useSiteSetting("marketing", defaultMarketingConfig());
  const analytics: AnalyticsConfig = parseOrDefault(
    AnalyticsConfigSchema,
    analyticsRaw,
    defaultAnalyticsConfig,
  );
  const marketing: MarketingConfig = parseOrDefault(
    MarketingConfigSchema,
    marketingRaw,
    defaultMarketingConfig,
  );
  const { categories, mounted } = useEffectiveConsent();
  // Identyfikator GA4 dla przeglądarki: tag z SSR > wpis z panelu > konektor >
  // stała (patrz `resolveBrowserGa4Id`). „Odłącz GA4" w panelu
  // (`ga4_enabled: false`) zatrzymuje bootstrap i aktualizacje zgody - tag z SSR
  // zostaje wtedy w trybie pełnej odmowy, czyli bez cookies i identyfikatorów.
  const ga4Id =
    analytics.ga4_enabled === false
      ? ""
      : resolveBrowserGa4Id({
          settingsId: analytics.ga4_measurement_id,
          connectorId: import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_ANALYTICS_API_KEY,
        });

  // GA4 w trybie domyślnej odmowy: strumień konfiguruje się od razu z wszystkimi
  // kategoriami `denied`, a decyzja odwiedzającego jedynie je aktualizuje.
  // Dlatego tu NIE ma bramki `categories.analytics` - jest nią sam Consent Mode.
  //
  // ROZDZIELENIE POLECEŃ OD SKRYPTU. `bootstrapGa4` wypycha polecenia do
  // `window.dataLayer` SYNCHRONICZNIE (albo rozpoznaje, że zrobił to już snippet
  // SSR), a sam plik gtag.js czeka na sygnał polityki `scheduleGtagLoad`:
  // pierwszą interakcję (gtag ostatni w kolejce po interakcji), jawną decyzję o
  // zgodzie albo globalny punkt ciszy strony (P0.3: ≥ 5 s po load i 5 s ciszy,
  // limit 20 s). Do 2026-10-02 było to `afterPageLoad(…, 2000)`, do 2026-10-04
  // bezczynność 2-8 s po load - oba trafiały w ślad Lighthouse'a, a Lantern liczy
  // każde długie zadanie w śladzie. Semantyka zgody nie zmienia się ani o krok:
  // `consent default`/`update` siedzą w warstwie danych, którą skrypt
  // przetwarza od początku, gdy dojedzie. Kompromis (odwiedzający bez
  // interakcji, który wychodzi przed punktem ciszy, ok. load + 10 s, nie wysyła
  // `page_view`) jest opisany w nagłówku `gtagLoadPolicy.ts`.
  //
  // Samą politykę (i prymitywy P0.3) ładuje `import()` dopiero tutaj, po
  // hydratacji - patrz `loadGtagLoadPolicy`. Cleanup przed jego
  // rozstrzygnięciem (odmontowanie, zmiana strumienia) nie zakłada już
  // żadnego sygnału. Gdy chunk nie dojedzie (np. dokument z cache brzegowego
  // po wdrożeniu z nowymi hashami) albo polityka rzuci, tag ładuje się od razu:
  // utracony pomiar byłby trwały, a koszt wraca tylko w tym przypadku awarii;
  // dociąganie jest idempotentne, więc spóźniony sygnał polityki nie
  // wstrzyknie drugiego skryptu.
  useEffect(() => {
    if (!mounted || !ga4Id) return;
    let active = true;
    let cancelLoad: (() => void) | null = null;
    bootstrapGa4(ga4Id, {
      scheduleScript: (load) => {
        void loadGtagLoadPolicy()
          .then(({ scheduleGtagLoad }) => {
            if (active) cancelLoad = scheduleGtagLoad(load, { onDecision: onConsentDecision });
          })
          .catch(() => {
            if (active) void load();
          });
      },
    });
    return () => {
      active = false;
      cancelLoad?.();
    };
  }, [mounted, ga4Id]);

  // ZGODA, POTEM GOOGLE ADS - w TYM SAMYM efekcie i w tej kolejności (P1.1,
  // TP-2). Snippet SSR i bootstrap nie konfigurują już Ads: `config AW` kazałby
  // gtag.js dociągnąć kontener Ads (~200 KB, ~185 ms CPU) każdemu, także bez
  // zgody. `ga4ConfigureAds` biegnie wyłącznie przy `categories.marketing ===
  // true` (GPC zdejmuje marketing już w `useEffectiveConsent`) i PO
  // `ga4ConsentUpdate`: gtag.js przetwarza warstwę danych po kolei, więc
  // `config AW` przed aktualizacją zgody wysłałby pierwsze trafienie Ads
  // powracającego odwiedzającego w stanie `denied`. Idempotencja (flaga i skan
  // warstwy danych na `config AW` z HTML-a z cache) jest po stronie `ga4Client`.
  // Google Ads z panelu (Pixels -> Google Ads): identyfikator tagu i etykiety
  // konwersji trafiają do wysyłki PRZED konfiguracją Ads poniżej.
  const adsId = extractGoogleAdsId(marketing.google_ads_id);
  const adsLabelsKey = JSON.stringify(marketing.google_ads_conversions);
  useEffect(() => {
    configureGoogleAds({ id: adsId, labels: marketing.google_ads_conversions });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adsId, adsLabelsKey]);

  useEffect(() => {
    if (!mounted || !ga4Id) return;
    ga4ConsentUpdate(categories);
    if (categories.marketing === true && adsId) ga4ConfigureAds(adsId);
  }, [mounted, ga4Id, adsId, categories]);

  const analyticsCleanup = useRef<CleanupFn | null>(null);
  const marketingCleanup = useRef<CleanupFn | null>(null);

  useEffect(() => {
    if (!mounted) return;
    if (categories.analytics) {
      analyticsCleanup.current = loadAnalytics(analytics);
    } else {
      // Wycofanie zgody: Clarity w pamięci przestaje zapisywać i wysyłać.
      clarityConsent(false, false);
      analyticsCleanup.current?.();
      analyticsCleanup.current = null;
    }
    return () => {
      analyticsCleanup.current?.();
      analyticsCleanup.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, categories.analytics, JSON.stringify(analytics)]);

  // Clarity dostaje każdą zmianę decyzji (także samą zgodę marketingową).
  useEffect(() => {
    if (!mounted || !categories.analytics || !analytics.clarity_project_id) return;
    clarityConsent(true, categories.marketing === true);
  }, [mounted, categories.analytics, categories.marketing, analytics.clarity_project_id]);

  useEffect(() => {
    if (!mounted) return;
    let active = true;
    let stopMetaContact: (() => void) | null = null;
    let stopTicketWatch: (() => void) | null = null;
    let stopLinkedInAuto: (() => void) | null = null;
    if (categories.marketing) {
      marketingCleanup.current = loadMarketing(marketing);
      // Piksel Meta stoi: wysyłamy zdarzenia zakolejkowane przed jego startem
      // (odsłona, powrót z płatności) i zakładamy nasłuch Contact (mailto/tel).
      if (marketing.meta_pixel_id) {
        void import("@/lib/analytics/metaPixelEvents")
          .then((m) => {
            if (!active) return;
            m.flushPendingMetaEvents();
            m.trackMetaPageView();
            stopMetaContact = m.installMetaContactListener();
          })
          .catch(() => undefined);
      }
      // LinkedIn Insight stoi: przekazujemy ID konwersji z panelu i wysyłamy
      // wyniki zakolejkowane przed odczytem ustawień.
      if (marketing.linkedin_partner_id) {
        void import("@/lib/analytics/linkedinInsightEvents")
          .then((m) => {
            if (!active) return;
            m.configureLinkedInConversions(marketing.linkedin_conversions);
            stopLinkedInAuto = m.installLinkedInAutoGoals();
          })
          .catch(() => undefined);
      }
      // Piksel X stoi: zapamiętujemy go dla odsłon przejść SPA.
      if (marketing.x_pixel_id) {
        void import("@/lib/analytics/xPixelEvents")
          .then((m) => {
            if (active) m.configureXPixel(marketing.x_pixel_id);
          })
          .catch(() => undefined);
      }
      // Powrót z płatności za bilet: Purchase (Meta) i zakup Google Ads po
      // potwierdzeniu zamówienia w bazie - niezależnie od tego, czy piksel Meta
      // jest skonfigurowany (każdy kanał sam pilnuje zgody marketingowej).
      void import("@/lib/analytics/metaTicketPurchase")
        .then((m) => {
          if (active) stopTicketWatch = m.watchMetaTicketPurchase();
        })
        .catch(() => undefined);
      // Lustro pikseli do panelu admina (Piksele Ads) - patrz adPixels.ts.
      const platforms: AdPlatform[] = [];
      if (marketing.meta_pixel_id) platforms.push("meta");
      if (ga4Id && adsId) platforms.push("google_ads");
      if (marketing.linkedin_partner_id) platforms.push("linkedin");
      if (marketing.x_pixel_id) platforms.push("x");
      // Leniwie: lustro ciągnie `track()`, którego nie chcemy w chunku bootu.
      void import("@/lib/analytics/adPixelTelemetry")
        .then((m) => {
          m.setActiveAdPlatforms(platforms);
          m.recordAdPixelVisit();
        })
        .catch(() => undefined);
    } else {
      void import("@/lib/analytics/adPixelTelemetry")
        .then((m) => m.setActiveAdPlatforms([]))
        .catch(() => undefined);
      // Wycofanie zgody: piksel Meta przestaje wysyłać bez przeładowania strony,
      // a ponowna zgoda znów policzy bieżącą odsłonę.
      void import("@/lib/analytics/metaPixelEvents")
        .then((m) => m.resetMetaPageView())
        .catch(() => undefined);
      const fbq: unknown = (window as Window & { fbq?: unknown }).fbq;
      if (typeof fbq === "function") {
        try {
          (fbq as (...args: unknown[]) => void)("consent", "revoke");
        } catch {
          /* piksel niedostępny - nic do wycofania */
        }
      }
      void import("@/lib/analytics/linkedinInsightEvents")
        .then((m) => m.resetLinkedInConversions())
        .catch(() => undefined);
      void import("@/lib/analytics/xPixelEvents")
        .then((m) => m.resetXPixel())
        .catch(() => undefined);
      marketingCleanup.current?.();
      marketingCleanup.current = null;
    }
    return () => {
      active = false;
      stopMetaContact?.();
      stopTicketWatch?.();
      stopLinkedInAuto?.();
      marketingCleanup.current?.();
      marketingCleanup.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, categories.marketing, ga4Id, JSON.stringify(marketing)]);

  return null;
}
