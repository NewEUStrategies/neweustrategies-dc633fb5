// Molekuła: wybór układu strony klubu z PODGLĄDEM, nie dropListą.
//
// Trzy nazwy na liście rozwijanej - "lista", "karty", "magazyn" - nie mówią
// nic, dopóki się ich nie kliknie i nie zobaczy efektu na produkcji. Miniatura
// pokazuje różnicę od razu: gdzie ląduje tytuł, ile treści widać, czy coś jest
// wyróżnione. To jest cała wartość tego komponentu.
//
// Miniatury są rysowane divami, nie obrazkami: obrazek trzeba by regenerować
// przy każdej zmianie motywu, a te dziedziczą kolory z tokenów, więc w trybie
// ciemnym i jasnym wyglądają tak jak realna strona.
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLUB_LAYOUTS, type ClubLayout } from "@/lib/clubs/types";

/** Pasek udający wiersz tekstu. `w` to szerokość w procentach. */
function Bar({ w, strong = false }: { w: number; strong?: boolean }) {
  return (
    <div
      className={cn("h-1.5 rounded-full", strong ? "bg-foreground/50" : "bg-foreground/20")}
      style={{ width: `${w}%` }}
    />
  );
}

function ListPreview() {
  return (
    <div className="flex flex-col gap-2 p-2.5">
      {[92, 78, 85, 70].map((w, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-border/50 p-1.5">
          <Bar w={w} strong />
          <Bar w={w * 0.45} />
        </div>
      ))}
    </div>
  );
}

function CardsPreview() {
  return (
    <div className="grid grid-cols-2 gap-2 p-2.5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-border/50 p-1.5">
          <div className="mb-0.5 h-4 rounded bg-foreground/10" />
          <Bar w={88} strong />
          <Bar w={64} />
        </div>
      ))}
    </div>
  );
}

function MagazinePreview() {
  return (
    <div className="flex flex-col gap-2 p-2.5">
      {/* Wyróżniony wątek: to jest cała różnica względem listy. */}
      <div className="flex flex-col gap-1 rounded border border-primary/40 bg-primary/5 p-1.5">
        <div className="mb-0.5 h-6 rounded bg-foreground/15" />
        <Bar w={94} strong />
        <Bar w={70} />
      </div>
      {[82, 74].map((w, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-border/50 p-1.5">
          <Bar w={w} strong />
          <Bar w={w * 0.5} />
        </div>
      ))}
    </div>
  );
}

function EditorialPreview() {
  return (
    <div className="flex flex-col gap-2 p-2.5">
      {/* Wyróżniony nagłówek edytorialny z dużą czcionką i podkreśleniem. */}
      <div className="flex flex-col gap-1 rounded border border-primary/40 bg-primary/5 p-1.5">
        <div className="mb-0.5 h-5 rounded bg-foreground/15" />
        <Bar w={96} strong />
        <div className="mt-1 h-0.5 w-1/3 rounded bg-primary/60" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[88, 76].map((w, i) => (
          <div key={i} className="flex flex-col gap-1 rounded border border-border/50 p-1.5">
            <div className="mb-0.5 h-4 rounded bg-foreground/10" />
            <Bar w={w} strong />
            <Bar w={w * 0.55} />
          </div>
        ))}
      </div>
    </div>
  );
}

// `React.ComponentType`, nie globalny `JSX.Element`: przy nowej transformacji
// JSX globalna przestrzeń nazw `JSX` nie istnieje i typ się nie rozwiązuje.
const PREVIEW: Record<ClubLayout, React.ComponentType> = {
  list: ListPreview,
  cards: CardsPreview,
  magazine: MagazinePreview,
  editorial: EditorialPreview,
};

export function ClubLayoutPicker({
  value,
  onChange,
  disabled,
}: {
  value: ClubLayout;
  onChange: (layout: ClubLayout) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="radiogroup"
      aria-label={t("adminClubs.layout.label")}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {CLUB_LAYOUTS.map((layout) => {
        const Preview = PREVIEW[layout];
        const selected = value === layout;
        return (
          <button
            key={layout}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(layout)}
            className={cn(
              "group flex flex-col overflow-hidden rounded-lg border text-left transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-primary ring-2 ring-primary/30"
                : "border-border/60 hover:border-primary/50",
              disabled ? "cursor-not-allowed opacity-60" : "",
            )}
          >
            <div className="aspect-[4/3] w-full bg-muted/30">
              <Preview />
            </div>
            <div className="flex items-start gap-2 border-t border-border/60 p-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {t(`adminClubs.layout.${layout}`)}
                  {selected ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                </div>
                <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
                  {t(`adminClubs.layoutHint.${layout}`)}
                </p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
