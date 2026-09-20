// Lokalny odpowiednik lucide-react/dynamic (SSR-safe): resolwer po nazwie kebab-case.
//
// UWAGA wydajnościowa: poprzednia wersja robiła `import * as LucideIcons from
// "lucide-react"`, przez co CAŁA biblioteka (~640 KB raw, ~1500 ikon) lądowała
// w chunku wejściowym każdej strony (DynamicIcon renderują SiteMenu i
// MegaPanelView, czyli chrome nagłówka). Teraz:
//   1. wyselekcjonowany zestaw ikon (imports nazwane -> tree-shaking) pokrywa
//      typowe ikony menu/treści i renderuje się synchronicznie,
//   2. nieznane nazwy dociągają pełny rejestr Reactowym lazy() z osobnego
//      chunka (DynamicIconFull) - jednorazowo, poza ścieżką krytyczną.
// Fallback Suspense rezerwuje dokładnie wymiar ikony (size), więc doładowanie
// nie powoduje przesunięcia układu (CLS = 0). Na serwerze lazy() renderuje się
// synchronicznie, więc SSR HTML zawsze zawiera właściwą ikonę.
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
  CalendarClock,
  ClipboardList,
  Crown,
  FolderOpen,
  LifeBuoy,
  ShieldCheck,
  ShoppingCart,
  Ticket,
  UsersRound,
  type LucideProps,
} from "lucide-react";

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

const DynamicIconFull = lazy(() => import("./DynamicIconFull"));

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
   * administracyjnym kosztowałaby 109 KB gzip KAŻDEGO anonima na stronie
   * publicznej - i to na ścieżce krytycznej pierwszego renderu. Zamiast tego
   * rysujemy neutralne kółko i mówimy o tym w konsoli dev.
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
  return (
    <Suspense fallback={fallback}>
      <DynamicIconFull iconKey={key} {...rest} />
    </Suspense>
  );
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
