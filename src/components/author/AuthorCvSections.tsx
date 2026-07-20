import React from "react";
// Sekcja CV na publicznym profilu autora `/author/$slug`.
// Renderuje doświadczenie zawodowe, edukację, umiejętności, nagrody i hobby.
// Pusta sekcja (brak danych) nie jest w ogóle wyświetlana — nie chcemy
// pokazywać nagłówka bez treści.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Briefcase,
  GraduationCap,
  Sparkles,
  Award,
  Heart,
  MapPin,
  ExternalLink,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { authorCvQueryOptions, type AuthorCv } from "@/lib/queries/authorCv";
import { formatDate } from "@/lib/i18n/format";
import { useAuth } from "@/hooks/useAuth";
import { useConnectionStatuses } from "@/lib/network/useConnections";
import { useSkillEndorsements, useToggleEndorsement } from "@/lib/network/useEndorsements";
import {
  CvDownloadButton,
  CvPrintSheet,
  type CvPrintIdentity,
} from "@/components/author/CvPrintSheet";

interface Props {
  userId: string | null | undefined;
  /** Tożsamość do nagłówka arkusza PDF; bez niej przycisk eksportu nie
   *  jest pokazywany (arkusz bez imienia byłby bezużyteczny). */
  printIdentity?: CvPrintIdentity;
}

function formatDateRange(
  start: string | null,
  end: string | null,
  isCurrent: boolean | null,
  isPl: boolean,
): string {
  const fmt = (d: string | null) => {
    if (!d) return "";
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) return "";
    return formatDate(parsed, isPl ? "pl" : "en", { year: "numeric", month: "short" });
  };
  const s = fmt(start);
  const e = isCurrent ? (isPl ? "obecnie" : "present") : fmt(end);
  if (s && e) return `${s} — ${e}`;
  return s || e;
}

export function AuthorCvSections({ userId, printIdentity }: Props): React.ReactElement | null {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const { data } = useQuery(authorCvQueryOptions(userId));

  if (!data) return null;
  const { experiences, education, skills, awards, hobbies } = data;
  const hasAny =
    experiences.length + education.length + skills.length + awards.length + hobbies.length > 0;
  if (!hasAny) return null;

  return (
    <section className="max-w-[1200px] mx-auto px-4 lg:px-8 pt-2 pb-10 space-y-10">
      {printIdentity && (
        <div className="flex justify-end -mb-6">
          <CvDownloadButton identity={printIdentity} />
        </div>
      )}
      {printIdentity && <CvPrintSheet identity={printIdentity} cv={data} />}
      {experiences.length > 0 && <ExperienceSection items={experiences} isPl={isPl} />}
      {education.length > 0 && <EducationSection items={education} isPl={isPl} />}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {skills.length > 0 && (
          <div className="lg:col-span-2">
            <SkillsSection items={skills} isPl={isPl} authorId={userId ?? null} />
          </div>
        )}
        {hobbies.length > 0 && (
          <div>
            <HobbiesSection items={hobbies} isPl={isPl} />
          </div>
        )}
      </div>
      {awards.length > 0 && <AwardsSection items={awards} isPl={isPl} />}
    </section>
  );
}

// ---------------------------------------------------------------------------

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: typeof Briefcase;
  title: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="w-5 h-5 text-brand" />
      <h2 className="font-display text-xl lg:text-2xl">{title}</h2>
    </div>
  );
}

function ExperienceSection({
  items,
  isPl,
}: {
  items: AuthorCv["experiences"];
  isPl: boolean;
}): React.ReactElement {
  return (
    <div>
      <SectionHeader icon={Briefcase} title={isPl ? "Doświadczenie zawodowe" : "Experience"} />
      <ol className="relative border-l border-border ml-3 space-y-6">
        {items.map((e) => (
          <li key={e.id} className="pl-5 relative">
            <span
              className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-brand"
              aria-hidden
            />
            <div className="flex flex-col sm:flex-row sm:items-start gap-3">
              {e.logo_url && (
                <img
                  src={e.logo_url}
                  alt=""
                  className="w-10 h-10 rounded object-cover border border-border shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h3 className="font-semibold">
                    {e.role_title || (isPl ? "Stanowisko" : "Role")}
                  </h3>
                  {e.company && <span className="text-muted-foreground">· {e.company}</span>}
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-0.5">
                  <span>{formatDateRange(e.start_date, e.end_date, e.is_current, isPl)}</span>
                  {e.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {e.location}
                    </span>
                  )}
                </div>
                {e.description && (
                  <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">
                    {e.description}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EducationSection({
  items,
  isPl,
}: {
  items: AuthorCv["education"];
  isPl: boolean;
}): React.ReactElement {
  return (
    <div>
      <SectionHeader icon={GraduationCap} title={isPl ? "Edukacja" : "Education"} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map((e) => (
          <article key={e.id} className="rounded-lg border border-border bg-card p-4 flex gap-3">
            {e.logo_url && (
              <img
                src={e.logo_url}
                alt=""
                className="w-10 h-10 rounded object-cover border border-border shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold">{e.school || (isPl ? "Uczelnia" : "School")}</h3>
              {(e.degree || e.field) && (
                <div className="text-sm text-muted-foreground">
                  {[e.degree, e.field].filter(Boolean).join(" · ")}
                </div>
              )}
              <div className="text-xs text-muted-foreground mt-0.5">
                {formatDateRange(e.start_date, e.end_date, null, isPl)}
              </div>
              {e.description && (
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">
                  {e.description}
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function SkillsSection({
  items,
  isPl,
  authorId,
}: {
  items: AuthorCv["skills"];
  isPl: boolean;
  authorId: string | null;
}): React.ReactElement {
  const grouped = items.reduce<Record<string, AuthorCv["skills"]>>((acc, s) => {
    const key = s.category ?? "";
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});
  const groups = Object.entries(grouped);

  return (
    <div>
      <SectionHeader icon={Sparkles} title={isPl ? "Umiejętności" : "Skills"} />
      <div className="space-y-4">
        {groups.map(([category, list]) => (
          <div key={category || "default"}>
            {category && (
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                {category}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {list.map((s) => (
                <SkillChip key={s.id} skill={s} authorId={authorId} isPl={isPl} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillChip({
  skill,
  authorId,
  isPl,
}: {
  skill: AuthorCv["skills"][number];
  authorId: string | null;
  isPl: boolean;
}): React.ReactElement {
  const endorsementsQ = useSkillEndorsements(authorId);
  const toggle = useToggleEndorsement(authorId ?? "");
  const { user } = useAuth();
  const statusesQ = useConnectionStatuses(
    user && authorId && authorId !== user.id ? [authorId] : [],
  );

  const row = endorsementsQ.data?.find((r) => r.skill_id === skill.id);
  const count = row?.cnt ?? 0;
  const byMe = row?.by_me ?? false;

  const isOwner = !!user && !!authorId && user.id === authorId;
  const connected = statusesQ.data?.get(authorId ?? "")?.status === "connected";
  const canEndorse = !!user && !isOwner && connected;

  const handleClick = () => {
    if (!canEndorse) return;
    toggle.mutate(
      { skillId: skill.id, endorsed: byMe },
      { onError: (e) => toast.error(e.message) },
    );
  };

  const title = !user
    ? isPl
      ? "Zaloguj się, aby poprzeć"
      : "Sign in to endorse"
    : isOwner
      ? isPl
        ? "Nie możesz poprzeć własnej umiejętności"
        : "You can't endorse your own skill"
      : !connected
        ? isPl
          ? "Aby poprzeć, musisz być połączony w sieci kontaktów"
          : "Connect first to endorse this skill"
        : byMe
          ? isPl
            ? "Cofnij poparcie"
            : "Remove endorsement"
          : isPl
            ? "Poprzyj tę umiejętność"
            : "Endorse this skill";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canEndorse || toggle.isPending}
      title={title}
      aria-pressed={byMe}
      className={
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors " +
        (byMe
          ? "border-brand bg-brand/10 text-brand"
          : "border-border bg-card hover:border-brand/60") +
        (canEndorse ? " cursor-pointer" : " cursor-default")
      }
    >
      <span>{skill.label}</span>
      {typeof skill.level === "number" && skill.level > 0 && (
        <span
          className="flex gap-0.5"
          role="meter"
          aria-label={`${skill.label} ${skill.level}/5`}
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={skill.level}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={
                "w-1.5 h-1.5 rounded-full " + (n <= (skill.level ?? 0) ? "bg-brand" : "bg-muted")
              }
            />
          ))}
        </span>
      )}
      {count > 0 && (
        <span
          aria-label={
            isPl ? `${count} osób poparło` : `${count} endorsement${count === 1 ? "" : "s"}`
          }
          className={
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium " +
            (byMe ? "bg-brand text-brand-foreground" : "bg-muted text-foreground/80")
          }
        >
          <ThumbsUp className="h-3 w-3" aria-hidden />
          {count}
        </span>
      )}
    </button>
  );
}

function HobbiesSection({
  items,
  isPl,
}: {
  items: AuthorCv["hobbies"];
  isPl: boolean;
}): React.ReactElement {
  return (
    <div>
      <SectionHeader icon={Heart} title={isPl ? "Zainteresowania" : "Interests"} />
      <div className="flex flex-wrap gap-2">
        {items.map((h) => (
          <span
            key={h.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm"
          >
            {h.icon && <span aria-hidden>{h.icon}</span>}
            {h.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function AwardsSection({
  items,
  isPl,
}: {
  items: AuthorCv["awards"];
  isPl: boolean;
}): React.ReactElement {
  return (
    <div>
      <SectionHeader
        icon={Award}
        title={isPl ? "Wyróżnienia i certyfikaty" : "Awards & certifications"}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((a) => {
          const inner = (
            <>
              <div className="flex items-start gap-2">
                {a.icon && (
                  <span aria-hidden className="text-xl">
                    {a.icon}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm">{a.title}</h3>
                  {a.issuer && <div className="text-xs text-muted-foreground">{a.issuer}</div>}
                  {a.awarded_at && (
                    <div className="text-xs text-muted-foreground">
                      {new Date(a.awarded_at).toLocaleDateString(isPl ? "pl-PL" : "en-US", {
                        year: "numeric",
                        month: "long",
                      })}
                    </div>
                  )}
                </div>
                {a.url && <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
              </div>
              {a.description && (
                <p className="text-xs text-muted-foreground mt-2 whitespace-pre-line">
                  {a.description}
                </p>
              )}
            </>
          );
          return a.url ? (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border bg-card p-4 hover:border-brand transition-colors"
            >
              {inner}
            </a>
          ) : (
            <article key={a.id} className="rounded-lg border border-border bg-card p-4">
              {inner}
            </article>
          );
        })}
      </div>
    </div>
  );
}
