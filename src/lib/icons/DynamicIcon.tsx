// Lokalny odpowiednik lucide-react/dynamic (SSR-safe): resolwer po nazwie kebab-case.
//
// UWAGA wydajnościowa: poprzednia wersja robiła `import * as LucideIcons from
// "lucide-react"`, przez co CAŁA biblioteka (~640 KB raw, ~1500 ikon) lądowała
// w chunku wejściowym każdej strony (DynamicIcon renderują SiteMenu i
// MegaPanelView, czyli chrome nagłówka). Teraz:
//   1. wyselekcjonowany zestaw ikon (imports nazwane -> tree-shaking) pokrywa
//      typowe ikony menu/treści i renderuje się synchronicznie,
//   2. pozostałe nazwy dociągają przez lazy() jedną z 4 porcji danych SVG
//      (`chunks/icons-N.json`; numer porcji to `hash % 4` z `iconChunkIndex.js`,
//      wspólnego dla generatora i `lazyNamedIcon.ts`).
//      Pełny katalog pozostaje wyłącznie w pickerze administracyjnym.
// Fallback Suspense rezerwuje dokładnie wymiar ikony (size), więc doładowanie
// nie zmienia zarezerwowanego miejsca. SSR może poczekać na tę samą porcję danych,
// a przeglądarka przy hydratacji NIE pobiera porcji - odtwarza SVG z DOM-u
// serwera (znacznik `data-dyn-icon`, P2.4; szczegóły przy `readSsrIcon`).
import { lazy, Suspense } from "react";
import {
  // - zestaw bazowy (nawigacja/UI) -
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Award,
  Banknote,
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  Briefcase,
  Building,
  Building2,
  Calendar,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Compass,
  Cpu,
  Database,
  DollarSign,
  Download,
  Euro,
  ExternalLink,
  Eye,
  Factory,
  FileText,
  Flag,
  Flame,
  Folder,
  Gavel,
  Globe,
  Globe2,
  GraduationCap,
  Handshake,
  Headphones,
  Heart,
  HelpCircle,
  Home,
  Image,
  Info,
  Landmark,
  Layers,
  Leaf,
  Library,
  Lightbulb,
  LineChart,
  Link,
  List,
  ListChecks,
  Lock,
  Mail,
  Map,
  MapPin,
  Megaphone,
  Menu,
  MessageCircle,
  MessageSquare,
  Mic,
  Moon,
  Newspaper,
  Pencil,
  Phone,
  PieChart,
  Plane,
  Play,
  Podcast,
  Radio,
  Rocket,
  Rss,
  Scale,
  Search,
  Settings,
  Share2,
  Shield,
  Ship,
  Sparkles,
  Star,
  Sun,
  Tag,
  Tags,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  Truck,
  User,
  Users,
  Video,
  Wifi,
  X,
  Zap,
  AlertTriangle,
  CircleUser,
  CreditCard,
  Facebook,
  Github,
  Instagram,
  LayoutDashboard,
  Linkedin,
  LogIn,
  LogOut,
  MessagesSquare,
  ShoppingBag,
  SlidersHorizontal,
  Twitter,
  UserCheck,
  UserCircle,
  UserPlus,
  Youtube,
  // - dołożone 2026-09-20 wraz z bramką `check:menu-icons` (F24) -
  // Te dziewięć nazw KONFIGURACJA CHROME PODAJE NAPRAWDĘ: pasek dolny
  // (`users-round` z migracji 20260808120627), menu konta (`Crown`, `Ticket`,
  // `ShoppingCart`, `ShieldCheck`), kafelki podstron wydarzenia
  // (`clipboard-list`, `folder-open`, `calendar-clock`) i domyślne
  // powiadomienia (`life-buoy` z 20260723140000). Każda z nich - jako nazwa
  // SPOZA zestawu - ściągała leniwy chunk pełnego rejestru (473 KB źródeł,
  // 109 KB gzip) do przeglądarki anonima, żeby narysować JEDNĄ ikonę.
  // Import nazwany kosztuje setki bajtów; to jest cała cena tej naprawy.
  // (Od podziału rejestru na porcje, 2026-09-29, taka nazwa kosztuje jedną
  // porcję, 23-25 KB gzip - mniej, ale wciąż wielokrotnie więcej niż import.)
  CalendarClock,
  ClipboardList,
  Crown,
  FolderOpen,
  LifeBuoy,
  ShieldCheck,
  ShoppingCart,
  Ticket,
  UsersRound,
  Icon,
  type IconNode,
  type LucideProps,
} from "lucide-react";

const DynamicIconChunk = lazy(() => import("./DynamicIconChunk"));

export type IconName = string;

type IconComponent = React.ComponentType<LucideProps>;

// PascalCase (bez sufiksu "Icon") -> komponent. Klucze odpowiadają
// toPascalKey(nazwa-kebab), np. "graduation-cap" -> "GraduationCap".
const CURATED: Record<string, IconComponent> = {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Award,
  Banknote,
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  Briefcase,
  Building,
  Building2,
  Calendar,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Compass,
  Cpu,
  Database,
  DollarSign,
  Download,
  Euro,
  ExternalLink,
  Eye,
  Factory,
  FileText,
  Flag,
  Flame,
  Folder,
  Gavel,
  Globe,
  Globe2,
  GraduationCap,
  Handshake,
  Headphones,
  Heart,
  HelpCircle,
  Home,
  Image,
  Info,
  Landmark,
  Layers,
  Leaf,
  Library,
  Lightbulb,
  LineChart,
  Link,
  List,
  ListChecks,
  Lock,
  Mail,
  Map,
  MapPin,
  Megaphone,
  Menu,
  MessageCircle,
  MessageSquare,
  Mic,
  Moon,
  Newspaper,
  Pencil,
  Phone,
  PieChart,
  Plane,
  Play,
  Podcast,
  Radio,
  Rocket,
  Rss,
  Scale,
  Search,
  Settings,
  Share2,
  Shield,
  Ship,
  Sparkles,
  Star,
  Sun,
  Tag,
  Tags,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  Truck,
  User,
  Users,
  Video,
  Wifi,
  X,
  Zap,
  AlertTriangle,
  CircleUser,
  CreditCard,
  Facebook,
  Github,
  Instagram,
  LayoutDashboard,
  Linkedin,
  LogIn,
  LogOut,
  MessagesSquare,
  ShoppingBag,
  SlidersHorizontal,
  Twitter,
  UserCheck,
  UserCircle,
  UserPlus,
  Youtube,
  // Nazwy wymuszone przez konfigurację chrome - uzasadnienie przy imporcie.
  CalendarClock,
  ClipboardList,
  Crown,
  FolderOpen,
  LifeBuoy,
  ShieldCheck,
  ShoppingCart,
  Ticket,
  UsersRound,
};

/**
 * Klucze zestawu kuratorowanego (PascalCase) - JEDYNE źródło prawdy o jego
 * składzie. Bramka `check:menu-icons` porównuje z nim nazwy z konfiguracji,
 * ale robi to przez `CURATED_ICON_NAMES` (czyste dane, bez `lucide-react`);
 * test `curatedIconNames.test.tsx` dowodzi, że obie listy są tą samą listą.
 */
export const CURATED_ICON_KEYS: readonly string[] = Object.keys(CURATED);

// Indeks case-insensitive: konsumenci zapisują nazwy różnie (kebab-case w DB
// powiadomień/menu, PascalCase w configu account-menu) - "log-in", "LogIn" i
// "login" mają trafić w ten sam komponent.
const CURATED_LC: Record<string, IconComponent> = {};
for (const [k, v] of Object.entries(CURATED)) CURATED_LC[k.toLowerCase()] = v;

function toPascalKey(name: string): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  // Bez separatorów: zachowaj wewnętrzne wielkie litery ("LogIn", "logIn" ->
  // "LogIn"); lowercase'owanie reszty zepsułoby PascalCase'owe nazwy.
  if (!/[-_\s]/.test(trimmed)) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }
  return trimmed
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

/**
 * Ostrzeżenie o nazwie spoza zestawu - RAZ na nazwę i tylko w trybie
 * deweloperskim. Menu renderuje się przy każdym żądaniu, więc ostrzeżenie bez
 * pamięci zalałoby konsolę (i log workera) tą samą linijką.
 */
const ostrzezone = new Set<string>();
function ostrzezOIkonieSpozaZestawu(name: string): void {
  if (!import.meta.env.DEV) return;
  const key = String(name);
  if (ostrzezone.has(key)) return;
  ostrzezone.add(key);
  console.warn(
    `[DynamicIcon] Nazwa "${key}" jest spoza zestawu kuratorowanego, a to wywołanie ` +
      "jest w chrome (menu/nawigacja), więc pełny rejestr NIE zostanie dociągnięty - " +
      "renderuję ikonę zastępczą. Popraw nazwę w konfiguracji albo dopisz ikonę do " +
      "CURATED w src/lib/icons/DynamicIcon.tsx (wtedy też do CURATED_ICON_NAMES).",
  );
}

interface DynamicIconProps extends LucideProps {
  name: string;
  /**
   * Czy nieznana nazwa MOŻE dociągnąć pełny rejestr ikon.
   *
   * Domyślnie `true`, czyli zachowanie sprzed 2026-09-20: treść, panel
   * administracyjny i pickery ikon nadal renderują dowolną z ~1500 nazw, bo
   * tam koszt leniwego chunka ponosi ktoś, kto świadomie wszedł w edytor.
   *
   * `false` jest dla CHROME (menu witryny, mega panel, pasek dolny). Nazwy
   * ikon menu pochodzą z konfiguracji w bazie, więc JEDNA literówka w panelu
   * administracyjnym kosztowałaby KAŻDEGO anonima na stronie publicznej
   * leniwą porcję danych SVG (23-25 KB gzip) - i to na ścieżce krytycznej
   * pierwszego renderu. Zamiast tego rysujemy neutralne kółko i mówimy o tym
   * w konsoli dev.
   * Zestaw kuratorowany pilnuje bramka `check:menu-icons`.
   */
  allowFull?: boolean;
}

export function DynamicIcon({ name, allowFull = true, ...rest }: DynamicIconProps) {
  const key = toPascalKey(name);
  const Curated = key ? (CURATED[key] ?? CURATED_LC[key.toLowerCase()]) : undefined;
  if (Curated) return <Curated {...rest} />;
  if (!key) return <HelpCircle {...rest} />;
  if (!allowFull) {
    ostrzezOIkonieSpozaZestawu(name);
    // Kółko, a nie znak zapytania: w nawigacji ikona jest ozdobą pozycji, więc
    // zastępnik ma zająć jej miejsce, a nie krzyczeć do czytelnika o usterce
    // konfiguracji. Wymiar bierze się z `rest.size` tak samo jak dla ikony
    // właściwej, więc układ wiersza się nie zmienia.
    return <Circle {...rest} />;
  }

  // Rezerwacja wymiaru na czas dociągania chunka - identyczna z boxem ikony
  // lucide (kwadrat `size`, domyślnie 24), więc zero przesunięcia układu.
  const size = rest.size ?? 24;
  const fallback = (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: size, height: size, flexShrink: 0 }}
    />
  );
  // Ta sama granica Suspense po obu stronach (struktura hydratacji). Serwer
  // zawsze rysuje ikonę z porcji danych (`DynamicIconChunk`) i znakuje ją
  // `data-dyn-icon`; przeglądarka najpierw szuka tego SVG w DOM-ie z SSR.
  const ssr = readSsrIcon(key, rest.className);
  return (
    <Suspense fallback={fallback}>
      {ssr ? (
        <Icon
          {...rest}
          iconNode={ssr.iconNode}
          className={[ssr.lucideClasses, rest.className].filter(Boolean).join(" ")}
          data-dyn-icon={key}
        />
      ) : (
        <DynamicIconChunk iconKey={key} {...rest} data-dyn-icon={key} />
      )}
    </Suspense>
  );
}

// ---------- ikony spoza zestawu: SVG z DOM-u SSR (P2.4, hydration:H10 e) ----------
//
// PO CO. Nazwa spoza zestawu kuratorowanego (np. ikona `nav-link` z dokumentu
// nagłówka) kosztowała przy hydratacji `/` porcję danych `icons-N` (23-25 KB
// gzip, ~100 KB surowego JSON-a do sparsowania) - tylko po to, żeby klient
// odtworzył SVG, który serwer już wysłał w HTML-u. Teraz klient czyta ten SVG
// z DOM-u: węzły dzieci (ścieżki, okręgi, ...) stają się `IconNode` dla `Icon`
// z lucide (ten sam komponent, którego używa `createLucideIcon`), a klasy
// `lucide-*` przechodzą 1:1. Wynik renderu jest bajt w bajt tym, co
// wyrenderował serwer, więc hydratacja nie widzi różnicy, a granica Suspense
// się nie zawiesza. Porcja danych zostaje dla renderu czysto klienckiego
// (nawigacja SPA do ikony, której nie było w dokumencie).
//
// Pamięć: kształt jest per NAZWA (ta sama nazwa = ten sam SVG), więc jeden
// odczyt DOM-u wystarcza na cały dokument i późniejsze nawigacje.

/** Atrybut, którym serwer znakuje SVG ikony spoza zestawu (wartość = klucz). */
const SSR_ICON_ATTR = "data-dyn-icon";

/** Elementy, z których składają się ikony lucide (jak `isIconNode` porcji). */
const SSR_ICON_TAGS = new Set([
  "circle",
  "ellipse",
  "g",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
]);

interface SsrIconShape {
  readonly iconNode: IconNode;
  /** Klasy `lucide-<nazwa>` z SVG serwera (bez `lucide` i bez klas wołającego). */
  readonly lucideClasses: string;
}

// `globalThis.Map`: w tym module `Map` to zaimportowana ikona lucide.
const ssrIconShapes = new globalThis.Map<string, SsrIconShape>();

function cssAttrValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\n\r\f]/g, "\\a ");
}

/** `stroke-width` -> `strokeWidth`: nazwa propsa Reacta dla atrybutu SVG. */
function svgPropName(attribute: string): string {
  return attribute.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function readSsrIcon(key: string, className: string | undefined): SsrIconShape | undefined {
  if (typeof document === "undefined") return undefined;
  const known = ssrIconShapes.get(key);
  if (known) return known;
  const svg = document.querySelector(`svg[${SSR_ICON_ATTR}="${cssAttrValue(key)}"]`);
  if (!svg) return undefined;
  const iconNode: IconNode = [];
  for (const [index, child] of Array.from(svg.children).entries()) {
    const tag = child.localName;
    if (!SSR_ICON_TAGS.has(tag) || child.children.length > 0) return undefined;
    const attrs: Record<string, string> = { key: `ssr-${index}` };
    for (const attribute of Array.from(child.attributes)) {
      attrs[svgPropName(attribute.name)] = attribute.value;
    }
    iconNode.push([tag as IconNode[number][0], attrs]);
  }
  // Serwer: `class="lucide lucide-<a> lucide-<b> <className>"`. Klasy
  // wołającego (te same przy hydratacji) odcinamy, zostają klasy ikony.
  const own = new Set((className ?? "").split(/\s+/).filter(Boolean));
  const lucideClasses = (svg.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((token) => token.startsWith("lucide-") && !own.has(token))
    .join(" ");
  const shape: SsrIconShape = { iconNode, lucideClasses };
  ssrIconShapes.set(key, shape);
  return shape;
}

/**
 * Ikona CHROME - ta sama rozdzielczość nazw, ale bez prawa do pełnego rejestru.
 *
 * DLACZEGO OSOBNY EKSPORT, A NIE ZMIANA DOMYŚLNEGO ZACHOWANIA. `DynamicIcon`
 * ma dziś ~30 wywołań: większość z nich to treść i panel administracyjny, gdzie
 * dociągnięcie pełnego rejestru jest POPRAWNE (redaktor wybrał egzotyczną
 * ikonę i ma prawo ją zobaczyć). Wywołań w chrome jest kilka i to one są na
 * ścieżce krytycznej KAŻDEJ strony publicznej. Zmiana domyślnej wartości
 * przełączyłaby wszystkie; osobny eksport przełącza dokładnie te, które trzeba,
 * a podmiana jest zmianą jednej linii w imporcie.
 *
 * Miejsca docelowe: `components/menu/SiteMenu.tsx`,
 * `components/menu/MegaPanelView.tsx`, `components/mobile/bottomBar/BottomBarTab.tsx`
 * (ten ostatni ma już zastępnik `"circle"` dla pustej nazwy).
 */
export function MenuIcon(props: Omit<DynamicIconProps, "allowFull">) {
  return <DynamicIcon {...props} allowFull={false} />;
}
