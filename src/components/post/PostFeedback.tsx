// "Czy ta analiza była przydatna?" (A9) - jednokliknięciowy feedback pod
// wpisem. Po głosie sekcja przechodzi w podziękowanie; localStorage pamięta
// głos per wpis (UI-owa blokada powtórki), serwer dodatkowo deduplikuje po
// skrócie IP+UA i limituje per IP. Ukryte w druku.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { submitPostFeedback } from "@/lib/content/feedback.functions";

const COPY = {
  pl: {
    question: "Czy ta analiza była przydatna?",
    yes: "Tak, przydatna",
    no: "Nie",
    thanks: "Dziękujemy za opinię.",
  },
  en: {
    question: "Was this analysis useful?",
    yes: "Yes, useful",
    no: "No",
    thanks: "Thank you for your feedback.",
  },
} as const;

const STORAGE_PREFIX = "post-feedback:";

export function PostFeedback({ postId, lang }: { postId: string; lang: "pl" | "en" }) {
  const c = COPY[lang];
  const submit$ = useServerFn(submitPostFeedback);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  useEffect(() => {
    try {
      if (window.localStorage.getItem(`${STORAGE_PREFIX}${postId}`)) setState("done");
      else setState("idle");
    } catch {
      /* prywatny tryb - trudno, przycisk zostaje aktywny */
    }
  }, [postId]);

  const vote = async (helpful: boolean) => {
    if (state !== "idle") return;
    setState("busy");
    try {
      await submit$({ data: { postId, helpful } });
      try {
        window.localStorage.setItem(`${STORAGE_PREFIX}${postId}`, helpful ? "up" : "down");
      } catch {
        /* noop */
      }
      setState("done");
    } catch {
      // Cichy powrót - feedback nie jest krytyczny, nie strasz czytelnika.
      setState("idle");
    }
  };

  return (
    <div
      className="no-print border-t border-border pt-6 flex flex-wrap items-center gap-3"
      aria-live="polite"
    >
      {state === "done" ? (
        <p className="text-sm text-muted-foreground">{c.thanks}</p>
      ) : (
        <>
          <span className="text-sm font-medium">{c.question}</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={state === "busy"}
              onClick={() => void vote(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted hover:text-brand transition disabled:opacity-60"
            >
              <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
              {c.yes}
            </button>
            <button
              type="button"
              disabled={state === "busy"}
              onClick={() => void vote(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted transition disabled:opacity-60"
            >
              <ThumbsDown className="w-3.5 h-3.5" aria-hidden="true" />
              {c.no}
            </button>
          </span>
        </>
      )}
    </div>
  );
}
