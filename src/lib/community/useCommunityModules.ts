// Hook do konsumowania toggle modułów community (site_settings.community_modules)
// przez runtime aplikacji. Wywoływany w nawigacji/mobilnym drawerze, żeby
// wyłączony moduł zniknął z UI użytkownika bez rebuildu.
import { useSiteSetting } from "@/lib/useSiteSetting";
import {
  COMMUNITY_MODULES_DEFAULTS,
  COMMUNITY_MODULES_KEY,
  type CommunityModulesSettings,
} from "@/lib/admin/community";

export function useCommunityModules(): CommunityModulesSettings {
  return useSiteSetting<CommunityModulesSettings>(
    COMMUNITY_MODULES_KEY,
    COMMUNITY_MODULES_DEFAULTS,
  );
}
