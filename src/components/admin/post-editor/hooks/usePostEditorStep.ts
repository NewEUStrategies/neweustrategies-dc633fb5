// Two-step editor flow controller. Content-first: an established post (already
// titled) opens straight in the editor so writing - not the dense metadata - is
// the landing view. Brand-new / untitled posts stay on "details" so the author
// sets a title first. The auto-jump runs exactly once after the post loads and
// never fights later manual navigation. Extracted 1:1 from admin.posts.$slug.
import { useEffect, useRef, useState } from "react";
import type { EditorStep, PostForm } from "../types";

export interface PostEditorStepApi {
  step: EditorStep;
  setStep: (step: EditorStep) => void;
}

/** Only the titles decide the initial step, so the hook depends on nothing more
 *  (interface segregation keeps it trivially testable). */
type StepForm = Pick<PostForm, "title_pl" | "title_en">;

export function usePostEditorStep(form: StepForm | null): PostEditorStepApi {
  const [step, setStep] = useState<EditorStep>("details");
  const autoStepRef = useRef(false);
  useEffect(() => {
    if (autoStepRef.current || !form) return;
    autoStepRef.current = true;
    if (form.title_pl?.trim() || form.title_en?.trim()) {
      setStep("content");
    }
  }, [form]);
  return { step, setStep };
}
