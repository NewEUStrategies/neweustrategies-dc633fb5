// Widgety klubów dyskusyjnych: `club-card` i `club-threads` (spec §5.5).
//
// CZEGO TU NIE BYŁO. Specyfikacja wymienia oba widgety jako powierzchnie modułu
// POZA modułem - i to jest ich cały sens: klub żyje na `/club`, a redakcja
// potrzebuje go na stronie głównej, w dossier i w lądowaniu kampanii. Bez nich
// jedyną drogą do klubu był bezpośredni adres.
//
// WIDOCZNOŚĆ JEST W BAZIE, nie tutaj. `club_view` zwraca anonimowi wyłącznie
// kluby `public` o statusie `active`, a `club_activity_feed` jest nadane roli
// `authenticated` i liczy `club_capabilities` per wiersz. Widget nie ma więc
// czym pokazać klubu, którego wołający i tak by nie zobaczył - a to jest ta
// własność, której nie wolno przenosić do komponentu.
//
// PUSTY STAN JEST CICHY. Widget bez skonfigurowanego klubu (albo z klubem,
// którego czytelnik nie widzi) renderuje `null`, a nie ramkę z komunikatem:
// karta „nie masz dostępu" na stronie głównej ujawnia istnienie klubu
// zamkniętego dokładnie tym, przed kim jest zamknięty. Redaktor widzi
// podpowiedź w panelu, czytelnik - nic.
//
// i18n PL/EN, tokeny motywu, 6px rounding - jak w pozostałych widgetach.
import { useQuery } from "@tanstack/react-query";
import { AppLink } from "@/components/atoms/AppLink";
import { MessagesSquare, Users } from "@/lib/lucide-shim";
import type { WidgetContent } from "@/lib/builder/types";
import { clubCardQueryOptions, clubThreadsQueryOptions } from "@/lib/builder/clubsQuery";
import { getBool, getNum, getStr, type Lang } from "./frame";

function locStr(c: WidgetContent, base: string, lang: Lang): string {
  return getStr(c, `${base}_${lang}`) || getStr(c, `${base}_pl`) || getStr(c, `${base}_en`);
}

const CTA_FALLBACK: Record<Lang, string> = { pl: "Zobacz klub", en: "Open the club" };
const HEADING_FALLBACK: Record<Lang, string> = {
  pl: "Dyskusje w klubach",
  en: "Club discussions",
};
const MEMBERS_LABEL: Record<Lang, string> = { pl: "członków", en: "members" };
const THREADS_LABEL: Record<Lang, string> = { pl: "wątków", en: "topics" };

export function ClubCardView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const slug = getStr(c, "clubSlug");
  const showStats = getBool(c, "showStats", true);
  const cta = locStr(c, "ctaLabel", lang) || CTA_FALLBACK[lang];

  const { data } = useQuery(clubCardQueryOptions(slug));
  if (!data) return null;

  const name = lang === "pl" ? data.name_pl || data.name_en : data.name_en || data.name_pl;
  const tagline =
    lang === "pl"
      ? (data.tagline_pl ?? data.tagline_en ?? "")
      : (data.tagline_en ?? data.tagline_pl ?? "");
  // Akcent klubu jest jego danymi redakcyjnymi, nie stylem widgetu - dlatego
  // jedzie z bazy, a nie z ustawień w panelu.
  const accent = data.accent_color ?? "";

  return (
    <AppLink
      href={`/club/${data.slug}`}
      className="block overflow-hidden rounded-md border border-border bg-card transition-colors hover:border-primary/40"
      style={accent !== "" ? { borderTopColor: accent, borderTopWidth: 3 } : undefined}
    >
      {data.cover_image_url !== null && data.cover_image_url !== "" ? (
        <img
          src={data.cover_image_url}
          alt=""
          loading="lazy"
          className="h-32 w-full object-cover"
        />
      ) : null}
      <div className="space-y-2 p-4">
        <h3 className="text-lg font-semibold leading-snug">{name}</h3>
        {tagline !== "" ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{tagline}</p>
        ) : null}
        {showStats ? (
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {data.member_count} {MEMBERS_LABEL[lang]}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MessagesSquare className="h-3.5 w-3.5" aria-hidden="true" />
              {data.thread_count} {THREADS_LABEL[lang]}
            </span>
          </div>
        ) : null}
        <span className="inline-block pt-1 text-sm font-medium text-primary">{cta}</span>
      </div>
    </AppLink>
  );
}

export function ClubThreadsView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const heading = locStr(c, "heading", lang) || HEADING_FALLBACK[lang];
  const sort = getStr(c, "sort") || "hot";
  const policyArea = getStr(c, "policyArea");
  const limit = getNum(c, "limit", 4);

  const { data } = useQuery(clubThreadsQueryOptions({ sort, policyArea, limit }));
  const rows = data ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{heading}</h2>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.thread_id}>
            <AppLink
              href={`/club/${row.club_slug}/t/${row.thread_slug}`}
              className="block rounded-md border border-border bg-card p-3 transition-colors hover:border-primary/40"
            >
              {/* Nazwa klubu PRZED tytułem: widget stoi poza modułem, więc bez
                  niej czytelnik nie wie, dokąd właściwie prowadzi odnośnik. */}
              <span className="text-xs font-medium text-primary">
                {lang === "pl"
                  ? row.club_name_pl || row.club_name_en
                  : row.club_name_en || row.club_name_pl}
              </span>
              <p className="mt-0.5 font-medium leading-snug">{row.title}</p>
              <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <MessagesSquare className="h-3 w-3" aria-hidden="true" />
                {row.reply_count}
              </span>
            </AppLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
