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
  ArrowLeft as LArrowLeft, ArrowRight as LArrowRight, Bold as LBold, Check as LCheck,
  ChevronDown as LChevronDown, ChevronLeft as LChevronLeft, ChevronRight as LChevronRight,
  ChevronUp as LChevronUp, Circle as LCircle, Clock as LClock, Columns2 as LColumns2,
  Copy as LCopy, Eye as LEye, File as LFile, FileText as LFileText, Flame as LFlame,
  FolderTree as LFolderTree, GalleryHorizontal as LGalleryHorizontal, Globe as LGlobe,
  GripVertical as LGripVertical, Heading1 as LHeading1, Heading2 as LHeading2,
  Heading3 as LHeading3, Home as LHome, Image as LImage, Italic as LItalic,
  Layers as LLayers, LayoutDashboard as LLayoutDashboard, Link as LLink, List as LList,
  ListOrdered as LListOrdered, LogIn as LLogIn, LogOut as LLogOut, Mail as LMail,
  MapPin as LMapPin, Megaphone as LMegaphone, Menu as LMenu, Minus as LMinus,
  Monitor as LMonitor, Moon as LMoon, MoreHorizontal as LMoreHorizontal,
  MousePointerClick as LMousePointerClick, MoveVertical as LMoveVertical,
  Newspaper as LNewspaper, PanelLeft as LPanelLeft, Pencil as LPencil, Plus as LPlus,
  Bookmark as LBookmark, BookmarkCheck as LBookmarkCheck, BookOpen as LBookOpen,
  Quote as LQuote, Redo as LRedo, Loader2 as LLoader2, AlertTriangle as LAlertTriangle,
  Rows as LRows, Save as LSave, Search as LSearch, Send as LSend, Settings as LSettings,
  Smartphone as LSmartphone, Star as LStar, Sun as LSun, Tablet as LTablet, Tags as LTags,
  Trash2 as LTrash2, Type as LType, Undo as LUndo, Upload as LUpload, User as LUser,
  Users as LUsers, Video as LVideo, X as LX,
  Lock as LLock, Palette as LPalette, LayoutGrid as LLayoutGrid, Sparkles as LSparkles, Shapes as LShapes,
  SlidersHorizontal as LSlidersHorizontal, UserPlus as LUserPlus,

  PanelsTopLeft as LPanelsTopLeft, CreditCard as LCreditCard, Play as LPlay, Pause as LPause,
  Bell as LBell, Info as LInfo,
  Mic as LMic, Film as LFilm, Brush as LBrush, Rss as LRss, ShieldCheck as LShieldCheck,
  Cog as LCog, Wand2 as LWand2, Share2 as LShare2, Gauge as LGauge,
  Printer as LPrinter, Download as LDownload, RotateCcw as LRotateCcw,
  Facebook as LFacebook, Instagram as LInstagram, Linkedin as LLinkedin,
  Twitter as LTwitter, Youtube as LYoutube,
  type LucideIcon as LucideIconImpl,
} from "lucide-react";
import { useIconPack } from "@/lib/iconPack";

// Font Awesome renderer is split into its own lazy chunk; only fetched when a
// glyph actually renders under the "fontawesome" pack.
const FaGlyph = lazy(() => import("./lucide-shim.fa"));

export type LucideIcon = React.FC<IconProps>;

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "color"> {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
}

function makeIcon(faName: string, LucideComp: LucideIconImpl): LucideIcon {
  const Comp = forwardRef<SVGSVGElement, IconProps>(
    ({ size = 24, color, className, style, strokeWidth, absoluteStrokeWidth: _abs, ...rest }, ref) => {
      const pack = useIconPack();
      if (pack === "lucide") {
        return (
          <LucideComp
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
          <FaGlyph name={faName} size={size} color={color} className={className} style={style} {...(rest as Record<string, unknown>)} />
        </Suspense>
      );
    },
  );
  Comp.displayName = `Icon(${faName})`;
  return Comp as LucideIcon;
}

// Solid
export const ArrowLeft = makeIcon("ArrowLeft", LArrowLeft);
export const ArrowRight = makeIcon("ArrowRight", LArrowRight);
export const Bold = makeIcon("Bold", LBold);
export const Bookmark = makeIcon("Bookmark", LBookmark);
export const BookmarkCheck = makeIcon("BookmarkCheck", LBookmarkCheck);
export const BookOpen = makeIcon("BookOpen", LBookOpen);
export const Check = makeIcon("Check", LCheck);
export const ChevronDown = makeIcon("ChevronDown", LChevronDown);
export const ChevronDownIcon = ChevronDown;
export const ChevronLeft = makeIcon("ChevronLeft", LChevronLeft);
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRight = makeIcon("ChevronRight", LChevronRight);
export const ChevronRightIcon = ChevronRight;
export const ChevronUp = makeIcon("ChevronUp", LChevronUp);
export const Circle = makeIcon("Circle", LCircle);
export const Clock = makeIcon("Clock", LClock);
export const Columns2 = makeIcon("Columns2", LColumns2);
export const Copy = makeIcon("Copy", LCopy);
export const Eye = makeIcon("Eye", LEye);
export const File = makeIcon("File", LFile);
export const FileText = makeIcon("FileText", LFileText);
export const Flame = makeIcon("Flame", LFlame);
export const FolderTree = makeIcon("FolderTree", LFolderTree);
export const GalleryHorizontal = makeIcon("GalleryHorizontal", LGalleryHorizontal);
export const Globe = makeIcon("Globe", LGlobe);
export const GripVertical = makeIcon("GripVertical", LGripVertical);
export const Heading1 = makeIcon("Heading1", LHeading1);
export const Heading2 = makeIcon("Heading2", LHeading2);
export const Heading3 = makeIcon("Heading3", LHeading3);
export const Home = makeIcon("Home", LHome);
export const Image = makeIcon("Image", LImage);
export const Italic = makeIcon("Italic", LItalic);
export const Layers = makeIcon("Layers", LLayers);
export const LayoutDashboard = makeIcon("LayoutDashboard", LLayoutDashboard);
export const Link = makeIcon("Link", LLink);
export const List = makeIcon("List", LList);
export const ListOrdered = makeIcon("ListOrdered", LListOrdered);
export const LogIn = makeIcon("LogIn", LLogIn);
export const LogOut = makeIcon("LogOut", LLogOut);
export const Mail = makeIcon("Mail", LMail);
export const MapPin = makeIcon("MapPin", LMapPin);
export const Megaphone = makeIcon("Megaphone", LMegaphone);
export const Menu = makeIcon("Menu", LMenu);
export const Minus = makeIcon("Minus", LMinus);
export const Monitor = makeIcon("Monitor", LMonitor);
export const Moon = makeIcon("Moon", LMoon);
export const MoreHorizontal = makeIcon("MoreHorizontal", LMoreHorizontal);
export const MousePointerClick = makeIcon("MousePointerClick", LMousePointerClick);
export const MoveVertical = makeIcon("MoveVertical", LMoveVertical);
export const Newspaper = makeIcon("Newspaper", LNewspaper);
export const PanelLeft = makeIcon("PanelLeft", LPanelLeft);
export const Pencil = makeIcon("Pencil", LPencil);
export const Plus = makeIcon("Plus", LPlus);
export const Quote = makeIcon("Quote", LQuote);
export const Redo = makeIcon("Redo", LRedo);
export const Redo2 = Redo;
export const Loader2 = makeIcon("Loader2", LLoader2);
export const AlertTriangle = makeIcon("AlertTriangle", LAlertTriangle);
export const Rows = makeIcon("Rows", LRows);
export const Save = makeIcon("Save", LSave);
export const Search = makeIcon("Search", LSearch);
export const Send = makeIcon("Send", LSend);
export const Settings = makeIcon("Settings", LSettings);
export const Smartphone = makeIcon("Smartphone", LSmartphone);
export const Star = makeIcon("Star", LStar);
export const Sun = makeIcon("Sun", LSun);
export const Tablet = makeIcon("Tablet", LTablet);
export const Tags = makeIcon("Tags", LTags);
export const Trash2 = makeIcon("Trash2", LTrash2);
export const Type = makeIcon("Type", LType);
export const Undo = makeIcon("Undo", LUndo);
export const Undo2 = Undo;
export const RotateCcw = makeIcon("RotateCcw", LRotateCcw);

export const Upload = makeIcon("Upload", LUpload);
export const User = makeIcon("User", LUser);
export const Users = makeIcon("Users", LUsers);
export const Video = makeIcon("Video", LVideo);
export const X = makeIcon("X", LX);
export const Lock = makeIcon("Lock", LLock);
export const Palette = makeIcon("Palette", LPalette);
export const LayoutGrid = makeIcon("LayoutGrid", LLayoutGrid);
export const Sparkles = makeIcon("Sparkles", LSparkles);
export const Shapes = makeIcon("Shapes", LShapes);
export const PanelsTopLeft = makeIcon("PanelsTopLeft", LPanelsTopLeft);
export const CreditCard = makeIcon("CreditCard", LCreditCard);
export const Play = makeIcon("Play", LPlay);
export const Pause = makeIcon("Pause", LPause);
export const Bell = makeIcon("Bell", LBell);
export const Info = makeIcon("Info", LInfo);
export const Mic = makeIcon("Mic", LMic);
export const Film = makeIcon("Film", LFilm);
export const Brush = makeIcon("Brush", LBrush);
export const Rss = makeIcon("Rss", LRss);
export const ShieldCheck = makeIcon("ShieldCheck", LShieldCheck);
export const Cog = makeIcon("Cog", LCog);
export const Wand2 = makeIcon("Wand2", LWand2);
export const Share2 = makeIcon("Share2", LShare2);
export const Gauge = makeIcon("Gauge", LGauge);
export const Printer = makeIcon("Printer", LPrinter);
export const Download = makeIcon("Download", LDownload);


// Brands
export const Facebook = makeIcon("Facebook", LFacebook);
export const Instagram = makeIcon("Instagram", LInstagram);
export const Linkedin = makeIcon("Linkedin", LLinkedin);
export const Twitter = makeIcon("Twitter", LTwitter);
export const Youtube = makeIcon("Youtube", LYoutube);
