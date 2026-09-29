/**
 * Drop-in icon API. Renders Lucide by default; switches to Font Awesome
 * when the icon pack is set to "fontawesome" via @/lib/iconPack.
 * Keeps the same PascalCase exports used across the app.
 *
 * Font Awesome is lazy-loaded (./lucide-shim.fa) only when the pack is
 * "fontawesome" (default is lucide), so @fortawesome never enters the eager
 * first-load bundle.
 */
import { forwardRef, lazy, Suspense, type SVGAttributes } from "react";
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
  Facebook as LFacebook,
  Linkedin as LLinkedin,
  Twitter as LTwitter,
  Instagram as LInstagram,
  Youtube as LYoutube,
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
import { useIconPack } from "@/lib/iconPack";

// Font Awesome renderer is split into its own lazy chunk; only fetched when a
// glyph actually renders under the "fontawesome" pack.
const FaGlyph = lazy(() => import("./lucide-shim.fa"));

export type LucideIcon = React.FC<IconProps>;

interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "color"> {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
}

function makeIcon(faName: string, LucideComp: LucideIconImpl | undefined): LucideIcon {
  // Runtime fallback: if a lucide export vanishes in a future version (common
  // for brand icons across major versions), render a neutral Circle glyph
  // instead of crashing the tree.
  const Resolved: LucideIconImpl = (LucideComp ?? LCircle) as LucideIconImpl;
  const Comp = forwardRef<SVGSVGElement, IconProps>(
    (
      { size = 24, color, className, style, strokeWidth, absoluteStrokeWidth: _abs, ...rest },
      ref,
    ) => {
      const pack = useIconPack();
      if (pack === "lucide") {
        return (
          <Resolved
            size={size}
            color={color}
            strokeWidth={strokeWidth as number | undefined}
            className={className}
            style={style}
            {...(rest as Record<string, unknown>)}
            ref={ref as unknown as React.Ref<SVGSVGElement>}
          />
        );
      }
      // Font Awesome pack: render the lazily-loaded glyph by name. The chunk is
      // fetched on demand; until then nothing renders (icons are non-blocking).
      return (
        <Suspense fallback={null}>
          <FaGlyph
            name={faName}
            size={size}
            color={color}
            className={className}
            style={style}
            {...(rest as Record<string, unknown>)}
          />
        </Suspense>
      );
    },
  );
  Comp.displayName = `Icon(${faName})`;
  return Comp as LucideIcon;
}

// Each factory only creates its returned component; it does not register icons.
// Pure calls let Rollup remove unused wrappers and their Lucide imports.
// Solid
export const ArrowLeft = /* @__PURE__ */ makeIcon("ArrowLeft", LArrowLeft);
export const ArrowRight = /* @__PURE__ */ makeIcon("ArrowRight", LArrowRight);
export const Bold = /* @__PURE__ */ makeIcon("Bold", LBold);
export const Bookmark = /* @__PURE__ */ makeIcon("Bookmark", LBookmark);
export const BookmarkCheck = /* @__PURE__ */ makeIcon("BookmarkCheck", LBookmarkCheck);
export const BookOpen = /* @__PURE__ */ makeIcon("BookOpen", LBookOpen);
export const Check = /* @__PURE__ */ makeIcon("Check", LCheck);
export const ChevronDown = /* @__PURE__ */ makeIcon("ChevronDown", LChevronDown);
export const ChevronDownIcon = ChevronDown;
export const ChevronLeft = /* @__PURE__ */ makeIcon("ChevronLeft", LChevronLeft);
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRight = /* @__PURE__ */ makeIcon("ChevronRight", LChevronRight);
export const ChevronRightIcon = ChevronRight;
export const ChevronUp = /* @__PURE__ */ makeIcon("ChevronUp", LChevronUp);
export const ChevronsUp = /* @__PURE__ */ makeIcon("ChevronsUp", LChevronsUp);
export const CalendarCheck = /* @__PURE__ */ makeIcon("CalendarCheck", LCalendarCheck);
export const CalendarClock = /* @__PURE__ */ makeIcon("CalendarClock", LCalendarClock);
export const CalendarDays = /* @__PURE__ */ makeIcon("CalendarDays", LCalendarDays);
export const Handshake = /* @__PURE__ */ makeIcon("Handshake", LHandshake);
export const Ticket = /* @__PURE__ */ makeIcon("Ticket", LTicket);
export const Circle = /* @__PURE__ */ makeIcon("Circle", LCircle);
export const Clock = /* @__PURE__ */ makeIcon("Clock", LClock);
export const Clock3 = /* @__PURE__ */ makeIcon("Clock3", LClock3);
export const Columns2 = /* @__PURE__ */ makeIcon("Columns2", LColumns2);

export const Copy = /* @__PURE__ */ makeIcon("Copy", LCopy);
export const ExternalLink = /* @__PURE__ */ makeIcon("ExternalLink", LExternalLink);
export const Eye = /* @__PURE__ */ makeIcon("Eye", LEye);
export const File = /* @__PURE__ */ makeIcon("File", LFile);
export const FileText = /* @__PURE__ */ makeIcon("FileText", LFileText);
export const Flame = /* @__PURE__ */ makeIcon("Flame", LFlame);
export const FolderTree = /* @__PURE__ */ makeIcon("FolderTree", LFolderTree);
export const GalleryHorizontal = /* @__PURE__ */ makeIcon("GalleryHorizontal", LGalleryHorizontal);
export const Globe = /* @__PURE__ */ makeIcon("Globe", LGlobe);
export const GripVertical = /* @__PURE__ */ makeIcon("GripVertical", LGripVertical);
export const Heading1 = /* @__PURE__ */ makeIcon("Heading1", LHeading1);
export const Heading2 = /* @__PURE__ */ makeIcon("Heading2", LHeading2);
export const Heading3 = /* @__PURE__ */ makeIcon("Heading3", LHeading3);
export const Home = /* @__PURE__ */ makeIcon("Home", LHome);
export const Image = /* @__PURE__ */ makeIcon("Image", LImage);
export const Italic = /* @__PURE__ */ makeIcon("Italic", LItalic);
export const Layers = /* @__PURE__ */ makeIcon("Layers", LLayers);
export const LayoutDashboard = /* @__PURE__ */ makeIcon("LayoutDashboard", LLayoutDashboard);
export const Link = /* @__PURE__ */ makeIcon("Link", LLink);
export const Link2Off = /* @__PURE__ */ makeIcon("Link2Off", LLink2Off);
export const FlaskConical = /* @__PURE__ */ makeIcon("FlaskConical", LFlaskConical);
export const List = /* @__PURE__ */ makeIcon("List", LList);
export const ListOrdered = /* @__PURE__ */ makeIcon("ListOrdered", LListOrdered);
export const LogIn = /* @__PURE__ */ makeIcon("LogIn", LLogIn);
export const LogOut = /* @__PURE__ */ makeIcon("LogOut", LLogOut);
export const Mail = /* @__PURE__ */ makeIcon("Mail", LMail);
export const LineChart = /* @__PURE__ */ makeIcon("LineChart", LLineChart);
export const Globe2 = /* @__PURE__ */ makeIcon("Globe2", LGlobe2);
export const MapPin = /* @__PURE__ */ makeIcon("MapPin", LMapPin);
export const Megaphone = /* @__PURE__ */ makeIcon("Megaphone", LMegaphone);
export const Menu = /* @__PURE__ */ makeIcon("Menu", LMenu);
export const Minus = /* @__PURE__ */ makeIcon("Minus", LMinus);
export const Headphones = /* @__PURE__ */ makeIcon("Headphones", LHeadphones);
export const Monitor = /* @__PURE__ */ makeIcon("Monitor", LMonitor);
export const Moon = /* @__PURE__ */ makeIcon("Moon", LMoon);
export const MoreHorizontal = /* @__PURE__ */ makeIcon("MoreHorizontal", LMoreHorizontal);
export const MousePointerClick = /* @__PURE__ */ makeIcon("MousePointerClick", LMousePointerClick);
export const MoveVertical = /* @__PURE__ */ makeIcon("MoveVertical", LMoveVertical);
export const Newspaper = /* @__PURE__ */ makeIcon("Newspaper", LNewspaper);
export const PanelLeft = /* @__PURE__ */ makeIcon("PanelLeft", LPanelLeft);
export const Pencil = /* @__PURE__ */ makeIcon("Pencil", LPencil);
export const Plus = /* @__PURE__ */ makeIcon("Plus", LPlus);
export const Quote = /* @__PURE__ */ makeIcon("Quote", LQuote);
export const Redo = /* @__PURE__ */ makeIcon("Redo", LRedo);
export const Redo2 = Redo;
export const Loader2 = /* @__PURE__ */ makeIcon("Loader2", LLoader2);
export const AlertTriangle = /* @__PURE__ */ makeIcon("AlertTriangle", LAlertTriangle);
export const TriangleAlert = /* @__PURE__ */ makeIcon("TriangleAlert", LTriangleAlert);
export const Rows = /* @__PURE__ */ makeIcon("Rows", LRows);

export const Save = /* @__PURE__ */ makeIcon("Save", LSave);
export const Search = /* @__PURE__ */ makeIcon("Search", LSearch);
export const Send = /* @__PURE__ */ makeIcon("Send", LSend);
export const Settings = /* @__PURE__ */ makeIcon("Settings", LSettings);
export const Smartphone = /* @__PURE__ */ makeIcon("Smartphone", LSmartphone);
export const Star = /* @__PURE__ */ makeIcon("Star", LStar);
export const Sun = /* @__PURE__ */ makeIcon("Sun", LSun);
export const Tablet = /* @__PURE__ */ makeIcon("Tablet", LTablet);
export const Tags = /* @__PURE__ */ makeIcon("Tags", LTags);
export const Trash2 = /* @__PURE__ */ makeIcon("Trash2", LTrash2);
export const Type = /* @__PURE__ */ makeIcon("Type", LType);
export const Undo = /* @__PURE__ */ makeIcon("Undo", LUndo);
export const Undo2 = Undo;
export const RotateCcw = /* @__PURE__ */ makeIcon("RotateCcw", LRotateCcw);

export const Upload = /* @__PURE__ */ makeIcon("Upload", LUpload);
export const User = /* @__PURE__ */ makeIcon("User", LUser);
export const UserRoundCheck = /* @__PURE__ */ makeIcon("UserRoundCheck", LUserRoundCheck);
export const Users = /* @__PURE__ */ makeIcon("Users", LUsers);
export const MessagesSquare = /* @__PURE__ */ makeIcon("MessagesSquare", LMessagesSquare);

export const Video = /* @__PURE__ */ makeIcon("Video", LVideo);
export const X = /* @__PURE__ */ makeIcon("X", LX);
export const Lock = /* @__PURE__ */ makeIcon("Lock", LLock);
export const Palette = /* @__PURE__ */ makeIcon("Palette", LPalette);
export const LayoutGrid = /* @__PURE__ */ makeIcon("LayoutGrid", LLayoutGrid);
export const Sparkles = /* @__PURE__ */ makeIcon("Sparkles", LSparkles);
export const Shapes = /* @__PURE__ */ makeIcon("Shapes", LShapes);
export const SlidersHorizontal = /* @__PURE__ */ makeIcon("SlidersHorizontal", LSlidersHorizontal);
export const UserPlus = /* @__PURE__ */ makeIcon("UserPlus", LUserPlus);

export const PanelsTopLeft = /* @__PURE__ */ makeIcon("PanelsTopLeft", LPanelsTopLeft);
export const CreditCard = /* @__PURE__ */ makeIcon("CreditCard", LCreditCard);
export const Play = /* @__PURE__ */ makeIcon("Play", LPlay);
export const Pause = /* @__PURE__ */ makeIcon("Pause", LPause);
export const Mic = /* @__PURE__ */ makeIcon("Mic", LMic);
export const Film = /* @__PURE__ */ makeIcon("Film", LFilm);
export const Brush = /* @__PURE__ */ makeIcon("Brush", LBrush);
export const ShieldCheck = /* @__PURE__ */ makeIcon("ShieldCheck", LShieldCheck);
export const Wand2 = /* @__PURE__ */ makeIcon("Wand2", LWand2);
export const Share2 = /* @__PURE__ */ makeIcon("Share2", LShare2);
export const Gauge = /* @__PURE__ */ makeIcon("Gauge", LGauge);
export const Printer = /* @__PURE__ */ makeIcon("Printer", LPrinter);
export const Download = /* @__PURE__ */ makeIcon("Download", LDownload);

// Brands. Kept behind makeIcon() so a future lucide-react release that drops
// any of these exports degrades to a neutral Circle glyph instead of a
// build-time TS2305 or a runtime crash.
export const Facebook = /* @__PURE__ */ makeIcon("Facebook", LFacebook);
export const Linkedin = /* @__PURE__ */ makeIcon("Linkedin", LLinkedin);
export const Twitter = /* @__PURE__ */ makeIcon("Twitter", LTwitter);
export const Instagram = /* @__PURE__ */ makeIcon("Instagram", LInstagram);
export const Youtube = /* @__PURE__ */ makeIcon("Youtube", LYoutube);
// Brand alias registry lives in ./brandIconRegistry to keep this module's
// namespace as a flat map of icon components (many call sites cast
// `import * as Icons from "@/lib/lucide-shim"` to Record<string, IconComp>).

// Files/folders extras
export const Folder = /* @__PURE__ */ makeIcon("Folder", LFolder);
export const FolderOpen = /* @__PURE__ */ makeIcon("FolderOpen", LFolderOpen);
export const FolderPlus = /* @__PURE__ */ makeIcon("FolderPlus", LFolderPlus);
export const Info = /* @__PURE__ */ makeIcon("Info", LInfo);
export const MoreVertical = /* @__PURE__ */ makeIcon("MoreVertical", LMoreVertical);
export const Scissors = /* @__PURE__ */ makeIcon("Scissors", LScissors);
export const ClipboardPaste = /* @__PURE__ */ makeIcon("ClipboardPaste", LClipboardPaste);
export const HandHeart = /* @__PURE__ */ makeIcon("HandHeart", LHandHeart);
export const Heart = /* @__PURE__ */ makeIcon("Heart", LHeart);
export const Target = /* @__PURE__ */ makeIcon("Target", LTarget);
export const TrendingUp = /* @__PURE__ */ makeIcon("TrendingUp", LTrendingUp);
export const RefreshCw = /* @__PURE__ */ makeIcon("RefreshCw", LRefreshCw);
export const CheckCircle2 = /* @__PURE__ */ makeIcon("CheckCircle2", LCheckCircle2);
export const XCircle = /* @__PURE__ */ makeIcon("XCircle", LXCircle);
export const Zap = /* @__PURE__ */ makeIcon("Zap", LZap);
