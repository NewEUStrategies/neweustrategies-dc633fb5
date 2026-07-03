// Dynamiczna sekcja "Nawigacja" - pozycje pochodzą z konfiguracji
// zarządzanej przez super-admina. Renderer nie wyświetla nic, gdy lista
// pozycji jest pusta (albo wszystkie są wyłączone) - super-admin sam
// decyduje, czy sekcja się pokazuje.
import type { ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import {
  Home,
  Newspaper,
  Tag,
  Mic,
  Mail,
  DollarSign,
  BookOpen,
  Briefcase,
  Calendar,
  FileText,
  Info,
  LayoutGrid,
  Star,
  User,
  Users,
  Shield,
  Phone,
  MapPin,
  Link as LinkIcon,
} from "lucide-react";
import type { NavItem, NavIcon } from "@/lib/mobileDrawer";

const ICON_MAP: Record<NavIcon, ComponentType<{ className?: string }>> = {
  home: Home,
  newspaper: Newspaper,
  tag: Tag,
  mic: Mic,
  mail: Mail,
  "dollar-sign": DollarSign,
  "book-open": BookOpen,
  briefcase: Briefcase,
  calendar: Calendar,
  "file-text": FileText,
  info: Info,
  "layout-grid": LayoutGrid,
  star: Star,
  user: User,
  users: Users,
  shield: Shield,
  phone: Phone,
  "map-pin": MapPin,
  link: LinkIcon,
};

type Props = {
  items: NavItem[];
  isPl: boolean;
  onNavigate: () => void;
};

export function MobileNavSection({ items, isPl, onNavigate }: Props) {
  const visible = items.filter((i) => i.enabled);
  if (visible.length === 0) return null;

  const t = (pl: string, en: string) => (isPl ? pl : en);
  const linkCls =
    "flex items-center gap-3 px-4 py-3 text-sm font-medium text-foreground hover:bg-muted border-b border-border/60 transition";

  return (
    <nav aria-label={t("Nawigacja", "Navigation")} className="border-b border-border">
      <p className="px-4 pt-3 pb-2 text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
        {t("Nawigacja", "Navigation")}
      </p>
      {visible.map((item) => {
        const Icon = ICON_MAP[item.icon] ?? LinkIcon;
        const label = isPl ? item.label_pl : item.label_en;
        const external = /^https?:\/\//.test(item.href);
        if (external) {
          return (
            <a
              key={item.id}
              href={item.href}
              onClick={onNavigate}
              className={linkCls}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon className="w-4 h-4 text-muted-foreground" />
              <span>{label}</span>
            </a>
          );
        }
        return (
          <Link key={item.id} to={item.href} onClick={onNavigate} className={linkCls}>
            <Icon className="w-4 h-4 text-muted-foreground" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
