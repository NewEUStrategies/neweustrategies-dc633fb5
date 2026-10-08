/**
 * Lazy Font Awesome glyph renderer. Loaded ONLY when the icon pack is switched
 * to "fontawesome" (the default is "lucide"), so @fortawesome never enters the
 * eager first-load bundle. lucide-shim.tsx dynamically imports this module's
 * default export and renders it inside a Suspense boundary.
 *
 * Definicje ikon rysujemy sami, bez `FontAwesomeIcon`. Komponent wciągał
 * `@fortawesome/fontawesome-svg-core` (~138 kB przed minifikacją: parser
 * transformacji, maski, warstwy, animacje, ~10 kB wstrzykiwanego CSS) tylko po
 * to, żeby z `[szerokość, wysokość, , , ścieżka]` zrobić `<svg><path/></svg>`.
 * Markup jest identyczny z tym, co renderował `FontAwesomeIcon` 3.5 (te same
 * atrybuty i ich kolejność, `aria-hidden` jak w bibliotece, `title` pomijany jak
 * tam), a jedyna reguła CSS rdzenia, która dotyczy tych ikon, trafia do
 * dokumentu tym samym mechanizmem co w `insertCss` rdzenia - patrz niżej.
 */
import { type CSSProperties, type SVGAttributes } from "react";
import {
  faArrowLeft,
  faArrowRight,
  faBold,
  faCheck,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faChevronUp,
  faAnglesUp,
  faCalendarDays,
  faCalendarCheck,
  faHandshake,
  faTicket,
  faCircle,
  faClock,
  faTableColumns,
  faCopy,
  faEye,
  faFile,
  faFileLines,
  faFire,
  faFolderTree,
  faImages,
  faGlobe,
  faGripVertical,
  faHeading,
  faHouse,
  faImage,
  faItalic,
  faLayerGroup,
  faGauge,
  faLink,
  faListUl,
  faListOl,
  faRightToBracket,
  faRightFromBracket,
  faEnvelope,
  faChartLine,
  faEarthEurope,
  faLocationDot,
  faBullhorn,
  faBars,
  faMinus,
  faDesktop,
  faHeadphones,
  faMoon,
  faEllipsis,
  faHandPointer,
  faUpDown,
  faNewspaper,
  faPencil,
  faPlus,
  faBookmark,
  faBookOpen,
  faQuoteRight,
  faRotateRight,
  faGripLines,
  faFloppyDisk,
  faMagnifyingGlass,
  faPaperPlane,
  faGear,
  faMobileScreen,
  faStar,
  faSun,
  faTabletScreenButton,
  faTags,
  faTrashCan,
  faFont,
  faRotateLeft,
  faUpload,
  faUser,
  faUsers,
  faVideo,
  faXmark,
  faSpinner,
  faTriangleExclamation,
  faBolt,
  faLock,
  faPalette,
  faTableCells,
  faWandMagicSparkles,
  faWindowMaximize,
  faCreditCard,
  faPlay,
  faPause,
  faBell,
  faCircleInfo,
  faMicrophone,
  faFilm,
  faPaintbrush,
  faRss,
  faShieldHalved,
  faGears,
  faWandSparkles,
  faShareNodes,
  faPrint,
  faDownload,
  faLinkSlash,
  faFlask,
} from "@fortawesome/free-solid-svg-icons";
import {
  faFacebook,
  faInstagram,
  faLinkedin,
  faXTwitter,
  faYoutube,
} from "@fortawesome/free-brands-svg-icons";

// Map of icon export name -> Font Awesome definition. Keys mirror the exports in
// lucide-shim.tsx (the second argument passed to makeIcon).
/** `IconDefinition` z `@fortawesome/fontawesome-common-types`, bez importu pakietu tranzytywnego. */
type IconDefinition = typeof faHouse;

const FA_MAP: Record<string, IconDefinition> = {
  ArrowLeft: faArrowLeft,
  ArrowRight: faArrowRight,
  Bold: faBold,
  Bookmark: faBookmark,
  BookmarkCheck: faBookmark,
  BookOpen: faBookOpen,
  Check: faCheck,
  ChevronDown: faChevronDown,
  ChevronLeft: faChevronLeft,
  ChevronRight: faChevronRight,
  ChevronUp: faChevronUp,
  ChevronsUp: faAnglesUp,
  Circle: faCircle,
  CalendarCheck: faCalendarCheck,
  CalendarClock: faCalendarDays,
  CalendarDays: faCalendarDays,
  Handshake: faHandshake,
  Ticket: faTicket,
  Clock: faClock,
  Columns2: faTableColumns,
  Copy: faCopy,
  Eye: faEye,
  File: faFile,
  FileText: faFileLines,
  Flame: faFire,
  FolderTree: faFolderTree,
  GalleryHorizontal: faImages,
  Globe: faGlobe,
  GripVertical: faGripVertical,
  Heading1: faHeading,
  Heading2: faHeading,
  Heading3: faHeading,
  Home: faHouse,
  Image: faImage,
  Italic: faItalic,
  Layers: faLayerGroup,
  LayoutDashboard: faGauge,
  Link: faLink,
  List: faListUl,
  ListOrdered: faListOl,
  LogIn: faRightToBracket,
  LogOut: faRightFromBracket,
  Mail: faEnvelope,
  LineChart: faChartLine,
  Globe2: faEarthEurope,
  MapPin: faLocationDot,
  Megaphone: faBullhorn,
  Menu: faBars,
  Minus: faMinus,
  Headphones: faHeadphones,
  Monitor: faDesktop,
  Moon: faMoon,
  MoreHorizontal: faEllipsis,
  MousePointerClick: faHandPointer,
  MoveVertical: faUpDown,
  Newspaper: faNewspaper,
  PanelLeft: faTableColumns,
  Pencil: faPencil,
  Plus: faPlus,
  Quote: faQuoteRight,
  Redo: faRotateRight,
  Loader2: faSpinner,
  AlertTriangle: faTriangleExclamation,
  Rows: faGripLines,
  Save: faFloppyDisk,
  Search: faMagnifyingGlass,
  Send: faPaperPlane,
  Settings: faGear,
  Smartphone: faMobileScreen,
  Star: faStar,
  Sun: faSun,
  Tablet: faTabletScreenButton,
  Tags: faTags,
  Trash2: faTrashCan,
  Type: faFont,
  Undo: faRotateLeft,
  Upload: faUpload,
  User: faUser,
  Users: faUsers,
  Video: faVideo,
  X: faXmark,
  Lock: faLock,
  Palette: faPalette,
  LayoutGrid: faTableCells,
  Sparkles: faWandMagicSparkles,
  PanelsTopLeft: faWindowMaximize,
  CreditCard: faCreditCard,
  Play: faPlay,
  Pause: faPause,
  Bell: faBell,
  Info: faCircleInfo,
  Mic: faMicrophone,
  Film: faFilm,
  Brush: faPaintbrush,
  Rss: faRss,
  ShieldCheck: faShieldHalved,
  Cog: faGears,
  Wand2: faWandSparkles,
  Share2: faShareNodes,
  Gauge: faGauge,
  Printer: faPrint,
  Download: faDownload,
  Link2Off: faLinkSlash,
  FlaskConical: faFlask,
  Zap: faBolt,
  Facebook: faFacebook,
  Instagram: faInstagram,
  Linkedin: faLinkedin,
  Twitter: faXTwitter,
  Youtube: faYoutube,
};

// Reguła bazowa z CSS, które `fontawesome-svg-core` 7.3 wstrzykiwał przy
// załadowaniu modułu (`autoAddCss`). Z całego arkusza rdzenia tylko ona trafia
// w te ikony: rozmiar i `vertical-align` i tak nadpisuje styl inline niżej, ale
// `display`, `overflow` i `box-sizing` zostają z niej. Wstawiamy ją tak jak
// rdzeń - PRZED pierwszy `<style>`/`<link>` w `<head>` - więc w kaskadzie
// przegrywa z każdą regułą aplikacji o tej samej specyficzności, dokładnie jak
// dotąd. Moduł ładuje się tylko w paczce „fontawesome", więc reguła też.
const FA_BASE_CSS =
  ".svg-inline--fa{box-sizing:content-box;display:var(--fa-display,inline-block);height:1em;overflow:visible;vertical-align:-.125em;width:var(--fa-width,1.25em)}";

if (typeof document !== "undefined" && document.head) {
  const style = document.createElement("style");
  style.setAttribute("type", "text/css");
  style.textContent = FA_BASE_CSS;
  const first = Array.from(document.head.childNodes).find((node) =>
    ["STYLE", "LINK"].includes(((node as Element).tagName || "").toUpperCase()),
  );
  document.head.insertBefore(style, first ?? null);
}

interface FaGlyphProps extends Omit<SVGAttributes<SVGSVGElement>, "color"> {
  name: string;
  size?: number | string;
  color?: string;
  /** Przyjmowany i pomijany, jak w `FontAwesomeIcon` 3.5 (bez `<title>`). */
  title?: string;
}

export default function FaGlyph({
  name,
  size = 24,
  color,
  className,
  style,
  role,
  title: _title,
  "aria-hidden": ariaHiddenProp,
  ...rest
}: FaGlyphProps) {
  const faDef = FA_MAP[name];
  if (!faDef) return null;
  // FA glyphs read larger than Lucide's stroked icons at the same box size;
  // scale to ~72% so they balance as drop-in replacements (matches the legacy shim).
  const scaled = typeof size === "number" ? Math.round(size * 0.72) : size;
  const merged: CSSProperties = {
    width: typeof scaled === "number" ? `${scaled}px` : scaled,
    height: typeof scaled === "number" ? `${scaled}px` : scaled,
    fontSize: typeof scaled === "number" ? `${scaled}px` : scaled,
    color,
    verticalAlign: "middle",
    ...style,
  };
  const [width, height, , , pathData] = faDef.icon;
  // Jak w `FontAwesomeIcon`: domyślnie ukryta dla czytników, chyba że wołający
  // podał `aria-label` (wtedy zawsze "false") albo jawne `aria-hidden`.
  const ariaHidden = rest["aria-label"] ? "false" : (ariaHiddenProp ?? "true");
  return (
    <svg
      data-prefix={faDef.prefix}
      data-icon={faDef.iconName}
      className={`svg-inline--fa fa-${faDef.iconName}${className ? ` ${className}` : ""}`}
      role={role ?? "img"}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden={ariaHidden}
      style={merged}
      {...rest}
    >
      {Array.isArray(pathData) ? (
        <g className="fa-duotone-group">
          <path className="fa-secondary" fill="currentColor" d={pathData[0]} />
          <path className="fa-primary" fill="currentColor" d={pathData[1]} />
        </g>
      ) : (
        <path fill="currentColor" d={pathData} />
      )}
    </svg>
  );
}
