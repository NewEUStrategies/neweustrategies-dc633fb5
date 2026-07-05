// Premium subtle animated background presets used by ImageSlot quick-picker.
// Each preset is a self-contained SVG data URI so it renders without any
// network request and works in both preview and production.

export type BgPreset = {
  id: string;
  labelPl: string;
  labelEn: string;
  /** Suggested animation key from schemas.bgAnimation. */
  animation: "aurora" | "mesh-drift" | "noise-shimmer" | "orbits";
  /** SVG data URI to store in bgImage. */
  url: string;
  /** CSS gradient used to render the tiny thumbnail in the picker. */
  thumb: string;
};

const svg = (inner: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900' preserveAspectRatio='xMidYMid slice'>${inner}</svg>`,
  )}`;

export const BG_PRESETS: ReadonlyArray<BgPreset> = [
  {
    id: "midnight-aurora",
    labelPl: "Nocna zorza",
    labelEn: "Midnight aurora",
    animation: "aurora",
    thumb:
      "radial-gradient(120% 80% at 20% 30%, #1e3a5f 0%, transparent 55%), radial-gradient(100% 80% at 80% 70%, #3b6fa0 0%, transparent 60%), #0a0f1e",
    url: svg(
      `<defs>
        <radialGradient id='a' cx='20%' cy='30%' r='70%'>
          <stop offset='0%' stop-color='#1e3a5f' stop-opacity='.9'/>
          <stop offset='100%' stop-color='#0a0f1e' stop-opacity='0'/>
        </radialGradient>
        <radialGradient id='b' cx='80%' cy='70%' r='70%'>
          <stop offset='0%' stop-color='#3b6fa0' stop-opacity='.75'/>
          <stop offset='100%' stop-color='#0a0f1e' stop-opacity='0'/>
        </radialGradient>
      </defs>
      <rect width='1600' height='900' fill='#0a0f1e'/>
      <rect width='1600' height='900' fill='url(#a)'/>
      <rect width='1600' height='900' fill='url(#b)'/>`,
    ),
  },
  {
    id: "obsidian-mesh",
    labelPl: "Obsydianowa mgła",
    labelEn: "Obsidian mesh",
    animation: "mesh-drift",
    thumb:
      "radial-gradient(90% 70% at 30% 30%, #2d2d3a 0%, transparent 60%), radial-gradient(80% 70% at 75% 75%, #1a1a24 0%, transparent 60%), #0d0d12",
    url: svg(
      `<defs>
        <radialGradient id='a' cx='30%' cy='30%' r='60%'>
          <stop offset='0%' stop-color='#2d2d3a' stop-opacity='.9'/>
          <stop offset='100%' stop-color='#0d0d12' stop-opacity='0'/>
        </radialGradient>
        <radialGradient id='b' cx='75%' cy='75%' r='60%'>
          <stop offset='0%' stop-color='#1f2033' stop-opacity='.85'/>
          <stop offset='100%' stop-color='#0d0d12' stop-opacity='0'/>
        </radialGradient>
      </defs>
      <rect width='1600' height='900' fill='#0d0d12'/>
      <rect width='1600' height='900' fill='url(#a)'/>
      <rect width='1600' height='900' fill='url(#b)'/>`,
    ),
  },
  {
    id: "emerald-noir",
    labelPl: "Szmaragdowy noir",
    labelEn: "Emerald noir",
    animation: "noise-shimmer",
    thumb:
      "radial-gradient(90% 70% at 25% 35%, #0d7a5f 0%, transparent 55%), radial-gradient(80% 70% at 80% 70%, #064e3b 0%, transparent 60%), #04120e",
    url: svg(
      `<defs>
        <radialGradient id='a' cx='25%' cy='35%' r='65%'>
          <stop offset='0%' stop-color='#0d7a5f' stop-opacity='.7'/>
          <stop offset='100%' stop-color='#04120e' stop-opacity='0'/>
        </radialGradient>
        <radialGradient id='b' cx='80%' cy='70%' r='65%'>
          <stop offset='0%' stop-color='#064e3b' stop-opacity='.85'/>
          <stop offset='100%' stop-color='#04120e' stop-opacity='0'/>
        </radialGradient>
      </defs>
      <rect width='1600' height='900' fill='#04120e'/>
      <rect width='1600' height='900' fill='url(#a)'/>
      <rect width='1600' height='900' fill='url(#b)'/>`,
    ),
  },
  {
    id: "royal-orbit",
    labelPl: "Królewska orbita",
    labelEn: "Royal orbit",
    animation: "orbits",
    thumb:
      "radial-gradient(90% 70% at 30% 40%, #4f46e5 0%, transparent 55%), radial-gradient(80% 70% at 75% 65%, #7c3aed 0%, transparent 60%), #0a0a1a",
    url: svg(
      `<defs>
        <radialGradient id='a' cx='30%' cy='40%' r='65%'>
          <stop offset='0%' stop-color='#4f46e5' stop-opacity='.7'/>
          <stop offset='100%' stop-color='#0a0a1a' stop-opacity='0'/>
        </radialGradient>
        <radialGradient id='b' cx='75%' cy='65%' r='65%'>
          <stop offset='0%' stop-color='#7c3aed' stop-opacity='.7'/>
          <stop offset='100%' stop-color='#0a0a1a' stop-opacity='0'/>
        </radialGradient>
      </defs>
      <rect width='1600' height='900' fill='#0a0a1a'/>
      <rect width='1600' height='900' fill='url(#a)'/>
      <rect width='1600' height='900' fill='url(#b)'/>`,
    ),
  },
];
