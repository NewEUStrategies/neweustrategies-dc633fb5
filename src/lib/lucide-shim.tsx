/**
 * Drop-in icon API nad Lucide: te same eksporty PascalCase, których używa
 * aplikacja (288 plików importuje stąd zamiast z `lucide-react`).
 *
 * Do 16.11.2026 moduł przełączał się na Font Awesome, gdy w ustawieniach
 * ogólnych wybrano zestaw „fontawesome". Opcję usunięto decyzją właściciela
 * (roadmapa ładowania §9, W5): była niepełna (892 pliki importują Lucide
 * bezpośrednio, 22 ze 129 ikon nie miały odpowiednika i znikały), a SSR zawsze
 * renderował Lucide, więc ikony migały po hydratacji. Eksport to teraz wprost
 * komponent Lucide - bez opakowania, subskrypcji preferencji i Suspense.
 *
 * CZYSTE REEKSPORTY, NIE `export const X = makeIcon(LX)` (D4, §9.1). Shim jest
 * modułem startowym (importują go nagłówek i stopka), a Rolldown przypisuje
 * glify Lucide do `vendor-lucide-boot` według statycznej osiągalności MODUŁU
 * z wejścia (`$initial`, `scripts/lib/clientChunkGroups.ts`). Import
 * `X as LX` w module startowym czynił startową KAŻDĄ ikonę shimu, której
 * ktokolwiek używał - także tę używaną wyłącznie przez leniwy chunk panelu.
 * Reeksport bundler rozwiązuje do faktycznie użytych ikon, więc glif używany
 * tylko w leniwym kodzie trafia do `vendor-lucide`. Komponenty są tymi samymi
 * obiektami co wcześniej (`makeIcon` zwracał komponent Lucide bez zmian) -
 * przypina to `src/lib/__tests__/lucideShimIdentity.test.ts`.
 *
 * Bez rezerwowego `Circle` z dawnego `makeIcon`: eksport, którego zabraknie
 * w nowej wersji `lucide-react`, jest błędem typów i builda, a nie cichym
 * kółkiem w interfejsie.
 *
 * NOWY EKSPORT = WPIS W `src/lib/icons/shimIconNames.ts` i `shimIconMap.ts`
 * (nazwy ikon zapisywane w treści CMS; test `shimIconByName.test.tsx` oblewa
 * bez nich). Aliasy shimu (`Redo2`, `Undo2`) wskazują glify `Redo`/`Undo`,
 * a nie ikony `lucide-react` o tych nazwach.
 */
import type { SVGAttributes } from "react";

export type LucideIcon = React.FC<IconProps>;

interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "color"> {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
}

export {
  ArrowLeft,
  ArrowRight,
  Bold,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Check,
  ChevronDown,
  ChevronDown as ChevronDownIcon,
  ChevronLeft,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight,
  ChevronRight as ChevronRightIcon,
  ChevronUp,
  ChevronsUp,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Handshake,
  Ticket,
  Circle,
  Clock,
  Clock3,
  Columns2,
  Copy,
  ExternalLink,
  Eye,
  File,
  FileText,
  Flame,
  FolderTree,
  GalleryHorizontal,
  Globe,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Home,
  Image,
  Italic,
  Layers,
  LayoutDashboard,
  Link,
  Link2Off,
  FlaskConical,
  List,
  ListOrdered,
  LogIn,
  LogOut,
  Mail,
  LineChart,
  Globe2,
  MapPin,
  Megaphone,
  Menu,
  Minus,
  Headphones,
  Monitor,
  Moon,
  MoreHorizontal,
  MousePointerClick,
  MoveVertical,
  Newspaper,
  PanelLeft,
  Pencil,
  Plus,
  Quote,
  Redo,
  Redo as Redo2,
  Loader2,
  AlertTriangle,
  TriangleAlert,
  Rows,
  Save,
  Search,
  Send,
  Settings,
  Smartphone,
  Star,
  Sun,
  Tablet,
  Tags,
  Trash2,
  Type,
  Undo,
  Undo as Undo2,
  RotateCcw,
  Upload,
  User,
  UserRoundCheck,
  Users,
  MessagesSquare,
  Video,
  X,
  Lock,
  Palette,
  LayoutGrid,
  Sparkles,
  Shapes,
  SlidersHorizontal,
  UserPlus,
  PanelsTopLeft,
  CreditCard,
  Play,
  Pause,
  Mic,
  Film,
  Brush,
  ShieldCheck,
  Wand2,
  Share2,
  Gauge,
  Printer,
  Download,
  Facebook,
  Linkedin,
  Twitter,
  Instagram,
  Youtube,
  Folder,
  FolderOpen,
  FolderPlus,
  Info,
  MoreVertical,
  Scissors,
  ClipboardPaste,
  HandHeart,
  Heart,
  Target,
  TrendingUp,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Zap,
} from "lucide-react";
