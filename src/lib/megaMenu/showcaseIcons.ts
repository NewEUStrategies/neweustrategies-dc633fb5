// Curated icon set selectable per mega-menu link in the "showcase" layout.
// Kept small on purpose - the admin picks from a labelled list, so we never
// ship the whole lucide bundle into the menu.
import type { ComponentType, SVGProps } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CreditCard,
  FileText,
  Globe,
  HandHeart,
  Info,
  Layers,
  LayoutGrid,
  LineChart,
  Mail,
  Newspaper,
  Search,
  ShieldCheck,
  Star,
  Target,
  TrendingUp,
  UserPlus,
  Users,
} from "@/lib/lucide-shim";

export type MegaMenuIconName =
  | "globe"
  | "layers"
  | "users"
  | "user-plus"
  | "chart"
  | "trending"
  | "target"
  | "shield"
  | "star"
  | "file"
  | "news"
  | "book"
  | "calendar"
  | "mail"
  | "search"
  | "card"
  | "heart"
  | "info"
  | "grid";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export const MEGA_MENU_ICONS: Record<MegaMenuIconName, IconComponent> = {
  globe: Globe,
  layers: Layers,
  users: Users,
  "user-plus": UserPlus,
  chart: LineChart,
  trending: TrendingUp,
  target: Target,
  shield: ShieldCheck,
  star: Star,
  file: FileText,
  news: Newspaper,
  book: BookOpen,
  calendar: CalendarDays,
  mail: Mail,
  search: Search,
  card: CreditCard,
  heart: HandHeart,
  info: Info,
  grid: LayoutGrid,
};

export const MEGA_MENU_ICON_NAMES = Object.keys(MEGA_MENU_ICONS) as MegaMenuIconName[];

export function resolveMegaMenuIcon(name: unknown): IconComponent | null {
  if (typeof name !== "string") return null;
  return MEGA_MENU_ICONS[name as MegaMenuIconName] ?? null;
}

export { ArrowRight as MegaMenuArrowIcon };
