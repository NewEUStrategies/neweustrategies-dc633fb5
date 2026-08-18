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
import { toJson } from "@/lib/builder/types";
import { useQuery, useMutation, useQueryClient, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notifyError, notifySuccess } from "@/lib/notify";
import { customFontsCss, type CustomFont } from "@/lib/theme/customFonts";
import { edgeTtlCache } from "@/lib/ssrCache";

export interface BrandColor {
  /** Stable slug used to build the CSS variable (`--brand-primary`). */
  name: string;
  /** Any valid CSS color: hex, rgb(), oklch(), color-mix(). */
  value: string;
}

interface BrandFonts {
  /** Font-family stack for headings. */
  heading?: string;
  /** Font-family stack for body copy. */
  body?: string;
  /** User-uploaded custom fonts (rendered as @font-face). */
  custom?: CustomFont[];
}

interface BrandScale {
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

/** Pełny wiersz `site_design_tokens` (tokeny marki + kolory globalne). */
export interface SiteDesignTokensRow {
  colors: unknown;
  fonts: unknown;
  scale: unknown;
  global_colors: unknown;
}

const DESIGN_TOKENS_ROW_TTL_MS = 60_000;

let inflightRow: Promise<SiteDesignTokensRow | null> | null = null;

/**
 * JEDEN odczyt wiersza `site_design_tokens` współdzielony przez tokeny marki
 * (designTokensQueryOptions) i kolory globalne (globalColorsQueryOptions).
 * Wcześniej root loader wykonywał dwa osobne round-tripy do tego samego
 * jednowierszowego zapisu na KAŻDEJ trasie. Warstwy współdzielenia:
 *   - serwer: `edgeTtlCache` (per tenant host, 60 s) - w stanie ustalonym zero
 *     round-tripów, spójnie z site_settings;
 *   - klient i zimny serwer: dedupe in-flight - dwa równoległe zapytania
 *     (tokeny + kolory) zbiegają do jednego fetcha, świeżością dalej rządzi
 *     react-query per queryKey.
 * Błąd degraduje do null (wołający mają wbudowane defaulty) - ten sam kontrakt
 * odporności co dotąd.
 */
export async function fetchSiteDesignTokensRow(): Promise<SiteDesignTokensRow | null> {
  if (inflightRow) return inflightRow;
  const load = async (): Promise<SiteDesignTokensRow | null> => {
    const { data, error } = await supabase
      .from("site_design_tokens")
      .select("colors, fonts, scale, global_colors")
      .maybeSingle();
    if (error) return null;
    return (data as SiteDesignTokensRow | null) ?? null;
  };
  inflightRow = edgeTtlCache("site_design_tokens:row", DESIGN_TOKENS_ROW_TTL_MS, load).catch(
    () => null,
  );
  try {
    return await inflightRow;
  } finally {
    inflightRow = null;
  }
}

export const designTokensQueryOptions = queryOptions({
  queryKey: QUERY_KEY,
  queryFn: async (): Promise<DesignTokens> => {
    // Brand tokens are purely presentational (they only feed CSS variables) and
    // this query is warmed by the root loader on EVERY route. A fetch failure
    // must therefore degrade to the built-in defaults, never throw - otherwise a
    // single transient error here takes the whole site down. The client re-query
    // (react-query) picks up the real tokens on the next successful fetch.
    const data = await fetchSiteDesignTokensRow();
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
  staleTime: 5 * 60_000,
});

/** Read the current tenant's design tokens. Returns EMPTY_TOKENS when no row exists. */
export function useDesignTokens() {
  return useQuery(designTokensQueryOptions);
}

/** Upsert the current tenant's design tokens (RLS scopes to the caller's tenant). */
export function useSaveDesignTokens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: DesignTokens) => {
      // `tenant_id` is omitted: the DB default `current_tenant_id()` fills
      // it on insert; on update RLS already scopes to the caller's tenant.
      const { error } = await supabase.from("site_design_tokens").upsert(
        {
          colors: toJson(next.colors),
          fonts: toJson(next.fonts),
          scale: toJson(next.scale),
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(QUERY_KEY, next);
      notifySuccess("Zapisano tokeny marki");
    },
    onError: (e: Error) => notifyError(e.message || "Błąd zapisu tokenów"),
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
  const rootRule = lines.length ? `:root{${lines.join("")}}` : "";
  return customFontsCss(t.fonts.custom) + rootRule;
}
