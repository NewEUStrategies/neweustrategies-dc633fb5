// Render HTML wiadomości kampanii newslettera - JEDNO miejsce dla wysyłki,
// wysyłki testowej i przyszłych podglądów.
//
// Funkcja mieszkała prywatnie w `newsletter-campaigns.functions.ts`; wyniesiona
// BEZ ZMIANY CIAŁA (dowód bajt w bajt: macierz 48 przypadków - język, tracking
// z podpisem linku i bez, stopka wypisu i jej brak, znaki specjalne w
// zmiennych, tag nieużyty - przypięta skrótami SHA-256 policzonymi na
// implementacji z a90e66c4, `__tests__/renderCampaign.server.test.ts`).
// Jedyny dodatek to opcjonalny kod kuponu (`{{coupon_code}}`, P04): bez niego
// wynik jest identyczny jak przed wyniesieniem.
//
// I9d-Y2: drugi opcjonalny dodatek - linia stopki „Nie mierz moich otwarć
// i kliknięć" (`measurementOptOutUrl`); bez niej wynik bajt w bajt jak dotąd.
// O pomiarze (piksel, linki z tokenem) decyduje WOŁAJĄCY: odbiorca bez zgody
// na pomiar dostaje `tracking = null` - mail jak wysyłka testowa.
//
// Plik `.server`: render widzi tokeny trackingu i adres wypisu odbiorcy - nie
// ma powodu, żeby trafiał do paczki przeglądarki.
import { rewriteTrackingLinks, trackingPixelImg } from "@/lib/newsletter/tracking";
import { MEASUREMENT_FOOTER_COPY } from "@/lib/privacy/measurement";

/** Kod kuponu podstawiany w wysyłce testowej - tag nigdy nie wychodzi surowy. */
export const SAMPLE_COUPON_CODE = "PRZYKLAD-KOD";

export function esc(v: string): string {
  return v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

export function renderCampaignHtml(
  rawHtml: string,
  vars: {
    email: string;
    firstName: string;
    lastName: string;
    /**
     * Kod kuponu odbiorcy (kampania kuponowa). Brak = `{{coupon_code}}`
     * zostaje nietknięty (zachowanie sprzed P04); wysyłka kuponowa zawsze go
     * podaje, a zwykła kampania z tym tagiem jest zatrzymywana wcześniej.
     */
    couponCode?: string | null;
  },
  lang: "pl" | "en",
  unsubscribeUrl: string | null,
  // When present, body links are rewritten through the click-tracking redirect
  // and an open-tracking pixel is appended. `token` is the SIGNED tracking token
  // (HMAC per campaign+subscriber, see trackingToken.server) - NOT the
  // unsubscribe token. Null for test sends (no tracking).
  tracking: {
    origin: string;
    campaignId: string;
    token: string;
    signLink?: (target: string) => string;
  } | null = null,
  // Adres wycofania SAMEGO pomiaru (podpisany token subskrybenta). Doklejany
  // PO przepisaniu linków - jak wypis, nie przechodzi przez przekierowanie.
  measurementOptOutUrl: string | null = null,
): string {
  // Kod podstawiamy w SZABLONIE, przed zmiennymi osobowymi: imię odbiorcy
  // zawierające napis `{{coupon_code}}` nie może stać się nośnikiem kodu.
  const template =
    vars.couponCode == null ? rawHtml : rawHtml.replaceAll("{{coupon_code}}", esc(vars.couponCode));
  const replaced = template
    .replaceAll("{{email}}", esc(vars.email))
    .replaceAll("{{firstName}}", esc(vars.firstName))
    .replaceAll("{{lastName}}", esc(vars.lastName));
  // Rewrite body links BEFORE the unsubscribe footer is appended, so the
  // one-click unsubscribe link (and List-Unsubscribe / RFC-8058) is never
  // routed through the tracker.
  const content = tracking
    ? rewriteTrackingLinks(
        replaced,
        tracking.origin,
        tracking.campaignId,
        tracking.token,
        tracking.signLink,
      )
    : replaced;
  const footer = unsubscribeUrl
    ? `<hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
       <p style="color:#888;font-size:12px;text-align:center">
         ${
           lang === "pl"
             ? `Nie chcesz otrzymywać tych wiadomości? <a href="${esc(unsubscribeUrl)}" style="color:#888">Wypisz się jednym kliknięciem</a>.`
             : `No longer want these emails? <a href="${esc(unsubscribeUrl)}" style="color:#888">Unsubscribe with one click</a>.`
         }
       </p>`
    : "";
  const measurementCopy = MEASUREMENT_FOOTER_COPY[lang];
  const measurementFooter = measurementOptOutUrl
    ? `<p style="color:#888;font-size:12px;text-align:center">${esc(measurementCopy.lead)} <a href="${esc(measurementOptOutUrl)}" style="color:#888">${esc(measurementCopy.link)}</a>.</p>`
    : "";
  const pixel = tracking
    ? trackingPixelImg(tracking.origin, tracking.campaignId, tracking.token)
    : "";
  return `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:640px;margin:0 auto">${content}${footer}${measurementFooter}${pixel}</div>`;
}
