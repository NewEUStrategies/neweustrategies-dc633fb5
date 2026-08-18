// Mega menu - "showcase" layout (grid-card variant).
// Alternative to the classic column layout: links with a description render as
// GridCards with a soft grid backdrop, short links render as compact rows with
// an arrow affordance. 6px rounding, semantic tokens only, PL/EN via the
// localized keys already stored on the menu config.
import { memo } from "react";

import { AppLink } from "@/components/atoms/AppLink";
import { GridCard } from "@/components/ui/grid-card";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { MegaMenuArrowIcon, resolveMegaMenuIcon } from "@/lib/megaMenu/showcaseIcons";
import { safeUrl } from "@/lib/sanitizePure";

export type ShowcaseLang = "pl" | "en";

export interface ShowcaseLink {
  label_pl?: string;
  label_en?: string;
  desc_pl?: string;
  desc_en?: string;
  href?: string;
  icon?: string;
}

export interface ShowcaseColumn {
  kind?: string;
  title_pl?: string;
  title_en?: string;
  href?: string;
  links?: ShowcaseLink[];
}

interface Props {
  columns: ShowcaseColumn[];
  lang: ShowcaseLang;
}

interface ResolvedLink {
  label: string;
  desc: string;
  href: string;
  icon: ReturnType<typeof resolveMegaMenuIcon>;
}

function resolveLinks(col: ShowcaseColumn, lang: ShowcaseLang): ResolvedLink[] {
  const links = Array.isArray(col.links) ? col.links : [];
  return links
    .map((l) => ({
      label: pickLocalized(l as unknown as Record<string, unknown>, "label", lang),
      desc: pickLocalized(l as unknown as Record<string, unknown>, "desc", lang),
      href: safeUrl(l.href ?? "#"),
      icon: resolveMegaMenuIcon(l.icon),
    }))
    .filter((l) => l.label.length > 0);
}

function ShowcaseHeading({ title, href }: { title: string; href?: string }) {
  if (!title) return null;
  const cls = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";
  const safe = safeUrl(href ?? "", "");
  return safe ? (
    <AppLink href={safe} className={`${cls} hover:text-brand-ink transition`}>
      {title}
    </AppLink>
  ) : (
    <span className={cls}>{title}</span>
  );
}

function ShowcaseCard({ link }: { link: ResolvedLink }) {
  const Icon = link.icon;
  return (
    <AppLink href={link.href} className="group block">
      <GridCard seed={link.label} className="h-full">
        <div className="flex items-start gap-3 p-3.5">
          {Icon && (
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-border bg-background text-brand-ink transition-colors group-hover:border-brand/60">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight text-foreground">
              {link.label}
            </span>
            {link.desc && (
              <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                {link.desc}
              </span>
            )}
          </span>
        </div>
      </GridCard>
    </AppLink>
  );
}

function ShowcaseRow({ link }: { link: ResolvedLink }) {
  const Icon = link.icon;
  return (
    <AppLink
      href={link.href}
      className="group flex items-center gap-2.5 rounded-[6px] px-2 py-2 text-sm text-foreground transition-colors hover:bg-muted"
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate font-medium">{link.label}</span>
      <MegaMenuArrowIcon
        className="h-3.5 w-3.5 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
        aria-hidden="true"
      />
    </AppLink>
  );
}

export const MegaMenuShowcase = memo(function MegaMenuShowcase({ columns, lang }: Props) {
  return (
    <div
      className="grid gap-6"
      style={{
        gridTemplateColumns: `repeat(${Math.min(Math.max(columns.length, 1), 4)}, minmax(0, 1fr))`,
      }}
    >
      {columns.map((col, i) => {
        const links = resolveLinks(col, lang);
        const cards = links.filter((l) => l.desc.length > 0);
        const rows = links.filter((l) => l.desc.length === 0);
        return (
          <div key={i} className="min-w-0 space-y-3">
            <ShowcaseHeading
              title={pickLocalized(col as unknown as Record<string, unknown>, "title", lang)}
              href={col.href}
            />
            {cards.length > 0 && (
              <div className="grid gap-2.5">
                {cards.map((l, k) => (
                  <ShowcaseCard key={k} link={l} />
                ))}
              </div>
            )}
            {rows.length > 0 && (
              <div className="grid gap-0.5 rounded-[6px] border border-border/60 p-1">
                {rows.map((l, k) => (
                  <ShowcaseRow key={k} link={l} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
MegaMenuShowcase.displayName = "MegaMenuShowcase";
