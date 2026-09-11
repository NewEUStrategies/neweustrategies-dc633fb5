// Molekuła: rozwijana zakładka paska doku (ikona + etykieta aktywnej pozycji).
//
// ── DLACZEGO TO JUŻ NIE JEST `motion.button` ─────────────────────────────
// Poprzednia wersja animowała `framer-motion`: `paddingLeft`, `paddingRight`,
// `gap` przycisku i `width` etykiety. Trzy rzeczy naraz były na tym złe.
//
//  1. TO SĄ WŁASNOŚCI UKŁADU. Każda klatka takiej animacji to zapis stylu
//     z JS, przeliczenie układu CAŁEGO rzędu (czternaście zakładek w DOM -
//     rząd mobilny i desktopowy są oba zamontowane, jeden schowany klasą)
//     i przemalowanie, w pasku z `backdrop-blur` na pełną szerokość. Przy
//     jednoczesnym parsowaniu paczki panelu - czyli dokładnie wtedy, gdy
//     zakładka się animuje - główny wątek jest zajęty i animacja gubi klatki.
//  2. 0,6 s CZASU + 0,1 s OPÓŹNIENIA. 700 ms na potwierdzenie kliknięcia,
//     przy zakresie 150-200 ms, w którym afordancja czyta się jako
//     natychmiastowa. To była JEDYNA informacja, że klik został przyjęty,
//     bo panel do czasu dociągnięcia paczki nie renderował nic.
//  3. `framer-motion` NIE JEST ZALEŻNOŚCIĄ TEGO PROJEKTU z wyboru. Osiem
//     komponentów (`ProfileCard`, `TravelRouteCard`, `WorldMap`,
//     `AvatarGroup`, `EventSpeakerCreateDialog`, karuzele, `link-preview`)
//     ma w nagłówkach spisaną decyzję „animacja idzie w CSS, biblioteki nie
//     ma w projekcie". Dok był jedynym plikiem, który ją wciągał. ZMIERZONE
//     esbuildem (React jako external): sam `import { motion, AnimatePresence }`
//     to 127 874 B po minifikacji / 42 402 B po gzipie - i nie ma reguły
//     `manualChunks`, która by to gdziekolwiek przypięła, więc paczka jedzie
//     w chunku doku. Gość nie płaci nic, ale KAŻDY zalogowany członek płacił
//     ~42 kB gzip na pierwsze wejście, żeby przesunąć 4 px wcięcia.
//
// Ruch robi teraz warstwa `.wd-tab*` w `styles.css`.
//
// ── DWIE OBIETNICE, DWA ELEMENTY ─────────────────────────────────────────
// Zakładka robi jedną z dwóch rzeczy i to MUSI być widać w znaczniku:
//
//   NAWIGACJA  -> `<a href>` (przez `AppLink`) + `aria-current="page"`.
//     Poprzednia wersja wołała `navigate()` z `<button>`, czyli pozycja
//     „Sieć" nie dawała się otworzyć w nowej karcie, skopiować adresu ani
//     kliknąć środkowym przyciskiem - zwykłe rzeczy, których ludzie robią
//     z linkami. Repozytorium ma na to gotowy wzorzec w `BottomBarTab`
//     (`AppLink` + `aria-current`) dla DOKŁADNIE tej samej konfiguracji
//     pozycji, więc dok był tu jedynym odstępstwem.
//   PANEL      -> `<button>` + `aria-expanded` + `aria-controls`.
//     `aria-pressed` mówiłoby „wciśnięty", a nie „rozwinąłem region" - i tak
//     właśnie było, także dla nawigacji.
//
// ── DLACZEGO NIE MA `aria-label` ─────────────────────────────────────────
// Etykieta tekstowa jest ZAWSZE w drzewie (zwija ją tor siatki, nie
// `display: none`), więc nazwę dostępną niesie sama treść. `aria-label`
// nadpisywał tę nazwę i przez to WYCINAŁ z niej licznik: „Zadania" zamiast
// „Zadania 3". Czytnik ekranu nie miał skąd wiedzieć o trzech otwartych
// zadaniach, choć liczba stała na ekranie.
//
// ── DLACZEGO PROPSY SĄ PROSTYMI WARTOŚCIAMI, A NIE `ReactNode` ───────────
// `memo` porównuje propsy referencją. Zakładka brała wcześniej gotowe
// elementy (`icon={<Icon/>}`, `badge={<LiveTabBadge/>}`) i domknięcie
// (`onPress={() => ...}`), które pasek tworzy od nowa przy każdym renderze -
// czyli `memo` nigdy by nie trafiło i byłoby wyłącznie ozdobą. Zakładka
// przyjmuje więc TOŻSAMOŚĆ pozycji (`id`), typ ikony (referencja modułowa,
// stała) i liczby, a elementy składa u siebie.
//
// ── ROZGRZEWANIE NA ZAMIAR ───────────────────────────────────────────────
// `onPrefetch` odpala się na `onPointerEnter`, `onFocus` i `onPointerDown`.
// Trzy zdarzenia, bo pokrywają trzy różne wejścia: kursor (hover), klawiatura
// (focus) i palec (na dotyku hoveru NIE MA, a `pointerdown` wyprzedza `click`
// o czas przytrzymania - w praktyce kilkadziesiąt milisekund, które paczka
// ma dla siebie).
import { memo, useCallback, type ComponentType, type SVGProps } from "react";
import { AppLink } from "@/components/atoms/AppLink";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { LiveTabBadge } from "@/components/mobile/bottomBar/LiveTabBadge";
import type { BottomBarBadgeSource } from "@/lib/mobileBottomBar/config";
import { cn } from "@/lib/utils";

interface CommonProps {
  /** Tożsamość pozycji - wraca do paska w `onPress`/`onPrefetch`. */
  id: string;
  label: string;
  active: boolean;
  /** Ikona z `lucide` - referencja modułowa, więc stabilna między renderami. */
  Icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Nazwa ikony wybranej przez redakcję (skróty nawigacyjne). */
  iconName?: string;
  /** Źródło żywego licznika (nieprzeczytane rozmowy, zaproszenia, ...). */
  badgeSource?: BottomBarBadgeSource;
  /** Licznik liczony po stronie doku (otwarte zadania). */
  badgeCount?: number;
  /**
   * Zlokalizowany opis licznika (np. „Otwarte: 3"), dołączany do nazwy
   * dostępnej PO etykiecie.
   *
   * DLACZEGO OSOBNO OD `badgeCount`. Sama pigułka licznika jest pozycjonowana
   * absolutnie NAD ikoną, więc w drzewie DOM stoi PRZED etykietą - czytnik
   * ekranu ogłaszał „99+ Zadania" zamiast „Zadania, otwarte 99+". Pigułka jest
   * więc `aria-hidden` (czysta warstwa wizualna), a treść dla czytnika idzie
   * w `sr-only` za etykietą, we właściwej kolejności i pełnym zdaniem.
   */
  badgeLabel?: string;
  /** Wyróżniona ikona pozycji centralnej (Home na telefonie). */
  center?: boolean;
  /** Ciaśniejsze wcięcia i mniejszy tekst - rząd mobilny. */
  compact?: boolean;
  /** Delikatna obwódka „ostatnio używane narzędzie". */
  highlighted?: boolean;
}

/** Zakładka otwierająca panel nad paskiem albo skrzynkę czatu. */
interface PanelTabProps extends CommonProps {
  kind: "panel";
  /** Identyfikator regionu, którym ta zakładka steruje (`aria-controls`). */
  controls: string;
  onPress: (id: string) => void;
  /**
   * Rozgrzanie paczki panelu I jego danych na zamiar otwarcia
   * (hover / focus / dotyk). Tylko dla zakładek panelowych - nawigacyjne
   * rozgrzewa router przez `preload="intent"` na `AppLink`.
   */
  onPrefetch?: (id: string) => void;
  href?: never;
}

/** Zakładka przenosząca na inną trasę. */
interface NavTabProps extends CommonProps {
  kind: "nav";
  /** Adres docelowy - prawdziwy `href`, nie `navigate()` z przycisku. */
  href: string;
  onPress?: never;
  onPrefetch?: never;
  controls?: never;
}

export type ExpandableTabProps = PanelTabProps | NavTabProps;

function ExpandableTabBase(props: ExpandableTabProps) {
  const {
    id,
    label,
    active,
    Icon,
    iconName,
    badgeSource,
    badgeCount = 0,
    badgeLabel,
    center = false,
    compact = false,
    highlighted = false,
  } = props;

  // Domknięcia liczone z WARTOŚCI, nie z całego obiektu propsów - inaczej
  // zależność zmieniałaby tożsamość przy każdym renderze rodzica i `memo`
  // wyżej nie miałoby czego chronić.
  const onPress = props.kind === "panel" ? props.onPress : undefined;
  const onPrefetch = props.kind === "panel" ? props.onPrefetch : undefined;
  const press = useCallback(() => onPress?.(id), [onPress, id]);
  const prefetch = useCallback(() => onPrefetch?.(id), [onPrefetch, id]);

  const className = cn(
    "wd-tab flex min-w-0 items-center justify-center rounded-md py-1 text-xs font-medium no-underline",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    // Wcięcia i przerwa NIE są animowane - to były najdroższe własności
    // w poprzedniej wersji. Aktywna zakładka dostaje je skokowo, a ruch,
    // który widać, robi rozwijana etykieta.
    active
      ? cn("gap-1.5 text-primary", compact ? "px-1" : "px-3")
      : cn("gap-0 text-muted-foreground/80 hover:text-foreground", compact ? "px-1" : "px-2"),
  );

  const inner = (
    <>
      <span
        className={cn(
          "relative grid shrink-0 place-items-center rounded-full [&>svg]:h-4 [&>svg]:w-4",
          center && "h-6 w-6 bg-primary text-primary-foreground [&>svg]:h-3.5 [&>svg]:w-3.5",
        )}
      >
        {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
        {iconName ? <DynamicIcon name={iconName} className="h-4 w-4" aria-hidden="true" /> : null}
        {badgeSource ? <LiveTabBadge source={badgeSource} /> : null}
        {badgeCount > 0 ? (
          <span
            aria-hidden="true"
            data-dock-badge
            className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground"
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        ) : null}
      </span>
      {/* Etykieta zostaje W DRZEWIE zawsze - i widoczna dla czytnika ekranu,
          bo to ONA jest nazwą dostępną zakładki. Poprzednia wersja montowała
          ją przez `AnimatePresence`, więc każde przełączenie tworzyło
          i niszczyło węzeł tekstowy; tutaj zmienia się tylko tor siatki
          i przezroczystość, czyli praca dla silnika stylu, nie dla Reacta. */}
      <span className="wd-tab__reveal">
        <span className={cn("wd-tab__label", compact ? "text-[11px]" : "text-xs")}>{label}</span>
      </span>
      {badgeCount > 0 && badgeLabel ? <span className="sr-only">{badgeLabel}</span> : null}
    </>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {props.kind === "nav" ? (
          <AppLink
            href={props.href}
            // `preload="intent"` to ta sama zasada, co rozgrzewanie paczek
            // paneli: router pobiera kod i dane trasy na najechanie.
            preload="intent"
            aria-current={active ? "page" : undefined}
            data-dock-tab={id}
            data-active={active ? "true" : "false"}
            data-recent={highlighted ? "true" : "false"}
            className={className}
          >
            {inner}
          </AppLink>
        ) : (
          <button
            type="button"
            onClick={press}
            onPointerEnter={prefetch}
            onPointerDown={prefetch}
            onFocus={prefetch}
            aria-expanded={active}
            aria-controls={props.controls}
            data-dock-tab={id}
            data-active={active ? "true" : "false"}
            data-recent={highlighted ? "true" : "false"}
            className={className}
          >
            {inner}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export const ExpandableTab = memo(ExpandableTabBase);
