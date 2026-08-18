// Atrapa `supabase.storage` - wspolna dla wszystkich powierzchni testowych.
//
// Podpisy pojedyncze i wsadowe oraz URL uploadu. Wyprowadzona z
// `src/test/chat/fixtures.ts` razem z reszta generycznej maszynerii klienta:
// zalaczniki czatu, okladki klubow (`clubs/coverApi`) i pliki wpisow klubowych
// (`clubs/postsApi`) korzystaja z tego samego kubelka i tego samego kontraktu.
import { vi, type Mock } from "vitest";

export interface StorageStub {
  from: Mock;
  createSignedUrl: Mock;
  createSignedUrls: Mock;
  createSignedUploadUrl: Mock;
  reset(): void;
}

/** Atrapa `supabase.storage` dla załączników (podpisy 15-minutowe, batch). */
export function storageStub(): StorageStub {
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://signed.test/${path}` },
    error: null,
  }));
  const createSignedUrls = vi.fn(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}`, error: null })),
    error: null,
  }));
  const createSignedUploadUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://upload.test/${path}`, path, token: "tok" },
    error: null,
  }));
  const stub: StorageStub = {
    from: vi.fn(() => ({ createSignedUrl, createSignedUrls, createSignedUploadUrl })),
    createSignedUrl,
    createSignedUrls,
    createSignedUploadUrl,
    reset() {
      createSignedUrl.mockClear();
      createSignedUrls.mockClear();
      createSignedUploadUrl.mockClear();
      stub.from.mockClear();
    },
  };
  return stub;
}
