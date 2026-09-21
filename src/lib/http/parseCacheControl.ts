// Minimalny, defensywny parser Cache-Control - tylko dyrektywy, które realnie
// zmieniają decyzję NES Edge Cache. Czysta funkcja, bez zależności.
//
// `no-cache` i `must-revalidate` są tu MODELOWANE, choć dziś nie emitujemy ich
// na żadnym dokumencie HTML. Wcześniej wpadały w `default: break` i ginęły bez
// śladu, a milczące zignorowanie ich znaczy „wolno serwować bez walidacji" -
// czyli dokładnie to, czego obie zakazują. Ten magazyn nie umie walidować
// (patrz `documentStorePolicy`), więc jedyną bezpieczną lekturą jest ostra.
// To była mina, nie pożar: zadziałałaby w dniu, w którym ktoś w dobrej wierze
// napisze `Cache-Control: public, s-maxage=600, no-cache`.

export interface ParsedCacheControl {
  public: boolean;
  private: boolean;
  noStore: boolean;
  /** `no-cache`: wolno PRZECHOWAĆ, nie wolno PODAĆ bez walidacji u źródła. */
  noCache: boolean;
  /** `must-revalidate`: wpis NIEŚWIEŻY wymaga walidacji, nie wolno go podać. */
  mustRevalidate: boolean;
  sMaxAge: number | null;
  staleWhileRevalidate: number | null;
}

const EMPTY: ParsedCacheControl = {
  public: false,
  private: false,
  noStore: false,
  noCache: false,
  mustRevalidate: false,
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
      case "no-cache":
        // Kwalifikowane `no-cache="pole"` (RFC 9111 5.2.2.4) czytamy jak
        // niekwalifikowane: ten magazyn nie umie usunąć pojedynczych nagłówków
        // z odtwarzanej odpowiedzi, więc ostrzejsza lektura jest jedyną wierną.
        out.noCache = true;
        break;
      // `proxy-revalidate` to `must-revalidate` adresowane do cache'ów
      // WSPÓŁDZIELONYCH - a NES Edge Cache jest dokładnie takim cache'em, więc
      // obie dyrektywy znaczą tu to samo. Komentarz stoi NAD parą etykiet,
      // nie między nimi: `no-fallthrough` dopuszcza pustą etykietę tylko wtedy,
      // gdy sąsiaduje z następną, a wiersz komentarza tę sąsiedniość zrywa.
      case "must-revalidate":
      case "proxy-revalidate":
        out.mustRevalidate = true;
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
