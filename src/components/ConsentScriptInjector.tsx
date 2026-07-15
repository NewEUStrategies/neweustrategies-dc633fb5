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
import { useEffectiveConsent } from "@/lib/ads/consent";

type CleanupFn = () => void;

const MARK_ATTR = "data-consent-owner";

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

function loadAnalytics(cfg: AnalyticsConfig): CleanupFn {
  const owner = "consent-analytics";
  removeMarked(owner);

  if (cfg.ga4_measurement_id) {
    injectExternalScript(
      `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.ga4_measurement_id)}`,
      owner,
    );
    injectInlineScript(
      `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(cfg.ga4_measurement_id)},{anonymize_ip:true});`,
      owner,
    );
  }

  if (cfg.gtm_container_id) {
    injectInlineScript(
      `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;j.setAttribute('data-consent-owner','${owner}');f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(cfg.gtm_container_id)});`,
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
    injectInlineScript(
      `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;t.setAttribute('data-consent-owner','${owner}');s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(cfg.meta_pixel_id)});fbq('track','PageView');`,
      owner,
    );
  }

  if (cfg.linkedin_partner_id) {
    injectInlineScript(
      `_linkedin_partner_id=${JSON.stringify(cfg.linkedin_partner_id)};window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);`,
      owner,
    );
    injectExternalScript("https://snap.licdn.com/li.lms-analytics/insight.min.js", owner);
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

export function ConsentScriptInjector() {
  const analyticsRaw = useSiteSetting("analytics", defaultAnalyticsConfig());
  const marketingRaw = useSiteSetting("marketing", defaultMarketingConfig());
  const analytics: AnalyticsConfig = AnalyticsConfigSchema.parse(analyticsRaw);
  const marketing: MarketingConfig = MarketingConfigSchema.parse(marketingRaw);
  const { categories, mounted } = useEffectiveConsent();
  const analyticsCleanup = useRef<CleanupFn | null>(null);
  const marketingCleanup = useRef<CleanupFn | null>(null);

  useEffect(() => {
    if (!mounted) return;
    if (categories.analytics) {
      analyticsCleanup.current = loadAnalytics(analytics);
    } else {
      analyticsCleanup.current?.();
      analyticsCleanup.current = null;
    }
    return () => {
      analyticsCleanup.current?.();
      analyticsCleanup.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, categories.analytics, JSON.stringify(analytics)]);

  useEffect(() => {
    if (!mounted) return;
    if (categories.marketing) {
      marketingCleanup.current = loadMarketing(marketing);
    } else {
      marketingCleanup.current?.();
      marketingCleanup.current = null;
    }
    return () => {
      marketingCleanup.current?.();
      marketingCleanup.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, categories.marketing, JSON.stringify(marketing)]);

  return null;
}
