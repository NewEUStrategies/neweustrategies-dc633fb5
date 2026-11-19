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
 */
import { type SVGAttributes } from "react";
import {
  ArrowLeft as LArrowLeft,
  ArrowRight as LArrowRight,
  Bold as LBold,
  Check as LCheck,
  ChevronDown as LChevronDown,
  ChevronLeft as LChevronLeft,
  ChevronRight as LChevronRight,
  ChevronUp as LChevronUp,
  ChevronsUp as LChevronsUp,
  CalendarCheck as LCalendarCheck,
  CalendarClock as LCalendarClock,
  CalendarDays as LCalendarDays,
  Handshake as LHandshake,
  Ticket as LTicket,
  Circle as LCircle,
  Clock as LClock,
  Columns2 as LColumns2,
  Copy as LCopy,
  ExternalLink as LExternalLink,
  Eye as LEye,
  File as LFile,
  FileText as LFileText,
  Flame as LFlame,
  FolderTree as LFolderTree,
  GalleryHorizontal as LGalleryHorizontal,
  Globe as LGlobe,
  GripVertical as LGripVertical,
  Headphones as LHeadphones,
  Heading1 as LHeading1,
  Heading2 as LHeading2,
  Heading3 as LHeading3,
  Home as LHome,
  Image as LImage,
  Italic as LItalic,
  Layers as LLayers,
  LayoutDashboard as LLayoutDashboard,
  Link as LLink,
  List as LList,
  ListOrdered as LListOrdered,
  LogIn as LLogIn,
  LogOut as LLogOut,
  Mail as LMail,
  LineChart as LLineChart,
  Globe2 as LGlobe2,
  MapPin as LMapPin,
  Megaphone as LMegaphone,
  Menu as LMenu,
  Minus as LMinus,
  Monitor as LMonitor,
  Moon as LMoon,
  MoreHorizontal as LMoreHorizontal,
  MousePointerClick as LMousePointerClick,
  MoveVertical as LMoveVertical,
  Newspaper as LNewspaper,
  PanelLeft as LPanelLeft,
  Pencil as LPencil,
  Plus as LPlus,
  Bookmark as LBookmark,
  BookmarkCheck as LBookmarkCheck,
  BookOpen as LBookOpen,
  Quote as LQuote,
  Redo as LRedo,
  Loader2 as LLoader2,
  AlertTriangle as LAlertTriangle,
  TriangleAlert as LTriangleAlert,
  Clock3 as LClock3,
  UserRoundCheck as LUserRoundCheck,
  Rows as LRows,
  Save as LSave,
  Search as LSearch,
  Send as LSend,
  Settings as LSettings,
  Smartphone as LSmartphone,
  Star as LStar,
  Sun as LSun,
  Tablet as LTablet,
  Tags as LTags,
  Trash2 as LTrash2,
  Type as LType,
  Undo as LUndo,
  Upload as LUpload,
  User as LUser,
  Users as LUsers,
  MessagesSquare as LMessagesSquare,
  Video as LVideo,
  X as LX,
  Lock as LLock,
  Palette as LPalette,
  LayoutGrid as LLayoutGrid,
  Sparkles as LSparkles,
  Shapes as LShapes,
  SlidersHorizontal as LSlidersHorizontal,
  UserPlus as LUserPlus,
  PanelsTopLeft as LPanelsTopLeft,
  CreditCard as LCreditCard,
  Play as LPlay,
  Pause as LPause,
  Mic as LMic,
  Film as LFilm,
  Brush as LBrush,
  ShieldCheck as LShieldCheck,
  Wand2 as LWand2,
  Share2 as LShare2,
  Gauge as LGauge,
  Link2Off as LLink2Off,
  FlaskConical as LFlaskConical,
  Printer as LPrinter,
  Download as LDownload,
  RotateCcw as LRotateCcw,
  Folder as LFolder,
  FolderOpen as LFolderOpen,
  FolderPlus as LFolderPlus,
  Info as LInfo,
  MoreVertical as LMoreVertical,
  Scissors as LScissors,
  ClipboardPaste as LClipboardPaste,
  HandHeart as LHandHeart,
  Heart as LHeart,
  Target as LTarget,
  TrendingUp as LTrendingUp,
  RefreshCw as LRefreshCw,
  CheckCircle2 as LCheckCircle2,
  XCircle as LXCircle,
  Zap as LZap,
  type LucideIcon as LucideIconImpl,
} from "lucide-react";
import {
  Facebook as LFacebook,
  Linkedin as LLinkedin,
  Twitter as LTwitter,
  Instagram as LInstagram,
  Youtube as LYoutube,
} from "@/lib/icons/brandIcons";

export type LucideIcon = React.FC<IconProps>;

interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "color"> {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
}

function makeIcon(LucideComp: LucideIconImpl | undefined): LucideIcon {
  // Runtime fallback: if a lucide export vanishes in a future version (common
  // for brand icons across major versions), render a neutral Circle glyph
  // instead of crashing the tree.
  return (LucideComp ?? LCircle) as unknown as LucideIcon;
}

// Each factory only creates its returned component; it does not register icons.
// Pure calls let the bundler remove unused wrappers and their Lucide imports.
// Solid
export const ArrowLeft = /* @__PURE__ */ makeIcon(LArrowLeft);
export const ArrowRight = /* @__PURE__ */ makeIcon(LArrowRight);
export const Bold = /* @__PURE__ */ makeIcon(LBold);
export const Bookmark = /* @__PURE__ */ makeIcon(LBookmark);
export const BookmarkCheck = /* @__PURE__ */ makeIcon(LBookmarkCheck);
export const BookOpen = /* @__PURE__ */ makeIcon(LBookOpen);
export const Check = /* @__PURE__ */ makeIcon(LCheck);
export const ChevronDown = /* @__PURE__ */ makeIcon(LChevronDown);
export const ChevronDownIcon = ChevronDown;
export const ChevronLeft = /* @__PURE__ */ makeIcon(LChevronLeft);
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRight = /* @__PURE__ */ makeIcon(LChevronRight);
export const ChevronRightIcon = ChevronRight;
export const ChevronUp = /* @__PURE__ */ makeIcon(LChevronUp);
export const ChevronsUp = /* @__PURE__ */ makeIcon(LChevronsUp);
export const CalendarCheck = /* @__PURE__ */ makeIcon(LCalendarCheck);
export const CalendarClock = /* @__PURE__ */ makeIcon(LCalendarClock);
export const CalendarDays = /* @__PURE__ */ makeIcon(LCalendarDays);
export const Handshake = /* @__PURE__ */ makeIcon(LHandshake);
export const Ticket = /* @__PURE__ */ makeIcon(LTicket);
export const Circle = /* @__PURE__ */ makeIcon(LCircle);
export const Clock = /* @__PURE__ */ makeIcon(LClock);
export const Clock3 = /* @__PURE__ */ makeIcon(LClock3);
export const Columns2 = /* @__PURE__ */ makeIcon(LColumns2);

export const Copy = /* @__PURE__ */ makeIcon(LCopy);
export const ExternalLink = /* @__PURE__ */ makeIcon(LExternalLink);
export const Eye = /* @__PURE__ */ makeIcon(LEye);
export const File = /* @__PURE__ */ makeIcon(LFile);
export const FileText = /* @__PURE__ */ makeIcon(LFileText);
export const Flame = /* @__PURE__ */ makeIcon(LFlame);
export const FolderTree = /* @__PURE__ */ makeIcon(LFolderTree);
export const GalleryHorizontal = /* @__PURE__ */ makeIcon(LGalleryHorizontal);
export const Globe = /* @__PURE__ */ makeIcon(LGlobe);
export const GripVertical = /* @__PURE__ */ makeIcon(LGripVertical);
export const Heading1 = /* @__PURE__ */ makeIcon(LHeading1);
export const Heading2 = /* @__PURE__ */ makeIcon(LHeading2);
export const Heading3 = /* @__PURE__ */ makeIcon(LHeading3);
export const Home = /* @__PURE__ */ makeIcon(LHome);
export const Image = /* @__PURE__ */ makeIcon(LImage);
export const Italic = /* @__PURE__ */ makeIcon(LItalic);
export const Layers = /* @__PURE__ */ makeIcon(LLayers);
export const LayoutDashboard = /* @__PURE__ */ makeIcon(LLayoutDashboard);
export const Link = /* @__PURE__ */ makeIcon(LLink);
export const Link2Off = /* @__PURE__ */ makeIcon(LLink2Off);
export const FlaskConical = /* @__PURE__ */ makeIcon(LFlaskConical);
export const List = /* @__PURE__ */ makeIcon(LList);
export const ListOrdered = /* @__PURE__ */ makeIcon(LListOrdered);
export const LogIn = /* @__PURE__ */ makeIcon(LLogIn);
export const LogOut = /* @__PURE__ */ makeIcon(LLogOut);
export const Mail = /* @__PURE__ */ makeIcon(LMail);
export const LineChart = /* @__PURE__ */ makeIcon(LLineChart);
export const Globe2 = /* @__PURE__ */ makeIcon(LGlobe2);
export const MapPin = /* @__PURE__ */ makeIcon(LMapPin);
export const Megaphone = /* @__PURE__ */ makeIcon(LMegaphone);
export const Menu = /* @__PURE__ */ makeIcon(LMenu);
export const Minus = /* @__PURE__ */ makeIcon(LMinus);
export const Headphones = /* @__PURE__ */ makeIcon(LHeadphones);
export const Monitor = /* @__PURE__ */ makeIcon(LMonitor);
export const Moon = /* @__PURE__ */ makeIcon(LMoon);
export const MoreHorizontal = /* @__PURE__ */ makeIcon(LMoreHorizontal);
export const MousePointerClick = /* @__PURE__ */ makeIcon(LMousePointerClick);
export const MoveVertical = /* @__PURE__ */ makeIcon(LMoveVertical);
export const Newspaper = /* @__PURE__ */ makeIcon(LNewspaper);
export const PanelLeft = /* @__PURE__ */ makeIcon(LPanelLeft);
export const Pencil = /* @__PURE__ */ makeIcon(LPencil);
export const Plus = /* @__PURE__ */ makeIcon(LPlus);
export const Quote = /* @__PURE__ */ makeIcon(LQuote);
export const Redo = /* @__PURE__ */ makeIcon(LRedo);
export const Redo2 = Redo;
export const Loader2 = /* @__PURE__ */ makeIcon(LLoader2);
export const AlertTriangle = /* @__PURE__ */ makeIcon(LAlertTriangle);
export const TriangleAlert = /* @__PURE__ */ makeIcon(LTriangleAlert);
export const Rows = /* @__PURE__ */ makeIcon(LRows);

export const Save = /* @__PURE__ */ makeIcon(LSave);
export const Search = /* @__PURE__ */ makeIcon(LSearch);
export const Send = /* @__PURE__ */ makeIcon(LSend);
export const Settings = /* @__PURE__ */ makeIcon(LSettings);
export const Smartphone = /* @__PURE__ */ makeIcon(LSmartphone);
export const Star = /* @__PURE__ */ makeIcon(LStar);
export const Sun = /* @__PURE__ */ makeIcon(LSun);
export const Tablet = /* @__PURE__ */ makeIcon(LTablet);
export const Tags = /* @__PURE__ */ makeIcon(LTags);
export const Trash2 = /* @__PURE__ */ makeIcon(LTrash2);
export const Type = /* @__PURE__ */ makeIcon(LType);
export const Undo = /* @__PURE__ */ makeIcon(LUndo);
export const Undo2 = Undo;
export const RotateCcw = /* @__PURE__ */ makeIcon(LRotateCcw);

export const Upload = /* @__PURE__ */ makeIcon(LUpload);
export const User = /* @__PURE__ */ makeIcon(LUser);
export const UserRoundCheck = /* @__PURE__ */ makeIcon(LUserRoundCheck);
export const Users = /* @__PURE__ */ makeIcon(LUsers);
export const MessagesSquare = /* @__PURE__ */ makeIcon(LMessagesSquare);

export const Video = /* @__PURE__ */ makeIcon(LVideo);
export const X = /* @__PURE__ */ makeIcon(LX);
export const Lock = /* @__PURE__ */ makeIcon(LLock);
export const Palette = /* @__PURE__ */ makeIcon(LPalette);
export const LayoutGrid = /* @__PURE__ */ makeIcon(LLayoutGrid);
export const Sparkles = /* @__PURE__ */ makeIcon(LSparkles);
export const Shapes = /* @__PURE__ */ makeIcon(LShapes);
export const SlidersHorizontal = /* @__PURE__ */ makeIcon(LSlidersHorizontal);
export const UserPlus = /* @__PURE__ */ makeIcon(LUserPlus);

export const PanelsTopLeft = /* @__PURE__ */ makeIcon(LPanelsTopLeft);
export const CreditCard = /* @__PURE__ */ makeIcon(LCreditCard);
export const Play = /* @__PURE__ */ makeIcon(LPlay);
export const Pause = /* @__PURE__ */ makeIcon(LPause);
export const Mic = /* @__PURE__ */ makeIcon(LMic);
export const Film = /* @__PURE__ */ makeIcon(LFilm);
export const Brush = /* @__PURE__ */ makeIcon(LBrush);
export const ShieldCheck = /* @__PURE__ */ makeIcon(LShieldCheck);
export const Wand2 = /* @__PURE__ */ makeIcon(LWand2);
export const Share2 = /* @__PURE__ */ makeIcon(LShare2);
export const Gauge = /* @__PURE__ */ makeIcon(LGauge);
export const Printer = /* @__PURE__ */ makeIcon(LPrinter);
export const Download = /* @__PURE__ */ makeIcon(LDownload);

// Brands. Kept behind makeIcon() so a future lucide-react release that drops
// any of these exports degrades to a neutral Circle glyph instead of a
// build-time TS2305 or a runtime crash.
export const Facebook = /* @__PURE__ */ makeIcon(LFacebook);
export const Linkedin = /* @__PURE__ */ makeIcon(LLinkedin);
export const Twitter = /* @__PURE__ */ makeIcon(LTwitter);
export const Instagram = /* @__PURE__ */ makeIcon(LInstagram);
export const Youtube = /* @__PURE__ */ makeIcon(LYoutube);
// No brand alias registry here on purpose: this module's namespace stays
// a flat map of icon components (many call sites cast
// `import * as Icons from "@/lib/lucide-shim"` to Record<string, IconComp>).

// Files/folders extras
export const Folder = /* @__PURE__ */ makeIcon(LFolder);
export const FolderOpen = /* @__PURE__ */ makeIcon(LFolderOpen);
export const FolderPlus = /* @__PURE__ */ makeIcon(LFolderPlus);
export const Info = /* @__PURE__ */ makeIcon(LInfo);
export const MoreVertical = /* @__PURE__ */ makeIcon(LMoreVertical);
export const Scissors = /* @__PURE__ */ makeIcon(LScissors);
export const ClipboardPaste = /* @__PURE__ */ makeIcon(LClipboardPaste);
export const HandHeart = /* @__PURE__ */ makeIcon(LHandHeart);
export const Heart = /* @__PURE__ */ makeIcon(LHeart);
export const Target = /* @__PURE__ */ makeIcon(LTarget);
export const TrendingUp = /* @__PURE__ */ makeIcon(LTrendingUp);
export const RefreshCw = /* @__PURE__ */ makeIcon(LRefreshCw);
export const CheckCircle2 = /* @__PURE__ */ makeIcon(LCheckCircle2);
export const XCircle = /* @__PURE__ */ makeIcon(LXCircle);
export const Zap = /* @__PURE__ */ makeIcon(LZap);
