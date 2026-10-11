// Pole okładki podcastu mierzy obraz i ocenia go regułą Apple - baner 16:9
// musi być widoczny jako błąd ZANIM trafi do `<itunes:image>`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({ onPick }: { onPick: (url: string) => void }) => (
    <button
      type="button"
      data-testid="media-pick"
      onClick={() => onPick("https://cdn.example.org/n.png")}
    />
  ),
}));

import { PodcastArtworkField } from "@/components/admin/podcasts/PodcastArtworkField";

const sizes = new Map<string, [number, number]>();
class FakeImage {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    const size = sizes.get(value);
    queueMicrotask(() => {
      if (!size) return this.onerror?.();
      [this.naturalWidth, this.naturalHeight] = size;
      this.onload?.();
    });
  }
}

beforeEach(() => {
  sizes.clear();
  vi.stubGlobal("Image", FakeImage);
});
afterEach(() => vi.unstubAllGlobals());

function mount(value: string, onMeasured = vi.fn(), onChange = vi.fn()) {
  render(
    <PodcastArtworkField
      id="cover"
      label="Okładka"
      value={value}
      onChange={onChange}
      onMeasured={onMeasured}
    />,
  );
  return { onMeasured, onChange };
}

describe("PodcastArtworkField", () => {
  it("flags a 16:9 banner as not square and reports the measurement up", async () => {
    sizes.set("https://cdn.example.org/baner.jpg", [1024, 640]);
    const { onMeasured } = mount("https://cdn.example.org/baner.jpg");
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toContain("adminPodcasts.artwork.notSquare");
    expect(onMeasured).toHaveBeenLastCalledWith({ width: 1024, height: 640 });
  });

  it("a wide LIBRARY image is a warning, not an error - the feed serves a 1400 square crop", async () => {
    const url = "https://db.example.supabase.co/storage/v1/object/public/media/baner.jpg";
    sizes.set(`/media/baner.jpg`, [3000, 2000]);
    sizes.set(url, [3000, 2000]);
    const { onMeasured } = mount(url);
    await act(async () => {});
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("adminPodcasts.artwork.croppedInFeed");
    expect(status).not.toContain("adminPodcasts.artwork.notSquare");
    expect(onMeasured).toHaveBeenLastCalledWith({ width: 1400, height: 1400 });
  });

  it("accepts a 3000x3000 square", async () => {
    sizes.set("https://cdn.example.org/kwadrat.png", [3000, 3000]);
    mount("https://cdn.example.org/kwadrat.png");
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toContain("adminPodcasts.artwork.ok");
  });

  it("warns about formats Apple does not read and about unreadable images", async () => {
    mount("https://cdn.example.org/okladka.webp");
    await act(async () => {});
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("adminPodcasts.artwork.format");
    expect(status).toContain("adminPodcasts.artwork.loadError");
  });

  it("opens the media library on demand and writes the pick back", async () => {
    const { onChange } = mount("");
    expect(screen.queryByTestId("media-pick")).toBeNull();
    fireEvent.click(screen.getByTitle("adminPodcasts.artwork.pick"));
    fireEvent.click(screen.getByTestId("media-pick"));
    expect(onChange).toHaveBeenCalledWith("https://cdn.example.org/n.png");
  });
});
