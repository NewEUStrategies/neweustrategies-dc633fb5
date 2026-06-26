// Visual UI for selecting category/tag interests. Backed by `useMyInterests`
// (RLS-protected user_follows for logged-in users, localStorage for anon).
// Used both as a standalone page (/profile/interests) and inside the
// "customize-interests" Page Builder widget.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Loader2, Check, Sparkles, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInterestCatalog, useMyInterests, type InterestItem } from "@/hooks/useInterests";
import "@/lib/i18n-interests";

interface Props {
  variant?: "full" | "compact";
  showHeader?: boolean;
  className?: string;
}

export function InterestsCustomizer({ variant = "full", showHeader = true, className }: Props) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.startsWith("en") ? "en" : "pl") as "pl" | "en";
  const catalog = useInterestCatalog(lang);
  const my = useMyInterests();

  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Hydrate selection from current preferences
  useEffect(() => {
    if (!my.data) return;
    setSelectedCats(new Set(my.data.categoryIds));
    setSelectedTags(new Set(my.data.tagIds));
  }, [my.data]);

  const total = selectedCats.size + selectedTags.size;

  const toggle = (item: InterestItem) => {
    const setter = item.type === "category" ? setSelectedCats : setSelectedTags;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    setSaveState("idle");
  };

  const onSave = async () => {
    setSaveState("saving");
    setSaveErr(null);
    const res = await my.save({
      categoryIds: Array.from(selectedCats),
      tagIds: Array.from(selectedTags),
    });
    if (!res.ok) {
      setSaveErr(res.error ?? null);
      setSaveState("err");
      return;
    }
    setSaveState("ok");
    setTimeout(() => setSaveState("idle"), 2000);
  };

  const isLoading = catalog.isLoading || my.isLoading;

  const cats = catalog.data?.categories ?? [];
  const tags = catalog.data?.tags ?? [];

  return (
    <section
      className={cn(
        "w-full max-w-3xl rounded-xl border border-border bg-card",
        variant === "compact" ? "p-4" : "p-6 sm:p-8",
        className,
      )}
      aria-labelledby="interests-heading"
    >
      {showHeader && (
        <header className="mb-6">
          <div className="flex items-center gap-2 text-brand mb-2">
            <Sparkles className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">
              {t("interests.customize")}
            </span>
          </div>
          <h2 id="interests-heading" className="font-display text-2xl sm:text-3xl mb-2">
            {t("interests.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("interests.subtitle")}</p>
        </header>
      )}

      {my.isAnonymous && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <LogIn className="w-4 h-4 mt-0.5 text-brand" />
          <div className="flex-1">
            <p className="text-foreground">{t("interests.loginRequired")}</p>
            <Link
              to="/login"
              className="mt-1 inline-block text-brand font-medium hover:underline"
            >
              {t("interests.loginCta")} →
            </Link>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> {t("interests.loading")}
        </div>
      ) : (
        <div className="space-y-6">
          <InterestGroup
            title={t("interests.sectionCategories")}
            items={cats}
            selected={selectedCats}
            onToggle={toggle}
            emptyLabel={t("interests.empty")}
          />
          <InterestGroup
            title={t("interests.sectionTags")}
            items={tags}
            selected={selectedTags}
            onToggle={toggle}
            emptyLabel={t("interests.empty")}
          />
        </div>
      )}

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">
          {t("interests.selectedCount", { count: total })}
        </span>
        <div className="flex items-center gap-3">
          {saveState === "err" && saveErr && (
            <span className="text-xs text-destructive">{saveErr}</span>
          )}
          {saveState === "ok" && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5" /> {t("interests.saved")}
            </span>
          )}
          <button
            type="button"
            disabled={saveState === "saving" || isLoading}
            onClick={onSave}
            className="inline-flex items-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition disabled:opacity-60 hover:opacity-90"
          >
            {saveState === "saving" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {t("interests.save")}
          </button>
        </div>
      </footer>
    </section>
  );
}

function InterestGroup({
  title,
  items,
  selected,
  onToggle,
  emptyLabel,
}: {
  title: string;
  items: InterestItem[];
  selected: Set<string>;
  onToggle: (i: InterestItem) => void;
  emptyLabel: string;
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((it) => {
            const active = selected.has(it.id);
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onToggle(it)}
                aria-pressed={active}
                className={cn(
                  "group rounded-full border px-3 py-1.5 text-sm transition select-none",
                  active
                    ? "border-brand bg-brand text-brand-foreground"
                    : "border-border bg-background text-foreground hover:border-brand/60 hover:text-brand",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {active && <Check className="w-3.5 h-3.5" />}
                  {it.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default InterestsCustomizer;
