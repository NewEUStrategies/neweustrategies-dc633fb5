// Mini-podgląd presetu layoutu wpisu (SVG-like wireframe). Używany
// w /admin/post-layouts (zamiast szarego kafelka) i w edytorze wpisu,
// żeby autor widział wybór nim opublikuje.
import type { LayoutPreset, PostLayoutSettings } from "@/lib/postLayouts";

interface Props {
  preset: LayoutPreset;
  /** Pełne ustawienia globalne — używane do wyliczenia ratio i centrowania. */
  settings?: Pick<
    PostLayoutSettings,
    "featured_ratio_l6" | "featured_ratio_l10" | "featured_ratio_l11" | "center_header"
  >;
  className?: string;
}

function ratioPct(p: LayoutPreset, s: Props["settings"]): number {
  if (p.cover !== "ratio" || !p.featuredRatioKey || !s) return 56;
  const v = s[p.featuredRatioKey];
  if (typeof v === "number" && v > 10 && v < 200) return v;
  return 56;
}

export function LayoutPreview({ preset, settings, className }: Props) {
  const ratio = ratioPct(preset, settings);
  const hasSidebar = preset.hasSidebar;
  const centered = (settings?.center_header ?? preset.centerHeaderDefault) === true;
  const headerJustify = centered ? "items-center text-center" : "items-start text-left";

  // Helpery rysujące prostokąt z klasami tailwind.
  const Bar = ({ w, h = "h-2", c = "bg-foreground/70" }: { w: string; h?: string; c?: string }) => (
    <div className={`${h} ${c} rounded ${w}`} />
  );
  const Img = ({ h }: { h: string }) => (
    <div className={`${h} w-full rounded bg-gradient-to-br from-brand/40 to-brand/10 border border-border`} />
  );
  const Lines = () => (
    <div className="space-y-1">
      <Bar w="w-full" h="h-1.5" c="bg-foreground/30" />
      <Bar w="w-11/12" h="h-1.5" c="bg-foreground/30" />
      <Bar w="w-10/12" h="h-1.5" c="bg-foreground/30" />
      <Bar w="w-9/12" h="h-1.5" c="bg-foreground/30" />
    </div>
  );

  const Header = ({ small = false }: { small?: boolean }) => (
    <div className={`flex flex-col ${headerJustify} gap-1`}>
      <Bar w="w-1/3" h="h-1" c="bg-brand" />
      <Bar w={small ? "w-3/4" : "w-5/6"} h={small ? "h-2" : "h-3"} c="bg-foreground" />
      <Bar w={small ? "w-1/2" : "w-2/3"} h="h-1.5" c="bg-foreground/40" />
    </div>
  );

  let body: React.ReactNode = null;

  switch (preset.header) {
    case "no-cover":
      body = (
        <div className="p-3 space-y-3">
          <Header />
          <Lines />
        </div>
      );
      break;
    case "overlay":
      body = (
        <div className="relative">
          <div className={`w-full ${preset.cover === "full-bleed" ? "h-24" : "h-20"} bg-gradient-to-br from-foreground/80 to-foreground/40`} />
          <div className={`absolute inset-0 p-3 flex flex-col ${centered ? "items-center text-center" : "items-start"} justify-end`}>
            <Bar w="w-1/3" h="h-1" c="bg-brand" />
            <Bar w="w-5/6" h="h-3" c="bg-background" />
          </div>
          <div className="p-3"><Lines /></div>
        </div>
      );
      break;
    case "side-by-side":
      body = (
        <div className="p-3 grid grid-cols-2 gap-2">
          <Img h="h-16" />
          <div className="space-y-2"><Header small /><Bar w="w-full" h="h-1" c="bg-foreground/30" /><Bar w="w-3/4" h="h-1" c="bg-foreground/30" /></div>
        </div>
      );
      break;
    case "below-cover":
      body = (
        <div className="p-3 space-y-2">
          <Img h="h-14" />
          <Header />
          <Lines />
        </div>
      );
      break;
    case "above-cover":
    default: {
      const ph = preset.cover === "ratio" ? `${Math.round((ratio / 150) * 28 + 10)}px` : "56px";
      body = (
        <div className={`p-3 space-y-2 ${hasSidebar ? "grid grid-cols-[1fr_60px] gap-2 space-y-0" : ""}`}>
          <div className="space-y-2">
            <Header />
            {preset.cover === "full-bleed" ? <div className="w-[110%] -ml-[5%]"><Img h="h-14" /></div> :
              preset.cover === "boxed" ? <div className="mx-auto w-3/4"><Img h="h-14" /></div> :
              <div style={{ height: ph }}><Img h="h-full" /></div>}
            <Lines />
          </div>
          {hasSidebar && (
            <div className="space-y-1 border-l border-border pl-1.5">
              <Bar w="w-full" h="h-1.5" c="bg-foreground/40" />
              <Bar w="w-full" h="h-1.5" c="bg-foreground/30" />
              <Bar w="w-2/3" h="h-1.5" c="bg-foreground/30" />
              <div className="h-6 bg-muted rounded mt-1" />
            </div>
          )}
        </div>
      );
      break;
    }
  }

  return (
    <div className={`bg-background border border-border rounded-md overflow-hidden ${className ?? ""}`}>
      {body}
    </div>
  );
}
