/**
 * Drill-down dialog for BI charts.
 *
 * Every chart in the BI dashboards may accept an `onDataClick` handler that
 * translates a `ChartSelection` from the chart engine into a `ChartDrillDetail`
 * payload. The `ChartCard` shell owns the dialog state and renders the details
 * here.
 *
 * The payload is intentionally UI-shaped (not domain-shaped) so a single
 * component can render selections from a bar, a donut, a scatter or a line
 * without knowing about paths, queries, metrics etc. Every field is optional
 * except the title so partial payloads still render sensibly.
 */
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { ExternalLink, Calendar, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ChartDrillTone = "good" | "warn" | "bad" | "neutral";

export interface ChartDrillMetric {
  label: string;
  value: string;
  hint?: string;
  tone?: ChartDrillTone;
}

export interface ChartDrillLink {
  href: string;
  label: string;
  /** External => opens in new tab with rel=noopener. Defaults to true for absolute URLs. */
  external?: boolean;
}

export interface ChartDrillDetail {
  title: string;
  subtitle?: string;
  /** ISO date or human-readable label. Renders inside a subtle chip. */
  date?: string;
  /** Primary URL/path represented by the clicked element. Shown as monospace + link. */
  url?: string;
  urlLabel?: string;
  description?: string;
  metrics?: ChartDrillMetric[];
  links?: ChartDrillLink[];
}

const TONE_CLS: Record<ChartDrillTone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
  neutral: "text-foreground",
};

function isExternal(href: string, explicit?: boolean): boolean {
  if (typeof explicit === "boolean") return explicit;
  return /^https?:\/\//i.test(href);
}

export interface ChartDrillDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  detail: ChartDrillDetail | null;
}

export function ChartDrillDialog({ open, onOpenChange, detail }: ChartDrillDialogProps) {
  const { t } = useTranslation();
  // Element, który miał ognisko w chwili otwarcia okna. Radiks w trybie
  // modalnym oddaje ognisko `triggerRef`, a tutaj wyzwalacza NIE MA - okno
  // otwiera kliknięcie w wykres, nie `<DialogTrigger>`. Bez własnego
  // zapamiętania ognisko przepadałoby na `<body>`, a osoba nawigująca
  // klawiaturą musiałaby przejść cały panel od nowa (WCAG 2.4.3).
  const powrotOgniskaRef = useRef<HTMLElement | SVGElement | null>(null);

  const zapamietajOgnisko = useCallback(() => {
    // `onOpenAutoFocus` leci z `FocusScope` PRZED przeniesieniem ogniska
    // do okna, więc `activeElement` to jeszcze element wołającego.
    const aktywny = document.activeElement;
    powrotOgniskaRef.current =
      aktywny instanceof HTMLElement || aktywny instanceof SVGElement ? aktywny : null;
  }, []);

  const przywrocOgnisko = useCallback((event: Event) => {
    const powrot = powrotOgniskaRef.current;
    powrotOgniskaRef.current = null;
    // Bez sensownego celu nie blokujemy Radiksa - jego własna ścieżka kończy
    // się tym samym (`triggerRef` jest `null`), a `body.focus()` nic nie daje.
    if (!powrot || !powrot.isConnected || powrot === document.body) return;
    event.preventDefault();
    // Punkty i segmenty wykresów są elementami SVG. Przywrócenie im ogniska
    // zwykłym `focus()` przewijało najbliższy kontener (a czasem cały panel)
    // tak, aby element znalazł się przy górnej krawędzi. Użytkownik po
    // zamknięciu szczegółów tracił przez to miejsce, które właśnie analizował.
    powrot.focus({ preventScroll: true });
  }, []);

  if (!detail) return null;

  // Autodetekcja z `isExternal`: adres względny (`/analizy/...`) zostaje
  // w panelu, absolutny idzie do nowej karty. Stały drugi argument `true`
  // wyrzucałby operatora z panelu na jego własnej ścieżce i przeczył temu, jak
  // ten sam adres renderuje się na liście „Powiązane".
  const external = detail.url ? isExternal(detail.url) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl min-w-0 overflow-x-hidden overflow-y-auto rounded-[6px] p-4 sm:p-6"
        onOpenAutoFocus={zapamietajOgnisko}
        onCloseAutoFocus={przywrocOgnisko}
        // Radiks generuje id opisu ZAWSZE i wstawia je w `aria-describedby`,
        // ale `DialogDescription` renderuje się tylko z podtytułem. Bez
        // podtytułu atrybut wskazywałby element, którego w dokumencie nie ma -
        // czytnik obiecuje opis i milknie. Jawne `undefined` zdejmuje atrybut.
        {...(detail.subtitle ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader className="min-w-0 pr-8 text-left">
          <DialogTitle className="min-w-0 [overflow-wrap:anywhere] font-display text-base leading-snug">
            {detail.title}
          </DialogTitle>
          {detail.subtitle ? (
            <DialogDescription className="min-w-0 [overflow-wrap:anywhere] text-xs leading-relaxed">
              {detail.subtitle}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {(detail.date || detail.url) && (
          <div className="-mt-1 flex min-w-0 flex-wrap items-center gap-2">
            {detail.date ? (
              <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" aria-hidden />
                {detail.date}
              </span>
            ) : null}
            {detail.url ? (
              <a
                href={detail.url}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-[6px] border border-input bg-background px-2 py-1 font-mono text-xs text-foreground transition-colors hover:border-brand hover:text-brand"
                title={detail.url}
              >
                <span className="min-w-0 truncate">{detail.urlLabel ?? detail.url}</span>
                {external ? <ExternalLink className="h-3 w-3 shrink-0" aria-hidden /> : null}
              </a>
            ) : null}
          </div>
        )}

        {detail.description ? (
          <p className="min-w-0 [overflow-wrap:anywhere] rounded-[6px] border border-border/60 bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <Info className="mr-1 inline h-3 w-3 -translate-y-0.5" aria-hidden />
            {detail.description}
          </p>
        ) : null}

        {detail.metrics && detail.metrics.length > 0 ? (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("adminAnalytics.drillDialog.metrics")}
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              {detail.metrics.map((m) => (
                <div
                  key={m.label}
                  className="min-w-0 rounded-[6px] border border-border/60 bg-card px-2.5 py-2"
                >
                  <div className="min-w-0 [overflow-wrap:anywhere] text-[10px] uppercase tracking-wide text-muted-foreground">
                    {m.label}
                  </div>
                  <div
                    className={cn(
                      "min-w-0 [overflow-wrap:anywhere] font-display text-sm font-semibold tabular-nums",
                      TONE_CLS[m.tone ?? "neutral"],
                    )}
                  >
                    {m.value}
                  </div>
                  {m.hint ? (
                    <div className="mt-0.5 min-w-0 [overflow-wrap:anywhere] text-[10px] text-muted-foreground">
                      {m.hint}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {detail.links && detail.links.length > 0 ? (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("adminAnalytics.drillDialog.links")}
            </div>
            <ul className="space-y-1">
              {detail.links.map((l) => {
                const ext = isExternal(l.href, l.external);
                return (
                  <li key={`${l.href}-${l.label}`}>
                    <a
                      href={l.href}
                      target={ext ? "_blank" : undefined}
                      rel={ext ? "noopener noreferrer" : undefined}
                      className="inline-flex max-w-full min-w-0 items-start gap-1 [overflow-wrap:anywhere] text-xs text-brand transition-colors hover:underline"
                    >
                      <span className="min-w-0">{l.label}</span>
                      {ext ? (
                        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
