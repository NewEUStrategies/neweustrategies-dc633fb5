// Analytics / Marketing site_settings shape. Backs the admin forms and the
// runtime ConsentScriptInjector: nothing is loaded until the visitor grants
// the matching category.
import { z } from "zod";
import { extractLinkedInConversionId } from "./linkedinConversionId";

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
  })
  .catch({
    contact_form: "",
    club_application: "",
    account_signup: "",
    newsletter: "",
    event_registration: "",
    purchase: "",
  });

export const MarketingConfigSchema = z.object({
  meta_pixel_id: z.string().trim().max(64).default(""),
  linkedin_partner_id: z.string().trim().max(64).default(""),
  linkedin_conversions: LinkedInConversionsSchema.prefault({}),
  tiktok_pixel_id: z.string().trim().max(64).default(""),
  custom_head_html: z.string().max(20_000).default(""),
  custom_body_html: z.string().max(20_000).default(""),
});
export type MarketingConfig = z.infer<typeof MarketingConfigSchema>;
export const defaultMarketingConfig = (): MarketingConfig => MarketingConfigSchema.parse({});
