// Eksport CV do PDF (P2 z OCENA_MODULOW_2026-07-20 §5.5): silnikiem PDF jest
// przeglądarka czytelnika (window.print), jak w PrintBriefHeader - deploy na
// Cloudflare Workers nie ma serwerowego Chromium. Mechanika:
//   * arkusz CV renderuje się PORTALEM na końcu <body> i na ekranie jest
//     ukryty (display:none),
//   * przycisk "Pobierz CV (PDF)" dodaje klasę cv-print-mode na <html>,
//     woła window.print() i zdejmuje klasę po afterprint,
//   * @media print + html.cv-print-mode (styles.css) chowa wszystko poza
//     arkuszem; zwykły wydruk strony (Ctrl+P bez przycisku) pozostaje
//     nietknięty, bo reguły są zawężone do tej klasy.
// Tytuł dokumentu na czas druku ustawiamy na "CV - <imię>", żeby domyślna
// nazwa pliku PDF była sensowna.
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { FileDown } from "lucide-react";
import type { AuthorCv } from "@/lib/queries/authorCv";
import { formatDate } from "@/lib/i18n/format";

export interface CvPrintIdentity {
  name: string;
  jobTitle?: string | null;
  company?: string | null;
  contactEmail?: string | null;
  websiteUrl?: string | null;
  /** Publiczny adres profilu (stopka arkusza). */
  profileUrl?: string | null;
}

function range(
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
  if (s && e) return `${s} - ${e}`;
  return s || e;
}

export function useCvPrint(name: string) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    [],
  );

  return useCallback(() => {
    const root = document.documentElement;
    const prevTitle = document.title;
    root.classList.add("cv-print-mode");
    document.title = `CV - ${name}`;
    const cleanup = () => {
      root.classList.remove("cv-print-mode");
      document.title = prevTitle;
      window.removeEventListener("afterprint", cleanup);
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    window.addEventListener("afterprint", cleanup);
    // Drukujemy w następnej klatce, żeby przeglądarka zdążyła zastosować
    // klasę print-mode do arkusza przed zrzutem strony.
    window.requestAnimationFrame(() => window.print());
  }, [name]);
}

export function CvDownloadButton({ identity }: { identity: CvPrintIdentity }) {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const print = useCvPrint(identity.name);
  return (
    <button
      type="button"
      onClick={print}
      className="no-print inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-brand hover:text-brand"
      title={
        isPl ? "Pobierz CV jako PDF (drukowanie do pliku)" : "Download CV as PDF (print to file)"
      }
    >
      <FileDown className="h-3.5 w-3.5" aria-hidden />
      {isPl ? "Pobierz CV (PDF)" : "Download CV (PDF)"}
    </button>
  );
}

export function CvPrintSheet({
  identity,
  cv,
}: {
  identity: CvPrintIdentity;
  cv: AuthorCv;
}): React.ReactPortal | null {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  if (typeof document === "undefined") return null;

  const { experiences, education, skills, awards, hobbies } = cv;
  const contactBits = [identity.contactEmail, identity.websiteUrl].filter(Boolean) as string[];

  const sheet = (
    <div className="cv-print-sheet" aria-hidden>
      <header className="cv-print-header">
        <h1>{identity.name}</h1>
        {(identity.jobTitle || identity.company) && (
          <p className="cv-print-subtitle">
            {[identity.jobTitle, identity.company].filter(Boolean).join(" · ")}
          </p>
        )}
        {contactBits.length > 0 && <p className="cv-print-contact">{contactBits.join(" · ")}</p>}
      </header>

      {experiences.length > 0 && (
        <section>
          <h2>{isPl ? "Doświadczenie zawodowe" : "Experience"}</h2>
          {experiences.map((e) => (
            <article key={e.id}>
              <h3>
                {e.role_title || (isPl ? "Stanowisko" : "Role")}
                {e.company ? ` · ${e.company}` : ""}
              </h3>
              <p className="cv-print-meta">
                {[range(e.start_date, e.end_date, e.is_current, isPl), e.location]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {e.description && <p className="cv-print-desc">{e.description}</p>}
            </article>
          ))}
        </section>
      )}

      {education.length > 0 && (
        <section>
          <h2>{isPl ? "Edukacja" : "Education"}</h2>
          {education.map((e) => (
            <article key={e.id}>
              <h3>{e.school || (isPl ? "Uczelnia" : "School")}</h3>
              <p className="cv-print-meta">
                {[
                  [e.degree, e.field].filter(Boolean).join(" · "),
                  range(e.start_date, e.end_date, null, isPl),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {e.description && <p className="cv-print-desc">{e.description}</p>}
            </article>
          ))}
        </section>
      )}

      {skills.length > 0 && (
        <section>
          <h2>{isPl ? "Umiejętności" : "Skills"}</h2>
          <p className="cv-print-skills">
            {skills
              .map((s) =>
                typeof s.level === "number" && s.level > 0 ? `${s.label} (${s.level}/5)` : s.label,
              )
              .join(" · ")}
          </p>
        </section>
      )}

      {awards.length > 0 && (
        <section>
          <h2>{isPl ? "Wyróżnienia i certyfikaty" : "Awards & certifications"}</h2>
          {awards.map((a) => (
            <article key={a.id}>
              <h3>{a.title}</h3>
              <p className="cv-print-meta">
                {[
                  a.issuer,
                  a.awarded_at
                    ? new Date(a.awarded_at).toLocaleDateString(isPl ? "pl-PL" : "en-US", {
                        year: "numeric",
                        month: "long",
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {a.description && <p className="cv-print-desc">{a.description}</p>}
            </article>
          ))}
        </section>
      )}

      {hobbies.length > 0 && (
        <section>
          <h2>{isPl ? "Zainteresowania" : "Interests"}</h2>
          <p className="cv-print-skills">{hobbies.map((h) => h.label).join(" · ")}</p>
        </section>
      )}

      {identity.profileUrl && (
        <footer className="cv-print-footer">
          {isPl ? "Pełny profil: " : "Full profile: "}
          {identity.profileUrl}
        </footer>
      )}
    </div>
  );

  return createPortal(sheet, document.body);
}
