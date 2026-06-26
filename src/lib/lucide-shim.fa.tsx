/**
 * Lazy Font Awesome glyph renderer. Loaded ONLY when the icon pack is switched
 * to "fontawesome" (the default is "lucide"), so @fortawesome never enters the
 * eager first-load bundle. lucide-shim.tsx dynamically imports this module's
 * default export and renders it inside a Suspense boundary.
 */
import { type CSSProperties, type SVGAttributes } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowLeft, faArrowRight, faBold, faCheck, faChevronDown, faChevronLeft,
  faChevronRight, faChevronUp, faCircle, faClock, faTableColumns, faCopy,
  faEye, faFile, faFileLines, faFire, faFolderTree, faImages, faGlobe,
  faGripVertical, faHeading, faHouse, faImage, faItalic, faLayerGroup,
  faGauge, faLink, faListUl, faListOl, faRightToBracket, faRightFromBracket,
  faEnvelope, faLocationDot, faBullhorn, faBars, faMinus, faDesktop, faMoon,
  faEllipsis, faHandPointer, faUpDown, faNewspaper, faPencil, faPlus, faBookmark, faBookOpen,
  faQuoteRight, faRotateRight, faGripLines, faFloppyDisk, faMagnifyingGlass,
  faPaperPlane, faGear, faMobileScreen, faStar, faSun, faTabletScreenButton,
  faTags, faTrashCan, faFont, faRotateLeft, faUpload, faUser, faUsers,
  faVideo, faXmark, faSpinner, faTriangleExclamation,
  faLock, faPalette, faTableCells, faWandMagicSparkles, faWindowMaximize, faCreditCard,
  faPlay, faPause, faBell, faCircleInfo,
  faMicrophone, faFilm, faPaintbrush, faRss, faShieldHalved, faGears, faWandSparkles, faShareNodes,
} from "@fortawesome/free-solid-svg-icons";
import {
  faFacebook, faInstagram, faLinkedin, faXTwitter, faYoutube,
} from "@fortawesome/free-brands-svg-icons";

// Map of icon export name -> Font Awesome definition. Keys mirror the exports in
// lucide-shim.tsx (the second argument passed to makeIcon).
const FA_MAP: Record<string, IconDefinition> = {
  ArrowLeft: faArrowLeft, ArrowRight: faArrowRight, Bold: faBold, Bookmark: faBookmark,
  BookmarkCheck: faBookmark, BookOpen: faBookOpen, Check: faCheck, ChevronDown: faChevronDown,
  ChevronLeft: faChevronLeft, ChevronRight: faChevronRight, ChevronUp: faChevronUp, Circle: faCircle,
  Clock: faClock, Columns2: faTableColumns, Copy: faCopy, Eye: faEye, File: faFile,
  FileText: faFileLines, Flame: faFire, FolderTree: faFolderTree, GalleryHorizontal: faImages,
  Globe: faGlobe, GripVertical: faGripVertical, Heading1: faHeading, Heading2: faHeading,
  Heading3: faHeading, Home: faHouse, Image: faImage, Italic: faItalic, Layers: faLayerGroup,
  LayoutDashboard: faGauge, Link: faLink, List: faListUl, ListOrdered: faListOl,
  LogIn: faRightToBracket, LogOut: faRightFromBracket, Mail: faEnvelope, MapPin: faLocationDot,
  Megaphone: faBullhorn, Menu: faBars, Minus: faMinus, Monitor: faDesktop, Moon: faMoon,
  MoreHorizontal: faEllipsis, MousePointerClick: faHandPointer, MoveVertical: faUpDown,
  Newspaper: faNewspaper, PanelLeft: faTableColumns, Pencil: faPencil, Plus: faPlus,
  Quote: faQuoteRight, Redo: faRotateRight, Loader2: faSpinner, AlertTriangle: faTriangleExclamation,
  Rows: faGripLines, Save: faFloppyDisk, Search: faMagnifyingGlass, Send: faPaperPlane,
  Settings: faGear, Smartphone: faMobileScreen, Star: faStar, Sun: faSun, Tablet: faTabletScreenButton,
  Tags: faTags, Trash2: faTrashCan, Type: faFont, Undo: faRotateLeft, Upload: faUpload,
  User: faUser, Users: faUsers, Video: faVideo, X: faXmark, Lock: faLock, Palette: faPalette,
  LayoutGrid: faTableCells, Sparkles: faWandMagicSparkles, PanelsTopLeft: faWindowMaximize,
  CreditCard: faCreditCard, Play: faPlay, Pause: faPause, Bell: faBell, Info: faCircleInfo,
  Mic: faMicrophone, Film: faFilm, Brush: faPaintbrush, Rss: faRss, ShieldCheck: faShieldHalved,
  Cog: faGears, Wand2: faWandSparkles, Share2: faShareNodes, Gauge: faGauge,
  Facebook: faFacebook, Instagram: faInstagram, Linkedin: faLinkedin, Twitter: faXTwitter,
  Youtube: faYoutube,
};

interface FaGlyphProps extends Omit<SVGAttributes<SVGSVGElement>, "color"> {
  name: string;
  size?: number | string;
  color?: string;
}

export default function FaGlyph({ name, size = 24, color, className, style, ...rest }: FaGlyphProps) {
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
  return (
    <FontAwesomeIcon
      icon={faDef}
      className={className}
      style={merged as CSSProperties & Record<`--fa-${string}`, string>}
      {...(rest as Record<string, unknown>)}
    />
  );
}
