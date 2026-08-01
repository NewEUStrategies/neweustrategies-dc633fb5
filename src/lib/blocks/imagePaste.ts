// Pliki graficzne ze schowka / drag&drop -> bloki obrazów.
// Jedno źródło prawdy dla kanwy i edytorów inline (akapit): ten sam kształt
// danych co obrazy z importu Worda (`wordPaste.imageBlock`), URL jako data-URL;
// upload do biblioteki mediów wykonuje się przy zapisie (persistImages.ts).

import type { Block } from "./types";
import { newBlockId } from "./types";

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Nazwa pliku bez rozszerzenia - sensowny domyślny `alt`. */
function altFromFilename(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

/**
 * Czyta pliki graficzne i zwraca bloki obrazów. Pliki nie-obrazy oraz
 * nieczytelne są pomijane (jeden zepsuty plik nie przerywa wklejki).
 */
export async function filesToImageBlocks(files: readonly File[]): Promise<Block[]> {
  const blocks: Block[] = [];
  for (const file of files) {
    if (!isImageFile(file)) continue;
    try {
      const url = await readAsDataUrl(file);
      if (!url.startsWith("data:image/")) continue;
      blocks.push({
        id: newBlockId(),
        type: "image",
        data: {
          url,
          alt: altFromFilename(file.name),
          caption: "",
          align: "center",
          size: "full",
          rounded: true,
          shadow: false,
        },
      });
    } catch {
      // pomijamy nieczytelny plik
    }
  }
  return blocks;
}
