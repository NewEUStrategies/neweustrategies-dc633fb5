// Reads icon pack from site_settings.general and syncs it into the runtime store.
// Default stays "lucide" until a different value is loaded.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setIconPack, type IconPack } from "@/lib/iconPack";

export function IconPackSync() {
  const { data } = useQuery({
    queryKey: ["site_settings", "general", "icon_pack"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<IconPack | null> => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "general")
        .maybeSingle();
      if (error) return null;
      const v = (data?.value as { icon_pack?: string } | null)?.icon_pack;
      return v === "fontawesome" || v === "lucide" ? v : null;
    },
  });

  useEffect(() => {
    if (data) setIconPack(data);
  }, [data]);

  return null;
}
