// Toggle modułów community (site_settings.community_modules) - typ + domyślne.
// Wydzielone z lib/admin/community.ts, bo konsumuje je useCommunityModules w
// SiteChrome (chrome KAŻDEJ strony): import stamtąd wciągał całą admińską
// warstwę danych (queries/mutations/statystyki, ~14 KB) do bundla wejściowego.
// lib/admin/community re-eksportuje te symbole, więc panel admina bez zmian.
export interface CommunityModulesSettings {
  chat_enabled: boolean;
  connections_enabled: boolean;
  events_enabled: boolean;
  qa_enabled: boolean;
  polls_enabled: boolean;
  contributor_program_enabled: boolean;
  badges_enabled: boolean;
  push_enabled: boolean;
  default_message_ttl_seconds: number | null;
}

export const COMMUNITY_MODULES_DEFAULTS: CommunityModulesSettings = {
  chat_enabled: true,
  connections_enabled: true,
  events_enabled: true,
  qa_enabled: true,
  polls_enabled: true,
  contributor_program_enabled: true,
  badges_enabled: true,
  push_enabled: true,
  default_message_ttl_seconds: null,
};

export const COMMUNITY_MODULES_KEY = "community_modules";
