// Sekcja "Osoby i organizacje": premium karty ekspertów/autorów (avatar,
// rola, znacznik weryfikacji, dorobek) i organizacji (publikacje w archiwum).
// Osoba prowadzi do huba /author/<slug>, organizacja filtruje /search po
// termie. Prezentacyjny - dane dostarcza searchPeopleOrgsQueryOptions.
import { useTranslation } from "react-i18next";
// BadgeCheck/Building2 nie istnieją w shim pakietu ikon - trasa /search
// również importuje te "jednorazowe" ikony bezpośrednio z lucide-react.
import { BadgeCheck, Building2 } from "lucide-react";
import { FileText, User, Users } from "@/lib/lucide-shim";
import { AppLink } from "@/components/atoms/AppLink";
import type { PeopleOrgItem } from "@/lib/queries/archives";

interface Props {
  items: PeopleOrgItem[];
  lang: "pl" | "en";
}

function itemLabel(it: PeopleOrgItem, lang: "pl" | "en"): string {
  return (lang === "en" ? it.label_en || it.label_pl : it.label_pl || it.label_en) || "";
}

function itemSublabel(it: PeopleOrgItem, lang: "pl" | "en"): string | null {
  return (
    (lang === "en" ? it.sublabel_en || it.sublabel_pl : it.sublabel_pl || it.sublabel_en) ?? null
  );
}

function hrefFor(it: PeopleOrgItem): string {
  if (it.kind === "person") return `/author/${it.slug ?? it.id}`;
  return `/search?org=${encodeURIComponent(it.id)}`;
}

function PersonAvatar({ it, lang }: { it: PeopleOrgItem; lang: "pl" | "en" }) {
  if (it.avatarUrl) {
    return (
      <img
        src={it.avatarUrl}
        alt=""
        loading="lazy"
        className="h-12 w-12 shrink-0 rounded-[6px] object-cover border border-border/60"
      />
    );
  }
  const initial = itemLabel(it, lang).trim().charAt(0).toUpperCase();
  return (
    <span
      aria-hidden
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[6px] bg-brand/10 text-brand-ink font-display text-lg"
    >
      {initial || <User className="w-5 h-5" />}
    </span>
  );
}

function OrgAvatar({ it, lang }: { it: PeopleOrgItem; lang: "pl" | "en" }) {
  if (it.logoUrl) {
    return (
      <img
        src={it.logoUrl}
        alt=""
        loading="lazy"
        className="h-12 w-12 shrink-0 rounded-[6px] object-contain border border-border/60 bg-white p-0.5"
      />
    );
  }
  const initial = itemLabel(it, lang).trim().charAt(0).toUpperCase();
  return (
    <span
      aria-hidden
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[6px] bg-brand/10 text-brand-ink font-display text-lg"
    >
      {initial || <Building2 className="w-5 h-5" />}
    </span>
  );
}

function Card({ it, lang }: { it: PeopleOrgItem; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const sub = itemSublabel(it, lang);
  return (
    <li>
      <AppLink
        href={hrefFor(it)}
        className="group flex h-full items-start gap-3 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-brand"
      >
        {it.kind === "person" ? (
          <PersonAvatar it={it} lang={lang} />
        ) : (
          <OrgAvatar it={it} lang={lang} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-display font-semibold text-foreground group-hover:text-brand-ink transition-colors">
              {itemLabel(it, lang)}
            </span>
            {it.verified && (
              <BadgeCheck
                className="w-4 h-4 shrink-0 text-brand-ink"
                aria-label={t("search.people.verified")}
              />
            )}
          </span>
          {sub && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{sub}</span>
          )}
          <span className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="w-3.5 h-3.5" aria-hidden />
            <span className="tabular-nums">
              {t("search.people.publications", { count: it.postCount })}
            </span>
          </span>
        </span>
      </AppLink>
    </li>
  );
}

/** Kompaktowy pasek "Osoby i organizacje" nad wynikami sekcji "Wszystko":
 *  pigułki z avatarem/logotypem + przejście do pełnej sekcji. */
export function PeopleOrgStrip({ items, lang, onSeeAll }: Props & { onSeeAll: () => void }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Users className="w-3 h-3" aria-hidden />
        {t("search.tabs.people")}
        <button
          type="button"
          onClick={onSeeAll}
          className="ml-auto inline-flex items-center gap-1 normal-case tracking-normal text-xs font-medium text-brand-ink hover:underline"
        >
          {t("search.tabs.all")} →
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {items.map((it) => (
          <li key={`${it.kind}-${it.id}`}>
            <AppLink
              href={hrefFor(it)}
              className="group inline-flex items-center gap-2 rounded-[6px] border border-border bg-card py-1 pl-1 pr-3 text-xs transition-colors hover:border-brand"
            >
              {it.kind === "person" && it.avatarUrl ? (
                <img
                  src={it.avatarUrl}
                  alt=""
                  loading="lazy"
                  className="h-6 w-6 rounded-[6px] object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-brand/10 text-brand-ink"

                >
                  {it.kind === "person" ? (
                    <User className="w-3 h-3" />
                  ) : (
                    <Building2 className="w-3 h-3" />
                  )}
                </span>
              )}
              <span className="font-medium text-foreground group-hover:text-brand-ink transition-colors">
                {itemLabel(it, lang)}
              </span>
              {it.verified && (
                <BadgeCheck
                  className="w-3.5 h-3.5 shrink-0 text-brand-ink"
                  aria-label={t("search.people.verified")}
                />
              )}
            </AppLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PeopleOrgResults({ items, lang }: Props) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  const people = items.filter((it) => it.kind === "person");
  const orgs = items.filter((it) => it.kind === "organization");

  return (
    <div className="space-y-8">
      {people.length > 0 && (
        <section aria-label={t("search.people.people_heading")}>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            <User className="w-3.5 h-3.5" aria-hidden />
            {t("search.people.people_heading")}
            <span className="ml-auto tabular-nums text-muted-foreground/70">{people.length}</span>
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {people.map((it) => (
              <Card key={`p-${it.id}`} it={it} lang={lang} />
            ))}
          </ul>
        </section>
      )}
      {orgs.length > 0 && (
        <section aria-label={t("search.people.orgs_heading")}>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            <Building2 className="w-3.5 h-3.5" aria-hidden />
            {t("search.people.orgs_heading")}
            <span className="ml-auto tabular-nums text-muted-foreground/70">{orgs.length}</span>
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {orgs.map((it) => (
              <Card key={`o-${it.id}`} it={it} lang={lang} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
