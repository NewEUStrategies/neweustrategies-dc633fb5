// Tablica „Sponsorzy i reklama": układ sekcji (baner / siatka), przekierowania
// logotypów i reklamy strony głównej wydarzenia. Warstwa RPC + hooki.
//
// Sekcja = poziom sponsorski (`event_sponsor_tiers`); logotyp = przypięta firma
// z CRM (`event_sponsors`). Nowe kolumny czytamy osobnymi, wąskimi RPC, żeby nie
// przepisywać sygnatur istniejących list.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { sponsorKeys } from "@/lib/events/useEventSponsors";

type Fns = Database["public"]["Functions"];

export const SPONSOR_SECTION_LAYOUTS = ["banner", "grid"] as const;
export type SponsorSectionLayout = (typeof SPONSOR_SECTION_LAYOUTS)[number];

export const SPONSOR_LINK_MODES = ["exhibitor", "external", "none"] as const;
export type SponsorLinkMode = (typeof SPONSOR_LINK_MODES)[number];

export type EventHomeAdRow = Fns["admin_event_home_ads_list"]["Returns"][number];
export type PublicHomeAdRow = Fns["event_home_ads_for_viewer"]["Returns"][number];

export interface SponsorLink {
  mode: SponsorLinkMode;
  url: string;
}

const HTTPS_URL = /^https:\/\/\S{3,2000}$/i;

export function isHttpsUrl(value: string): boolean {
  return HTTPS_URL.test(value.trim());
}

export function toLayout(value: string | null | undefined): SponsorSectionLayout {
  return value === "banner" ? "banner" : "grid";
}

export function toLinkMode(value: string | null | undefined): SponsorLinkMode {
  return value === "external" || value === "none" ? value : "exhibitor";
}

/* ----------------------------------------------------------------- RPC --- */

export async function fetchTierLayouts(
  eventId: string,
): Promise<Map<string, SponsorSectionLayout>> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_tier_layouts", {
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.id, toLayout(row.layout)]));
}

export async function fetchSponsorLinks(eventId: string): Promise<Map<string, SponsorLink>> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_links", { p_event_id: eventId });
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? []).map((row) => [
      row.id,
      { mode: toLinkMode(row.link_mode), url: row.link_url ?? "" },
    ]),
  );
}

export async function setTierLayout(input: {
  id: string;
  layout: SponsorSectionLayout;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_tier_set_layout", {
    _id: input.id,
    _layout: input.layout,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function setSponsorLink(input: { id: string } & SponsorLink): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_sponsor_set_link", {
    _id: input.id,
    _mode: input.mode,
    _url: input.mode === "external" ? input.url.trim() : "",
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export interface HomeAdInput {
  id?: string;
  eventId: string;
  imageUrl: string;
  imageMobileUrl: string;
  linkUrl: string;
  altText: string;
  groupIds: string[];
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

export type HomeAdField = "imageUrl" | "imageMobileUrl" | "linkUrl" | "endsAt";

export function validateHomeAd(input: HomeAdInput): HomeAdField[] {
  const out: HomeAdField[] = [];
  if (!isHttpsUrl(input.imageUrl)) out.push("imageUrl");
  if (input.imageMobileUrl.trim() !== "" && !isHttpsUrl(input.imageMobileUrl))
    out.push("imageMobileUrl");
  if (input.linkUrl.trim() !== "" && !isHttpsUrl(input.linkUrl)) out.push("linkUrl");
  if (input.startsAt !== "" && input.endsAt !== "" && input.endsAt <= input.startsAt)
    out.push("endsAt");
  return out;
}

export async function fetchHomeAds(eventId: string): Promise<EventHomeAdRow[]> {
  const { data, error } = await supabase.rpc("admin_event_home_ads_list", { p_event_id: eventId });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function saveHomeAd(input: HomeAdInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_event_home_ad_save", {
    p_payload: {
      id: input.id ?? "",
      event_id: input.eventId,
      image_url: input.imageUrl.trim(),
      image_mobile_url: input.imageMobileUrl.trim(),
      link_url: input.linkUrl.trim(),
      alt_text: input.altText.trim(),
      group_ids: input.groupIds,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      is_active: input.isActive,
    },
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function deleteHomeAd(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_home_ad_delete", { _id: id });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function fetchPublicHomeAds(slug: string): Promise<PublicHomeAdRow[]> {
  const { data, error } = await supabase.rpc("event_home_ads_for_viewer", { p_slug: slug });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function trackHomeAd(adId: string, kind: "view" | "click", session: string) {
  await supabase.rpc("event_home_ad_track", { p_ad_id: adId, p_kind: kind, p_session: session });
}

/* --------------------------------------------------------------- hooki --- */

const boardKeys = {
  layouts: (eventId: string) => [...sponsorKeys.event(eventId), "layouts"] as const,
  links: (eventId: string) => [...sponsorKeys.event(eventId), "links"] as const,
  ads: (eventId: string) => ["event-home-ads", eventId] as const,
  publicAds: (slug: string) => ["event-home-ads-public", slug] as const,
};

export function useTierLayouts(eventId: string): UseQueryResult<Map<string, SponsorSectionLayout>> {
  return useQuery({
    queryKey: boardKeys.layouts(eventId),
    queryFn: () => fetchTierLayouts(eventId),
  });
}

export function useSponsorLinks(eventId: string): UseQueryResult<Map<string, SponsorLink>> {
  return useQuery({
    queryKey: boardKeys.links(eventId),
    queryFn: () => fetchSponsorLinks(eventId),
  });
}

function useEventMutation<TIn, TOut>(
  keys: ReadonlyArray<readonly unknown[]>,
  run: (input: TIn) => Promise<TOut>,
): UseMutationResult<TOut, Error, TIn> {
  const qc = useQueryClient();
  return useMutation<TOut, Error, TIn>({
    mutationFn: run,
    onSuccess: () => {
      for (const key of keys) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useSetTierLayout(eventId: string) {
  return useEventMutation([sponsorKeys.event(eventId)], setTierLayout);
}

export function useSetSponsorLink(eventId: string) {
  return useEventMutation([boardKeys.links(eventId)], setSponsorLink);
}

export function useHomeAds(eventId: string): UseQueryResult<EventHomeAdRow[]> {
  return useQuery({ queryKey: boardKeys.ads(eventId), queryFn: () => fetchHomeAds(eventId) });
}

export function useSaveHomeAd(eventId: string) {
  return useEventMutation([boardKeys.ads(eventId)], saveHomeAd);
}

export function useDeleteHomeAd(eventId: string) {
  return useEventMutation([boardKeys.ads(eventId)], deleteHomeAd);
}

export function usePublicHomeAds(slug: string): UseQueryResult<PublicHomeAdRow[]> {
  return useQuery({
    queryKey: boardKeys.publicAds(slug),
    queryFn: () => fetchPublicHomeAds(slug),
    staleTime: 60_000,
    enabled: slug !== "",
  });
}
