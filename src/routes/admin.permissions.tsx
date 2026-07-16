// /admin/permissions - macierz uprawnień: definiuje zakres możliwości dla
// każdej roli systemowej (super_admin, admin, editor, author, user) oraz
// poziomów subskrybentów (free, basic, premium, enterprise). Strona jest
// referencyjna (read-only) - służy jako "źródło prawdy" dla zespołu i
// spełnia wymóg atomic design + i18n (PL/EN).
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  PenSquare,
  User as UserIcon,
  Users,
  Crown,
  Sparkles,
  Star,
  Building2,
  Check,
  Minus,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/permissions")({
  component: PermissionsMatrix,
});

type Level = "none" | "partial" | "full";

interface RoleDef {
  id: string;
  kind: "role" | "subscriber";
  pl: string;
  en: string;
  descPl: string;
  descEn: string;
  icon: typeof Shield;
  tone: string; // tailwind color classes
}

interface Capability {
  id: string;
  groupPl: string;
  groupEn: string;
  pl: string;
  en: string;
  matrix: Record<string, Level>;
}

const ROLES: RoleDef[] = [
  {
    id: "super_admin",
    kind: "role",
    pl: "Super-Admin",
    en: "Super-Admin",
    descPl: "Pełen dostęp do tenanta, konfiguracji i danych wrażliwych.",
    descEn: "Full tenant, config and sensitive data access.",
    icon: ShieldAlert,
    tone: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-900",
  },
  {
    id: "admin",
    kind: "role",
    pl: "Admin",
    en: "Admin",
    descPl: "Zarządza treścią, użytkownikami i ustawieniami operacyjnymi.",
    descEn: "Manages content, users and operational settings.",
    icon: ShieldCheck,
    tone: "text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900",
  },
  {
    id: "editor",
    kind: "role",
    pl: "Editor",
    en: "Editor",
    descPl: "Redaguje i publikuje treści innych autorów.",
    descEn: "Edits and publishes content from all authors.",
    icon: Shield,
    tone: "text-blue-700 bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-900",
  },
  {
    id: "author",
    kind: "role",
    pl: "Autor / Prelegent",
    en: "Author / Speaker",
    descPl: "Tworzy własne treści, prowadzi wydarzenia, profil eksperta.",
    descEn: "Authors own content, runs events, expert profile.",
    icon: PenSquare,
    tone: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900",
  },
  {
    id: "user",
    kind: "role",
    pl: "Użytkownik",
    en: "User",
    descPl: "Zalogowany członek społeczności, bez roli redakcyjnej.",
    descEn: "Signed-in community member, no editorial role.",
    icon: UserIcon,
    tone: "text-slate-700 bg-slate-50 border-slate-200 dark:bg-slate-900/60 dark:border-slate-700",
  },
  {
    id: "sub_free",
    kind: "subscriber",
    pl: "Subskrybent - Free",
    en: "Subscriber - Free",
    descPl: "Poziom bazowy, dostęp do treści otwartych.",
    descEn: "Baseline tier, access to open content.",
    icon: Users,
    tone: "text-zinc-700 bg-zinc-50 border-zinc-200 dark:bg-zinc-900/60 dark:border-zinc-700",
  },
  {
    id: "sub_basic",
    kind: "subscriber",
    pl: "Subskrybent - Basic",
    en: "Subscriber - Basic",
    descPl: "Podstawowy plan płatny, treści premium wybrane.",
    descEn: "Entry paid plan, selected premium content.",
    icon: Star,
    tone: "text-sky-700 bg-sky-50 border-sky-200 dark:bg-sky-950/40 dark:border-sky-900",
  },
  {
    id: "sub_premium",
    kind: "subscriber",
    pl: "Subskrybent - Premium",
    en: "Subscriber - Premium",
    descPl: "Pełny dostęp do treści i wydarzeń premium.",
    descEn: "Full access to premium content and events.",
    icon: Sparkles,
    tone: "text-violet-700 bg-violet-50 border-violet-200 dark:bg-violet-950/40 dark:border-violet-900",
  },
  {
    id: "sub_enterprise",
    kind: "subscriber",
    pl: "Subskrybent - Enterprise",
    en: "Subscriber - Enterprise",
    descPl: "Konta organizacji, seaty, raporty B2B.",
    descEn: "Organization accounts, seats, B2B reports.",
    icon: Building2,
    tone: "text-indigo-700 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900",
  },
];

// Skrót: F=full, P=partial, N=none. own = tylko własne rekordy.
const F: Level = "full";
const P: Level = "partial";
const N: Level = "none";

const CAPS: Capability[] = [
  // === Zarządzanie tenantem ===
  {
    id: "tenant_config",
    groupPl: "Tenant & konfiguracja",
    groupEn: "Tenant & configuration",
    pl: "Konfiguracja tenanta, domeny, klucze",
    en: "Tenant config, domains, keys",
    matrix: {
      super_admin: F,
      admin: N,
      editor: N,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  {
    id: "billing",
    groupPl: "Tenant & konfiguracja",
    groupEn: "Tenant & configuration",
    pl: "Rozliczenia i faktury organizacji",
    en: "Organization billing & invoices",
    matrix: {
      super_admin: F,
      admin: P,
      editor: N,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: P,
    },
  },
  {
    id: "login_settings",
    groupPl: "Tenant & konfiguracja",
    groupEn: "Tenant & configuration",
    pl: "Strona logowania i dostawcy SSO",
    en: "Login page & SSO providers",
    matrix: {
      super_admin: F,
      admin: N,
      editor: N,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  // === Użytkownicy i role ===
  {
    id: "users_manage",
    groupPl: "Użytkownicy i role",
    groupEn: "Users & roles",
    pl: "Zarządzanie użytkownikami (lista, edycja, blokada)",
    en: "Manage users (list, edit, block)",
    matrix: {
      super_admin: F,
      admin: F,
      editor: N,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  {
    id: "roles_assign",
    groupPl: "Użytkownicy i role",
    groupEn: "Users & roles",
    pl: "Nadawanie ról (admin, editor, author)",
    en: "Assign roles (admin, editor, author)",
    matrix: {
      super_admin: F,
      admin: P,
      editor: N,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  {
    id: "invitations",
    groupPl: "Użytkownicy i role",
    groupEn: "Users & roles",
    pl: "Zaproszenia i import zespołu",
    en: "Invitations & team import",
    matrix: {
      super_admin: F,
      admin: F,
      editor: N,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: P,
    },
  },
  {
    id: "impersonate",
    groupPl: "Użytkownicy i role",
    groupEn: "Users & roles",
    pl: "Impersonacja użytkownika (audyt)",
    en: "User impersonation (audited)",
    matrix: {
      super_admin: F,
      admin: N,
      editor: N,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  // === Treści ===
  {
    id: "posts_own",
    groupPl: "Treści",
    groupEn: "Content",
    pl: "Tworzenie własnych wpisów i szkiców",
    en: "Create own posts & drafts",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: F,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  {
    id: "posts_publish",
    groupPl: "Treści",
    groupEn: "Content",
    pl: "Publikowanie treści (wszystkich)",
    en: "Publish content (all)",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: P,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  {
    id: "posts_edit_all",
    groupPl: "Treści",
    groupEn: "Content",
    pl: "Edycja treści innych autorów",
    en: "Edit content of other authors",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  {
    id: "media_library",
    groupPl: "Treści",
    groupEn: "Content",
    pl: "Biblioteka mediów",
    en: "Media library",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: P,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  {
    id: "categories",
    groupPl: "Treści",
    groupEn: "Content",
    pl: "Kategorie, tagi, regiony",
    en: "Categories, tags, regions",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  {
    id: "comments_moderate",
    groupPl: "Treści",
    groupEn: "Content",
    pl: "Moderacja komentarzy",
    en: "Moderate comments",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: P,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  // === Wydarzenia i społeczność ===
  {
    id: "events_run",
    groupPl: "Wydarzenia i społeczność",
    groupEn: "Events & community",
    pl: "Prowadzenie wydarzeń (prelegent)",
    en: "Run events (speaker)",
    matrix: {
      super_admin: F,
      admin: F,
      editor: P,
      author: F,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  {
    id: "events_rsvp",
    groupPl: "Wydarzenia i społeczność",
    groupEn: "Events & community",
    pl: "Zapisy na wydarzenia (RSVP)",
    en: "Event RSVPs",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: F,
      user: F,
      sub_free: F,
      sub_basic: F,
      sub_premium: F,
      sub_enterprise: F,
    },
  },
  {
    id: "qa_ask",
    groupPl: "Wydarzenia i społeczność",
    groupEn: "Events & community",
    pl: "Zadawanie pytań w Q&A",
    en: "Ask questions in Q&A",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: F,
      user: F,
      sub_free: P,
      sub_basic: F,
      sub_premium: F,
      sub_enterprise: F,
    },
  },
  {
    id: "chat",
    groupPl: "Wydarzenia i społeczność",
    groupEn: "Events & community",
    pl: "Czat społeczności",
    en: "Community chat",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: F,
      user: F,
      sub_free: N,
      sub_basic: F,
      sub_premium: F,
      sub_enterprise: F,
    },
  },
  // === Treści premium ===
  {
    id: "premium_read",
    groupPl: "Dostęp do treści",
    groupEn: "Content access",
    pl: "Odczyt treści premium",
    en: "Read premium content",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: F,
      user: N,
      sub_free: N,
      sub_basic: P,
      sub_premium: F,
      sub_enterprise: F,
    },
  },
  {
    id: "resources",
    groupPl: "Dostęp do treści",
    groupEn: "Content access",
    pl: "Zasoby dla członków (PDF, raporty)",
    en: "Member resources (PDFs, reports)",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: F,
      user: N,
      sub_free: N,
      sub_basic: P,
      sub_premium: F,
      sub_enterprise: F,
    },
  },
  {
    id: "newsletter",
    groupPl: "Dostęp do treści",
    groupEn: "Content access",
    pl: "Newsletter (subskrypcja)",
    en: "Newsletter (subscription)",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: F,
      user: F,
      sub_free: F,
      sub_basic: F,
      sub_premium: F,
      sub_enterprise: F,
    },
  },
  // === Analityka ===
  {
    id: "analytics_all",
    groupPl: "Analityka i SEO",
    groupEn: "Analytics & SEO",
    pl: "Analityka pełna (tenant)",
    en: "Full analytics (tenant)",
    matrix: {
      super_admin: F,
      admin: F,
      editor: P,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: P,
    },
  },
  {
    id: "analytics_own",
    groupPl: "Analityka i SEO",
    groupEn: "Analytics & SEO",
    pl: "Statystyki własnych wpisów",
    en: "Own posts stats",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: F,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  {
    id: "seo_redirects",
    groupPl: "Analityka i SEO",
    groupEn: "Analytics & SEO",
    pl: "SEO, przekierowania, meta",
    en: "SEO, redirects, meta",
    matrix: {
      super_admin: F,
      admin: F,
      editor: P,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  // === Reklama i monetyzacja ===
  {
    id: "ads",
    groupPl: "Reklama i monetyzacja",
    groupEn: "Advertising & monetization",
    pl: "Slots reklamowe i kampanie",
    en: "Ad slots & campaigns",
    matrix: {
      super_admin: F,
      admin: F,
      editor: N,
      author: N,
      user: N,
      sub_free: N,
      sub_basic: N,
      sub_premium: N,
      sub_enterprise: N,
    },
  },
  {
    id: "ads_free",
    groupPl: "Reklama i monetyzacja",
    groupEn: "Advertising & monetization",
    pl: "Doświadczenie bez reklam",
    en: "Ad-free experience",
    matrix: {
      super_admin: F,
      admin: F,
      editor: F,
      author: F,
      user: N,
      sub_free: N,
      sub_basic: P,
      sub_premium: F,
      sub_enterprise: F,
    },
  },
];

const LEVEL_BADGE: Record<Level, { pl: string; en: string; className: string }> = {
  full: {
    pl: "Pełny",
    en: "Full",
    className:
      "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900",
  },
  partial: {
    pl: "Częściowy",
    en: "Partial",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-900",
  },
  none: {
    pl: "Brak",
    en: "None",
    className: "bg-muted text-muted-foreground border-border",
  },
};

function LevelCell({ level, lang }: { level: Level; lang: string }) {
  const meta = LEVEL_BADGE[level];
  const label = lang === "pl" ? meta.pl : meta.en;
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center gap-1 min-w-[68px] px-2 py-0.5 border rounded-[5px] text-[11px] font-medium",
        meta.className,
      )}
      title={label}
      aria-label={label}
    >
      {level === "full" && <Check className="w-3 h-3" aria-hidden />}
      {level === "partial" && <Minus className="w-3 h-3" aria-hidden />}
      {level === "none" && <span className="w-3 h-3 inline-block" aria-hidden />}
      <span>{label}</span>
    </div>
  );
}

function PermissionsMatrix() {
  const { i18n } = useTranslation();
  const lang = i18n.language.startsWith("pl") ? "pl" : "en";
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | "role" | "subscriber">("all");

  const visibleRoles = useMemo(
    () => (kind === "all" ? ROLES : ROLES.filter((r) => r.kind === kind)),
    [kind],
  );

  const filteredCaps = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return CAPS;
    return CAPS.filter((c) =>
      [c.pl, c.en, c.groupPl, c.groupEn].some((s) => s.toLowerCase().includes(needle)),
    );
  }, [q]);

  const grouped = useMemo(() => {
    const map = new Map<string, Capability[]>();
    for (const c of filteredCaps) {
      const key = lang === "pl" ? c.groupPl : c.groupEn;
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [filteredCaps, lang]);

  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-brand" aria-hidden />
          <h1 className="text-2xl font-bold font-display">
            {t("Macierz uprawnień", "Permissions matrix")}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-3xl">
          {t(
            "Zakres możliwości poszczególnych ról systemowych i poziomów subskrybentów. Widok referencyjny — źródło prawdy dla zespołu.",
            "Capability scope for each system role and subscriber tier. Reference view — single source of truth for the team.",
          )}
        </p>
      </header>

      {/* Legenda + filtry */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("Legenda:", "Legend:")}</span>
          <LevelCell level="full" lang={lang} />
          <LevelCell level="partial" lang={lang} />
          <LevelCell level="none" lang={lang} />
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-[5px] border border-border overflow-hidden">
            {(["all", "role", "subscriber"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition",
                  kind === k
                    ? "bg-brand text-brand-foreground"
                    : "bg-card text-foreground hover:bg-muted",
                )}
              >
                {k === "all" && t("Wszyscy", "All")}
                {k === "role" && t("Role", "Roles")}
                {k === "subscriber" && t("Subskrybenci", "Subscribers")}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search
              className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Szukaj uprawnienia…", "Search capability…")}
              className="pl-8 h-8 w-64 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Karty ról */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {visibleRoles.map((r) => {
          const Icon = r.icon;
          return (
            <article
              key={r.id}
              className={cn("border rounded-[5px] p-3 flex gap-3 items-start bg-card", r.tone)}
            >
              <div className="w-9 h-9 rounded-[5px] bg-background/60 border border-border/60 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm leading-tight">{t(r.pl, r.en)}</h3>
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0"
                  >
                    {r.kind === "role" ? t("rola", "role") : t("subskrybent", "subscriber")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-snug">
                  {t(r.descPl, r.descEn)}
                </p>
              </div>
            </article>
          );
        })}
      </section>

      {/* Macierz */}
      <section className="border border-border rounded-[5px] overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/60">
                <th className="sticky left-0 z-10 bg-muted/60 text-left font-semibold px-3 py-2 border-b border-border min-w-[260px]">
                  {t("Uprawnienie", "Capability")}
                </th>
                {visibleRoles.map((r) => (
                  <th
                    key={r.id}
                    className="text-center font-semibold px-2 py-2 border-b border-border whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-1">
                      <r.icon className="w-3.5 h-3.5" aria-hidden />
                      {t(r.pl, r.en)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map(([groupLabel, rows]) => (
                <>
                  <tr key={`g-${groupLabel}`} className="bg-muted/30">
                    <td
                      colSpan={visibleRoles.length + 1}
                      className="px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground border-b border-border"
                    >
                      {groupLabel}
                    </td>
                  </tr>
                  {rows.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                      <td className="sticky left-0 z-[1] bg-card hover:bg-muted/20 px-3 py-2 border-b border-border/60 font-medium">
                        {t(c.pl, c.en)}
                      </td>
                      {visibleRoles.map((r) => (
                        <td key={r.id} className="text-center px-2 py-2 border-b border-border/60">
                          <LevelCell level={c.matrix[r.id] ?? N} lang={lang} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ))}
              {filteredCaps.length === 0 && (
                <tr>
                  <td
                    colSpan={visibleRoles.length + 1}
                    className="px-3 py-6 text-center text-sm text-muted-foreground"
                  >
                    {t("Brak wyników.", "No results.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        {t(
          "Uwaga: rzeczywisty dostęp jest egzekwowany przez RLS w bazie danych (public.has_role) oraz przez plany dostępu (access_plans / membership_tiers). Ta strona dokumentuje zamierzony zakres.",
          "Note: actual access is enforced by database RLS (public.has_role) and access plans (access_plans / membership_tiers). This page documents the intended scope.",
        )}
      </p>
    </div>
  );
}
