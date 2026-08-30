// Molekuła UI: karta trasy - mapa w tle pod barwną nakładką, tytuł + autor po
// lewej, wielki dystans po prawej, przycisk polubienia z licznikiem.
//
// Renderuje ją widget `travel-route-card` buildera (Elementor-like). Komponent
// jest CZYSTO prezentacyjny: nie czyta treści widgetu, nie chodzi do sieci i
// nie zna i18n - wszystkie napisy (również te dla czytnika ekranu) dostaje
// przez `labels`, dzięki czemu ta sama molekuła obsługuje PL i EN bez gałęzi
// językowych w środku.
//
// ODWZOROWANIE WZORCA: proporcja karty, siatka 2/3 + 1/3, gradientowa nakładka
// nad zdjęciem, „pigułka" polubienia z ikoną serca i licznikiem skracanym do
// K/M, wejście z przesunięciem i delikatne uniesienie na hoverze.
//
// Świadome odstępstwa od wklejonego wzorca:
//   * `framer-motion` -> klasy CSS `.trc-*` (biblioteki nie ma w projekcie, a
//     cały ruch to wejście karty i podmiana licznika; CSS robi to bez kosztu JS
//     i sam respektuje `prefers-reduced-motion`),
//   * `lucide-react` -> `@/lib/lucide-shim` (projekt przełącza paczkę ikon na
//     Font Awesome; bezpośredni import omijałby ten przełącznik),
//   * `rounded-2xl` -> platformowe **6 px** jako DOMYŚLNE zaokrąglenie, ale
//     wystawione jako ustawienie panelu (`radius`) - redakcja może wrócić do
//     16 px wzorca, kod nie narzuca ani jednego, ani drugiego,
//   * `bg-blue-500/60 dark:bg-blue-800/70` -> kolor nakładki + krycie z panelu,
//     domyślnie kolor marki (`var(--brand)`); jeden zapis dla light i dark, bo
//     karta i tak jest kontrastową płaszczyzną z białym tekstem,
//   * `text-8xl` (96 px na sztywno) -> `distanceSizePx` z panelu; węzeł niesie
//     `data-typography-exempt`, więc globalna typografia widgetu nie zgniata
//     liczby do rozmiaru akapitu,
//   * `<h2>`/`<h1>` -> `<h3 class="cms-post-title">` i `<p class="cms-post-excerpt">`,
//     czyli platformowe haki typografii: kontrolka „Rozmiar tytułu / opisu"
//     w panelu widgetu steruje tą kartą tak samo jak listą wpisów,
//   * licznik polubień pamiętany W PRZEGLĄDARCE ODWIEDZAJĄCEGO (`storageKey`),
//     a nie w stanie komponentu - polubienie znikające po odświeżeniu strony
//     byłoby obietnicą bez pokrycia. Bazy to nie dotyka: to preferencja
//     jednego urządzenia, nie licznik globalny.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Heart } from "@/lib/lucide-shim";
import {
  formatLikes,
  TRAVEL_ROUTE_CARD_DEFAULTS,
  TRAVEL_ROUTE_LIKE_COLOR,
} from "@/lib/builder/travelRouteCard";
import { cn } from "@/lib/utils";

export interface TravelRouteCardLabels {
  /** Etykieta przycisku, gdy trasa NIE jest polubiona. */
  like: string;
  /** Etykieta przycisku, gdy trasa JEST polubiona (klik = cofnięcie). */
  unlike: string;
  /** Opis liczby polubień dla czytnika ekranu, `{{n}}` -> pełna liczba. */
  likesCount: string;
  /** Opis dystansu dla czytnika ekranu, `{{v}}` -> wartość. */
  distance: string;
  /** Nazwa karty-linku, gdy redakcja nie wpisała tytułu. */
  mapAlt: string;
}

export interface TravelRouteCardProps {
  title: string;
  author: string;
  distance: string;
  /** Podpis pod liczbą (np. „km"). Puste = brak wiersza. */
  distanceCaption?: string;
  initialLikes: number;
  imageUrl?: string;
  imageAlt?: string;
  /** Adres, pod który prowadzi karta. Puste = karta nie jest linkiem. */
  href?: string;
  /** Kolor nakładki nad zdjęciem. Puste = kolor marki. */
  overlayColor?: string;
  /** Krycie nakładki 0-1. */
  overlayAlpha?: number;
  minHeight?: number;
  radius?: number;
  /** Maksymalna szerokość karty w px. 0 = pełna szerokość kolumny. */
  maxWidth?: number;
  distanceSizePx?: number;
  showLikes?: boolean;
  /** Kolor „pigułki" po polubieniu. Puste = czerwień wzorca. */
  likeAccentColor?: string;
  animate?: boolean;
  hoverLift?: boolean;
  /**
   * Klucz w `localStorage` przechowujący polubienie tego odwiedzającego.
   * `null` (kanwa buildera, testy) = stan tylko w pamięci komponentu.
   */
  storageKey?: string | null;
  labels: TravelRouteCardLabels;
  className?: string;
}

/** Podstawienie `{{n}}` / `{{v}}` w etykiecie a11y. */
function fill(template: string, token: string, value: string | number): string {
  return template.replace(`{{${token}}}`, String(value));
}

/**
 * Odczyt/zapis polubienia w przeglądarce odwiedzającego. `localStorage` bywa
 * niedostępny (tryb prywatny Safari, zablokowane dane witryny), więc każde
 * dotknięcie jest osłonięte - brak pamięci degraduje do stanu w pamięci
 * komponentu, nie do wyjątku w renderze.
 */
function readStoredLike(key: string | null | undefined): boolean {
  if (!key || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeStoredLike(key: string | null | undefined, liked: boolean): void {
  if (!key || typeof window === "undefined") return;
  try {
    if (liked) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    /* brak pamięci = polubienie żyje tylko do przeładowania */
  }
}

export function TravelRouteCard({
  title,
  author,
  distance,
  distanceCaption = "",
  initialLikes,
  imageUrl = "",
  imageAlt = "",
  href = "",
  overlayColor = "",
  overlayAlpha = TRAVEL_ROUTE_CARD_DEFAULTS.overlayAlpha,
  minHeight = TRAVEL_ROUTE_CARD_DEFAULTS.minHeight,
  radius = TRAVEL_ROUTE_CARD_DEFAULTS.radius,
  maxWidth = TRAVEL_ROUTE_CARD_DEFAULTS.maxWidth,
  distanceSizePx = TRAVEL_ROUTE_CARD_DEFAULTS.distanceSizePx,
  showLikes = true,
  likeAccentColor = "",
  animate = true,
  hoverLift = true,
  storageKey = null,
  labels,
  className,
}: TravelRouteCardProps) {
  const [liked, setLiked] = useState(false);

  // Pamięć przeglądarki czytana PO zamontowaniu: pierwszy render musi być
  // identyczny na serwerze i w kliencie, inaczej hydracja zgłasza rozjazd.
  useEffect(() => {
    if (!storageKey) return;
    setLiked(readStoredLike(storageKey));
  }, [storageKey]);

  // Zapis siedzi w HANDLERZE, nie w funkcji aktualizującej stan: React wywołuje
  // ją w trybie ścisłym dwukrotnie, a `localStorage` to efekt uboczny, który
  // nie ma prawa jechać dwa razy na jedno kliknięcie.
  const toggleLike = useCallback(() => {
    const next = !liked;
    setLiked(next);
    writeStoredLike(storageKey, next);
  }, [liked, storageKey]);

  const base = Math.max(0, Math.floor(Number.isFinite(initialLikes) ? initialLikes : 0));
  const likes = base + (liked ? 1 : 0);
  const overlay = overlayColor || "var(--brand)";
  const alphaPct = Math.round(Math.min(1, Math.max(0, overlayAlpha)) * 100);
  const accent = likeAccentColor || TRAVEL_ROUTE_LIKE_COLOR;
  const distanceSpoken = `${distance}${distanceCaption ? ` ${distanceCaption}` : ""}`;

  const frameStyle: CSSProperties = {
    minHeight: `${Math.max(120, minHeight)}px`,
    borderRadius: `${Math.max(0, radius)}px`,
    ...(maxWidth > 0 ? { maxWidth: `${maxWidth}px` } : null),
  };

  return (
    <div
      data-travel-route-card=""
      style={frameStyle}
      className={cn(
        "relative isolate flex w-full items-end overflow-hidden p-6 text-white shadow-lg",
        animate && "trc-rise",
        hoverLift && "trc-lift",
        className,
      )}
    >
      {/* Tło: zdjęcie mapy + nakładka. Bez tekstu alternatywnego mapa jest
          DEKORACJĄ (informację niesie tytuł i dystans), więc znika z drzewa
          dostępności zamiast dyktować czytnikowi nazwę pliku. */}
      <div className="absolute inset-0 z-0" aria-hidden={imageAlt ? undefined : true}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={imageAlt}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-muted" />
        )}
        {/* Kolor i krycie jadą jako WŁASNOŚCI NIESTANDARDOWE, nie jako gotowa
            deklaracja `background`. `color-mix()` jest jedynym zapisem, który
            umie nałożyć krycie na dowolny token motywu (`var(--brand)`), ale
            wstawiony wprost w atrybut `style` przepada w silnikach DOM bez
            wsparcia dla tej funkcji - łącznie z tym, na którym stoją testy.
            Zmienna przechodzi zawsze, a mieszanie robi arkusz. */}
        <div
          className="trc-overlay absolute inset-0"
          style={
            {
              "--trc-overlay-color": overlay,
              "--trc-overlay-alpha": `${alphaPct}%`,
            } as CSSProperties
          }
        />
      </div>

      {/* Karta-link: kotwica przykrywa CAŁĄ kartę, ale leży POD treścią, więc
          przycisk polubienia nadal dostaje swój klik (kotwica w roli rodzica
          nawigowałaby przy każdym polubieniu). */}
      {href ? (
        <a
          href={href}
          aria-label={title || labels.mapAlt}
          className="absolute inset-0 z-10 rounded-[inherit]"
        />
      ) : null}

      <div
        className={cn(
          "relative z-20 grid w-full grid-cols-3 items-end gap-4",
          href && "pointer-events-none",
        )}
      >
        <div className="col-span-2 flex h-full min-w-0 flex-col justify-end">
          <div>
            {title ? (
              <h3 className="cms-post-title text-xl font-bold leading-tight">{title}</h3>
            ) : null}
            {author ? <p className="cms-post-excerpt mt-2 text-sm opacity-80">{author}</p> : null}
          </div>
          {showLikes ? (
            <button
              type="button"
              onClick={toggleLike}
              aria-pressed={liked}
              aria-label={`${liked ? labels.unlike : labels.like}, ${fill(labels.likesCount, "n", likes)}`}
              data-typography-exempt
              data-liked={liked ? "true" : "false"}
              className={cn(
                "mt-4 flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-300",
                href && "pointer-events-auto",
                liked
                  ? "trc-pill-liked"
                  : "bg-white/20 text-white backdrop-blur-sm hover:bg-white/30",
              )}
              style={{ "--trc-like-color": accent } as CSSProperties}
            >
              <Heart
                aria-hidden="true"
                className={cn("h-5 w-5", liked && "trc-pop")}
                style={{ fill: liked ? "currentColor" : "transparent" }}
              />
              {/* `key` na liczniku wymusza ponowne odtworzenie animacji przy
                  każdej zmianie - odpowiednik `AnimatePresence` ze wzorca. */}
              <span key={likes} className="trc-roll w-10 text-left tabular-nums">
                {formatLikes(likes)}
              </span>
            </button>
          ) : null}
        </div>

        {/* Liczba i jednostka to JEDNA informacja, więc czytnik ekranu dostaje
            ją RAZ, w całości ("Dystans: 12K km"). Widoczna para jest schowana
            przed drzewem dostępności - bez tego użytkownik słyszał trzy razy
            to samo: „12K", „km", „Dystans: 12K km". Jednostka bez liczby nie
            niesie treści, więc cała kolumna zależy od `distance`. */}
        {distance ? (
          <div className="col-span-1 flex flex-col items-center justify-center text-center">
            <span aria-hidden="true" className="flex flex-col items-center">
              <span
                data-typography-exempt
                className="select-none font-bold leading-none tracking-tighter text-white/90"
                style={{ fontSize: `${Math.max(12, distanceSizePx)}px` }}
              >
                {distance}
              </span>
              {distanceCaption ? (
                <span
                  data-typography-exempt
                  className="mt-1 text-xs font-medium uppercase tracking-widest text-white/70"
                >
                  {distanceCaption}
                </span>
              ) : null}
            </span>
            <span className="sr-only">{fill(labels.distance, "v", distanceSpoken)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default TravelRouteCard;
