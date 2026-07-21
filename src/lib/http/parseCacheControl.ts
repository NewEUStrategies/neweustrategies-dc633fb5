// Minimalny, defensywny parser Cache-Control - tylko dyrektywy, których używa
// NES Edge Cache. Czysta funkcja, bez zależności.

export interface ParsedCacheControl {
  public: boolean;
  private: boolean;
  noStore: boolean;
  sMaxAge: number | null;
  staleWhileRevalidate: number | null;
}

const EMPTY: ParsedCacheControl = {
  public: false,
  private: false,
  noStore: false,
  sMaxAge: null,
  staleWhileRevalidate: null,
};

function directiveSeconds(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseCacheControl(header: string | null | undefined): ParsedCacheControl {
  if (!header) return EMPTY;
  const out: ParsedCacheControl = { ...EMPTY };
  for (const raw of header.split(",")) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const value = eq === -1 ? undefined : token.slice(eq + 1).trim();
    switch (name) {
      case "public":
        out.public = true;
        break;
      case "private":
        out.private = true;
        break;
      case "no-store":
        out.noStore = true;
        break;
      case "s-maxage":
        out.sMaxAge = directiveSeconds(value);
        break;
      case "stale-while-revalidate":
        out.staleWhileRevalidate = directiveSeconds(value);
        break;
      default:
        break;
    }
  }
  return out;
}
