// Widget "Sugerowane linki wewnętrzne" w edytorze wpisów.
// Woła server function `suggestInternalLinks` i pozwala szybko skopiować
// ścieżkę do wpisu lub otworzyć podgląd. Wspiera PL/EN i18n.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Copy, ExternalLink, Loader2, Sparkles } from "@/lib/lucide-shim";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { suggestInternalLinks } from "@/lib/seo/linkSuggestions.functions";

interface Props {
  postId: string | null;
  titlePl: string | null;
  titleEn: string | null;
  contentPl: string | null;
  contentEn: string | null;
  categoryIds: string[];
  tagIds: string[];
}

export function InternalLinkSuggestions(props: Props) {
  const { t, i18n } = useTranslation();
  const call = useServerFn(suggestInternalLinks);

  const key = useMemo(
    () => [
      "seo-link-suggestions",
      props.postId ?? "new",
      props.categoryIds.slice().sort().join(","),
      props.tagIds.slice().sort().join(","),
      (props.titlePl ?? "").slice(0, 120),
      (props.titleEn ?? "").slice(0, 120),
    ],
    [props.postId, props.categoryIds, props.tagIds, props.titlePl, props.titleEn],
  );

  const enabled =
    props.categoryIds.length > 0 ||
    props.tagIds.length > 0 ||
    Boolean(props.titlePl && props.titlePl.length >= 4) ||
    Boolean(props.titleEn && props.titleEn.length >= 4);

  const q = useQuery({
    queryKey: key,
    enabled,
    staleTime: 60_000,
    queryFn: () =>
      call({
        data: {
          postId: props.postId,
          titlePl: props.titlePl,
          titleEn: props.titleEn,
          contentPl: props.contentPl,
          contentEn: props.contentEn,
          categoryIds: props.categoryIds,
          tagIds: props.tagIds,
          limit: 8,
        },
      }),
  });

  const lang = i18n.language?.startsWith("en") ? "en" : "pl";

  const copyLink = async (slug: string, title: string) => {
    const url = `/${slug}`;
    const html = `<a href="${url}">${title}</a>`;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([url], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(html);
      }
      toast.success(
        t("admin.seo.linkSuggestions.copied", {
          defaultValue: "Skopiowano link do schowka",
        }),
      );
    } catch {
      toast.error(
        t("admin.seo.linkSuggestions.copyFail", {
          defaultValue: "Nie udało się skopiować",
        }),
      );
    }
  };

  const reasonLabel = (r: string) =>
    r === "category"
      ? t("admin.seo.linkSuggestions.reasonCategory", { defaultValue: "kategoria" })
      : r === "tag"
        ? t("admin.seo.linkSuggestions.reasonTag", { defaultValue: "tag" })
        : t("admin.seo.linkSuggestions.reasonContent", { defaultValue: "treść" });

  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium">
        <Sparkles className="h-3.5 w-3.5 text-brand" aria-hidden />
        <span>
          {t("admin.seo.linkSuggestions.title", {
            defaultValue: "Sugerowane linki wewnętrzne",
          })}
        </span>
        {q.isFetching ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
      </div>

      {!enabled ? (
        <p className="text-[11px] text-muted-foreground">
          {t("admin.seo.linkSuggestions.hint", {
            defaultValue: "Wybierz kategorię/tagi lub uzupełnij tytuł, aby zobaczyć propozycje.",
          })}
        </p>
      ) : q.data && q.data.length > 0 ? (
        <ul className="space-y-1.5">
          {q.data.map((s) => {
            const title = (lang === "en" ? s.title_en : s.title_pl) ?? s.title_pl ?? s.slug;
            return (
              <li
                key={s.id}
                className="flex items-start justify-between gap-2 rounded-[6px] border border-border/50 bg-background/60 px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{title}</div>
                  <div className="text-[10px] text-muted-foreground flex flex-wrap gap-1 mt-0.5">
                    {s.reasons.map((r) => (
                      <span
                        key={r}
                        className="rounded-[4px] bg-muted px-1.5 py-0.5 tabular-nums"
                      >
                        {reasonLabel(r)}
                      </span>
                    ))}
                    <span className="text-muted-foreground/70">/{s.slug}</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => copyLink(s.slug, title)}
                    title={t("admin.seo.linkSuggestions.copy", {
                      defaultValue: "Kopiuj link",
                    })}
                  >
                    <Copy className="h-3 w-3" aria-hidden />
                  </Button>
                  <a
                    href={`/${s.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] hover:bg-muted"
                    title={t("admin.seo.linkSuggestions.open", {
                      defaultValue: "Otwórz",
                    })}
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      ) : q.isLoading ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {t("admin.seo.linkSuggestions.loading", { defaultValue: "Szukam kandydatów..." })}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Link2 className="h-3 w-3" aria-hidden />
          {t("admin.seo.linkSuggestions.empty", {
            defaultValue: "Brak dopasowań w tym tenantcie.",
          })}
        </p>
      )}
    </div>
  );
}
