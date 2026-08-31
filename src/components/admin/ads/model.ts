// Czyste pomocniki panelu reklam: puste szkice wierszy i klasa chipa.
// Wyniesione z `src/routes/admin.ads.tsx` bez zmiany zachowania - trasa byla
// jedynym miejscem, w ktorym te funkcje istnialy, wiec zaden test nie mogl ich
// dosiegnac bez montowania calego panelu.
import type { AdPlacement, AdSlot } from "@/lib/ads/types";

export function emptySlot(): Partial<AdSlot> {
  return {
    name: "",
    kind: "html",
    status: "active",
    requires_consent: true,
    html: "",
    script: "",
    image_url: "",
    image_link: "",
    image_alt: "",
    width: null,
    height: null,
    notes: "",
  };
}

export function emptyPlacement(): Partial<AdPlacement> {
  return {
    slot_id: "",
    position: "top_of_post",
    page_type: "post",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
  };
}

export function chipClass(active: boolean): string {
  return (
    "rounded-full border px-2.5 py-1 text-xs transition " +
    (active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-background hover:bg-muted")
  );
}
