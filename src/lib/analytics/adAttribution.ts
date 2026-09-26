// Atrybucja kampanii (Google Ads / UTM) - CZYSTA logika, bez DOM i bez magazynu.
//
// PO CO. Do lejka sprzedazy wydarzenia potrzebujemy wiedziec, z jakiej kampanii
// przyszla przegladarka, ktora potem sie zapisala albo kupila bilet. Adres
// wejscia niesie to w `utm_*`, `gclid`/`gbraid`/`wbraid` (klikniecie Google Ads;
// iOS/aplikacje dostaja gbraid/wbraid zamiast gclid) oraz `gad_source`
// i `gad_campaignid` (autotagowanie). Nikt w repozytorium tego dotad nie
// zapisywal, a jedyny strumien analityczny tnie query string (redactUrl).
//
// DLACZEGO CZYSTY MODUL. Ta sama walidacja stoi w SQL (`_event_ads_touch`
// w migracji 20260926120000) i tu - klient nie wysyla niczego, czego baza
// i tak by nie przyjela, a testy jednostkowe mierza kazda regule bez
// przegladarki. Magazyn i zgody mieszkaja w `adAttributionStore.ts`.
//
// ZASADY (lustrzane z SQL):
//   * UTM: bez znakow sterujacych, zwiniete biale znaki, maks. 100 znakow;
//     wartosc wygladajaca na adres e-mail ODRZUCONA (nadawcy newsletterow
//     wkladaja adresy do utm_content) - `source`/`medium` malymi literami;
//   * identyfikator klikniecia wylacznie pod regexem `[A-Za-z0-9_-]{10,512}`,
//     pierwszenstwo gclid > gbraid > wbraid;
//   * odsylacz tylko zewnetrzny: wlasny host, bramki platnosci i logowania nie
//     sa "zrodlem ruchu" (powrot ze Stripe nadpisalby kampanie jako referral);
//   * model: pierwsze dotkniecie + OSTATNIE NIE-BEZPOSREDNIE, okno 90 dni
//     (okno atrybucji Google Ads). Wejscie bez zadnego sygnalu niczego nie
//     zmienia - nie kasuje kampanii, z ktorej przegladarka przyszla wczesniej.
//
// ADRESU NIE ZMIENIAMY. gtag.js czyta `gclid` z `location`, kiedy sie wczyta
// (po zgodzie na `ad_storage`) - wyciecie parametru zepsuloby mu laczenie
// konwersji.

export type ClickIdType = "gclid" | "gbraid" | "wbraid";

/** Pierwszenstwo: gclid (web) > gbraid (iOS app->web) > wbraid (iOS web->app). */
export const CLICK_ID_TYPES: readonly ClickIdType[] = ["gclid", "gbraid", "wbraid"];

/** Okno atrybucji (Google Ads przyjmuje konwersje do 90 dni od klikniecia). */
export const AD_ATTRIBUTION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Maksymalna dlugosc wartosci UTM (ta sama co w SQL). */
export const UTM_MAX_LENGTH = 100;

export interface AdTouch {
  /** Chwila przechwycenia (ms epoki, zegar przegladarki). */
  readonly ts: number;
  /** Sama sciezka wejscia, bez query. */
  readonly landingPath: string | null;
  readonly referrerHost: string | null;
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly utmCampaign: string | null;
  readonly utmTerm: string | null;
  readonly utmContent: string | null;
  readonly gadSource: string | null;
  readonly gadCampaignId: string | null;
  /** Rodzaj klikniecia - to kanal (google/cpc), nie identyfikator osoby. */
  readonly clickType: ClickIdType | null;
  /** Identyfikator klikniecia - zyje wylacznie przy zgodzie marketingowej. */
  readonly clickId: string | null;
}

export interface StoredAttribution {
  readonly v: 1;
  readonly first: AdTouch;
  readonly last: AdTouch;
}

/** Ksztalt wysylany do bazy (klucze jak w `_event_ads_touch`). */
export type AdTouchWire = {
  ts: number;
  landing_path: string | null;
  referrer_host: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gad_source: string | null;
  gad_campaign_id: string | null;
  click_id_type: ClickIdType | null;
  click_id: string | null;
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i;
// eslint-disable-next-line no-control-regex -- celowo: wycinamy znaki sterujace z UTM
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const CLICK_ID_RE = /^[A-Za-z0-9_-]{10,512}$/;
const GAD_SOURCE_RE = /^\d{1,10}$/;
const GAD_CAMPAIGN_RE = /^\d{1,20}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const PATH_RE = /^\/[^\s?#]*$/;
const PATH_MAX = 512;

/**
 * Odsylacze, ktore NIE sa zrodlem ruchu: bramki platnosci i logowania.
 * Powrot ze Stripe Checkout albo z logowania Google nadpisywalby kampanie
 * jako "referral" dokladnie w chwili zakupu.
 */
const REFERRAL_EXCLUSIONS: readonly string[] = [
  "stripe.com",
  "paypal.com",
  "accounts.google.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
  "login.live.com",
];

/** Czysci wartosc UTM (lustro `_event_ads_clean`); `null` = brak albo odrzucona. */
export function cleanUtm(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const collapsed = value.replace(CONTROL_RE, "").replace(/\s+/g, " ").trim();
  if (collapsed === "" || EMAIL_RE.test(collapsed)) return null;
  return collapsed.slice(0, UTM_MAX_LENGTH).trim();
}

function lowerOrNull(value: string | null): string | null {
  return value === null ? null : value.toLowerCase();
}

function matchOrNull(value: string | null | undefined, re: RegExp): string | null {
  return typeof value === "string" && re.test(value) ? value : null;
}

/** Host bez `www.`, malymi literami - albo `null`, gdy nie jest nazwa hosta. */
export function normalizeHost(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length > 253) return null;
  const lower = value.toLowerCase();
  return HOST_RE.test(lower) ? lower.replace(/^www\./, "") : null;
}

function isExcludedReferrer(host: string, ownHost: string | null): boolean {
  if (ownHost !== null && host === ownHost) return true;
  return REFERRAL_EXCLUSIONS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function externalReferrerHost(referrer: string | null, ownHost: string | null): string | null {
  if (referrer === null || referrer === "") return null;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = normalizeHost(url.hostname);
  if (host === null || isExcludedReferrer(host, ownHost)) return null;
  return host;
}

function landingPathOf(pathname: string): string | null {
  return pathname.length <= PATH_MAX && PATH_RE.test(pathname) ? pathname : null;
}

function hasSignal(touch: Omit<AdTouch, "ts" | "landingPath">): boolean {
  return (
    touch.utmSource !== null ||
    touch.utmMedium !== null ||
    touch.utmCampaign !== null ||
    touch.utmTerm !== null ||
    touch.utmContent !== null ||
    touch.gadSource !== null ||
    touch.gadCampaignId !== null ||
    touch.clickType !== null ||
    touch.referrerHost !== null
  );
}

export interface LandingInput {
  /** `location.search` (z `?` albo bez). */
  search: string;
  pathname: string;
  /** `document.referrer`; `null` = nie brac odsylacza pod uwage. */
  referrer: string | null;
  /** `location.hostname` - wlasny host nie jest odsylaczem. */
  host: string;
  nowMs: number;
}

/**
 * Dotkniecie kampanii z adresu wejscia albo `null`, gdy wejscie nie niesie
 * zadnego sygnalu (wejscie bezposrednie - niczego nie nadpisuje).
 */
export function parseAdTouch(input: LandingInput): AdTouch | null {
  const params = new Map<string, string>();
  for (const [name, value] of new URLSearchParams(input.search)) {
    const key = name.toLowerCase();
    if (!params.has(key)) params.set(key, value);
  }
  const clickType = CLICK_ID_TYPES.find((type) => CLICK_ID_RE.test(params.get(type) ?? "")) ?? null;
  const signal = {
    referrerHost: externalReferrerHost(input.referrer, normalizeHost(input.host)),
    utmSource: lowerOrNull(cleanUtm(params.get("utm_source"))),
    utmMedium: lowerOrNull(cleanUtm(params.get("utm_medium"))),
    utmCampaign: cleanUtm(params.get("utm_campaign")),
    utmTerm: cleanUtm(params.get("utm_term")),
    utmContent: cleanUtm(params.get("utm_content")),
    gadSource: matchOrNull(params.get("gad_source"), GAD_SOURCE_RE),
    gadCampaignId: matchOrNull(params.get("gad_campaignid"), GAD_CAMPAIGN_RE),
    clickType,
    clickId: clickType === null ? null : (params.get(clickType) as string),
  };
  if (!hasSignal(signal)) return null;
  return { ts: input.nowMs, landingPath: landingPathOf(input.pathname), ...signal };
}

/**
 * Pierwsze dotkniecie zostaje, ostatnie nie-bezposrednie jest nowe. Wygasle
 * dotkniecia (poza oknem 90 dni) nie przechodza do wyniku.
 */
export function mergeAttribution(
  prev: StoredAttribution | null,
  next: AdTouch,
  nowMs: number,
): StoredAttribution {
  const fresh = freshAttribution(prev, nowMs);
  return { v: 1, first: fresh === null ? next : fresh.first, last: next };
}

function isFresh(touch: AdTouch, nowMs: number): boolean {
  return nowMs - touch.ts <= AD_ATTRIBUTION_TTL_MS;
}

/** Atrybucja po odcieciu dotkniec starszych niz okno (albo `null`). */
export function freshAttribution(
  attribution: StoredAttribution | null,
  nowMs: number,
): StoredAttribution | null {
  if (attribution === null || !isFresh(attribution.last, nowMs)) return null;
  if (isFresh(attribution.first, nowMs)) return attribution;
  return { v: 1, first: attribution.last, last: attribution.last };
}

/**
 * Kopia bez identyfikatorow klikniec - dla zgody wylacznie analitycznej.
 * Rodzaj klikniecia zostaje: to informacja o kanale (google/cpc), nie o osobie.
 */
export function withoutClickIds(attribution: StoredAttribution): StoredAttribution {
  return {
    v: 1,
    first: { ...attribution.first, clickId: null },
    last: { ...attribution.last, clickId: null },
  };
}

/** Ksztalt do bazy (snake_case, jak w `_event_ads_touch`). */
export function touchWire(touch: AdTouch): AdTouchWire {
  return {
    ts: touch.ts,
    landing_path: touch.landingPath,
    referrer_host: touch.referrerHost,
    utm_source: touch.utmSource,
    utm_medium: touch.utmMedium,
    utm_campaign: touch.utmCampaign,
    utm_term: touch.utmTerm,
    utm_content: touch.utmContent,
    gad_source: touch.gadSource,
    gad_campaign_id: touch.gadCampaignId,
    click_id_type: touch.clickType,
    click_id: touch.clickId,
  };
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

/**
 * Dotkniecie odczytane z magazynu przegladarki. Magazyn jest EDYTOWALNY przez
 * uzytkownika, wiec kazde pole przechodzi te same reguly co przy wejsciu;
 * cokolwiek nie pasuje, wypada.
 */
export function sanitizeTouch(raw: unknown): AdTouch | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const ts = record.ts;
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return null;
  const clickTypeRaw = stringField(record, "clickType");
  const clickType = CLICK_ID_TYPES.find((type) => type === clickTypeRaw) ?? null;
  const clickId =
    clickType === null ? null : matchOrNull(stringField(record, "clickId"), CLICK_ID_RE);
  const landing = stringField(record, "landingPath");
  const signal = {
    referrerHost: normalizeHost(stringField(record, "referrerHost")),
    utmSource: lowerOrNull(cleanUtm(stringField(record, "utmSource"))),
    utmMedium: lowerOrNull(cleanUtm(stringField(record, "utmMedium"))),
    utmCampaign: cleanUtm(stringField(record, "utmCampaign")),
    utmTerm: cleanUtm(stringField(record, "utmTerm")),
    utmContent: cleanUtm(stringField(record, "utmContent")),
    gadSource: matchOrNull(stringField(record, "gadSource"), GAD_SOURCE_RE),
    gadCampaignId: matchOrNull(stringField(record, "gadCampaignId"), GAD_CAMPAIGN_RE),
    clickType,
    clickId,
  };
  if (!hasSignal(signal)) return null;
  return { ts, landingPath: landing === null ? null : landingPathOf(landing), ...signal };
}

/** Atrybucja z tekstu magazynu - albo `null` (brak, zly JSON, zly ksztalt). */
export function parseStoredAttribution(raw: string | null): StoredAttribution | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1) return null;
  const last = sanitizeTouch(record.last);
  if (last === null) return null;
  return { v: 1, first: sanitizeTouch(record.first) ?? last, last };
}
