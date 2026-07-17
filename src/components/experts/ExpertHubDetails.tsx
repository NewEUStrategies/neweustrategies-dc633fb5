// Blok tożsamości eksperta pod nagłówkiem: programy (z funkcjami), obszary
// ekspertyzy, biografia oraz karty kontaktu bezpośredniego i dla mediów.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Mail, Phone, Globe, Briefcase, Layers } from "lucide-react";
import type { ExpertHubData } from "@/lib/experts/types";

function ContactCard({
  heading,
  hint,
  email,
  phone,
  website,
}: {
  heading: string;
  hint?: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
}) {
  if (!email && !phone && !website) return null;
  return (
    <div className="grid gap-2 rounded-[10px] border border-border/60 bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground/80">{heading}</h3>
      {hint && <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="grid gap-1.5 text-sm">
        {email && (
          <a href={`mailto:${email}`} className="inline-flex items-center gap-2 hover:text-brand">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="truncate">{email}</span>
          </a>
        )}
        {phone && (
          <a href={`tel:${phone}`} className="inline-flex items-center gap-2 hover:text-brand">
            <Phone className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span>{phone}</span>
          </a>
        )}
        {website && (
          <a
            href={website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 hover:text-brand"
          >
            <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="truncate">{website.replace(/^https?:\/\//, "")}</span>
          </a>
        )}
      </div>
    </div>
  );
}

export function ExpertHubDetails({ data, lang }: { data: ExpertHubData; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  const { expert, programs, areas } = data;

  const departments = programs.filter((p) => p.kind === "department");
  const realPrograms = programs.filter((p) => p.kind !== "department");

  const sidebar = (
    <aside className="grid content-start gap-6">
      {areas.length > 0 && (
        <section className="grid gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("expert.expertiseHeading")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {areas.map((a) => (
              <Link
                key={a.id}
                to="/experts"
                search={{ area: a.slug }}
                className="rounded-full border border-[var(--brand)]/30 bg-[var(--brand)]/5 px-3 py-1 text-sm text-foreground transition-colors hover:border-[var(--brand)]/60"
              >
                {lang === "en" ? a.name_en : a.name_pl}
              </Link>
            ))}
          </div>
        </section>
      )}

      <ContactCard
        heading={t("expert.contactHeading")}
        email={expert.contact_email}
        website={expert.website_url}
      />
    </aside>
  );

  return (
    <div className="grid gap-8">
      {sidebar}

      {(realPrograms.length > 0 || departments.length > 0) && (
        <div className="grid gap-8">
          {realPrograms.length > 0 && (
            <section className="grid gap-3">
              <h2 className="flex items-center gap-2 font-display text-2xl">
                <Briefcase className="h-5 w-5 text-[var(--brand)]" aria-hidden />
                {t("expert.programsHeading")}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {realPrograms.map((p) => {
                  const name = lang === "en" ? p.name_en : p.name_pl;
                  const role = lang === "en" ? p.role_en : p.role_pl;
                  const desc = lang === "en" ? p.description_en : p.description_pl;
                  return (
                    <li key={p.id} className="rounded-[10px] border border-border/60 bg-card p-4">
                      <p className="font-medium text-foreground">{name}</p>
                      {role && <p className="text-sm text-[var(--brand)]">{role}</p>}
                      {desc && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{desc}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {departments.length > 0 && (
            <section className="grid gap-3">
              <h2 className="flex items-center gap-2 font-display text-2xl">
                <Layers className="h-5 w-5 text-[var(--brand)]" aria-hidden />
                {t("expert.departmentsHeading")}
              </h2>
              <div className="flex flex-wrap gap-2">
                {departments.map((d) => (
                  <span
                    key={d.id}
                    className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-sm"
                  >
                    {lang === "en" ? d.name_en : d.name_pl}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
