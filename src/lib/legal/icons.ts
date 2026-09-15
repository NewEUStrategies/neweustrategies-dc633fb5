// Mapowanie nazw ikon (zapisanych w treści dokumentu) na komponenty lucide.
// Nazwa nieznana -> neutralna ikona dokumentu, żeby wersja z bazy nigdy nie
// wywróciła renderu strony prawnej.
import {
  Activity,
  Ban,
  Building2,
  CalendarClock,
  Cookie,
  Copyright,
  CreditCard,
  Database,
  FileCheck2,
  FileText,
  Globe2,
  HeartHandshake,
  Mail,
  MessageSquareWarning,
  RotateCcw,
  Scale,
  Send,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Store,
  Ticket,
  Timer,
  UserCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export const LEGAL_ICONS: Record<string, LucideIcon> = {
  Activity,
  Ban,
  Building2,
  CalendarClock,
  Cookie,
  Copyright,
  CreditCard,
  Database,
  FileCheck2,
  FileText,
  Globe2,
  HeartHandshake,
  Mail,
  MessageSquareWarning,
  RotateCcw,
  Scale,
  Send,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Store,
  Ticket,
  Timer,
  UserCheck,
  Wallet,
};

/** Lista nazw do wyboru w panelu (posortowana alfabetycznie). */
export const LEGAL_ICON_NAMES = Object.keys(LEGAL_ICONS).sort();

export function resolveLegalIcon(name: string): LucideIcon {
  return LEGAL_ICONS[name] ?? FileText;
}
