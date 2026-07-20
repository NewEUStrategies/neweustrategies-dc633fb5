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
};

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

interface DynamicIconProps extends LucideProps {
  name: string;
}

export function DynamicIcon({ name, ...rest }: DynamicIconProps) {
  const key = toPascalKey(name);
  const Curated = key ? (CURATED[key] ?? CURATED_LC[key.toLowerCase()]) : undefined;
  if (Curated) return <Curated {...rest} />;
  if (!key) return <HelpCircle {...rest} />;

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
