// Organizm: zasady pracy (interaktywny spotlight) + siatka benefitów.
//
// Spotlight: pionowa lista zasad (Radix Tabs - klawiatura i aria za darmo)
// i panel szczegółu z dowodem "W praktyce". Do pierwszej interakcji użytkownika
// zasady rotują same co 5 s - wyłącznie gdy sekcja jest w viewporcie, karta
// widoczna i bez prefers-reduced-motion. Klik/klawiatura zatrzymuje rotację
// na stałe (auto-pokaz ma zapraszać, nie walczyć o kursor).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Compass,
  Crown,
  Gauge,
  Globe2,
  Handshake,
  Laptop,
  PenLine,
  Target,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useInView } from "@/hooks/use-in-view";
import { CareerReveal } from "../atoms/CareerReveal";
import { CareerBenefitTile } from "../molecules/CareerBenefitTile";

const VALUES: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: "evidence", icon: Compass },
  { key: "ownership", icon: Crown },
  { key: "craft", icon: Gauge },
  { key: "europe", icon: Globe2 },
];

const BENEFITS: ReadonlyArray<{ key: string; icon: LucideIcon }> = [
  { key: "flexible", icon: Handshake },
  { key: "remote", icon: Laptop },
  { key: "warsaw", icon: Building2 },
  { key: "impact", icon: Target },
  { key: "byline", icon: PenLine },
  { key: "network", icon: Users },
];

const AUTO_ADVANCE_MS = 5000;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function CareersValues() {
  const { t } = useTranslation();
  const [active, setActive] = useState<string>(VALUES[0].key);
  const [interacted, setInteracted] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { ref: spotlightRef, inView } = useInView<HTMLDivElement>({ once: false, threshold: 0.35 });
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (interacted || hovered || !inView || prefersReducedMotion()) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const index = VALUES.findIndex((v) => v.key === activeRef.current);
      setActive(VALUES[(index + 1) % VALUES.length].key);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [interacted, hovered, inView]);

  return (
    <section aria-labelledby="careers-values" className="mt-14">
      <h2
        id="careers-values"
        className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
      >
        {t("careers.values.title")}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {t("careers.values.subtitle")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground/80">{t("careers.values.hint")}</p>

      <div
        ref={spotlightRef}
        className="mt-6"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Tabs
          value={active}
          onValueChange={(value) => {
            setInteracted(true);
            setActive(value);
          }}
          orientation="vertical"
          activationMode="manual"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(240px,20rem)_minmax(0,1fr)]">
            <TabsList
              onFocusCapture={() => setInteracted(true)}
              className="flex h-auto w-full flex-col items-stretch gap-2 overflow-visible rounded-none bg-transparent p-0 text-left"
            >
              {VALUES.map((item) => (
                <TabsTrigger
                  key={item.key}
                  value={item.key}
                  className="h-auto w-full justify-start gap-3 whitespace-normal rounded-[6px] border border-border/70 bg-card px-3.5 py-3 text-left text-sm font-semibold text-muted-foreground transition-[border-color,background-color,color] duration-200 hover:border-primary/40 data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:ring-0"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
                    <item.icon className="h-4 w-4" aria-hidden />
                  </span>
                  {t(`careers.values.items.${item.key}.title`)}
                </TabsTrigger>
              ))}
            </TabsList>

            {VALUES.map((item) => (
              <TabsContent
                key={item.key}
                value={item.key}
                className="crs-value-panel relative isolate mt-0 overflow-hidden rounded-[6px] border border-border/70 bg-card p-5 sm:p-7 lg:col-start-2 lg:row-start-1"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(110%_110%_at_100%_0%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_60%)]"
                />
                <span className="flex h-11 w-11 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
                  <item.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-4 text-lg font-semibold leading-snug text-foreground sm:text-xl">
                  {t(`careers.values.items.${item.key}.title`)}
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                  {t(`careers.values.items.${item.key}.body`)}
                </p>
                <div className="group relative mt-5 max-w-2xl transition-transform duration-300 hover:-translate-y-0.5">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-[6px] border border-border/60 bg-brand/[0.04]"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[2px] rounded-l-[6px] bg-[linear-gradient(to_bottom,transparent,var(--brand),var(--brand),transparent)] bg-[length:100%_400%] bg-[position:0%_0%] transition-[background-position] duration-1000 ease-in-out group-hover:bg-[position:0%_100%]"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-[linear-gradient(to_bottom,transparent,var(--brand),transparent)] bg-[length:100%_400%] bg-[position:0%_0%] opacity-0 blur-[6px] transition-all duration-1000 ease-in-out group-hover:bg-[position:0%_100%] group-hover:opacity-50"
                  />
                  <div className="relative flex flex-col items-start gap-2.5 py-5 pl-7 pr-5">
                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-brand sm:text-xs">
                      {t("careers.values.proofLabel")}
                    </span>
                    <p className="text-sm leading-relaxed text-foreground/90 sm:text-base">
                      {t(`careers.values.items.${item.key}.proof`)}
                    </p>
                  </div>
                </div>

              </TabsContent>
            ))}
          </div>
        </Tabs>
      </div>

      <div className="mt-10">
        <h3 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {t("careers.benefits.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("careers.benefits.subtitle")}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {BENEFITS.map((item, index) => (
            <CareerReveal key={item.key} index={index} className="h-full">
              <CareerBenefitTile
                icon={item.icon}
                title={t(`careers.benefits.items.${item.key}.title`)}
                body={t(`careers.benefits.items.${item.key}.body`)}
                className="h-full"
              />
            </CareerReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
