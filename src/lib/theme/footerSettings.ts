// Footer chrome settings stored under site_settings.key='footer'.
// Independent from the builder document — controls the strip rendered
// around the builder content (copyright bar, back-to-top, layout variant).
import { z } from "zod";

export const FooterLayout = z.enum(["default", "centered", "minimal", "dark", "light"]);
export type FooterLayout = z.infer<typeof FooterLayout>;

export const FooterChromeSchema = z.object({
  layout: FooterLayout.default("default"),
  show_separator: z.boolean().default(true),
  back_to_top: z.boolean().default(true),
  back_to_top_threshold_px: z.number().int().min(0).max(5000).default(400),
  copyright_pl: z.string().max(500).default(""),
  copyright_en: z.string().max(500).default(""),
  show_year: z.boolean().default(true),
});

export type FooterChrome = z.infer<typeof FooterChromeSchema>;

export const defaultFooterChrome = (): FooterChrome => FooterChromeSchema.parse({});

export function resolveCopyright(c: FooterChrome, lang: "pl" | "en"): string {
  const tpl = (lang === "en" ? c.copyright_en : c.copyright_pl).trim();
  const year = new Date().getFullYear();
  if (!tpl) return c.show_year ? `© ${year}` : "";
  return tpl.replace(/\{year\}/g, String(year));
}
