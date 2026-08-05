// Kontrakty (schematy + typy) dla administracyjnego audytu zgód.
// Trzymane poza `.functions.ts`, żeby splitter server-fn nie musiał wciągać
// siblingów do chunków handlerów.
import { z } from "zod";

export const ConsentDecisionsQuerySchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  source: z.string().trim().max(64).nullish(),
});

export const ConsentStatsQuerySchema = z.object({
  days: z.number().int().min(1).max(365).default(30),
});

/** Jedna decyzja użytkownika - kto, kiedy, na jakich kategoriach, jaka wersja. */
export interface ConsentDecisionRow {
  decision_id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  decided_at: string;
  source: string | null;
  banner_version: string | null;
  lang: string | null;
  gpc: boolean | null;
  page_url: string | null;
  granted_keys: string[];
  denied_keys: string[];
}

/** Zbiorcze liczniki per klucz zgody w wybranym oknie czasu. */
export interface ConsentStatRow {
  consent_key: string;
  granted: number;
  denied: number;
  gpc_events: number;
  last_event_at: string | null;
  banner_versions: string[];
}
