// Premium subtle animated background presets used by ImageSlot quick-picker.
// Each preset is a self-contained SVG data URI so it renders without any
// network request and works in both preview and production.
//
// The `animation` field pairs with `bgAnimation` in section/widget schemas
// so picking a preset auto-selects a matching subtle motion.

export type BgAnimationKey =
  | "aurora"
  | "mesh-drift"
  | "floating-dots"
  | "wave-lines"
  | "noise-shimmer"
  | "orbits";

export type BgPreset = {
  id: string;
  labelPl: string;
  labelEn: string;
  descriptionPl: string;
  descriptionEn: string;
  /** Suggested animation key from schemas.bgAnimation. */
  animation: BgAnimationKey;
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
    descriptionPl: "Płynne, świetliste smugi w chłodnym błękicie",
    descriptionEn: "Flowing luminous streaks in cool blue",
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
    descriptionPl: "Ciemna, powoli dryfująca siatka gradientów",
    descriptionEn: "Dark, slowly drifting gradient mesh",
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
    descriptionPl: "Głęboka zieleń z subtelnym połyskiem",
    descriptionEn: "Deep green with a subtle shimmer",
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
    descriptionPl: "Krążące pierścienie w fiolecie i indygo",
    descriptionEn: "Circling rings in violet and indigo",
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
  {
    id: "constellation",
    labelPl: "Konstelacja",
    labelEn: "Constellation",
    descriptionPl: "Delikatne, dryfujące kropki tła",
    descriptionEn: "Subtle floating background dots",
    animation: "floating-dots",
    thumb:
      "radial-gradient(60% 60% at 50% 50%, #172033 0%, transparent 70%), #060912",
    url: svg(
      `<defs>
        <radialGradient id='a' cx='50%' cy='50%' r='70%'>
          <stop offset='0%' stop-color='#172033' stop-opacity='.85'/>
          <stop offset='100%' stop-color='#060912' stop-opacity='0'/>
        </radialGradient>
      </defs>
      <rect width='1600' height='900' fill='#060912'/>
      <rect width='1600' height='900' fill='url(#a)'/>`,
    ),
  },
  {
    id: "silk-waves",
    labelPl: "Jedwabne fale",
    labelEn: "Silk waves",
    descriptionPl: "Miękkie, poziome fale w ciepłym mroku",
    descriptionEn: "Soft horizontal waves in warm dusk",
    animation: "wave-lines",
    thumb:
      "linear-gradient(180deg, #1a1024 0%, #0b0810 100%)",
    url: svg(
      `<defs>
        <linearGradient id='a' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stop-color='#1a1024'/>
          <stop offset='100%' stop-color='#0b0810'/>
        </linearGradient>
      </defs>
      <rect width='1600' height='900' fill='url(#a)'/>`,
    ),
  },
  {
    id: "champagne-mist",
    labelPl: "Szampańska mgła",
    labelEn: "Champagne mist",
    descriptionPl: "Ciepłe złoto z filmowym szumem",
    descriptionEn: "Warm gold with a cinematic grain",
    animation: "noise-shimmer",
    thumb:
      "radial-gradient(120% 80% at 30% 30%, #3a2a10 0%, transparent 60%), radial-gradient(100% 80% at 80% 70%, #5a3f18 0%, transparent 65%), #0f0a06",
    url: svg(
      `<defs>
        <radialGradient id='a' cx='30%' cy='30%' r='70%'>
          <stop offset='0%' stop-color='#5a3f18' stop-opacity='.6'/>
          <stop offset='100%' stop-color='#0f0a06' stop-opacity='0'/>
        </radialGradient>
        <radialGradient id='b' cx='75%' cy='70%' r='70%'>
          <stop offset='0%' stop-color='#3a2a10' stop-opacity='.7'/>
          <stop offset='100%' stop-color='#0f0a06' stop-opacity='0'/>
        </radialGradient>
      </defs>
      <rect width='1600' height='900' fill='#0f0a06'/>
      <rect width='1600' height='900' fill='url(#a)'/>
      <rect width='1600' height='900' fill='url(#b)'/>`,
    ),
  },
  {
    id: "ocean-drift",
    labelPl: "Oceaniczny dryf",
    labelEn: "Ocean drift",
    descriptionPl: "Chłodny cyjan z płynnymi warstwami",
    descriptionEn: "Cool cyan with drifting layers",
    animation: "mesh-drift",
    thumb:
      "radial-gradient(120% 80% at 25% 30%, #0e4c5a 0%, transparent 60%), radial-gradient(100% 80% at 80% 70%, #075069 0%, transparent 60%), #04141a",
    url: svg(
      `<defs>
        <radialGradient id='a' cx='25%' cy='30%' r='70%'>
          <stop offset='0%' stop-color='#0e4c5a' stop-opacity='.7'/>
          <stop offset='100%' stop-color='#04141a' stop-opacity='0'/>
        </radialGradient>
        <radialGradient id='b' cx='80%' cy='70%' r='70%'>
          <stop offset='0%' stop-color='#075069' stop-opacity='.7'/>
          <stop offset='100%' stop-color='#04141a' stop-opacity='0'/>
        </radialGradient>
      </defs>
      <rect width='1600' height='900' fill='#04141a'/>
      <rect width='1600' height='900' fill='url(#a)'/>
      <rect width='1600' height='900' fill='url(#b)'/>`,
    ),
  },
];
