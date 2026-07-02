import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "@/lib/lucide-shim";
import type { TenantAuthor } from "@/components/admin/hooks/useTenantAuthors";

export type StatusFilter =
  | "all"
  | "published"
  | "draft"
  | "pending_review"
  | "scheduled"
  | "archived";
export type LangFilter = "all" | "pl_only" | "en_only" | "missing_any" | "complete";

export interface AdminListToolbarProps {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;

  status?: StatusFilter;
  onStatus?: (v: StatusFilter) => void;
  hideStatus?: boolean;

  lang?: LangFilter;
  onLang?: (v: LangFilter) => void;
  hideLang?: boolean;

  author?: string; // "all" | author id
  onAuthor?: (v: string) => void;
  authors?: TenantAuthor[];
  hideAuthor?: boolean;

  resultsCount?: number;
  totalCount?: number;

  extraRight?: React.ReactNode;
}

/**
 * Molecule: compact toolbar with search + filters for admin list pages.
 * Uses small typography to maintain the dense layout the user requested.
 */
export function AdminListToolbar({
  search,
  onSearch,
  searchPlaceholder,
  status = "all",
  onStatus,
  hideStatus = false,
  lang = "all",
  onLang,
  hideLang = false,
  author = "all",
  onAuthor,
  authors,
  hideAuthor = false,
  resultsCount,
  totalCount,
  extraRight,
}: AdminListToolbarProps) {
  const { t } = useTranslation();
  const isFiltered =
    !!search ||
    (!hideStatus && status !== "all") ||
    (!hideLang && lang !== "all") ||
    (!hideAuthor && author !== "all");

  const clearAll = () => {
    onSearch("");
    onStatus?.("all");
    onLang?.("all");
    onAuthor?.("all");
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder ?? t("admin.list.search", { defaultValue: "Szukaj…" })}
          className="pl-7 h-8 text-xs"
        />
      </div>

      {!hideStatus && onStatus && (
        <Select value={status} onValueChange={(v) => onStatus(v as StatusFilter)}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.list.status.all", { defaultValue: "Wszystkie statusy" })}</SelectItem>
            <SelectItem value="published">{t("admin.status.published")}</SelectItem>
            <SelectItem value="draft">{t("admin.status.draft")}</SelectItem>
            <SelectItem value="pending_review">{t("admin.status.pending_review")}</SelectItem>
            <SelectItem value="scheduled">{t("admin.status.scheduled")}</SelectItem>
            <SelectItem value="archived">{t("admin.status.archived")}</SelectItem>
          </SelectContent>
        </Select>
      )}

      {!hideLang && onLang && (
        <Select value={lang} onValueChange={(v) => onLang(v as LangFilter)}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.list.lang.all", { defaultValue: "Wszystkie języki" })}</SelectItem>
            <SelectItem value="complete">{t("admin.list.lang.complete", { defaultValue: "PL + EN" })}</SelectItem>
            <SelectItem value="missing_any">{t("admin.list.lang.missingAny", { defaultValue: "Brak tłumaczenia" })}</SelectItem>
            <SelectItem value="pl_only">{t("admin.list.lang.plOnly", { defaultValue: "Tylko PL" })}</SelectItem>
            <SelectItem value="en_only">{t("admin.list.lang.enOnly", { defaultValue: "Tylko EN" })}</SelectItem>
          </SelectContent>
        </Select>
      )}

      {!hideAuthor && onAuthor && authors && (
        <Select value={author} onValueChange={onAuthor}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.list.author.all", { defaultValue: "Wszyscy autorzy" })}</SelectItem>
            {authors.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.display_name || a.email || a.id.slice(0, 6)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {isFiltered && (
        <Button variant="ghost" size="sm" onClick={clearAll} className="h-8 text-xs">
          <X className="w-3.5 h-3.5 mr-1" /> {t("admin.list.clear", { defaultValue: "Wyczyść" })}
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        {typeof resultsCount === "number" && (
          <span className="text-muted-foreground tabular-nums">
            {typeof totalCount === "number" && totalCount !== resultsCount
              ? `${resultsCount} / ${totalCount}`
              : resultsCount}
          </span>
        )}
        {extraRight}
      </div>
    </div>
  );
}
