// Karta „Powiązany profil" na stronie leada CRM — synchronizuje pola z profilu
// użytkownika (avatar, stanowisko, doświadczenie, umiejętności, Big5, CV).
// Dane pobiera server-fn `getCrmLeadProfileSync` (admin bypass ze względu na
// RLS owner-only na personality/experiences/skills), staff-check w middleware.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  UserCircle2,
  FileText,
  Briefcase,
  GraduationCap,
  Award,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { getCrmLeadProfileSync } from "@/lib/crm.functions";

type Big5 = {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  taken_at: string;
};
type Experience = {
  id: string;
  role_title: string;
  company: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  description: string | null;
  logo_url: string | null;
};
type Skill = { id: string; name: string; level: number | null; endorsements_count: number | null };
type Cv = {
  id: string;
  file_url: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  version: number;
  uploaded_at: string;
};
type Award = { id: string; title: string; issuer: string | null; issued_on: string | null };
type Education = {
  id: string;
  school: string;
  degree: string | null;
  field: string | null;
  start_date: string | null;
  end_date: string | null;
};
type Profile = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  current_company: string | null;
  location: string | null;
  slug: string | null;
  linkedin_url: string | null;
  verified_at: string | null;
  discoverable: boolean | null;
};
type Sync =
  | { matched: false }
  | {
      matched: true;
      profile: Profile;
      experiences: Experience[];
      skills: Skill[];
      personality: Big5 | null;
      cv: Cv | null;
      awards: Award[];
      education: Education[];
    };

export function ProfileSyncCard({ leadId, lang }: { leadId: string; lang: "pl" | "en" }) {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const q = useQuery({
    queryKey: ["crm-lead-profile-sync", leadId],
    queryFn: async () => {
      const r = await getCrmLeadProfileSync({ data: { lead_id: leadId } });
      const raw = JSON.parse((r as { json: string }).json) as Sync | null;
      return raw;
    },
    staleTime: 60_000,
  });

  const data = q.data;

  if (q.isLoading) {
    return (
      <div className="text-[11px] text-muted-foreground">
        {t("Wczytywanie profilu…", "Loading profile…")}
      </div>
    );
  }
  if (!data || data.matched === false) {
    return (
      <div className="text-[11px] text-muted-foreground">
        {t(
          "Brak dopasowanego profilu w systemie (po e-mailu).",
          "No matching in-system profile (by email).",
        )}
      </div>
    );
  }
  if (!data || data.matched === false) {
    return (
      <div className="p-3 text-[11px] text-muted-foreground">
        {t(
          "Brak dopasowanego profilu w systemie (po e-mailu).",
          "No matching in-system profile (by email).",
        )}
      </div>
    );
  }

  const p = data.profile;
  const name =
    [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
    p.display_name ||
    t("Bez nazwy", "No name");

  return (
    <div className="space-y-3 p-3">
      {/* Header: avatar + name + link */}
      <div className="flex items-center gap-3">
        {p.avatar_url ? (
          <img
            src={p.avatar_url}
            alt={name}
            className="h-12 w-12 rounded-md object-cover"
            loading="lazy"
          />
        ) : (
          <div className="grid h-12 w-12 place-items-center rounded-md bg-primary/10 text-primary">
            <UserCircle2 className="h-6 w-6" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold">{name}</span>
            {p.verified_at && (
              <span
                className="grid h-3.5 w-3.5 place-items-center rounded-full bg-primary/20 text-[9px] text-primary"
                title={t("Zweryfikowany", "Verified")}
              >
                ✓
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {p.job_title ?? t("Brak stanowiska", "No position")}
            {p.current_company && ` · ${p.current_company}`}
          </div>
        </div>
        {p.slug && (
          <Link
            to="/author/$slug"
            params={{ slug: p.slug }}
            className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title={t("Otwórz profil", "Open profile")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {/* CV */}
      {data.cv && (
        <a
          href={data.cv.file_url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-2 rounded border p-2 text-[12px] hover:bg-muted/50"
        >
          <FileText className="h-3.5 w-3.5 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{data.cv.file_name}</div>
            <div className="text-[10px] text-muted-foreground">
              v{data.cv.version} · {formatBytes(data.cv.size_bytes)} ·{" "}
              {new Date(data.cv.uploaded_at).toLocaleDateString()}
            </div>
          </div>
          <ExternalLink className="h-3 w-3 text-muted-foreground" />
        </a>
      )}

      {/* Big5 */}
      {data.personality && (
        <Big5Panel personality={data.personality} lang={lang} />
      )}

      {/* Experiences */}
      {data.experiences.length > 0 && (
        <Section
          title={t("Doświadczenie", "Experience")}
          icon={<Briefcase className="h-3.5 w-3.5" />}
        >
          <ul className="space-y-1.5">
            {data.experiences.slice(0, 4).map((e) => (
              <li key={e.id} className="text-[11px]">
                <div className="font-medium">{e.role_title}</div>
                <div className="text-muted-foreground">
                  {[e.company, e.location].filter(Boolean).join(" · ")}
                  {e.start_date && (
                    <span>
                      {" · "}
                      {formatYear(e.start_date)} –{" "}
                      {e.is_current ? t("obecnie", "present") : formatYear(e.end_date)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Education */}
      {data.education.length > 0 && (
        <Section
          title={t("Edukacja", "Education")}
          icon={<GraduationCap className="h-3.5 w-3.5" />}
        >
          <ul className="space-y-1.5">
            {data.education.slice(0, 3).map((e) => (
              <li key={e.id} className="text-[11px]">
                <div className="font-medium">{e.school}</div>
                <div className="text-muted-foreground">
                  {[e.degree, e.field].filter(Boolean).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Skills */}
      {data.skills.length > 0 && (
        <Section title={t("Umiejętności", "Skills")} icon={<Sparkles className="h-3.5 w-3.5" />}>
          <div className="flex flex-wrap gap-1">
            {data.skills.slice(0, 12).map((s) => (
              <span
                key={s.id}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
                title={
                  s.endorsements_count
                    ? `${s.endorsements_count} ${t("rekomendacji", "endorsements")}`
                    : undefined
                }
              >
                {s.name}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Awards */}
      {data.awards.length > 0 && (
        <Section title={t("Wyróżnienia", "Awards")} icon={<Award className="h-3.5 w-3.5" />}>
          <ul className="space-y-1">
            {data.awards.slice(0, 3).map((a) => (
              <li key={a.id} className="text-[11px]">
                <span className="font-medium">{a.title}</span>
                {a.issuer && <span className="text-muted-foreground"> · {a.issuer}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Big5Panel({ personality, lang }: { personality: Big5; lang: "pl" | "en" }) {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const traits = useMemo(
    () => [
      { key: "openness", label: t("Otwartość", "Openness"), v: personality.openness },
      {
        key: "conscientiousness",
        label: t("Sumienność", "Conscientiousness"),
        v: personality.conscientiousness,
      },
      { key: "extraversion", label: t("Ekstrawersja", "Extraversion"), v: personality.extraversion },
      { key: "agreeableness", label: t("Ugodowość", "Agreeableness"), v: personality.agreeableness },
      { key: "neuroticism", label: t("Neurotyczność", "Neuroticism"), v: personality.neuroticism },
    ],
    [personality, lang],
  );
  return (
    <Section title={t("Big5 (osobowość)", "Big5 personality")} icon={<Sparkles className="h-3.5 w-3.5" />}>
      <ul className="space-y-1">
        {traits.map((tr) => (
          <li key={tr.key} className="text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{tr.label}</span>
              <span className="tabular-nums font-medium">{tr.v}</span>
            </div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${Math.max(0, Math.min(100, tr.v))}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-1 text-[10px] text-muted-foreground">
        {t("Wypełniono:", "Taken:")} {new Date(personality.taken_at).toLocaleDateString()}
      </div>
    </Section>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border p-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        <span className="uppercase tracking-wide">{title}</span>
      </div>
      {children}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function formatYear(d: string | null): string {
  if (!d) return "";
  const y = new Date(d).getFullYear();
  return Number.isFinite(y) ? String(y) : "";
}
