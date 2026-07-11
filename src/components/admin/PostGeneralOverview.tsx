import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  FileText,
  Search,
  Layers,
  Lock,
  Link as LinkIconLucide,
  Settings as SettingsIcon,
  Tags as TagIcon,
} from "@/lib/lucide-shim";
import { Database, History, ListChecks } from "lucide-react";
import type { SeoIssue } from "@/lib/seo/validation";
import type { LayoutOverrides, PostFormat } from "@/lib/postLayouts";
import type { TocOverride } from "@/lib/toc/settings";

/**
 * Live-synced overview of every "details" tab. Every summary tile reads its
 * value from the same form state that owns the corresponding editor tab, so
 * changes flow both ways in real time. Tiles that reference DB-only state
 * (access rule, revisions) subscribe via useQuery keyed by entityId.
 */

type DetailsTab =
  | "general"
  | "settings"
  | "seo"
  | "meta"
  | "related"
  | "publish"
  | "layout"
  | "taxonomy"
  | "access"
  | "revisions";

type Props = {
  entityId: string;
  titlePl: string;
  titleEn: string;
  onTitlePlChange: (v: string) => void;
  onTitleEnChange: (v: string) => void;
  excerptPl: string;
  excerptEn: string;
  onExcerptPlChange: (v: string) => void;
  onExcerptEnChange: (v: string) => void;

  status: string;
  slug: string;
  coverImageUrl: string | null;
  publishedAt: string | null;
  publishAt: string | null;

  seoTitlePl: string | null;
  seoTitleEn: string | null;
  seoDescriptionPl: string | null;
  seoDescriptionEn: string | null;
  seoNoindex: boolean;
  seoIssues: SeoIssue[];

  tocOverride: TocOverride | null;
  takeawaysPl: string[];
  takeawaysEn: string[];

  customMeta: Record<string, string> | null;
  relatedOverride: Record<string, unknown> | null;

  postFormat: PostFormat;
  layoutOverrides: LayoutOverrides | null;

  selectedCatNames: string[];
  selectedTagNames: string[];

  onNavigate: (tab: DetailsTab) => void;
};

const titles = {
  general: "Ogólne",
  settings: "Ustawienia strony",
  seo: "SEO",
  meta: "Custom meta",
  related: "Powiązane wpisy",
  publish: "Publikacja",
  layout: "Layout",
  taxonomy: "Kategorie i tagi",
  access: "Dostęp / Paywall",
  revisions: "Historia zmian",
} as const;

function Tile({
  onClick,
  icon: Icon,
  title,
  badge,
  children,
  tone = "default",
}: {
  onClick: () => void;
  icon: React.ElementType;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  tone?: "default" | "warn" | "ok" | "muted";
}) {
  const toneRing =
    tone === "warn"
      ? "hover:border-amber-500/60"
      : tone === "ok"
        ? "hover:border-emerald-500/60"
        : "hover:border-brand/60";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group text-left bg-card border border-border rounded-xl p-4 transition-all hover:shadow-md ${toneRing} focus:outline-none focus:ring-2 focus:ring-brand/40`}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex w-8 h-8 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-brand/10 group-hover:text-brand transition-colors shrink-0">
            <Icon className="w-4 h-4" />
          </span>
          <h3 className="text-sm font-semibold truncate">{title}</h3>
        </div>
        {badge}
      </div>
      <div className="text-xs text-muted-foreground space-y-1">{children}</div>
    </button>
  );
}

function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "ok" | "warn" | "brand" | "danger";
}) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : tone === "brand"
          ? "bg-brand/10 text-brand"
          : tone === "danger"
            ? "bg-destructive/15 text-destructive"
            : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium truncate max-w-[60%] text-right">{value}</span>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pl-PL", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function PostGeneralOverview({
  entityId,
  titlePl,
  titleEn,
  onTitlePlChange,
  onTitleEnChange,
  excerptPl,
  excerptEn,
  onExcerptPlChange,
  onExcerptEnChange,
  status,
  slug,
  coverImageUrl,
  publishedAt,
  publishAt,
  seoTitlePl,
  seoTitleEn,
  seoDescriptionPl,
  seoDescriptionEn,
  seoNoindex,
  seoIssues,
  tocOverride,
  takeawaysPl,
  takeawaysEn,
  customMeta,
  relatedOverride,
  postFormat,
  layoutOverrides,
  selectedCatNames,
  selectedTagNames,
  onNavigate,
}: Props) {
  const { data: accessRule } = useQuery({
    queryKey: ["content_access", "post", entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const [{ data }, { data: hp }] = await Promise.all([
        supabase
          .from("content_access")
          .select("mode, plan_ids, one_time_price_cents, one_time_currency")
          .eq("entity_type", "post")
          .eq("entity_id", entityId)
          .maybeSingle(),
        supabase.rpc("content_access_has_password", {
          _entity_type: "post",
          _entity_id: entityId,
        }),
      ]);
      return data ? { ...data, has_password: !!hp } : null;
    },
    staleTime: 15_000,
  });

  const { data: revisionsCount } = useQuery({
    queryKey: ["content_revisions_count", "post", entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const { count } = await supabase
        .from("content_revisions")
        .select("*", { count: "exact", head: true })
        .eq("entity_type", "post")
        .eq("entity_id", entityId);
      return count ?? 0;
    },
    staleTime: 15_000,
  });

  const titleFilled = !!titlePl.trim() && !!titleEn.trim();
  const excerptFilled = !!excerptPl.trim() && !!excerptEn.trim();

  const blockingSeo = seoIssues.filter((i) => i.severity === "error").length;
  const warnSeo = seoIssues.filter((i) => i.severity === "warning").length;

  const takeawaysCount = Math.max(takeawaysPl.length, takeawaysEn.length);

  const customMetaCount = useMemo(() => {
    if (!customMeta) return 0;
    return Object.values(customMeta).filter((v) => v != null && String(v).trim() !== "").length;
  }, [customMeta]);

  const layoutOverridesCount = useMemo(() => {
    if (!layoutOverrides) return 0;
    return Object.values(layoutOverrides).filter((v) => v !== undefined && v !== null && v !== "")
      .length;
  }, [layoutOverrides]);

  const accessMode = accessRule?.mode ?? "public";
  const accessLabel =
    accessMode === "public"
      ? "Publiczny"
      : accessMode === "members"
        ? "Członkowie"
        : accessMode === "paid"
          ? "Płatny"
          : accessMode === "password"
            ? "Hasło"
            : accessMode;

  return (
    <div className="space-y-6">
      {/* Header + inline title/excerpt inputs */}
      <div className="space-y-1">
        <h2 className="text-xl font-display font-semibold">Podsumowanie wpisu</h2>
        <p className="text-xs text-muted-foreground">
          Wszystkie karty są zsynchronizowane z pozostałymi zakładkami - kliknij kartę, aby przejść
          do edycji szczegółów. Zmiany są odzwierciedlane natychmiast w obu miejscach.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <Label className="flex items-center justify-between">
            <span>
              Tytuł <span className="text-[10px] text-muted-foreground">(PL)</span>
            </span>
            {titlePl.trim() ? <Chip tone="ok">✓</Chip> : <Chip tone="warn">brak</Chip>}
          </Label>
          <Input
            value={titlePl}
            onChange={(e) => onTitlePlChange(e.target.value)}
            className="text-lg font-display"
            placeholder="Tytuł po polsku"
          />
          <Label className="flex items-center justify-between">
            <span>
              Lead <span className="text-[10px] text-muted-foreground">(PL)</span>
            </span>
            <span className="text-[10px] text-muted-foreground font-normal">
              {excerptPl.length} zn.
            </span>
          </Label>
          <Textarea
            value={excerptPl}
            onChange={(e) => onExcerptPlChange(e.target.value)}
            rows={3}
            placeholder="Krótki opis wpisu po polsku"
          />
        </div>
        <div className="space-y-3">
          <Label className="flex items-center justify-between">
            <span>
              Tytuł <span className="text-[10px] text-muted-foreground">(EN)</span>
            </span>
            {titleEn.trim() ? <Chip tone="ok">✓</Chip> : <Chip tone="warn">brak</Chip>}
          </Label>
          <Input
            value={titleEn}
            onChange={(e) => onTitleEnChange(e.target.value)}
            className="text-lg font-display"
            placeholder="Title in English"
          />
          <Label className="flex items-center justify-between">
            <span>
              Lead <span className="text-[10px] text-muted-foreground">(EN)</span>
            </span>
            <span className="text-[10px] text-muted-foreground font-normal">
              {excerptEn.length} zn.
            </span>
          </Label>
          <Textarea
            value={excerptEn}
            onChange={(e) => onExcerptEnChange(e.target.value)}
            rows={3}
            placeholder="Short excerpt in English"
          />
        </div>
      </div>

      {/* Completion bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <span className="text-xs text-muted-foreground">Status wypełnienia:</span>
        <Chip tone={titleFilled ? "ok" : "warn"}>Tytuły {titleFilled ? "✓" : "1/2"}</Chip>
        <Chip tone={excerptFilled ? "ok" : "muted"}>Zajawki {excerptFilled ? "✓" : "opc."}</Chip>
        <Chip tone={coverImageUrl ? "ok" : "muted"}>Cover {coverImageUrl ? "✓" : "brak"}</Chip>
        <Chip tone={blockingSeo > 0 ? "danger" : warnSeo > 0 ? "warn" : "ok"}>
          SEO{" "}
          {blockingSeo > 0 ? `${blockingSeo} błędów` : warnSeo > 0 ? `${warnSeo} ostrzeżeń` : "OK"}
        </Chip>
        {seoNoindex && <Chip tone="warn">noindex</Chip>}
        <Chip tone={accessMode === "public" ? "muted" : "brand"}>Dostęp: {accessLabel}</Chip>
        <Chip tone="muted">{status}</Chip>
      </div>

      {/* Tile grid — every card is a click-through to its tab */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Tile
          onClick={() => onNavigate("publish")}
          icon={SettingsIcon}
          title={titles.publish}
          badge={<Chip tone={status === "published" ? "ok" : "muted"}>{status}</Chip>}
        >
          <Row label="Slug" value={slug || "—"} />
          <Row label="Opublikowano" value={formatDate(publishedAt)} />
          {publishAt && <Row label="Zaplanowane" value={formatDate(publishAt)} />}
          <Row label="Cover" value={coverImageUrl ? "ustawiony" : "brak"} />
        </Tile>

        <Tile
          onClick={() => onNavigate("seo")}
          icon={Search}
          title={titles.seo}
          badge={
            blockingSeo > 0 ? (
              <Chip tone="danger">{blockingSeo} błąd.</Chip>
            ) : warnSeo > 0 ? (
              <Chip tone="warn">{warnSeo} ostrz.</Chip>
            ) : (
              <Chip tone="ok">OK</Chip>
            )
          }
          tone={blockingSeo > 0 ? "warn" : "default"}
        >
          <Row label="Meta title (PL)" value={`${(seoTitlePl ?? "").length} / 60`} />
          <Row label="Meta desc. (PL)" value={`${(seoDescriptionPl ?? "").length} / 160`} />
          <Row label="Indexowanie" value={seoNoindex ? "noindex" : "index, follow"} />
          <Row label="EN" value={seoTitleEn || seoDescriptionEn ? "uzupełnione" : "z zajawki"} />
        </Tile>

        <Tile
          onClick={() => onNavigate("settings")}
          icon={ListChecks}
          title={titles.settings}
          badge={
            <Chip tone={tocOverride ? "brand" : "muted"}>
              {tocOverride ? "override" : "domyślne"}
            </Chip>
          }
        >
          <Row
            label="Table of Contents"
            value={tocOverride ? "nadpisane" : "z ustawień globalnych"}
          />
          <Row
            label="Dowiesz się (PL)"
            value={`${takeawaysPl.length} punkt${takeawaysPl.length === 1 ? "" : "y"}`}
          />
          <Row
            label="Dowiesz się (EN)"
            value={`${takeawaysEn.length} punkt${takeawaysEn.length === 1 ? "" : "y"}`}
          />
          {takeawaysCount === 0 && (
            <p className="text-[11px] italic text-muted-foreground">
              Sugerowane: 3-5 punktów, 1 zdanie = 1 myśl.
            </p>
          )}
        </Tile>

        <Tile
          onClick={() => onNavigate("access")}
          icon={Lock}
          title={titles.access}
          badge={<Chip tone={accessMode === "public" ? "muted" : "brand"}>{accessLabel}</Chip>}
        >
          <Row label="Tryb" value={accessLabel} />
          {accessMode === "paid" && (
            <>
              <Row label="Plany" value={`${(accessRule?.plan_ids ?? []).length} wybrane`} />
              {accessRule?.one_time_price_cents ? (
                <Row
                  label="Cena jednorazowa"
                  value={`${((accessRule.one_time_price_cents ?? 0) / 100).toFixed(2)} ${accessRule.one_time_currency ?? "PLN"}`}
                />
              ) : null}
            </>
          )}
          {accessMode === "password" && (
            <Row label="Hasło" value={accessRule?.password_hash ? "ustawione ✓" : "brak"} />
          )}
        </Tile>

        <Tile
          onClick={() => onNavigate("taxonomy")}
          icon={TagIcon}
          title={titles.taxonomy}
          badge={
            <Chip tone={selectedCatNames.length ? "brand" : "warn"}>
              {selectedCatNames.length} kat.
            </Chip>
          }
          tone={selectedCatNames.length === 0 ? "warn" : "default"}
        >
          <div className="flex flex-wrap gap-1">
            {selectedCatNames.slice(0, 4).map((n) => (
              <Chip key={n} tone="brand">
                {n}
              </Chip>
            ))}
            {selectedCatNames.length > 4 && <Chip>+{selectedCatNames.length - 4}</Chip>}
            {selectedCatNames.length === 0 && (
              <span className="text-[11px] italic">brak kategorii</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            {selectedTagNames.slice(0, 5).map((n) => (
              <Chip key={n}>#{n}</Chip>
            ))}
            {selectedTagNames.length > 5 && <Chip>+{selectedTagNames.length - 5}</Chip>}
            {selectedTagNames.length === 0 && (
              <span className="text-[11px] italic">brak tagów</span>
            )}
          </div>
        </Tile>

        <Tile
          onClick={() => onNavigate("layout")}
          icon={Layers}
          title={titles.layout}
          badge={<Chip>{postFormat}</Chip>}
        >
          <Row label="Format" value={postFormat} />
          <Row
            label="Overrides"
            value={layoutOverridesCount === 0 ? "brak" : `${layoutOverridesCount} pól`}
          />
        </Tile>

        <Tile
          onClick={() => onNavigate("meta")}
          icon={Database}
          title={titles.meta}
          badge={<Chip tone={customMetaCount > 0 ? "brand" : "muted"}>{customMetaCount}</Chip>}
        >
          <Row label="Wypełnione pola" value={customMetaCount === 0 ? "brak" : customMetaCount} />
        </Tile>

        <Tile
          onClick={() => onNavigate("related")}
          icon={LinkIconLucide}
          title={titles.related}
          badge={
            <Chip tone={relatedOverride ? "brand" : "muted"}>
              {relatedOverride ? "override" : "globalne"}
            </Chip>
          }
        >
          <Row
            label="Konfiguracja"
            value={relatedOverride ? "per-wpis" : "z ustawień globalnych"}
          />
        </Tile>

        <Tile
          onClick={() => onNavigate("revisions")}
          icon={History}
          title={titles.revisions}
          badge={<Chip>{revisionsCount ?? 0}</Chip>}
        >
          <Row
            label="Zapisane wersje"
            value={revisionsCount === undefined ? "—" : revisionsCount}
          />
        </Tile>
      </div>
    </div>
  );
}

export { FileText };
