// Fabryki widgetow + budowanie startowego dokumentu Newsletter Buildera.
//
// `buildDefaultDoc` uzywane jest gdy tenant nie ma zapisanego `inline_doc`
// lub `popup_doc` - wypelniamy dokument sensownymi wartosciami zbudowanymi z
// pozostalych ustawien (headings, descriptions, cta), zeby builder od razu
// wygladal jak istniejacy formularz i nie startowal pusty.
import type {
  NlDoc,
  NlSection,
  NlWidget,
  NlI18n,
  NlWidgetType,
  NlEmailFieldWidget,
  NlTextFieldWidget,
  NlHeadingWidget,
  NlParagraphWidget,
  NlSubmitWidget,
  NlCheckboxWidget,
  NlImageWidget,
  NlDividerWidget,
  NlSpacerWidget,
  NlSuccessMessageWidget,
} from "./types";

const uid = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  }
};

const i18n = (pl: string, en: string): NlI18n => ({ pl, en });

export const widgetFactories: Record<NlWidgetType, () => NlWidget> = {
  heading: (): NlHeadingWidget => ({
    id: uid(),
    type: "heading",
    level: 2,
    align: "left",
    text: i18n("Zapisz sie do newslettera", "Subscribe to the newsletter"),
  }),
  paragraph: (): NlParagraphWidget => ({
    id: uid(),
    type: "paragraph",
    size: "md",
    html: i18n(
      "Otrzymuj najnowsze artykuly prosto na swoja skrzynke.",
      "Get the latest articles delivered to your inbox.",
    ),
  }),
  image: (): NlImageWidget => ({
    id: uid(),
    type: "image",
    url: null,
    alt: "",
    aspect: "16/9",
    rounded: true,
  }),
  divider: (): NlDividerWidget => ({ id: uid(), type: "divider", thickness: 1 }),
  spacer: (): NlSpacerWidget => ({ id: uid(), type: "spacer", size: 16 }),
  "field.email": (): NlEmailFieldWidget => ({
    id: uid(),
    type: "field.email",
    required: true,
    label: i18n("E-mail", "Email"),
    placeholder: i18n("twoj@email.pl", "your@email.com"),
  }),
  "field.text": (): NlTextFieldWidget => ({
    id: uid(),
    type: "field.text",
    name: "firstName",
    required: false,
    label: i18n("Imie", "First name"),
    placeholder: i18n("Imie", "First name"),
  }),
  "field.checkbox": (): NlCheckboxWidget => ({
    id: uid(),
    type: "field.checkbox",
    key: "terms",
    required: true,
    html: i18n(
      'Akceptuje <a href="/regulamin">regulamin</a>.',
      'I accept the <a href="/terms">terms &amp; conditions</a>.',
    ),
  }),
  submit: (): NlSubmitWidget => ({
    id: uid(),
    type: "submit",
    fullWidth: true,
    label: i18n("Zapisz sie", "Subscribe"),
  }),
  "success-message": (): NlSuccessMessageWidget => ({
    id: uid(),
    type: "success-message",
    text: i18n("Dziekujemy! Sprawdz swoja skrzynke.", "Thanks! Please check your inbox."),
  }),
};

export function makeWidget(type: NlWidgetType): NlWidget {
  return widgetFactories[type]();
}

export function makeSection(widgets: NlWidget[] = []): NlSection {
  return { id: uid(), widgets, style: { paddingY: 24, gap: 12, align: "left" } };
}

interface DocSeed {
  heading?: { pl: string; en: string };
  description?: { pl: string; en: string };
  policyHtml?: { pl: string | null; en: string | null };
  successMsg?: { pl: string; en: string };
  submitLabel?: { pl: string; en: string };
  coverUrl?: string | null;
  requireTerms?: boolean;
  termsHtml?: { pl: string | null; en: string | null };
  eyebrow?: { pl: string; en: string };
}

export function buildDefaultDoc(variant: "inline" | "popup", seed: DocSeed = {}): NlDoc {
  const widgets: NlWidget[] = [];

  if (variant === "popup" && seed.coverUrl) {
    const img = widgetFactories.image() as NlImageWidget;
    img.url = seed.coverUrl;
    img.aspect = "16/7";
    widgets.push(img);
  }

  const heading = widgetFactories.heading() as NlHeadingWidget;
  if (seed.heading) heading.text = seed.heading;
  widgets.push(heading);

  if (seed.description && (seed.description.pl || seed.description.en)) {
    const para = widgetFactories.paragraph() as NlParagraphWidget;
    para.html = seed.description;
    widgets.push(para);
  }

  const email = widgetFactories["field.email"]() as NlEmailFieldWidget;
  widgets.push(email);

  const submit = widgetFactories.submit() as NlSubmitWidget;
  if (seed.submitLabel) submit.label = seed.submitLabel;
  widgets.push(submit);

  if (seed.requireTerms && seed.termsHtml && (seed.termsHtml.pl || seed.termsHtml.en)) {
    const chk = widgetFactories["field.checkbox"]() as NlCheckboxWidget;
    chk.html = { pl: seed.termsHtml.pl ?? "", en: seed.termsHtml.en ?? "" };
    widgets.push(chk);
  }

  if (seed.policyHtml && (seed.policyHtml.pl || seed.policyHtml.en)) {
    const policy = widgetFactories.paragraph() as NlParagraphWidget;
    policy.size = "sm";
    policy.html = { pl: seed.policyHtml.pl ?? "", en: seed.policyHtml.en ?? "" };
    widgets.push(policy);
  }

  if (seed.successMsg) {
    const ok = widgetFactories["success-message"]() as NlSuccessMessageWidget;
    ok.text = seed.successMsg;
    widgets.push(ok);
  }

  return {
    version: 1,
    variant,
    sections: [makeSection(widgets)],
    ...(variant === "popup" ? { popup: { layout: "stacked", radius: 16 } } : {}),
  };
}

export function emptyDoc(variant: "inline" | "popup"): NlDoc {
  return { version: 1, variant, sections: [makeSection([])] };
}
