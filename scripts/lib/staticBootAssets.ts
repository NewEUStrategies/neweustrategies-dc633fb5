export interface BootAssetChunk {
  file: string;
  imports: readonly string[];
}

/** Follow Rollup's actual static edges from scripts emitted by SSR. Resource
 * Timing's initiatorType describes the fetch mechanism, not the module graph:
 * modulepreload and browser versions can change it without changing the code.
 */
export function staticBootAssets(
  chunks: readonly BootAssetChunk[],
  entries: readonly string[],
): string[] {
  if (entries.length === 0) throw new Error("SSR emitted no module entry scripts");
  const byPath = new Map(chunks.map((chunk) => [`/${chunk.file.replace(/^\//, "")}`, chunk]));
  const pending = entries.map((path) => new URL(path, "https://artifact.test").pathname);
  const seen = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    const chunk = byPath.get(path);
    if (!chunk) throw new Error(`Static boot asset missing from build inventory: ${path}`);
    seen.add(path);
    for (const dependency of chunk.imports) pending.push(`/${dependency.replace(/^\//, "")}`);
  }
  return [...seen].sort();
}
