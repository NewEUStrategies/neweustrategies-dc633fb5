// Organizm: domknięcie strony kariery - zgłoszenie spontaniczne / kontakt.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function CareersClosing({ onOpenApplication }: { onOpenApplication: () => void }) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="careers-closing"
      className="relative isolate mt-14 overflow-hidden rounded-[6px] border border-primary/30 bg-card/60 px-5 py-10 text-center sm:px-8"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(90%_120%_at_50%_0%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_65%)]"
      />
      <h2
        id="careers-closing"
        className="text-balance text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
      >
        {t("careers.closing.title")}
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {t("careers.closing.body")}
      </p>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button size="lg" className="gap-2" onClick={onOpenApplication}>
          {t("careers.closing.cta")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link to="/$" params={{ _splat: "kontakt" }}>
            {t("careers.closing.secondary")}
          </Link>
        </Button>
      </div>
    </section>
  );
}
