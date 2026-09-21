// Domyślny obrazek podglądu społecznościowego (og:image / twitter:image),
// sterowany z panelu admina (site_settings["seo"].default_og_image_url).
//
// Dlaczego osobny moduł, a nie parametr w meta.ts: `buildRootHead()` i
// `buildContentHead()` są czystymi funkcjami wołanymi z dziesiątek `head()`
// tras, które nie mają dostępu do site_settings. Root loader (jedyne miejsce
// pobierające pełną mapę ustawień na KAŻDEJ trasie) zapamiętuje tu wynik, a
// buildery czytają go po hoście żądania.
//
// TENANT-SAFE: wpis jest kluczowany hostem, więc render tenanta A nigdy nie
// poda obrazka tenanta B - nawet przy współbieżnym SSR w jednym isolate.
// Brak wpisu = statyczny fallback marki (`SITE_DEFAULT_OG_IMAGE`).

/** Wartość `twitter:card` - karta pełnowymiarowa albo mały kwadrat. */
export type TwitterCardType = "summary_large_image" | "summary";

export type SocialDefaults = {
  /** Absolutny URL albo ścieżka względna od originu ("" = fallback marki). */
  imageUrl: string;
  /** og:image:alt - opis karty dla czytników ekranu i scraperów. */
  imageAlt: string;
  /** Typ karty X/Twittera wybrany redakcyjnie. */
  twitterCard: TwitterCardType;
};

export const EMPTY_SOCIAL_DEFAULTS: SocialDefaults = {
  imageUrl: "",
  imageAlt: "",
  twitterCard: "summary_large_image",
};

/** Host bez portu, lowercase. Akceptuje host, origin i pełny URL. */
export function socialHostKey(input: string | null | undefined): string {
  if (!input) return "no-host";
  const raw = input.trim().toLowerCase();
  if (!raw) return "no-host";
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname || "no-host";
  } catch {
    return raw.split("/")[0]?.split(":")[0] || "no-host";
  }
}

const byHost = new Map<string, SocialDefaults>();
/** Sufit wpisów - klucz to host, więc przestrzeń jest teoretycznie otwarta. */
const MAX_HOSTS = 100;

/**
 * Wejście zapisu. `twitterCard` jest OPCJONALNE, bo to pole doszło później niż
 * sam moduł: wołający, który go nie poda (starszy kod, test skupiony na
 * obrazku), ma dostać wariant domyślny, a nie `undefined` wstawione wprost
 * w `twitter:card`. Typ wymagający wszystkich pól zamieniłby brak wartości
 * w cichy atrybut „undefined" w `<head>` na produkcji.
 */
export type SocialDefaultsInput = {
  imageUrl: string;
  imageAlt: string;
  twitterCard?: TwitterCardType;
};

/** Zapamiętaj ustawienia dla hosta bieżącego żądania (woła root loader). */
export function rememberSocialDefaults(
  host: string | null | undefined,
  value: SocialDefaultsInput,
): void {
  const key = socialHostKey(host);
  byHost.delete(key);
  byHost.set(key, {
    imageUrl: value.imageUrl.trim(),
    imageAlt: value.imageAlt.trim(),
    twitterCard: value.twitterCard ?? EMPTY_SOCIAL_DEFAULTS.twitterCard,
  });
  while (byHost.size > MAX_HOSTS) {
    const oldest = byHost.keys().next().value;
    if (oldest === undefined) break;
    byHost.delete(oldest);
  }
}

/** Ustawienia dla hosta (pusty obiekt, gdy nic nie zapamiętano). */
export function socialDefaultsFor(host: string | null | undefined): SocialDefaults {
  return byHost.get(socialHostKey(host)) ?? EMPTY_SOCIAL_DEFAULTS;
}

/** Hook testowy: wyczyść wszystkie hosty. */
export function clearSocialDefaults(): void {
  byHost.clear();
}
