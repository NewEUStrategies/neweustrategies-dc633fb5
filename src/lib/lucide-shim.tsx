/**
 * Drop-in icon API. Renders Lucide by default; switches to Font Awesome
 * when the icon pack is set to "fontawesome" via @/lib/iconPack.
 * Keeps the same PascalCase exports used across the app.
 */
import { forwardRef, type SVGAttributes } from "react";
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
} from "@fortawesome/free-solid-svg-icons";
import {
  faFacebook, faInstagram, faLinkedin, faXTwitter, faYoutube,
} from "@fortawesome/free-brands-svg-icons";
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
  Lock as LLock, Palette as LPalette, LayoutGrid as LLayoutGrid, Sparkles as LSparkles,
  PanelsTopLeft as LPanelsTopLeft, CreditCard as LCreditCard, Play as LPlay, Pause as LPause,
  Facebook as LFacebook, Instagram as LInstagram, Linkedin as LLinkedin,
  Twitter as LTwitter, Youtube as LYoutube,
  type LucideIcon as LucideIconImpl,
} from "lucide-react";
import { useIconPack } from "@/lib/iconPack";

export type LucideIcon = React.FC<IconProps>;

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "color"> {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
}

function makeIcon(faDef: IconDefinition, LucideComp: LucideIconImpl): LucideIcon {
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
      // Font Awesome glyphs visually read larger than Lucide's stroked icons
      // at the same box size. Scale down to ~72% so they look balanced
      // when used as drop-in replacements.
      const scaled = typeof size === "number" ? Math.round(size * 0.72) : size;
      const merged: React.CSSProperties = {
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
          style={merged as React.CSSProperties & Record<`--fa-${string}`, string>}
          {...(rest as Record<string, unknown>)}
          ref={ref}
        />
      );
    },
  );
  Comp.displayName = `Icon(${faDef.iconName})`;
  return Comp as LucideIcon;
}

// Solid
export const ArrowLeft = makeIcon(faArrowLeft, LArrowLeft);
export const ArrowRight = makeIcon(faArrowRight, LArrowRight);
export const Bold = makeIcon(faBold, LBold);
export const Bookmark = makeIcon(faBookmark, LBookmark);
export const BookmarkCheck = makeIcon(faBookmark, LBookmarkCheck);
export const BookOpen = makeIcon(faBookOpen, LBookOpen);
export const Check = makeIcon(faCheck, LCheck);
export const ChevronDown = makeIcon(faChevronDown, LChevronDown);
export const ChevronDownIcon = ChevronDown;
export const ChevronLeft = makeIcon(faChevronLeft, LChevronLeft);
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRight = makeIcon(faChevronRight, LChevronRight);
export const ChevronRightIcon = ChevronRight;
export const ChevronUp = makeIcon(faChevronUp, LChevronUp);
export const Circle = makeIcon(faCircle, LCircle);
export const Clock = makeIcon(faClock, LClock);
export const Columns2 = makeIcon(faTableColumns, LColumns2);
export const Copy = makeIcon(faCopy, LCopy);
export const Eye = makeIcon(faEye, LEye);
export const File = makeIcon(faFile, LFile);
export const FileText = makeIcon(faFileLines, LFileText);
export const Flame = makeIcon(faFire, LFlame);
export const FolderTree = makeIcon(faFolderTree, LFolderTree);
export const GalleryHorizontal = makeIcon(faImages, LGalleryHorizontal);
export const Globe = makeIcon(faGlobe, LGlobe);
export const GripVertical = makeIcon(faGripVertical, LGripVertical);
export const Heading1 = makeIcon(faHeading, LHeading1);
export const Heading2 = makeIcon(faHeading, LHeading2);
export const Heading3 = makeIcon(faHeading, LHeading3);
export const Home = makeIcon(faHouse, LHome);
export const Image = makeIcon(faImage, LImage);
export const Italic = makeIcon(faItalic, LItalic);
export const Layers = makeIcon(faLayerGroup, LLayers);
export const LayoutDashboard = makeIcon(faGauge, LLayoutDashboard);
export const Link = makeIcon(faLink, LLink);
export const List = makeIcon(faListUl, LList);
export const ListOrdered = makeIcon(faListOl, LListOrdered);
export const LogIn = makeIcon(faRightToBracket, LLogIn);
export const LogOut = makeIcon(faRightFromBracket, LLogOut);
export const Mail = makeIcon(faEnvelope, LMail);
export const MapPin = makeIcon(faLocationDot, LMapPin);
export const Megaphone = makeIcon(faBullhorn, LMegaphone);
export const Menu = makeIcon(faBars, LMenu);
export const Minus = makeIcon(faMinus, LMinus);
export const Monitor = makeIcon(faDesktop, LMonitor);
export const Moon = makeIcon(faMoon, LMoon);
export const MoreHorizontal = makeIcon(faEllipsis, LMoreHorizontal);
export const MousePointerClick = makeIcon(faHandPointer, LMousePointerClick);
export const MoveVertical = makeIcon(faUpDown, LMoveVertical);
export const Newspaper = makeIcon(faNewspaper, LNewspaper);
export const PanelLeft = makeIcon(faTableColumns, LPanelLeft);
export const Pencil = makeIcon(faPencil, LPencil);
export const Plus = makeIcon(faPlus, LPlus);
export const Quote = makeIcon(faQuoteRight, LQuote);
export const Redo = makeIcon(faRotateRight, LRedo);
export const Redo2 = Redo;
export const Loader2 = makeIcon(faSpinner, LLoader2);
export const AlertTriangle = makeIcon(faTriangleExclamation, LAlertTriangle);
export const Rows = makeIcon(faGripLines, LRows);
export const Save = makeIcon(faFloppyDisk, LSave);
export const Search = makeIcon(faMagnifyingGlass, LSearch);
export const Send = makeIcon(faPaperPlane, LSend);
export const Settings = makeIcon(faGear, LSettings);
export const Smartphone = makeIcon(faMobileScreen, LSmartphone);
export const Star = makeIcon(faStar, LStar);
export const Sun = makeIcon(faSun, LSun);
export const Tablet = makeIcon(faTabletScreenButton, LTablet);
export const Tags = makeIcon(faTags, LTags);
export const Trash2 = makeIcon(faTrashCan, LTrash2);
export const Type = makeIcon(faFont, LType);
export const Undo = makeIcon(faRotateLeft, LUndo);
export const Undo2 = Undo;
export const Upload = makeIcon(faUpload, LUpload);
export const User = makeIcon(faUser, LUser);
export const Users = makeIcon(faUsers, LUsers);
export const Video = makeIcon(faVideo, LVideo);
export const X = makeIcon(faXmark, LX);
export const Lock = makeIcon(faLock, LLock);
export const Palette = makeIcon(faPalette, LPalette);
export const LayoutGrid = makeIcon(faTableCells, LLayoutGrid);
export const Sparkles = makeIcon(faWandMagicSparkles, LSparkles);
export const PanelsTopLeft = makeIcon(faWindowMaximize, LPanelsTopLeft);
export const CreditCard = makeIcon(faCreditCard, LCreditCard);
export const Play = makeIcon(faPlay, LPlay);
export const Pause = makeIcon(faPause, LPause);


// Brands
export const Facebook = makeIcon(faFacebook, LFacebook);
export const Instagram = makeIcon(faInstagram, LInstagram);
export const Linkedin = makeIcon(faLinkedin, LLinkedin);
export const Twitter = makeIcon(faXTwitter, LTwitter);
export const Youtube = makeIcon(faYoutube, LYoutube);
