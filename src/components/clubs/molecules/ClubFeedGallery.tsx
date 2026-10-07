// Molekuła: zdjęcia i nagrania wpisu w strumieniu - od krawędzi do krawędzi.
//
// Reguły kadrowania są czyste i mieszkają w `lib/clubs/feedMedia.ts`; tutaj
// zostaje tylko ich narysowanie. Dwie rzeczy należą jednak do widoku:
//
// SUFIT WYSOKOŚCI. Środkowa kolumna huba bywa szeroka (do ~950 px), a pionowe
// zdjęcie 4:5 na pełną szerokość miałoby wtedy ponad metr wysokości ekranu.
// Rama dostaje więc `max-width = sufit * proporcja` i staje na środku pasa;
// boki pasa wypełnia rozmyta kopia tego samego zdjęcia, żeby pion nie stał
// w szarej dziurze. Najszerszy pas (~940 px) jest węższy niż sufit ramy 1.5:1,
// więc tło ma sens tylko dla ram węższych niż 1.5:1 (pion, kwadrat, 4:3)
// i dla zdjęcia wpisanego w całości, któremu tło wypełnia pasy po bokach.
//
// NADWYŻKA JEST OSIĄGALNA. Kafel „+N" nie otwiera czwartego zdjęcia, tylko
// rozwija galerię do siatki WSZYSTKICH zdjęć wpisu (podgląd w platformie
// pokazuje jeden plik, więc bez rozwinięcia zdjęcia od piątego w górę byłyby
// nie do obejrzenia). Fokus przechodzi na pierwsze odsłonięte zdjęcie.
//
// KAFEL BEZ PODPISANEGO ADRESU jest zastępnikiem, którego nie da się kliknąć.
// Proporcja ramy jest znana z metadanych, więc dojazd podpisu nie przesuwa
// strumienia ani o piksel.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { HUB_CONTROL } from "@/components/clubs/atoms/ClubHubPrimitives";
import {
  CLUB_GALLERY_MAX_TILES,
  CLUB_GALLERY_STRIP_RATIO,
  clubFeedFrame,
  planClubGallery,
  type ClubGalleryPlan,
} from "@/lib/clubs/feedMedia";
import type { ClubPostMediaAttachment } from "@/lib/clubs/postTypes";

/** Sufit wysokości ramy mediów w rem (~640 px). */
const MAX_FRAME_REM = 40;
/** Rama co najmniej tak szeroka zawsze wypełnia pas (40rem * 1.5 > ~940 px). */
const BACKDROP_RATIO_LIMIT = 1.5;

/** Proporcja CAŁEJ galerii - z niej liczymy sufit szerokości. */
function overallRatio(plan: ClubGalleryPlan): number {
  if (plan.layout === "top") return 1 / (1 / plan.ratio + 1 / CLUB_GALLERY_STRIP_RATIO);
  return plan.ratio;
}

function capStyle(ratio: number): CSSProperties {
  return { maxWidth: `calc(${MAX_FRAME_REM}rem * ${ratio.toFixed(4)})` };
}

/** Pas od krawędzi do krawędzi z rozmytym tłem dla ramy węższej niż pas. */
function Band({
  backdrop,
  dark = false,
  children,
}: {
  backdrop?: string;
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative isolate overflow-hidden", dark ? "bg-black" : "bg-muted/60")}>
      {backdrop !== undefined ? (
        <img
          src={backdrop}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
        />
      ) : null}
      {children}
    </div>
  );
}

export function ClubFeedGallery({
  images,
  mediaUrls,
  onOpen,
}: {
  images: readonly ClubPostMediaAttachment[];
  mediaUrls: Record<string, string>;
  onOpen: (item: ClubPostMediaAttachment, url: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Fokus na pierwsze ODSŁONIĘTE zdjęcie, które da się otworzyć; gdy żadne
  // nie ma jeszcze podpisanego adresu (kafel wyłączony) - na samą siatkę.
  const firstRevealed = Math.min(images.length, CLUB_GALLERY_MAX_TILES);
  useEffect(() => {
    if (!expanded || gridRef.current === null) return;
    const target = Array.from(
      gridRef.current.querySelectorAll<HTMLButtonElement>("button[data-gallery-tile]"),
    ).find((node) => Number(node.dataset.galleryTile) >= firstRevealed && !node.disabled);
    (target ?? gridRef.current).focus({ preventScroll: true });
  }, [expanded, firstRevealed]);
  // Zwinięcie oddaje fokus kaflowi „+N" i przewija do galerii - przycisk
  // „Zwiń" znika razem z siatką, a strona pod nim skraca się o kilkaset px.
  const collapsedRef = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (expanded || !restoreFocus.current || collapsedRef.current === null) return;
    restoreFocus.current = false;
    collapsedRef.current
      .querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
      ?.focus({ preventScroll: true });
    collapsedRef.current.scrollIntoView?.({ block: "nearest" });
  }, [expanded]);
  const plan = planClubGallery(images);
  if (plan === null) return null;
  const shown = images.slice(0, plan.visible);
  const [head, ...rest] = shown;
  if (head === undefined) return null;

  const tile = (item: ClubPostMediaAttachment, index: number, className?: string): ReactNode => {
    const url = mediaUrls[item.path];
    const more = !expanded && index === plan.visible - 1 && plan.overflow > 0;
    const contain = !expanded && plan.layout === "single" && plan.fit === "contain";
    return (
      // Zdjęcie otwiera podgląd W PLATFORMIE, nie nową kartę: wyjście do
      // surowego podpisanego adresu gubi kontekst wpisu. Kafel „+N" rozwija
      // galerię - patrz nagłówek pliku.
      <button
        key={item.path}
        type="button"
        disabled={!more && url === undefined}
        onClick={() => {
          if (more) setExpanded(true);
          else if (url !== undefined) onOpen(item, url);
        }}
        aria-label={
          more
            ? t("club.post.showAllImages", { count: images.length })
            : `${t("club.post.preview")}: ${item.name}`
        }
        aria-expanded={more ? false : undefined}
        data-gallery-tile={index}
        className={cn(
          "group/img relative block h-full min-h-0 w-full overflow-hidden",
          // Zdjęcie wpisane w całości ma pasy - przez przezroczysty kafel
          // widać w nich rozmyte tło pasa zamiast szarego prostokąta.
          contain && url !== undefined ? "bg-transparent" : "bg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          className,
        )}
      >
        {url === undefined ? (
          <span className="block h-full w-full animate-pulse bg-muted" />
        ) : (
          <>
            <img
              src={url}
              alt={item.name}
              loading="lazy"
              decoding="async"
              className={cn(
                "h-full w-full transition-transform duration-500 ease-out motion-reduce:transition-none",
                contain ? "object-contain" : "object-cover group-hover/img:scale-[1.03]",
              )}
            />
            {!more ? (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition duration-200 group-hover/img:bg-black/15 group-hover/img:opacity-100">
                <span
                  className={cn(
                    HUB_CONTROL,
                    "border-transparent bg-background/90 text-foreground shadow-sm",
                  )}
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("club.post.preview")}
                </span>
              </span>
            ) : null}
          </>
        )}
        {more ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 grid place-items-center bg-black/55 text-2xl font-semibold text-white transition-colors group-hover/img:bg-black/45"
          >
            +{plan.overflow}
          </span>
        ) : null}
      </button>
    );
  };

  const firstUrl = mediaUrls[head.path];
  const ratio = overallRatio(plan);
  // Rozmyte tło tylko tam, gdzie je widać: rama węższa niż pas albo zdjęcie
  // wpisane w całości (kafel jest wtedy przezroczysty - patrz `tile`).
  const backdrop =
    plan.layout === "single" && (plan.ratio < BACKDROP_RATIO_LIMIT || plan.fit === "contain")
      ? firstUrl
      : undefined;

  if (expanded) {
    // Siatka wszystkich zdjęć: kwadratowe kafle, bez sufitu - czytelnik sam
    // poprosił o całość.
    return (
      <div className="bg-muted/60">
        <div
          ref={gridRef}
          role="group"
          tabIndex={-1}
          aria-label={t("club.post.showAllImages", { count: images.length })}
          className="grid grid-cols-2 gap-0.5 outline-none sm:grid-cols-3"
          data-testid="club-post-images"
          data-layout="all"
          data-overflow={0}
        >
          {images.map((item, i) => (
            <div key={item.path} className="club-reaction-pop aspect-square">
              {tile(item, i)}
            </div>
          ))}
        </div>
        <div className="flex justify-center py-1.5">
          <button
            type="button"
            onClick={() => {
              restoreFocus.current = true;
              setExpanded(false);
            }}
            aria-expanded
            className={cn(
              HUB_CONTROL,
              "border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {t("club.post.showFewerImages")}
          </button>
        </div>
      </div>
    );
  }

  let body: ReactNode;
  if (plan.layout === "single") {
    body = (
      <div className="overflow-hidden" style={{ aspectRatio: plan.ratio }}>
        {tile(head, 0)}
      </div>
    );
  } else if (plan.layout === "pair") {
    body = (
      <div className="grid grid-cols-2 gap-0.5" style={{ aspectRatio: plan.ratio }}>
        {shown.map((item, i) => tile(item, i))}
      </div>
    );
  } else if (plan.layout === "top") {
    body = (
      <div className="flex flex-col gap-0.5">
        {/* `min-h-0`: element flex ma minimalną wysokość z treści, więc
            załadowany obraz rozpychałby kafel ponad `aspect-ratio` - skok
            układu o ~170 px po dojeździe zdjęć. */}
        <div className="min-h-0 overflow-hidden" style={{ aspectRatio: plan.ratio }}>
          {tile(head, 0)}
        </div>
        <div
          className="grid min-h-0 gap-0.5 overflow-hidden"
          style={{
            aspectRatio: CLUB_GALLERY_STRIP_RATIO,
            gridTemplateColumns: `repeat(${rest.length}, minmax(0, 1fr))`,
          }}
        >
          {rest.map((item, i) => tile(item, i + 1))}
        </div>
      </div>
    );
  } else {
    body = (
      <div
        className="grid grid-cols-[2fr_1fr] gap-0.5"
        style={{
          aspectRatio: plan.ratio,
          gridTemplateRows: `repeat(${rest.length}, minmax(0, 1fr))`,
        }}
      >
        {tile(head, 0, "row-span-full")}
        {rest.map((item, i) => tile(item, i + 1))}
      </div>
    );
  }

  return (
    <Band backdrop={backdrop}>
      <div
        ref={collapsedRef}
        className="relative mx-auto w-full"
        style={capStyle(ratio)}
        data-testid="club-post-images"
        data-layout={plan.layout}
        data-overflow={plan.overflow}
      >
        {body}
      </div>
    </Band>
  );
}

/** Nagranie wpisu: czarny pas, rama z proporcji pliku, ten sam sufit. */
export function ClubFeedVideo({
  item,
  url,
}: {
  item: ClubPostMediaAttachment;
  url: string | undefined;
}) {
  const frame = clubFeedFrame(item);
  return (
    <Band dark>
      <div
        className="relative mx-auto w-full"
        style={{ ...capStyle(frame.ratio), aspectRatio: frame.ratio }}
        data-testid="club-post-video"
      >
        {url === undefined ? (
          <div className="h-full w-full animate-pulse bg-muted" />
        ) : (
          // DŁUG DOSTĘPNOŚCI: nagranie wgrane przez członka nie ma ścieżki
          // napisów (`<track kind="captions">`), bo nie ma jej skąd wziąć -
          // przesyłający podaje sam plik. Do domknięcia razem z transkrypcją
          // po stronie serwera.
          <video
            src={url}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full object-contain"
          />
        )}
      </div>
    </Band>
  );
}
