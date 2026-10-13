import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SOCIAL_KEYS, type SocialKey } from "@/lib/events/myEventProfileApi";

export function parseSpeakerDetail(raw: unknown) {
  const value: Record<string, unknown> =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const text = (key: string) => (typeof value[key] === "string" ? value[key].trim() : "");
  const socials: Partial<Record<SocialKey, string>> = {};
  const links = value.social_links;
  if (links !== null && typeof links === "object" && !Array.isArray(links)) {
    const source = links as Record<string, unknown>;
    for (const key of SOCIAL_KEYS) {
      if (typeof source[key] !== "string") continue;
      try {
        const url = new URL(source[key]);
        if (url.protocol === "https:" || url.protocol === "http:") socials[key] = url.toString();
      } catch {
        /* Invalid imported links stay hidden. */
      }
    }
  }
  const email = text("email");
  const phone = text("phone");
  return {
    bioPl: text("bio_pl"),
    bioEn: text("bio_en"),
    socials,
    email: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : "",
    phone: /^\+?[\d\s().-]{5,30}$/.test(phone) ? phone : "",
  };
}

export function speakerDetailQueryOptions(
  eventId: string,
  speakerProfileId: string,
  preview: boolean,
  viewerId: string | null,
) {
  return queryOptions({
    queryKey: ["event-speaker-detail", eventId, speakerProfileId, preview, viewerId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("event_speaker_detail", {
        p_event_id: eventId,
        p_speaker_profile_id: speakerProfileId,
        p_preview: preview,
      });
      if (error) throw error;
      return parseSpeakerDetail(data);
    },
    staleTime: 60_000,
  });
}
