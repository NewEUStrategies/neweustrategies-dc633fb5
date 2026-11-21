// Analytics / Marketing site_settings shape. Backs the admin forms and the
// runtime ConsentScriptInjector: nothing is loaded until the visitor grants
// the matching category.
import { z } from "zod";
import { extractLinkedInConversionId } from "./linkedinConversionId";
import {
  DEFAULT_GOOGLE_ADS_ID,
  DEFAULT_GOOGLE_ADS_LABELS,
  extractGoogleAdsId,
  extractGoogleAdsLabel,
} from "./googleAdsGoals";

/** Identyfikator projektu Microsoft Clarity (małe litery i cyfry); śmieci -> "". */
export const CLARITY_PROJECT_ID_RE = /^[a-z0-9]{6,20}$/;
const clarityProjectId = z
  .string()
  .max(64)
  .catch("")
  .transform((v) => {
    const id = v.trim().toLowerCase();
    return CLARITY_PROJECT_ID_RE.test(id) ? id : "";
  });

export const AnalyticsConfigSchema = z.object({
  ga4_measurement_id: z.string().trim().max(64).default(""),
  ga4_property_id: z.string().trim().max(64).default(""),
  ga4_enabled: z.boolean().default(true),
  gtm_container_id: z.string().trim().max(64).default(""),
  clarity_project_id: clarityProjectId.default(""),
  plausible_domain: z.string().trim().max(255).default(""),
  plausible_script_url: z.string().trim().max(500).default("https://plausible.io/js/script.js"),
  custom_head_html: z.string().max(20_000).default(""),
  custom_body_html: z.string().max(20_000).default(""),
});
export type AnalyticsConfig = z.infer<typeof AnalyticsConfigSchema>;
export const defaultAnalyticsConfig = (): AnalyticsConfig => AnalyticsConfigSchema.parse({});

/** Wpis ID konwersji LinkedIn: numer albo fragment `lintrk`; śmieci -> "" (nie psują całej konfiguracji). */
const linkedInConversionId = z
  .string()
  .max(500)
  .catch("")
  .transform((v) => extractLinkedInConversionId(v));

export const LinkedInConversionsSchema = z
  .object({
    contact_form: linkedInConversionId.default(""),
    club_application: linkedInConversionId.default(""),
    account_signup: linkedInConversionId.default(""),
    newsletter: linkedInConversionId.default(""),
    event_registration: linkedInConversionId.default(""),
    purchase: linkedInConversionId.default(""),
    page_view: linkedInConversionId.default(""),
    video_view: linkedInConversionId.default(""),
    download: linkedInConversionId.default(""),
    schedule: linkedInConversionId.default(""),
    add_to_cart: linkedInConversionId.default(""),
  })
  .catch({
    contact_form: "",
    club_application: "",
    account_signup: "",
    newsletter: "",
    event_registration: "",
    purchase: "",
    page_view: "",
    video_view: "",
    download: "",
    schedule: "",
    add_to_cart: "",
  });

/** Etykieta konwersji Google Ads: etykieta albo fragment `send_to`; śmieci -> "" (konwersja wyłączona). */
const googleAdsLabel = (fallback: string) =>
  z.string().max(500).catch(fallback).transform(extractGoogleAdsLabel).default(fallback);

export const GoogleAdsConversionsSchema = z
  .object({
    contact_form: googleAdsLabel(DEFAULT_GOOGLE_ADS_LABELS.contact_form),
    club_application: googleAdsLabel(DEFAULT_GOOGLE_ADS_LABELS.club_application),
    account_signup: googleAdsLabel(DEFAULT_GOOGLE_ADS_LABELS.account_signup),
    newsletter: googleAdsLabel(DEFAULT_GOOGLE_ADS_LABELS.newsletter),
    event_registration: googleAdsLabel(DEFAULT_GOOGLE_ADS_LABELS.event_registration),
    purchase: googleAdsLabel(DEFAULT_GOOGLE_ADS_LABELS.purchase),
  })
  .catch(() => ({ ...DEFAULT_GOOGLE_ADS_LABELS }));

export const MarketingConfigSchema = z.object({
  /** `AW-…` tagu Google Ads; brak klucza = konto wbudowane, pusty wpis = Ads wyłączone. */
  google_ads_id: z
    .string()
    .max(200)
    .catch(DEFAULT_GOOGLE_ADS_ID)
    .transform(extractGoogleAdsId)
    .default(DEFAULT_GOOGLE_ADS_ID),
  google_ads_conversions: GoogleAdsConversionsSchema.prefault({}),
  meta_pixel_id: z.string().trim().max(64).default(""),
  linkedin_partner_id: z.string().trim().max(64).default(""),
  linkedin_conversions: LinkedInConversionsSchema.prefault({}),
  tiktok_pixel_id: z.string().trim().max(64).default(""),
  custom_head_html: z.string().max(20_000).default(""),
  custom_body_html: z.string().max(20_000).default(""),
});
export type MarketingConfig = z.infer<typeof MarketingConfigSchema>;
export const defaultMarketingConfig = (): MarketingConfig => MarketingConfigSchema.parse({});
