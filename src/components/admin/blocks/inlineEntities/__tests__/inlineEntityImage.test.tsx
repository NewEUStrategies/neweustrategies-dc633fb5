// Obraz encji inline: kadrowanie (rozmiar, przesuwanie L/P/G/D, 6 px, zapis)
// i pole obrazu (wgranie z dysku / z biblioteki, ponowny kadr z oryginału).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";

realT("pl");

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// react-easy-crop mierzy geometrię (happy-dom zwraca zera) - atrapa oddaje
// stałe wymiary i pokazuje sterowane propsy, żeby asercje szły na zachowanie
// kontrolek, a nie na piksele.
const AREA = { x: 10, y: 20, width: 50, height: 50 };
const PIXELS = { x: 40, y: 60, width: 200, height: 200 };
vi.mock("react-easy-crop", () => ({
  default: function CropperStub(props: {
    crop: { x: number; y: number };
    zoom: number;
    initialCroppedAreaPercentages?: unknown;
    onMediaLoaded?: (m: {
      width: number;
      height: number;
      naturalWidth: number;
      naturalHeight: number;
    }) => void;
    onCropSizeChange?: (s: { width: number; height: number }) => void;
    onCropComplete?: (a: typeof AREA, p: typeof PIXELS) => void;
    onZoomChange?: (z: number) => void;
    style?: { cropAreaStyle?: { borderRadius?: number } };
  }) {
    useEffect(() => {
      props.onMediaLoaded?.({ width: 300, height: 200, naturalWidth: 900, naturalHeight: 600 });
      props.onCropSizeChange?.({ width: 200, height: 200 });
      props.onCropComplete?.(AREA, PIXELS);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div
        data-testid="cropper"
        data-x={props.crop.x}
        data-y={props.crop.y}
        data-zoom={props.zoom}
        data-radius={props.style?.cropAreaStyle?.borderRadius}
        data-initial={JSON.stringify(props.initialCroppedAreaPercentages ?? null)}
        onClick={() => props.onZoomChange?.(2.004)}
      />
    );
  },
}));

const getCroppedBlob = vi.hoisted(() => vi.fn());
vi.mock("@/lib/media/imageCrop", () => ({
  getCroppedBlob,
  readFileAsDataUrl: vi.fn(async () => "data:image/png;base64,AAAA"),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/media/${path}` },
        }),
      }),
    },
  },
}));

const { InlineEntityImageCropDialog, OUTPUT_PX } = await import("../InlineEntityImageCropDialog");
const { clampCropOffset, corsSafeImageSource, croppedPreviewStyle } = await import("../cropMath");

function cropper() {
  return screen.getByTestId("cropper");
}

describe("pure crop helpers", () => {
  it("clamps offsets so the image always covers the frame", () => {
    const media = { width: 300, height: 200 };
    const crop = { width: 200, height: 200 };
    expect(clampCropOffset({ x: 500, y: 0 }, media, crop, 1)).toEqual({ x: 50, y: 0 });
    expect(clampCropOffset({ x: -500, y: 90 }, media, crop, 2)).toEqual({ x: -200, y: 90 });
    expect(clampCropOffset({ x: 3, y: 4 }, null, crop, 1)).toEqual({ x: 3, y: 4 });
  });

  it("maps a crop area onto a preview square", () => {
    expect(croppedPreviewStyle({ x: 25, y: 10, width: 50, height: 40 })).toMatchObject({
      width: "200%",
      height: "250%",
      left: "-50%",
      top: "-25%",
    });
  });

  it("uses the CORS-enabled storage URL for branded media", () => {
    expect(corsSafeImageSource("https://neweuropeanstrategies.com/media/t/u/a.png")).toBe(
      "https://x.supabase.co/storage/v1/object/public/media/t/u/a.png",
    );
    expect(corsSafeImageSource("data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
    expect(corsSafeImageSource("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
  });
});

describe("InlineEntityImageCropDialog", () => {
  // Blok, nie wyrażenie: funkcja zwrócona z `beforeEach` jest dla Vitesta
  // sprzątaniem - `mockReset()` zwraca samą atrapę, która wywołałaby się po teście.
  beforeEach(() => {
    getCroppedBlob.mockReset();
  });

  function mount(extra: Partial<Parameters<typeof InlineEntityImageCropDialog>[0]> = {}) {
    const onSave = vi.fn(async () => undefined);
    const onOpenChange = vi.fn();
    render(
      <InlineEntityImageCropDialog
        open
        source="data:image/png;base64,AAAA"
        onOpenChange={onOpenChange}
        onSave={onSave}
        {...extra}
      />,
    );
    return { onSave, onOpenChange };
  }

  it("shows a 6px-rounded frame and moves the image with the arrow buttons (clamped)", () => {
    mount();
    expect(screen.getByText(/kwadrat 256 px z zaokrągleniem 6 px/)).toBeTruthy();
    expect(Number(cropper().dataset.radius)).toBe(Math.round((200 * 6) / 44));
    fireEvent.click(screen.getByRole("button", { name: "Przesuń w lewo" }));
    expect(cropper().dataset.x).toBe("-6");
    fireEvent.click(screen.getByRole("button", { name: "Przesuń w prawo" }));
    fireEvent.click(screen.getByRole("button", { name: "Przesuń w prawo" }));
    expect(cropper().dataset.x).toBe("6");
    // Pionowo obraz (200 px) równa się ramce - brak luzu, przesunięcie = 0.
    fireEvent.click(screen.getByRole("button", { name: "Przesuń w dół" }));
    fireEvent.click(screen.getByRole("button", { name: "Przesuń w górę" }));
    expect(cropper().dataset.y).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: /Wyśrodkuj/ }));
    expect(cropper().dataset.x).toBe("0");
  });

  it("supports keyboard nudging and zoom", () => {
    mount();
    const frame = screen.getByTestId("inline-entity-crop-frame");
    fireEvent.keyDown(frame, { key: "ArrowLeft", shiftKey: true });
    expect(cropper().dataset.x).toBe("-24");
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    expect(cropper().dataset.x).toBe("-18");
    fireEvent.keyDown(frame, { key: "+" });
    expect(Number(cropper().dataset.zoom)).toBeCloseTo(1.05);
    fireEvent.keyDown(frame, { key: "-" });
    expect(Number(cropper().dataset.zoom)).toBeCloseTo(1);
    fireEvent.keyDown(frame, { key: "=", shiftKey: true });
    expect(Number(cropper().dataset.zoom)).toBeCloseTo(1.01);
    fireEvent.keyDown(frame, { key: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Powiększ" }));
    fireEvent.click(screen.getByRole("button", { name: "Pomniejsz" }));
    fireEvent.click(cropper());
    expect(Number(cropper().dataset.zoom)).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /Resetuj/ }));
    expect(Number(cropper().dataset.zoom)).toBe(1);
  });

  it("saves a square blob with the crop parameters and closes", async () => {
    const blob = new Blob(["x"], { type: "image/webp" });
    getCroppedBlob.mockResolvedValue(blob);
    const { onSave, onOpenChange } = mount({ initialZoom: 1.5, initialArea: AREA });
    expect(JSON.parse(cropper().dataset.initial!)).toEqual(AREA);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz kadr" }));
    });
    expect(getCroppedBlob).toHaveBeenCalledWith(
      "data:image/png;base64,AAAA",
      PIXELS,
      0,
      OUTPUT_PX,
      OUTPUT_PX,
      "image/webp",
      0.9,
    );
    expect(onSave).toHaveBeenCalledWith({ blob, area: AREA, zoom: 1.5 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("explains a failed save instead of silently failing", async () => {
    getCroppedBlob.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("tainted")), 0)),
    );
    const { onOpenChange } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Zapisz kadr" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Nie udało się zapisać obrazu/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders no cropper without a source", () => {
    mount({ source: null });
    expect(screen.queryByTestId("cropper")).toBeNull();
  });
});

// ── Pole obrazu ───────────────────────────────────────────────────────────

const upload = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  tenantId: "tenant-1" as string | null,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/media.functions", () => ({ registerMediaUpload: vi.fn() }));
vi.mock("@/lib/media/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/upload")>()),
  uploadAndRegisterMedia: upload,
}));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: ({ onPick }: { onPick: (url: string) => void }) => (
    <button type="button" onClick={() => onPick("https://cdn.example.com/lib.png")}>
      pick-from-library
    </button>
  ),
}));

const { InlineEntityImageField } = await import("../InlineEntityImageField");

describe("InlineEntityImageField", () => {
  beforeEach(() => {
    upload.mockReset();
    getCroppedBlob.mockReset();
    toast.error.mockReset();
    auth.user = { id: "user-1" };
    auth.tenantId = "tenant-1";
    upload.mockImplementation(async ({ file }: { file: File }) => ({
      mediaId: "m",
      storagePath: "p",
      publicUrl: `https://cdn.example.com/${file.name}`,
    }));
    getCroppedBlob.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
  });

  function mount(value: Parameters<typeof InlineEntityImageField>[0]["value"] = null) {
    const onChange = vi.fn();
    const utils = render(
      <InlineEntityImageField value={value} onChange={onChange} label="Logo" initials="AE" />,
    );
    const input = utils.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    return { onChange, input };
  }

  it("uploads a file, crops it and stores both the square and the original", async () => {
    const { onChange, input } = mount();
    expect(screen.getByText("AE")).toBeTruthy();
    const file = new File(["png"], "logo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole("button", { name: "Zapisz kadr" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz kadr" }));
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0][0]).toMatchObject({
      subfolder: "inline-entities",
      tenantId: "tenant-1",
    });
    expect(upload.mock.calls[1][0].file).toBe(file);
    const next = onChange.mock.calls[0][0];
    expect(next.src).toMatch(/^https:\/\/cdn\.example\.com\/inline-entity-\d+\.webp$/);
    expect(next).toMatchObject({
      original: "https://cdn.example.com/logo.png",
      area: AREA,
      zoom: 1,
    });
  });

  it("rejects unsupported files", async () => {
    const { input } = mount();
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] },
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Obsługiwane formaty: JPG, PNG, WebP, GIF, AVIF (do 10 MB).",
      ),
    );
    fireEvent.change(input, { target: { files: [] } });
    expect(screen.queryByRole("button", { name: "Zapisz kadr" })).toBeNull();
  });

  it("crops a library image without re-uploading the original", async () => {
    getCroppedBlob.mockResolvedValue(new Blob(["x"], { type: "image/png" }));
    const { onChange } = mount();
    fireEvent.click(screen.getByRole("button", { name: /Z biblioteki mediów/ }));
    fireEvent.click(screen.getByRole("button", { name: "pick-from-library" }));
    const save = await screen.findByRole("button", { name: "Zapisz kadr" });
    await act(async () => {
      fireEvent.click(save);
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({
      original: "https://cdn.example.com/lib.png",
    });
    expect(onChange.mock.calls[0][0].src).toMatch(/\.png$/);
  });

  it("re-crops from the original with the saved area, and removes the image", async () => {
    getCroppedBlob.mockResolvedValue(new Blob(["x"], { type: "" }));
    const value = {
      src: "https://cdn.example.com/c.webp",
      original: "https://cdn.example.com/o.png",
      area: AREA,
      zoom: 2,
    };
    const { onChange } = mount(value);
    fireEvent.click(screen.getByRole("button", { name: /Kadruj/ }));
    expect(JSON.parse(cropper().dataset.initial!)).toEqual(AREA);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Zapisz kadr" }));
    });
    expect(getCroppedBlob.mock.calls[0][0]).toBe("https://cdn.example.com/o.png");
    expect(onChange.mock.calls[0][0].src).toMatch(/\.jpg$/);
    fireEvent.click(screen.getByRole("button", { name: /Usuń obraz/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("re-crops a source image without an original from scratch", () => {
    mount({ src: "https://cdn.example.com/c.webp", area: AREA });
    fireEvent.click(screen.getByRole("button", { name: /Kadruj/ }));
    expect(cropper().dataset.initial).toBe("null");
  });

  it("refuses to upload without a session", async () => {
    auth.user = null;
    const { onChange, input } = mount();
    fireEvent.change(input, {
      target: { files: [new File(["png"], "logo.png", { type: "image/png" })] },
    });
    const save = await screen.findByRole("button", { name: "Zapisz kadr" });
    await act(async () => {
      fireEvent.click(save);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
