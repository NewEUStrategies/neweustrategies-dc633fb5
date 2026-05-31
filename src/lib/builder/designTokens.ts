// Brand design tokens (per tenant).
// Source of truth: `public.site_design_tokens` (one row per tenant).
//
// The same shape is rendered:
//   - as live CSS variables on :root via <DesignTokensStyle />
//   - as a picker palette in the admin settings panel
//
// Tokens are rendered as CSS variables prefixed with `--brand-…`, so authored
// custom CSS / inline style values (e.g. `var(--brand-primary)`) work in the
// builder canvas, the published site, and the public renderer alike.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface BrandColor {
  /** Stable slug used to build the CSS variable (`--brand-primary`). */
  name: string;
  /** Any valid CSS color: hex, rgb(), oklch(), color-mix(). */
  value: string;
}

export interface BrandFonts {
  /** Font-family stack for headings. */
  heading?: string;
  /** Font-family stack for body copy. */
  body?: string;
}

export interface BrandScale {
  /** Default border radius (e.g. `8px`). */
  radius?: string;
}

export interface DesignTokens {
  colors: BrandColor[];
  fonts: BrandFonts;
  scale: BrandScale;
}

export const EMPTY_TOKENS: DesignTokens = {
  colors: [],
  fonts: {},
  scale: {},
};

const QUERY_KEY = ["site_design_tokens"] as const;

/** Read the current tenant's design tokens. Returns EMPTY_TOKENS when no row exists. */
export function useDesignTokens() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<DesignTokens> => {
      const { data, error } = await supabase
        .from("site_design_tokens")
        .select("colors, fonts, scale")
        .maybeSingle();
      if (error) throw error;
      if (!data) return EMPTY_TOKENS;
      return {
        colors: Array.isArray(data.colors)
          ? (data.colors as unknown as BrandColor[]).filter(
              (c) => c && typeof c.name === "string" && typeof c.value === "string",
            )
          : [],
        fonts: (data.fonts as unknown as BrandFonts) ?? {},
        scale: (data.scale as unknown as BrandScale) ?? {},
      };
    },
  });
}

/** Upsert the current tenant's design tokens (RLS scopes to the caller's tenant). */
export function useSaveDesignTokens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: DesignTokens) => {
      // We rely on the `tenant_id` column default `current_tenant_id()` to
      // populate the row for first-time inserts.
      const { error } = await supabase
        .from("site_design_tokens")
        .upsert(
          {
            tenant_id: undefined as unknown as string, // let DB default fill it
            colors: next.colors as unknown as never,
            fonts: next.fonts as unknown as never,
            scale: next.scale as unknown as never,
          },
          { onConflict: "tenant_id" },
        );
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(QUERY_KEY, next);
      toast.success("Zapisano tokeny marki");
    },
    onError: (e: Error) => toast.error(e.message || "Błąd zapisu tokenów"),
  });
}

/** Sanitize a token name into a CSS-safe slug (lowercase letters, digits, dash). */
export const slugifyToken = (raw: string): string =>
  raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "token";

/** Build the CSS rule string applied at :root for the given tokens. */
export function tokensToCss(t: DesignTokens): string {
  const lines: string[] = [];
  for (const c of t.colors) {
    const slug = slugifyToken(c.name);
    if (!slug || !c.value) continue;
    lines.push(`--brand-${slug}: ${c.value};`);
  }
  if (t.fonts.heading) lines.push(`--brand-font-heading: ${t.fonts.heading};`);
  if (t.fonts.body) lines.push(`--brand-font-body: ${t.fonts.body};`);
  if (t.scale.radius) lines.push(`--brand-radius: ${t.scale.radius};`);
  return lines.length ? `:root{${lines.join("")}}` : "";
}
