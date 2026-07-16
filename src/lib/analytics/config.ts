// Analytics / Marketing site_settings shape. Backs the admin forms and the
// runtime ConsentScriptInjector: nothing is loaded until the visitor grants
// the matching category.
import { z } from "zod";

export const AnalyticsConfigSchema = z.object({
  ga4_measurement_id: z.string().trim().max(64).default(""),
  ga4_property_id: z.string().trim().max(64).default(""),
  ga4_enabled: z.boolean().default(true),
  gtm_container_id: z.string().trim().max(64).default(""),
  plausible_domain: z.string().trim().max(255).default(""),
  plausible_script_url: z
    .string()
    .trim()
    .max(500)
    .default("https://plausible.io/js/script.js"),
  custom_head_html: z.string().max(20_000).default(""),
  custom_body_html: z.string().max(20_000).default(""),
});
export type AnalyticsConfig = z.infer<typeof AnalyticsConfigSchema>;
export const defaultAnalyticsConfig = (): AnalyticsConfig => AnalyticsConfigSchema.parse({});

export const MarketingConfigSchema = z.object({
  meta_pixel_id: z.string().trim().max(64).default(""),
  linkedin_partner_id: z.string().trim().max(64).default(""),
  tiktok_pixel_id: z.string().trim().max(64).default(""),
  custom_head_html: z.string().max(20_000).default(""),
  custom_body_html: z.string().max(20_000).default(""),
});
export type MarketingConfig = z.infer<typeof MarketingConfigSchema>;
export const defaultMarketingConfig = (): MarketingConfig => MarketingConfigSchema.parse({});
