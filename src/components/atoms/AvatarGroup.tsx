// Grupa nakładających się awatarów - "kto tu jest" - z ruchem obecności.
//
// Atom bez wiedzy o domenie: dostaje gotowe pozycje i tylko je układa. Używa go
// każde miejsce, w którym stoi WIELE OSÓB naraz - kto zareagował w klubie, kto
// idzie na spotkanie klubu, kto teraz ogląda leada w CRM - bez duplikowania
// logiki nakładania, licznika "+N", karty tożsamości i ruchu.
//
// JAK SIĘ ZACHOWUJE, GDY OSÓB PRZYBYWA I UBYWA.
//  1. KOLEJNOŚĆ PRZYJŚCIA JEST STABILNA. Kto pojawił się pierwszy, stoi
//     pierwszy - nowa osoba dołącza NA KOŃCU stosu, a nie wpycha się na
//     początek i nie przestawia twarzy, na które czytelnik już patrzył.
//     Kolejność pierwszego renderu to kolejność z danych (np. "ja" pierwszy).
//  2. KAFEL MA SWÓJ SLOT, A SLOT JEDZIE NA SPRĘŻYNIE. Gdy ktoś wychodzi,
//     reszta zsuwa się w lewo; gdy ktoś wchodzi, pojawia się w swoim slocie
//     (opacity + scale). Szyna stosu zmienia szerokość w tym samym rytmie,
//     więc tekst obok stosu nie skacze. Pierwszy na wierzchu.
//  3. WYCHODZĄCY KAFEL NIE ZNIKA W PÓŁ KLATKI - gaśnie w miejscu, w którym
//     stał (krócej niż wejście: element, który znika, nie musi się
//     przedstawiać), a dopiero potem opuszcza DOM. Na ten czas jest `inert`.
//  4. "+N" LICZY PRAWDĘ, NIE TABLICĘ. `total` podaje licznik z bazy, który
//     bywa większy niż lista twarzy (reakcje anonimowe, lista przycięta
//     limitem RPC). Semantyka `total ?? items.length` - zero to zero.
//  5. ZDJĘCIE NIE MRUGA INICJAŁAMI. Inicjały leżą POD zdjęciem jako
//     zaślepka na czas ładowania i po błędzie; zdjęcie, które było gotowe
//     przed hydratacją, zostaje widoczne od razu (bez przejścia z zera).
//  6. PROMIEŃ 6 PX, jak każde zdjęcie profilowe w serwisie (`ChatAvatar`,
//     `ClubAuthorAvatar`); wnętrze ramki dostaje promień koncentryczny.
//
// DWA TRYBY DOSTĘPNOŚCI.
//  - `interactive` (domyślny): każda twarz jest celem - link do profilu albo
//    fokusowalny `role="img"` - z kartą tożsamości po najechaniu i fokusie.
//  - `interactive={false}`: stos jest ozdobą dla oka (`aria-hidden`), nazwiska
//    - WSZYSTKIE, także ukryte za "+N" - niesie warstwa `sr-only`, a każda
//    twarz ma natywny `title`. Dla stosów, obok których stoi już podpis.
//
// Świadomie BEZ `motion`/`framer-motion`: projekt nie ma tej zależności
// (patrz `ExpandableTab.tsx` - ~42 kB gzip), a cały ruch da się zrobić CSS-em
// na `translate`/`scale`/`opacity`. Krzywa slotu to `linear()` spróbkowane
// z tej samej sprężyny (k=520, c=34, m=0,45 - przetłumiona, bez przestrzału),
// z awaryjnym `cubic-bezier` dla starszych silników - warstwa `.avg-*`
// w `styles.css`. `prefers-reduced-motion: reduce` wyłącza cały ruch.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { buildAvatarSrc, buildAvatarSrcSet } from "@/lib/cropSizes";
import { cn } from "@/lib/utils";

export interface AvatarGroupItem {
  /** Stabilny klucz - id użytkownika albo syntetyczny dla osób anonimowych. */
  id: string;
  name: string;
  /** Druga linia karty: stanowisko, rola, typ reakcji. */
  designation?: string | null;
  image?: string | null;
  /** Gdy podany, awatar staje się linkiem do profilu. */
  href?: string | null;
  /** Tożsamość ukryta (tryb poufny) - neutralny znacznik, bez inicjałów. */
  anonymous?: boolean;
  /**
   * Znacznik w rogu kafla (np. kropka aktywności). Pozycjonuje się sam
   * względem kafla - atom tylko go umieszcza, nie wie, co znaczy.
   */
  badge?: ReactNode;
}

export type AvatarGroupSize = "xs" | "sm" | "md" | "lg";

interface SizeSpec {
  /** Bok kafla w px. */
  px: number;
  /** Ile kafel nachodzi na poprzedni (~30% boku, jak w stosach obecności). */
  overlap: number;
  /** Grubość ramki wokół zdjęcia. */
  pad: number;
  /** Stopień inicjałów. */
  font: number;
}

const SIZES: Record<AvatarGroupSize, SizeSpec> = {
  xs: { px: 24, overlap: 7, pad: 2, font: 9 },
  sm: { px: 32, overlap: 10, pad: 2, font: 11 },
  md: { px: 40, overlap: 12, pad: 3, font: 13 },
  lg: { px: 48, overlap: 14, pad: 3, font: 15 },
};

/** Rozmiar nazwany albo bok w px (np. 28 dla stosów huba klubu). */
function sizeSpec(size: AvatarGroupSize | number): SizeSpec {
  if (typeof size !== "number") return SIZES[size];
  const px = Math.max(16, Math.round(size));
  const pad = px >= 36 ? 3 : px >= 24 ? 2 : 1;
  return {
    px,
    overlap: Math.round(px * 0.3),
    pad,
    font: Math.max(8, Math.round((px - 2 * pad) * 0.42)),
  };
}

/** Promień ramki kafla i licznika. Wnętrze dostaje promień koncentryczny. */
const RADIUS = 6;

/** Czas gaśnięcia wychodzącego kafla - zgodny z `--avg-out-ms` w `styles.css`. */
const EXIT_MS = 160;

/** Licznik nie rośnie w nieskończoność - pełną liczbę niesie etykieta. */
const CHIP_CAP = 99;

export function avatarInitials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0] ?? "")[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1] ?? "")[0] ?? "") : "";
  return (first + last).toUpperCase();
}

// ---------------------------------------------------------------------------
// Kolejność przyjścia i obecność kafli
// ---------------------------------------------------------------------------

/**
 * Porządek "kto był pierwszy". Raz nadany numer nie jest zwalniany: osoba,
 * która wyszła i wróciła, wraca na swoje miejsce, zamiast przeskakiwać na
 * koniec przy każdym mrugnięciu połączenia.
 */
function useArrivalOrder(items: readonly AvatarGroupItem[]) {
  const seen = useRef(new Map<string, number>());
  const next = useRef(0);

  const ordered = useMemo(() => {
    const order = seen.current;
    for (const item of items) {
      if (!order.has(item.id)) {
        order.set(item.id, next.current);
        next.current += 1;
      }
    }
    // `sort` jest stabilny (ES2019), a pracuje na kopii - dane wołającego
    // zostają nietknięte.
    return items.slice().sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [items]);

  return { ordered, rank: seen.current };
}

interface Slot {
  item: AvatarGroupItem;
  index: number;
  leaving: boolean;
}

const NO_SLOTS: ReadonlyMap<string, Slot> = new Map();

/**
 * Widoczne kafle + te, które właśnie wychodzą. Wychodzący zostaje w drzewie
 * na czas gaśnięcia W TYM SAMYM ELEMENCIE DOM (React zachowuje węzeł po
 * kluczu), więc jego zdjęcie nie ładuje się od nowa i nie mruga inicjałami.
 * Poprzedni widok jest trzymany w stanie i korygowany W TRAKCIE renderu -
 * wzorzec "informacja z poprzedniego renderu" z dokumentacji Reacta - bo
 * korekta w efekcie zostawiłaby jedną klatkę bez wychodzącego kafla.
 */
function useSlots(visible: readonly AvatarGroupItem[], animate: boolean) {
  const signature = visible.map((item) => item.id).join("\u0000");
  const [snapshot, setSnapshot] = useState({ signature, visible });
  const [leaving, setLeaving] = useState<ReadonlyMap<string, Slot>>(NO_SLOTS);

  if (snapshot.signature !== signature) {
    const present = new Set(visible.map((item) => item.id));
    const nextLeaving = new Map(leaving);
    for (const id of present) nextLeaving.delete(id);
    if (animate) {
      snapshot.visible.forEach((item, index) => {
        if (!present.has(item.id)) nextLeaving.set(item.id, { item, index, leaving: true });
      });
    }
    setSnapshot({ signature, visible });
    setLeaving(nextLeaving.size === 0 ? NO_SLOTS : nextLeaving);
  }

  useEffect(() => {
    if (leaving.size === 0) return;
    const ids = [...leaving.keys()];
    const timer = setTimeout(() => {
      setLeaving((current) => {
        const next = new Map(current);
        for (const id of ids) next.delete(id);
        return next.size === 0 ? NO_SLOTS : next;
      });
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return useMemo(() => {
    const slots = new Map<string, Slot>();
    visible.forEach((item, index) => slots.set(item.id, { item, index, leaving: false }));
    for (const [id, slot] of leaving) if (!slots.has(id)) slots.set(id, slot);
    return slots;
  }, [visible, leaving]);
}

/**
 * Licznik "+N" też ma wejście i wyjście. Przy wyjściu pokazuje OSTATNIĄ
 * liczbę, a nie zero, dopóki nie zgaśnie.
 */
function useChip(overflow: number, animate: boolean): { count: number; leaving: boolean } {
  const [last, setLast] = useState(overflow);
  const [leaving, setLeaving] = useState(false);

  if (overflow > 0 && (last !== overflow || leaving)) {
    setLast(overflow);
    setLeaving(false);
  } else if (overflow === 0 && last > 0 && !leaving) {
    if (animate) setLeaving(true);
    else setLast(0);
  }

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      setLeaving(false);
      setLast(0);
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return overflow > 0 ? { count: overflow, leaving: false } : { count: last, leaving };
}

/** Znaczniki slotu: wejście (tylko po zamontowaniu grupy), wyjście, pozycja. */
function slotProps(enter: boolean, leaving: boolean, x: number, zIndex: number) {
  return {
    "data-enter": enter ? "" : undefined,
    "data-leaving": leaving ? "" : undefined,
    "aria-hidden": leaving || undefined,
    inert: leaving || undefined,
    style: { "--avg-x": `${x}px`, zIndex } as CSSProperties,
  };
}

// ---------------------------------------------------------------------------
// Kafel
// ---------------------------------------------------------------------------

type ImageStatus = "idle" | "loading" | "loaded" | "failed";

interface TileProps {
  slot: Slot;
  spec: SizeSpec;
  step: number;
  zIndex: number;
  interactive: boolean;
  /** Czy grupa była już zamontowana, gdy kafel wchodził (SSR i 1. render: nie). */
  enter: boolean;
  open: boolean;
  onOpen: (id: string) => void;
  onClose: (id: string) => void;
}

function AvatarTile({
  slot,
  spec,
  step,
  zIndex,
  interactive,
  enter,
  open,
  onOpen,
  onClose,
}: TileProps) {
  const { item, index, leaving } = slot;
  // Decyzja o animacji wejścia zapada RAZ, przy zamontowaniu kafla: kafel
  // obecny od pierwszego renderu (także z SSR) nie "wlatuje" po hydratacji.
  const [entering] = useState(enter);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<ImageStatus>("idle");

  const src = item.image ? buildAvatarSrc(item.image, spec.px) : "";
  const srcSet = item.image ? buildAvatarSrcSet(item.image, spec.px) : "";

  // Nowy adres zdjęcia zaczyna od zera - także po błędzie poprzedniego,
  // inaczej `failed` zdjęłoby `<img>` na zawsze i nowe zdjęcie nigdy by nie
  // weszło.
  const [statusSrc, setStatusSrc] = useState(src);
  if (statusSrc !== src) {
    setStatusSrc(src);
    setStatus("idle");
  }

  // Zdjęcie gotowe przed hydratacją (z pamięci podręcznej albo z SSR)
  // zostaje widoczne bez przejścia; dopiero niegotowe chowa się za
  // inicjałami i wjeżdża po `load`.
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) setStatus(img.naturalWidth > 0 ? "loaded" : "failed");
    else setStatus("loading");
  }, [src]);

  const accessibleName = item.designation ? `${item.name} - ${item.designation}` : item.name;
  const frameStyle: CSSProperties = {
    width: spec.px,
    height: spec.px,
    padding: spec.pad,
    borderRadius: RADIUS,
  };
  const frameClass = cn(
    // Uniesienie po najechaniu i ruch karty tylko przy zgodzie na animację.
    "avg-frame block motion-safe:transition-transform motion-safe:duration-150",
    interactive &&
      "motion-safe:group-hover/avatar:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  );

  const body = (
    <span
      className="avg-well relative grid size-full place-items-center overflow-hidden font-semibold uppercase leading-none"
      style={{ borderRadius: RADIUS - spec.pad, fontSize: spec.font }}
    >
      <span aria-hidden="true" className={item.anonymous ? "opacity-70" : undefined}>
        {item.anonymous ? "···" : avatarInitials(item.name)}
      </span>
      {src && status !== "failed" ? (
        <img
          ref={imgRef}
          src={src}
          srcSet={srcSet || undefined}
          alt=""
          width={spec.px}
          height={spec.px}
          loading="lazy"
          decoding="async"
          data-status={status}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("failed")}
          className="avg-img absolute inset-0 size-full object-cover"
        />
      ) : null}
    </span>
  );

  let face: ReactNode;
  if (!interactive) {
    face = (
      <span className={frameClass} style={frameStyle}>
        {body}
      </span>
    );
  } else if (item.href) {
    face = (
      <a
        href={item.href}
        className={frameClass}
        style={frameStyle}
        aria-label={accessibleName}
        onFocus={() => onOpen(item.id)}
        onBlur={() => onClose(item.id)}
      >
        {body}
      </a>
    );
  } else {
    face = (
      <span
        tabIndex={leaving ? -1 : 0}
        role="img"
        className={frameClass}
        style={frameStyle}
        aria-label={accessibleName}
        onFocus={() => onOpen(item.id)}
        onBlur={() => onClose(item.id)}
      >
        {body}
      </span>
    );
  }

  return (
    <li
      className="avg-slot group/avatar absolute left-0 top-0"
      title={interactive ? undefined : item.name}
      {...slotProps(entering, leaving, index * step, open ? 999 : zIndex)}
      onMouseEnter={interactive ? () => onOpen(item.id) : undefined}
      onMouseLeave={interactive ? () => onClose(item.id) : undefined}
    >
      {interactive ? (
        <span
          role="tooltip"
          aria-hidden={!open}
          className={cn(
            "pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[16rem]",
            "-translate-x-1/2 rounded-lg border border-border bg-popover px-2.5 py-1.5",
            "text-left shadow-md motion-safe:transition-all motion-safe:duration-150",
            open ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-95 opacity-0",
          )}
        >
          <span className="block text-xs font-semibold leading-tight text-popover-foreground">
            {item.name}
          </span>
          {item.designation ? (
            <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
              {item.designation}
            </span>
          ) : null}
        </span>
      ) : null}
      {face}
      {item.badge}
    </li>
  );
}

interface ChipProps {
  count: number;
  leaving: boolean;
  x: number;
  spec: SizeSpec;
  enter: boolean;
  /** Pełny tekst licznika dla czytnika ekranu, np. "i 4 inne osoby". */
  text: string | null;
  onSelect?: () => void;
}

function OverflowChip({ count, leaving, x, spec, enter, text, onSelect }: ChipProps) {
  const [entering] = useState(enter);
  const visible = `+${Math.min(count, CHIP_CAP)}`;
  const style: CSSProperties = {
    width: spec.px + 8,
    height: spec.px,
    borderRadius: RADIUS,
    // Stopień rośnie z kaflem (~30% boku), ale nie schodzi poniżej 10 px.
    fontSize: Math.max(10, Math.round(spec.px * 0.3)),
  };
  // Krój serwisu, nie mono: cyfry `tabular-nums` trzymają szerokość, a linia
  // centruje się w pionie tak samo jak inicjały na kaflach obok.
  const chipClass = "avg-chip grid place-items-center font-medium leading-none tabular-nums";

  return (
    <li className="avg-slot absolute left-0 top-0" {...slotProps(entering, leaving, x, 0)}>
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          aria-label={text ?? visible}
          title={text ?? undefined}
          className={cn(
            chipClass,
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          style={style}
        >
          <span aria-hidden="true">{visible}</span>
        </button>
      ) : text ? (
        <span className={chipClass} style={style} title={text}>
          <span aria-hidden="true">{visible}</span>
          <span className="sr-only">{text}</span>
        </span>
      ) : (
        <span className={chipClass} style={style}>
          {visible}
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Grupa
// ---------------------------------------------------------------------------

interface AvatarGroupProps {
  items: readonly AvatarGroupItem[];
  className?: string;
  maxVisible?: number;
  /** Rozmiar nazwany albo bok kafla w px. */
  size?: AvatarGroupSize | number;
  /** Etykieta całej grupy dla czytnika ekranu, np. "Zareagowali". */
  label?: string;
  /**
   * Prawdziwa liczba osób, gdy różni się od listy twarzy (licznik z bazy,
   * osoby spoza strony wyników). Domyślnie: długość `items`.
   */
  total?: number;
  /** Tekst licznika "+N" dla czytnika ekranu i dymka, np. "i 4 inne osoby". */
  overflowLabel?: (count: number) => string;
  /**
   * Gdy podany, licznik "+N" jest przyciskiem, który oddaje osoby spoza
   * stosu (np. otwiera pełną listę). Tylko w trybie interaktywnym.
   */
  onOverflowSelect?: (hidden: readonly AvatarGroupItem[]) => void;
  /** `false`: stos jest ozdobą (`aria-hidden`), nazwiska idą do `sr-only`. */
  interactive?: boolean;
  /**
   * Komunikat regionu `aria-live` o zmianie składu (np. "Tu teraz: Anna,
   * Jan"). Tylko dla stosów, które zmieniają się NA ŻYWO (obecność) - bez
   * niego grupa nic nie ogłasza. Ogłoszenie jest odroczone o `announceAfter`
   * ms, żeby seria wejść dała jedno zdanie, a nie pięć.
   */
  announce?: (names: readonly string[]) => string;
  announceAfter?: number;
}

export function AvatarGroup({
  items,
  className,
  maxVisible = 5,
  size = "sm",
  label,
  total,
  overflowLabel,
  onOverflowSelect,
  interactive = true,
  announce,
  announceAfter = 900,
}: AvatarGroupProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const listId = useId();
  const animate = !usePrefersReducedMotion();

  // Grupa "zamontowana" = po pierwszym commicie. Kafle, które wchodzą później,
  // dostają animację wejścia; te z SSR i pierwszego renderu - nie.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);

  const spec = sizeSpec(size);
  const step = spec.px - spec.overlap;
  const slotsCount = Math.max(1, maxVisible);

  const { ordered, rank } = useArrivalOrder(items);
  const visible = useMemo(() => ordered.slice(0, slotsCount), [ordered, slotsCount]);
  const hidden = useMemo(() => ordered.slice(slotsCount), [ordered, slotsCount]);
  const overflow = Math.max(0, (total ?? ordered.length) - visible.length);

  const slots = useSlots(visible, animate);
  const chip = useChip(overflow, animate);

  // Kolejność w DOM = kolejność przyjścia, także dla wychodzących. Dzięki temu
  // React nigdy nie PRZESTAWIA istniejącego węzła (przestawienie potrafi zerwać
  // trwające przejście), a wygląd i tak wyznacza `translate` slotu.
  const rendered = useMemo(
    () =>
      [...slots.values()].sort((a, b) => (rank.get(a.item.id) ?? 0) - (rank.get(b.item.id) ?? 0)),
    [slots, rank],
  );

  const names = ordered.map((item) => item.name);
  const summary = announce ? announce(names) : "";
  const [announcement, setAnnouncement] = useState(summary);
  const announcing = announce !== undefined;
  useEffect(() => {
    if (!announcing) return;
    const timer = setTimeout(() => setAnnouncement(summary), announceAfter);
    return () => clearTimeout(timer);
  }, [announcing, summary, announceAfter]);

  if (items.length === 0 && rendered.length === 0) return null;

  const chipWidth = spec.px + 8;
  const rail =
    visible.length === 0
      ? 0
      : overflow > 0
        ? visible.length * step + chipWidth
        : (visible.length - 1) * step + spec.px;

  const open = (id: string) => setHovered(id);
  const close = (id: string) => setHovered((prev) => (prev === id ? null : prev));

  return (
    <div
      className={cn("inline-flex items-center", className)}
      data-avatar-group={listId}
      role={!interactive && label ? "group" : undefined}
      aria-label={!interactive ? label : undefined}
    >
      <ul
        className="avg-rail relative shrink-0"
        aria-label={interactive ? label : undefined}
        aria-hidden={interactive ? undefined : true}
        style={{ "--avg-w": `${rail}px`, height: spec.px } as CSSProperties}
      >
        {rendered.map((slot) => (
          <AvatarTile
            key={slot.item.id}
            slot={slot}
            spec={spec}
            step={step}
            zIndex={slotsCount - slot.index}
            interactive={interactive}
            enter={mounted.current}
            open={interactive && !slot.leaving && hovered === slot.item.id}
            onOpen={open}
            onClose={close}
          />
        ))}

        {chip.count > 0 ? (
          <OverflowChip
            // Znak NUL nie wystąpi w id osoby - klucz licznika nie zderzy się z kaflem.
            key={"\u0000overflow"}
            count={chip.count}
            leaving={chip.leaving}
            x={visible.length * step}
            spec={spec}
            enter={mounted.current}
            text={interactive && overflowLabel ? overflowLabel(chip.count) : null}
            onSelect={interactive && onOverflowSelect ? () => onOverflowSelect(hidden) : undefined}
          />
        ) : null}
      </ul>

      {!interactive ? <span className="sr-only">{names.join(", ")}</span> : null}

      {announcing ? (
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </span>
      ) : null}
    </div>
  );
}

export default AvatarGroup;
