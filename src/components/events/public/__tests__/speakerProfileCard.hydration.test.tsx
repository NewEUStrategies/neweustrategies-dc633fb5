import { act } from "@testing-library/react";
import type { ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/test/i18nReal";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";

const { SpeakerProfileCard } =
  await import("@/components/events/public/molecules/SpeakerProfileCard");

const PHOTO = "https://proj.supabase.co/storage/v1/object/public/avatars/anna.jpg";

function speaker(overrides: Partial<PublicSpeakerRow> = {}): PublicSpeakerRow {
  return {
    user_id: "u1",
    slug: "anna-kowalska",
    display_name: "Anna Kowalska",
    avatar_url: PHOTO,
    job_title: "Dyrektor",
    company: "NASK",
    headline_pl: "Prezes",
    headline_en: "President",
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: true,
    has_speaker_profile: true,
    sort_order: 0,
    ...overrides,
  };
}

async function hydrate(view: ReactElement) {
  const host = document.createElement("div");
  host.innerHTML = renderToString(view);
  document.body.append(host);
  const serverHtml = host.innerHTML;
  const errors: unknown[] = [];
  const roots: Array<ReturnType<typeof hydrateRoot>> = [];
  await act(async () => {
    roots.push(hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) }));
  });
  const root = roots[0];
  if (root === undefined) throw new Error("Hydration root was not created");
  return { host, root, errors, serverHtml };
}

describe("SpeakerProfileCard - SSR i hydratacja", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  for (const view of [
    <SpeakerProfileCard key="static" speaker={speaker()} lang="pl" />,
    <SpeakerProfileCard key="interactive" speaker={speaker()} lang="en" onSelect={() => undefined} />,
    <SpeakerProfileCard
      key="fallback"
      speaker={speaker({ avatar_url: null, card_photo_url: null })}
      lang="pl"
    />,
  ]) {
    it("zachowuje identyczny HTML po hydratacji", async () => {
      const result = await hydrate(view);
      try {
        expect(result.errors).toEqual([]);
        expect(consoleError).not.toHaveBeenCalled();
        expect(result.host.innerHTML).toBe(result.serverHtml);
      } finally {
        await act(async () => result.root.unmount());
      }
    });
  }

  it("HTML serwera zawiera portret i treść karty bez odczytów układu", async () => {
    const measure = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const result = await hydrate(
      <SpeakerProfileCard speaker={speaker()} lang="pl" onSelect={() => undefined} />,
    );
    try {
      expect(result.serverHtml).toContain("Anna Kowalska");
      expect(result.serverHtml).toContain("width=480");
      expect(result.serverHtml).toContain("height=480");
      expect(measure).not.toHaveBeenCalled();
    } finally {
      await act(async () => result.root.unmount());
    }
  });
});