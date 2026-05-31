/**
 * Drop-in replacement for `lucide-react` icon components, backed by Font Awesome.
 * Keeps the same PascalCase API so existing code can `import { Foo } from "@/lib/lucide-shim"`.
 */
import { forwardRef, type CSSProperties, type SVGAttributes } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowLeft, faArrowRight, faBold, faCheck, faChevronDown, faChevronLeft,
  faChevronRight, faChevronUp, faCircle, faClock, faTableColumns, faCopy,
  faEye, faFile, faFileLines, faFire, faFolderTree, faImages, faGlobe,
  faGripVertical, faHeading, faHouse, faImage, faItalic, faLayerGroup,
  faGauge, faLink, faListUl, faListOl, faRightToBracket, faRightFromBracket,
  faEnvelope, faLocationDot, faBullhorn, faBars, faMinus, faDesktop, faMoon,
  faEllipsis, faHandPointer, faUpDown, faNewspaper, faPencil, faPlus,
  faQuoteRight, faRotateRight, faGripLines, faFloppyDisk, faMagnifyingGlass,
  faPaperPlane, faGear, faMobileScreen, faStar, faSun, faTabletScreenButton,
  faTags, faTrashCan, faFont, faRotateLeft, faUpload, faUser, faUsers,
  faVideo, faXmark,
} from "@fortawesome/free-solid-svg-icons";
import {
  faFacebook, faInstagram, faLinkedin, faXTwitter, faYoutube,
} from "@fortawesome/free-brands-svg-icons";

export type LucideIcon = React.FC<IconProps>;

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "color"> {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
}

function makeIcon(def: IconDefinition): LucideIcon {
  const Comp = forwardRef<SVGSVGElement, IconProps>(
    ({ size = 24, color, className, style, strokeWidth: _sw, absoluteStrokeWidth: _abs, ...rest }, ref) => {
      const merged: CSSProperties = {
        width: typeof size === "number" ? `${size}px` : size,
        height: typeof size === "number" ? `${size}px` : size,
        color,
        ...style,
      };
      return (
        <FontAwesomeIcon
          icon={def}
          className={className}
          style={merged as React.CSSProperties & Record<`--fa-${string}`, string>}
          {...(rest as Record<string, unknown>)}
          ref={ref}
        />
      );
    },
  );
  Comp.displayName = `Icon(${def.iconName})`;
  return Comp as LucideIcon;
}

// Solid
export const ArrowLeft = makeIcon(faArrowLeft);
export const ArrowRight = makeIcon(faArrowRight);
export const Bold = makeIcon(faBold);
export const Check = makeIcon(faCheck);
export const ChevronDown = makeIcon(faChevronDown);
export const ChevronDownIcon = ChevronDown;
export const ChevronLeft = makeIcon(faChevronLeft);
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRight = makeIcon(faChevronRight);
export const ChevronRightIcon = ChevronRight;
export const ChevronUp = makeIcon(faChevronUp);
export const Circle = makeIcon(faCircle);
export const Clock = makeIcon(faClock);
export const Columns2 = makeIcon(faTableColumns);
export const Copy = makeIcon(faCopy);
export const Eye = makeIcon(faEye);
export const File = makeIcon(faFile);
export const FileText = makeIcon(faFileLines);
export const Flame = makeIcon(faFire);
export const FolderTree = makeIcon(faFolderTree);
export const GalleryHorizontal = makeIcon(faImages);
export const Globe = makeIcon(faGlobe);
export const GripVertical = makeIcon(faGripVertical);
export const Heading1 = makeIcon(faHeading);
export const Heading2 = makeIcon(faHeading);
export const Heading3 = makeIcon(faHeading);
export const Home = makeIcon(faHouse);
export const Image = makeIcon(faImage);
export const Italic = makeIcon(faItalic);
export const Layers = makeIcon(faLayerGroup);
export const LayoutDashboard = makeIcon(faGauge);
export const Link = makeIcon(faLink);
export const List = makeIcon(faListUl);
export const ListOrdered = makeIcon(faListOl);
export const LogIn = makeIcon(faRightToBracket);
export const LogOut = makeIcon(faRightFromBracket);
export const Mail = makeIcon(faEnvelope);
export const MapPin = makeIcon(faLocationDot);
export const Megaphone = makeIcon(faBullhorn);
export const Menu = makeIcon(faBars);
export const Minus = makeIcon(faMinus);
export const Monitor = makeIcon(faDesktop);
export const Moon = makeIcon(faMoon);
export const MoreHorizontal = makeIcon(faEllipsis);
export const MousePointerClick = makeIcon(faHandPointer);
export const MoveVertical = makeIcon(faUpDown);
export const Newspaper = makeIcon(faNewspaper);
export const PanelLeft = makeIcon(faTableColumns);
export const Pencil = makeIcon(faPencil);
export const Plus = makeIcon(faPlus);
export const Quote = makeIcon(faQuoteRight);
export const Redo = makeIcon(faRotateRight);
export const Rows = makeIcon(faGripLines);
export const Save = makeIcon(faFloppyDisk);
export const Search = makeIcon(faMagnifyingGlass);
export const Send = makeIcon(faPaperPlane);
export const Settings = makeIcon(faGear);
export const Smartphone = makeIcon(faMobileScreen);
export const Star = makeIcon(faStar);
export const Sun = makeIcon(faSun);
export const Tablet = makeIcon(faTabletScreenButton);
export const Tags = makeIcon(faTags);
export const Trash2 = makeIcon(faTrashCan);
export const Type = makeIcon(faFont);
export const Undo = makeIcon(faRotateLeft);
export const Upload = makeIcon(faUpload);
export const User = makeIcon(faUser);
export const Users = makeIcon(faUsers);
export const Video = makeIcon(faVideo);
export const X = makeIcon(faXmark);

// Brands
export const Facebook = makeIcon(faFacebook);
export const Instagram = makeIcon(faInstagram);
export const Linkedin = makeIcon(faLinkedin);
export const Twitter = makeIcon(faXTwitter);
export const Youtube = makeIcon(faYoutube);
