// Wspólny szkielet publicznych stron prawnych (regulamin, polityka
// prywatności, polityka zwrotów). Treść jest statyczna w kodzie - nie zależy
// od CMS - żeby zawsze była dostępna dla użytkownika i dla weryfikacji
// operatora płatności (Stripe obsługuje transakcje w naszym imieniu).
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

export interface LegalSection {
  id: string;
  Icon: LucideIcon;
  heading: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
}

interface Props {
  eyebrow: string;
  title: string;
  lead: string;
  updatedLabel: string;
  sections: readonly LegalSection[];
  footnote?: string;
}

export function LegalPage({ eyebrow, title, lead, updatedLabel, sections, footnote }: Props) {
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-14 space-y-10">
      <header className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-ink/10 text-brand-ink px-3 py-1 text-xs font-medium ring-1 ring-brand-ink/30">
          {eyebrow}
        </div>
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">{title}</h1>
        <p className="text-muted-foreground max-w-2xl">{lead}</p>
        <p className="text-xs text-muted-foreground">{updatedLabel}</p>
      </header>

      <nav aria-label={title} className="flex flex-wrap gap-2">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {s.heading}
          </a>
        ))}
      </nav>

      <div className="space-y-4">
        {sections.map((s) => (
          <Card key={s.id} id={s.id} className="scroll-mt-28 p-5">
            <div className="flex items-start gap-4">
              <span
                className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-md bg-brand-ink/10 text-brand-ink ring-1 ring-brand-ink/25"
                aria-hidden
              >
                <s.Icon className="h-5 w-5" />
              </span>
              <div className="flex-1 space-y-2">
                <h2 className="font-display text-lg">{s.heading}</h2>
                {s.paragraphs?.map((p, i) => (
                  <p key={i} className="text-sm text-muted-foreground">
                    {p}
                  </p>
                ))}
                {s.bullets && s.bullets.length > 0 ? (
                  <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                    {s.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
    </main>
  );
}
