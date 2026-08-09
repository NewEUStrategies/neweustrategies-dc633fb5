// Widget buildera „Mapa świata" - cienki adapter między treścią widgetu
// a komponentem prezentacyjnym `src/components/maps/WorldMap.tsx`.
//
// POŁĄCZENIE Z PLATFORMĄ
// Tryb „Eksperci" podpina końce łuków pod PUBLICZNE profile platformy przez to
// samo RPC, którym żyją widgety prelegentów (`get_public_speakers` ->
// `speakersByIdsQueryOptions`). Mapa pokazuje wtedy żywe imię i nazwisko oraz
// prowadzi do publicznego huba osoby (/author/<slug>), a nie do wpisanej ręcznie
// kopii, która rozjeżdża się z profilem przy pierwszej zmianie.
//
// Współrzędne pozostają redakcyjne (autor wskazuje kraj w panelu): platforma
// NIE publikuje lokalizacji osób - `profiles_public` celowo nie niesie kolumny
// `location`, więc zgadywanie pozycji z danych profilu poszerzyłoby publiczną
// powierzchnię danych osobowych. Panel łączy więc jedno z drugim: tożsamość
// żywa z platformy, umiejscowienie z decyzji redakcji.
//
// SSR: zapytanie o profile jest zarejestrowane w `lib/builder/prefetch.ts`, więc
// serwer renderuje komplet etykiet - bez dociągania po hydratacji.
import { useQuery } from "@tanstack/react-query";
import type { WidgetContent } from "@/lib/builder/types";
import { speakersByIdsQueryOptions } from "@/lib/builder/speakersQuery";
import {
  worldMapArcs,
  worldMapProfileIds,
  worldMapView,
  type WorldMapProfile,
} from "@/lib/builder/worldMapContent";
import { WorldMap } from "@/components/maps/WorldMap";
import type { Lang } from "./frame";

export function WorldMapWidgetView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const view = worldMapView(c, lang);
  const profileIds = worldMapProfileIds(c);

  const { data: rows } = useQuery({
    ...speakersByIdsQueryOptions(profileIds),
    enabled: profileIds.length > 0,
  });

  const profiles: WorldMapProfile[] = (rows ?? []).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name ?? "",
    slug: row.slug ?? "",
    avatarUrl: row.avatar_url ?? "",
    // Nagłówek prelegenta w języku strony, a gdy go nie ma - stanowisko
    // z profilu autorskiego. Jedna linijka pod nazwiskiem, nie biogram.
    role: (lang === "pl" ? row.headline_pl : row.headline_en) || row.job_title || "",
  }));

  const arcs = worldMapArcs(c, lang, profiles);

  return (
    <div className="nes-world-map-widget not-prose w-full">
      {(view.title || view.subtitle) && (
        <div className="mb-5 text-center md:mb-7">
          {view.title && (
            <p className="font-display text-2xl font-bold leading-[1.15] tracking-[-0.01em] text-foreground md:text-4xl">
              {view.title}
            </p>
          )}
          {view.subtitle && (
            <p className="mx-auto mt-2.5 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
              {view.subtitle}
            </p>
          )}
        </div>
      )}
      <WorldMap
        dots={arcs}
        lang={lang}
        fit={view.fit}
        lineColor={view.lineColor || undefined}
        dotColor={view.dotColor}
        pointColor={view.pointColor}
        bgColor={view.bgColor}
        showLabels={view.showLabels}
        animate={view.animate}
        animationDuration={view.animationDuration}
        loop={view.loop}
      />
    </div>
  );
}
