// Tiny emoji helpers used by eagerly-loaded chat UI (message bubbles).
// Kept SEPARATE from emoji.ts on purpose: that module carries the ~20 KB
// picker dataset, and any eager import of it would anchor the dataset into
// the main chat chunk, defeating the lazy EmojiPicker split.

/** Messenger-style quick reaction bar. */
export const QUICK_REACTIONS: ReadonlyArray<string> = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const EMOJI_ONLY_PATTERN =
  /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*|\s){1,12}$/u;

/** True when a message consists of emoji only (rendered enlarged, Messenger-style). */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return EMOJI_ONLY_PATTERN.test(trimmed);
}
