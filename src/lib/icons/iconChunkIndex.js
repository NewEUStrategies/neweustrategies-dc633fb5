/** Shared by the generator and runtime; stable when other icons are added. */
export function iconChunkIndex(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 16;
}
