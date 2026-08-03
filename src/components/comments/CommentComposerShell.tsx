// Molekuła: kompozytor komentarza - cienka nakładka na współdzieloną
// `ComposerShell` (pasek formatowania markdown + licznik znaków).
//
// Formatowanie działa na tej samej textarei, którą renderuje MentionTextarea
// (dostęp przez `textareaRef`), więc podpowiedzi @wzmianek pozostają aktywne.
import { ComposerShell, type ComposerShellProps } from "@/components/composer/ComposerShell";

export { applyMarkdown } from "@/components/composer/ComposerShell";
export type { MarkdownAction } from "@/components/composer/ComposerShell";

export type CommentComposerShellProps = ComposerShellProps;

export function CommentComposerShell(props: CommentComposerShellProps) {
  return <ComposerShell {...props} />;
}
