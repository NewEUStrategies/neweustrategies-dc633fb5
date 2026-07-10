// Wspólna fabryka queryOptions dla statycznych zasobów geometrii map
// (public/geo/*.v1.json) - jedna definicja klucza/fetcha/czasów życia dla
// mapy publicznej (ChoroplethMap) i edytora bloku w adminie (lista krajów).
import { GEO_ASSET_URL, type GeoAsset, type MapRegion } from "./types";

export function geoAssetQueryOptions(region: MapRegion) {
  return {
    queryKey: ["public", "geo", region] as const,
    queryFn: async (): Promise<GeoAsset> => {
      const res = await fetch(GEO_ASSET_URL[region]);
      if (!res.ok) throw new Error(`geo asset ${region}: HTTP ${res.status}`);
      return (await res.json()) as GeoAsset;
    },
    // Zasób jest wersjonowany w nazwie pliku - nigdy nie twardnieje.
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  };
}
