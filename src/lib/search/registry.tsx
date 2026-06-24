// Static command registry for the global command palette.
// All labels are bilingual (PL/EN). Navigation commands carry a TanStack
// Router `to` path; action commands carry a `run` callback (resolved at
// invocation time inside the palette).
import type { ReactNode } from "react";
import {
  Home, FileText, Settings, Image as ImageIcon, Tags, Megaphone,
  Palette, Mail, Lock, LayoutDashboard, Newspaper, User as UserIcon,
  CreditCard, ListOrdered, FolderTree,
} from "@/lib/lucide-shim";

export type CommandSection =
  | "navigation"
  | "admin"
  | "settings"
  | "appearance"
  | "account"
  | "actions"
  | "content";

export interface PaletteCommand {
  id: string;
  /** Section the item belongs to (group heading). */
  section: CommandSection;
  label_pl: string;
  label_en: string;
  /** Optional supporting hint (path, description, shortcut). */
  hint_pl?: string;
  hint_en?: string;
  /** Extra tokens the matcher should consider. */
  keywords_pl?: string[];
  keywords_en?: string[];
  /** Navigation target (TSR path). Either `to` OR `run` MUST be set. */
  to?: string;
  /** Imperative action - executed when the user presses Enter. */
  run?: () => void | Promise<void>;
  /** True when this command requires an admin role. */
  adminOnly?: boolean;
  /** True when this command requires an authenticated user. */
  authOnly?: boolean;
  icon?: ReactNode;
}

const Icon = (C: typeof Home) => <C className="w-4 h-4" />;

export const STATIC_COMMANDS: PaletteCommand[] = [
  // Public navigation
  { id: "nav:home", section: "navigation", label_pl: "Strona główna", label_en: "Home", to: "/", icon: Icon(Home), keywords_pl: ["start"], keywords_en: ["index"] },
  { id: "nav:blog", section: "navigation", label_pl: "Blog", label_en: "Blog", to: "/blog", icon: Icon(Newspaper) },
  { id: "nav:pricing", section: "navigation", label_pl: "Cennik", label_en: "Pricing", to: "/pricing", icon: Icon(CreditCard) },

  // Account
  { id: "acc:profile", section: "account", label_pl: "Mój profil", label_en: "My profile", to: "/profile", icon: Icon(UserIcon), authOnly: true },
  { id: "acc:account", section: "account", label_pl: "Konto", label_en: "Account", to: "/profile/account", icon: Icon(UserIcon), authOnly: true },
  { id: "acc:billing", section: "account", label_pl: "Płatności", label_en: "Billing", to: "/profile/billing", icon: Icon(CreditCard), authOnly: true },
  { id: "acc:orders", section: "account", label_pl: "Zamówienia", label_en: "Orders", to: "/profile/orders", icon: Icon(Receipt), authOnly: true },
  { id: "acc:security", section: "account", label_pl: "Bezpieczeństwo", label_en: "Security", to: "/profile/security", icon: Icon(Shield), authOnly: true },
  { id: "acc:subscription", section: "account", label_pl: "Subskrypcja", label_en: "Subscription", to: "/profile/subscription", icon: Icon(ListOrdered), authOnly: true },

  // Admin
  { id: "adm:dashboard", section: "admin", label_pl: "Panel administratora", label_en: "Admin dashboard", to: "/admin", icon: Icon(LayoutDashboard), adminOnly: true },
  { id: "adm:pages", section: "admin", label_pl: "Strony", label_en: "Pages", to: "/admin/pages", icon: Icon(FilesIcon), adminOnly: true, keywords_pl: ["pages"], keywords_en: ["strony"] },
  { id: "adm:pages.new", section: "admin", label_pl: "Nowa strona", label_en: "New page", to: "/admin/pages/new", icon: Icon(FilesIcon), adminOnly: true },
  { id: "adm:posts", section: "admin", label_pl: "Wpisy", label_en: "Posts", to: "/admin/posts", icon: Icon(FileText), adminOnly: true },
  { id: "adm:posts.new", section: "admin", label_pl: "Nowy wpis", label_en: "New post", to: "/admin/posts/new", icon: Icon(FileText), adminOnly: true },
  { id: "adm:media", section: "admin", label_pl: "Media", label_en: "Media", to: "/admin/media", icon: Icon(ImageIcon), adminOnly: true },
  { id: "adm:categories", section: "admin", label_pl: "Kategorie", label_en: "Categories", to: "/admin/categories", icon: Icon(Tag), adminOnly: true },
  { id: "adm:ads", section: "admin", label_pl: "Reklamy", label_en: "Advertising", to: "/admin/ads", icon: Icon(Megaphone), adminOnly: true },
  { id: "adm:newsletter", section: "admin", label_pl: "Newsletter", label_en: "Newsletter", to: "/admin/newsletter", icon: Icon(Mail), adminOnly: true },
  { id: "adm:paywall", section: "admin", label_pl: "Paywall", label_en: "Paywall", to: "/admin/paywall", icon: Icon(Lock), adminOnly: true },

  // Appearance
  { id: "app:appearance", section: "appearance", label_pl: "Wygląd", label_en: "Appearance", to: "/admin/appearance", icon: Icon(Palette), adminOnly: true },
  { id: "app:header", section: "appearance", label_pl: "Wygląd · Nagłówek", label_en: "Appearance · Header", to: "/admin/appearance/header", icon: Icon(Palette), adminOnly: true },
  { id: "app:footer", section: "appearance", label_pl: "Wygląd · Stopka", label_en: "Appearance · Footer", to: "/admin/appearance/footer", icon: Icon(Palette), adminOnly: true },
  { id: "app:menu", section: "appearance", label_pl: "Wygląd · Menu", label_en: "Appearance · Menu", to: "/admin/appearance/menu", icon: Icon(Palette), adminOnly: true },
  { id: "app:colors", section: "appearance", label_pl: "Wygląd · Kolory globalne", label_en: "Appearance · Global colors", to: "/admin/appearance/global-colors", icon: Icon(Palette), adminOnly: true },

  // Settings
  { id: "set:general", section: "settings", label_pl: "Ustawienia · Ogólne", label_en: "Settings · General", to: "/admin/settings/general", icon: Icon(Settings), adminOnly: true },
  { id: "set:reading", section: "settings", label_pl: "Ustawienia · Czytanie", label_en: "Settings · Reading", to: "/admin/settings/reading", icon: Icon(Settings), adminOnly: true },
  { id: "set:permalinks", section: "settings", label_pl: "Ustawienia · Permalinki", label_en: "Settings · Permalinks", to: "/admin/settings/permalinks", icon: Icon(Settings), adminOnly: true },
  { id: "set:privacy", section: "settings", label_pl: "Ustawienia · Prywatność", label_en: "Settings · Privacy", to: "/admin/settings/privacy", icon: Icon(Settings), adminOnly: true },
  { id: "set:media", section: "settings", label_pl: "Ustawienia · Media", label_en: "Settings · Media", to: "/admin/settings/media", icon: Icon(Settings), adminOnly: true },
  { id: "set:design", section: "settings", label_pl: "Ustawienia · Design", label_en: "Settings · Design", to: "/admin/settings/design", icon: Icon(Settings), adminOnly: true },
  { id: "set:discussion", section: "settings", label_pl: "Ustawienia · Dyskusja", label_en: "Settings · Discussion", to: "/admin/settings/discussion", icon: Icon(Settings), adminOnly: true },
];

export interface BuildHaystackInput {
  cmd: PaletteCommand;
  lang: "pl" | "en";
}

/**
 * Combine localized labels + hints + keywords + path into a single string the
 * fuzzy matcher consumes. We include BOTH languages so a Polish user searching
 * with English keywords (e.g. "pages") still finds it, and vice-versa.
 */
export function buildHaystack({ cmd }: BuildHaystackInput): string {
  return [
    cmd.label_pl, cmd.label_en,
    cmd.hint_pl ?? "", cmd.hint_en ?? "",
    ...(cmd.keywords_pl ?? []), ...(cmd.keywords_en ?? []),
    cmd.to ?? "",
  ].join(" ").trim();
}

export function visibleCommands(opts: { isAdmin: boolean; isAuthenticated: boolean }): PaletteCommand[] {
  return STATIC_COMMANDS.filter((c) => {
    if (c.adminOnly && !opts.isAdmin) return false;
    if (c.authOnly && !opts.isAuthenticated) return false;
    return true;
  });
}
