// Reads icon pack from site_settings.general and syncs it into the runtime store.
// Default stays "lucide" until a different value is loaded.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { setIconPack, type IconPack } from "@/lib/iconPack";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

export function IconPackSync() {
  const { data } = useQuery({
    queryKey: ["site_settings", "general", "icon_pack"],
    staleTime: 5 * 60_000,
    queryFn: async ({ client }): Promise<IconPack | null> => {
      const settings = await client.ensureQueryData(siteSettingsQueryOptions);
      const v = (settings.general as { icon_pack?: string } | null)?.icon_pack;
      return v === "fontawesome" || v === "lucide" ? v : null;
    },
  });

  useEffect(() => {
    if (data) setIconPack(data);
  }, [data]);

  return null;
}
