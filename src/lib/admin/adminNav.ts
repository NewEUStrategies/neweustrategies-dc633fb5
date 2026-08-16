import type { ComponentType } from "react";
import type { TFunction } from "i18next";
import {
  LayoutDashboard,
  FileText,
  File,
  FolderTree,
  Tags,
  Users,
  Image as ImageIcon,
  Settings,
  PanelLeft,
  Mail,
  Lock,
  Palette,
  LayoutGrid,
  Shapes,
  PanelsTopLeft,
  Smartphone,
  Newspaper,
  Megaphone,
  Mic,
  Film,
  Wand2,
  Share2,
  Gauge,
  MousePointerClick,
  Clock as HistoryIcon,
  Globe2,
  FlaskConical,
  Link as LinkIcon,
  Search,
} from "@/lib/lucide-shim";
import {
  BadgePercent,
  BookOpen,
  Briefcase,
  Cable,
  Clock,
  CreditCard,
  Crown,
  Gift,
  HandHeart,
  Inbox,
  Landmark,
  ListChecks,
  MessageCircle,
  MessagesSquare,
  Radio,
  ShieldCheck,
  TrendingUp,
  Workflow,
} from "lucide-react";

export type AdminNavIcon = ComponentType<{ className?: string }>;

/**
 * Dwa rodzaje pozycji: wewnętrzna trasa panelu (`to`, TanStack <Link>) oraz
 * usługa zewnętrzna (`href`, nowa karta) - np. zbiórki żyjące poza panelem.
 */
export type AdminNavItem =
  | { to: string; icon: AdminNavIcon; label: string; badge?: number; keywords?: string[] }
  | { href: string; icon: AdminNavIcon; label: string; keywords?: string[] };

export type AdminNavGroup = { id: string; label?: string; items: AdminNavItem[] };

export type BuildAdminNavArgs = {
  t: TFunction;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  clubPending: number;
};

/** Klucz pozycji - stabilny identyfikator używany przy filtrowaniu i renderze. */
export function adminNavItemKey(item: AdminNavItem): string {
  return "to" in item ? item.to : item.href;
}

/** Normalizacja pod wyszukiwarkę: bez znaków diakrytycznych, lowercase. */
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l");
}

export type AdminNavSearchHit = { item: AdminNavItem; groupId: string; groupLabel?: string };

/**
 * Wyszukiwarka wewnętrzna panelu: dopasowanie po etykiecie, słowach kluczowych
 * i segmencie ścieżki. Bez zewnętrznych zależności - lista pozycji jest mała,
 * więc liniowe skanowanie jest tańsze niż indeks.
 */
export function searchAdminNav(groups: AdminNavGroup[], query: string): AdminNavSearchHit[] {
  const q = normalizeSearchText(query.trim());
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const hits: Array<AdminNavSearchHit & { score: number }> = [];

  for (const group of groups) {
    for (const item of group.items) {
      const label = normalizeSearchText(item.label);
      const haystack = normalizeSearchText(
        [item.label, group.label ?? "", adminNavItemKey(item), ...(item.keywords ?? [])].join(" "),
      );
      if (!tokens.every((token) => haystack.includes(token))) continue;
      const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
      hits.push({ item, groupId: group.id, groupLabel: group.label, score });
    }
  }

  return hits
    .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label))
    .map(({ item, groupId, groupLabel }) => ({ item, groupId, groupLabel }));
}

/**
 * Pełna mapa nawigacji panelu. Grupowanie jest domenowe (co administrator chce
 * zrobić), a nie techniczne (gdzie mieszka trasa), dlatego np. skrzynki CRM
 * i rekrutacja stoją razem, a taksonomie klubów obok samych klubów.
 */
export function buildAdminNavGroups({
  t,
  isAdmin,
  isSuperAdmin,
  clubPending,
}: BuildAdminNavArgs): AdminNavGroup[] {
  const groups: AdminNavGroup[] = [
    {
      id: "overview",
      items: [
        {
          to: "/admin",
          icon: LayoutDashboard,
          label: t("admin.nav.dashboard"),
          keywords: ["start", "home", "pulpit"],
        },
      ],
    },
    {
      id: "content",
      label: t("admin.navGroups.content"),
      items: [
        { to: "/admin/posts", icon: Newspaper, label: t("admin.nav.posts") },
        { to: "/admin/pages", icon: File, label: t("admin.nav.pages") },
        { to: "/admin/media", icon: ImageIcon, label: t("admin.nav.media") },
        { to: "/admin/content-area", icon: FileText, label: t("admin.nav.contentArea") },
        { to: "/admin/versions", icon: HistoryIcon, label: t("admin.nav.versions") },
        { to: "/admin/related-posts", icon: Share2, label: t("admin.nav.relatedPosts") },
        { to: "/admin/personalized", icon: Wand2, label: t("admin.nav.personalized") },
      ],
    },
    {
      id: "taxonomy",
      label: t("admin.navGroups.taxonomy"),
      items: [
        { to: "/admin/categories", icon: FolderTree, label: t("admin.nav.categories") },
        { to: "/admin/category-colors", icon: Palette, label: t("admin.nav.categoryColors") },
        { to: "/admin/tags", icon: Tags, label: t("admin.nav.tags") },
        { to: "/admin/glossary", icon: BookOpen, label: t("admin.nav.glossary") },
      ],
    },
    {
      id: "media",
      label: t("admin.navGroups.media"),
      items: [
        { to: "/admin/podcasts", icon: Mic, label: t("admin.nav.podcasts") },
        { to: "/admin/web-stories", icon: Film, label: t("admin.nav.webStories") },
        { to: "/admin/live-blog", icon: Radio, label: t("admin.nav.liveBlog") },
        { to: "/admin/tracker", icon: Landmark, label: t("admin.nav.tracker") },
        { to: "/admin/programs", icon: Briefcase, label: t("admin.nav.programs") },
        {
          to: "/admin/research-programs",
          icon: FlaskConical,
          label: t("admin.nav.researchPrograms"),
        },
      ],
    },
    {
      id: "design",
      label: t("admin.navGroups.design"),
      items: [
        { to: "/admin/appearance", icon: PanelsTopLeft, label: t("admin.nav.appearance") },
        {
          to: "/admin/appearance/category-archive",
          icon: FolderTree,
          label: t("admin.appearance.categoryArchive"),
        },
        {
          to: "/admin/appearance/tag-archive",
          icon: Tags,
          label: t("admin.appearance.tagArchive"),
        },
        { to: "/admin/theme-options", icon: Palette, label: t("admin.nav.themeOptions") },
        { to: "/admin/post-layouts", icon: LayoutGrid, label: t("admin.nav.postLayouts") },
        { to: "/admin/expert-layouts", icon: Users, label: t("admin.nav.expertLayouts") },
        {
          to: "/admin/settings/mobile-bottom-bar",
          icon: Smartphone,
          label: t("admin.nav.mobileBottomBar"),
        },
        { to: "/admin/key-takeaways", icon: ListChecks, label: t("admin.nav.keyTakeaways") },
        { to: "/admin/toc", icon: ListChecks, label: t("admin.nav.toc") },
        { to: "/admin/reading-time", icon: Clock, label: t("admin.nav.readingTime") },
        { to: "/admin/icons", icon: Shapes, label: t("admin.nav.icons") },
        ...(isAdmin
          ? [{ to: "/admin/greetings", icon: MessageCircle, label: t("admin.nav.greetings") }]
          : []),
        ...(isSuperAdmin
          ? [
              { to: "/admin/names", icon: Users, label: t("admin.nav.names") },
              {
                to: "/admin/super/mobile-drawer",
                icon: PanelLeft,
                label: t("admin.nav.mobileDrawer"),
              },
            ]
          : []),
      ],
    },
    {
      id: "monetization",
      label: t("admin.navGroups.monetization"),
      items: [
        { to: "/admin/monetization", icon: TrendingUp, label: t("admin.nav.monetization") },
        { to: "/admin/paywall", icon: Lock, label: t("admin.nav.paywall") },
        { to: "/admin/pricing", icon: BadgePercent, label: t("admin.nav.pricing") },
        { to: "/admin/membership", icon: Crown, label: t("admin.nav.membership") },
        { to: "/admin/gifting", icon: Gift, label: t("admin.nav.gifting") },
        { to: "/admin/coupons", icon: Megaphone, label: t("admin.nav.coupons") },
        { to: "/admin/library", icon: BookOpen, label: t("admin.nav.library") },
        { to: "/admin/organizations", icon: Landmark, label: t("admin.nav.organizations") },
        { to: "/admin/ads", icon: Megaphone, label: t("admin.nav.ads") },
      ],
    },
    {
      id: "billing",
      label: t("admin.navGroups.billing"),
      items: [
        {
          to: "/admin/billing",
          icon: CreditCard,
          label: t("admin.nav.billing"),
          keywords: ["stripe", "platnosci", "payments", "faktury"],
        },
        {
          to: "/admin/billing-reconcile",
          icon: CreditCard,
          label: t("admin.nav.billingReconcile"),
          keywords: ["webhook", "stripe", "rekoncyliacja"],
        },
        { to: "/admin/donations", icon: HandHeart, label: t("admin.nav.donations") },
      ],
    },
    {
      id: "marketing",
      label: t("admin.navGroups.marketing"),
      items: [
        { to: "/admin/newsletter", icon: Mail, label: t("admin.nav.newsletter") },
        { to: "/admin/popups", icon: MousePointerClick, label: t("admin.nav.popups") },
        {
          to: "/admin/settings/social-preview",
          icon: ImageIcon,
          label: t("admin.nav.socialPreview"),
        },
        { to: "/admin/experiments", icon: FlaskConical, label: t("admin.nav.experiments") },
        { to: "/admin/seo", icon: Search, label: t("admin.nav.seo") },
        { to: "/admin/redirects", icon: LinkIcon, label: t("admin.nav.redirects") },
      ],
    },
    {
      id: "crm",
      label: t("admin.navGroups.crm"),
      items: [
        { to: "/admin/crm", icon: Users, label: t("admin.nav.crm") },
        { to: "/admin/crm/funnel", icon: Mail, label: t("admin.nav.crmFunnel") },
        { to: "/admin/companies", icon: Users, label: t("admin.nav.companies") },
        { to: "/admin/workflows", icon: Workflow, label: t("admin.nav.workflows") },
        { to: "/admin/integrations", icon: Cable, label: t("admin.nav.integrations") },
        { to: "/admin/contact", icon: Inbox, label: t("admin.nav.contact") },
        { to: "/admin/expert-requests", icon: Inbox, label: t("admin.nav.expertRequests") },
        { to: "/admin/careers", icon: Briefcase, label: t("admin.nav.careers") },
        { to: "/admin/hiring", icon: Briefcase, label: t("admin.nav.hiring") },
      ],
    },
    {
      id: "community",
      label: t("admin.navGroups.community"),
      items: [
        { to: "/admin/community", icon: Users, label: t("admin.nav.community") },
        {
          to: "/admin/community/clubs",
          icon: MessagesSquare,
          label: t("admin.nav.clubs"),
          badge: clubPending,
        },
        {
          to: "/admin/community/clubs/applications",
          icon: Inbox,
          label: t("admin.nav.clubApplications"),
        },
        {
          to: "/admin/community/clubs/specializations",
          icon: Shapes,
          label: t("admin.nav.clubSpecializations"),
        },
        { to: "/admin/community/clubs/topics", icon: Shapes, label: t("admin.nav.clubTopics") },
        { to: "/admin/community/clubs/elements", icon: Shapes, label: t("admin.nav.clubElements") },
        { to: "/admin/comments", icon: MessageCircle, label: t("admin.nav.comments") },
      ],
    },
  ];

  if (isAdmin) {
    groups.push(
      {
        id: "analytics",
        label: t("admin.navGroups.analytics"),
        items: [
          { to: "/admin/analytics", icon: TrendingUp, label: t("admin.nav.analytics") },
          { to: "/admin/audience", icon: TrendingUp, label: t("admin.nav.audience") },
          { to: "/admin/performance", icon: Gauge, label: t("admin.nav.performance") },
          { to: "/admin/i18n", icon: Globe2, label: t("admin.nav.i18nAudit") },
        ],
      },
      {
        id: "system",
        label: t("admin.navGroups.system"),
        items: [
          { to: "/admin/users", icon: Users, label: t("admin.nav.users") },
          { to: "/admin/authors", icon: Users, label: t("admin.nav.authors") },
          { to: "/admin/permissions", icon: ShieldCheck, label: t("admin.nav.permissions") },
          {
            to: "/admin/settings/cookie-banner",
            icon: ShieldCheck,
            label: t("admin.nav.cookieBanner"),
          },
          ...(isSuperAdmin
            ? [{ to: "/admin/login-settings", icon: Lock, label: t("admin.nav.loginSettings") }]
            : []),
          { to: "/admin/settings", icon: Settings, label: t("admin.nav.settings") },
        ],
      },
    );
  }

  return groups;
}
