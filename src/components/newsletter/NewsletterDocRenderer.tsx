// NewsletterDocRenderer - runtime renderer dla dokumentu z Newsletter Buildera.
//
// Uzywane w NewsletterForm (inline) i NewsletterPopup (popup). Walkuje sekcje
// i widgety `NlDoc`, buduje realny formularz i zapisuje przez
// `subscribeToNewsletter` (double opt-in po stronie serwera). Waliduje
// wymagane pola po stronie klienta + polega na serwerowej polityce
// form_field_policies. Fallback do klasycznego layoutu jest po stronie
// wywolujacego (NewsletterForm / NewsletterPopup).
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { sanitizeHtml } from "@/lib/sanitize";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToNewsletter } from "@/lib/newsletter.functions";
import type {
  NlDoc,
  NlWidget,
  NlLang,
  NlSection,
} from "@/lib/newsletter-builder/types";
import type { NewsletterSettings, NewsletterMailingList } from "@/hooks/useNewsletterSettings";

interface Props {
  doc: NlDoc;
  settings: NewsletterSettings;
  lang: NlLang;
  source?: string;
}

const pickI = (v: { pl: string; en: string }, lang: NlLang) => (lang === "pl" ? v.pl : v.en);

const REQUIRED_TXT: Record<NlLang, string> = { pl: "Pole wymagane", en: "Required field" };
const EMAIL_TXT: Record<NlLang, string> = { pl: "Niepoprawny adres e-mail.", en: "Invalid email address." };

// Zliczanie subskrybentow z publicznej perspektywy - do widgetu social-proof.
// RLS moze zablokowac; wtedy uzywamy fallback z widgetu.
function useSubscriberCount(enabled: boolean): number | null {
  const q = useQuery({
    queryKey: ["newsletter-subscribers-count-public"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<number> => {
      const { count } = await supabase
        .from("newsletter_subscribers")
        .select("id", { count: "exact", head: true })
        .eq("status", "subscribed");
      return count ?? 0;
    },
  });
  return q.data ?? null;
}

export function NewsletterDocRenderer({ doc, settings, lang, source = "form" }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const subscribe = useServerFn(subscribeToNewsletter);

  const flatWidgets = useMemo(() => doc.sections.flatMap((s) => s.widgets), [doc]);
  const hasSocialProof = flatWidgets.some((w) => w.type === "social-proof");
  const hasCountdown = flatWidgets.some((w) => w.type === "countdown");
  const liveCount = useSubscriberCount(hasSocialProof);

  useEffect(() => {
    if (!hasCountdown) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasCountdown]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState("loading");
    setErrMsg(null);
    setErrors({});
    const fd = new FormData(e.currentTarget);

    const errs: Record<string, string> = {};
    const email = String(fd.get("email") ?? "").trim().toLowerCase();
    if (!email) errs.email = REQUIRED_TXT[lang];
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = EMAIL_TXT[lang];

    const firstName = String(fd.get("firstName") ?? "").trim() || undefined;
    const lastName = String(fd.get("lastName") ?? "").trim() || undefined;
    const meta: Record<string, string> = {};
    const consents: { key: string; text: string; given: boolean; lang: NlLang }[] = [];
    const requiredFields: string[] = [];

    for (const w of flatWidgets) {
      if (w.type === "field.text") {
        const val = String(fd.get(w.name) ?? "").trim();
        if (w.required && !val) errs[w.name] = REQUIRED_TXT[lang];
        if (val && w.name !== "firstName" && w.name !== "lastName") meta[w.name] = val;
        if (w.required) requiredFields.push(w.name);
      } else if (w.type === "field.select") {
        const val = String(fd.get(w.name) ?? "").trim();
        if (w.required && !val) errs[w.name] = REQUIRED_TXT[lang];
        if (val) meta[w.name] = val;
      } else if (w.type === "field.checkbox") {
        const on = fd.get(w.key) === "on";
        if (w.required && !on) errs[w.key] = REQUIRED_TXT[lang];
        if (on) consents.push({ key: w.key, text: pickI(w.html, lang), given: true, lang });
      } else if (w.type === "field.mailing-lists") {
        const lists = fd.getAll(`ml_${w.id}`).map((v) => String(v)).filter(Boolean);
        if (w.required && lists.length === 0) errs[`ml_${w.id}`] = REQUIRED_TXT[lang];
        if (lists.length) meta.mailing_lists = lists.join(",");
      }
    }

    if (Object.keys(errs).length) {
      setErrors(errs);
      setState("err");
      return;
    }

    // Zawsze doloz zgode na newsletter zgodna z policy_html.
    const consentText =
      (lang === "pl" ? settings.policy_html_pl : settings.policy_html_en) ||
      (lang === "pl"
        ? "Wyrazam zgode na otrzymywanie newslettera."
        : "I agree to receive the newsletter.");
    consents.push({ key: "newsletter", text: consentText, given: true, lang });

    try {
      const res = await subscribe({
        data: {
          email,
          firstName,
          lastName,
          name: [firstName, lastName].filter(Boolean).join(" ") || undefined,
          language: lang,
          source,
          formName: pickI(
            { pl: settings.heading_pl, en: settings.heading_en },
            lang,
          ),
          consents,
          meta: Object.keys(meta).length ? meta : undefined,
          requiredFields: requiredFields.length ? requiredFields : undefined,
        },
      });
      if (!res.ok) {
        setErrMsg(res.error);
        setState("err");
        return;
      }
      setState("ok");
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err));
      setState("err");
    }
  };

  if (state === "ok") {
    const successWidget = flatWidgets.find((w) => w.type === "success-message");
    const successText = successWidget && successWidget.type === "success-message"
      ? pickI(successWidget.text, lang)
      : lang === "pl" ? settings.success_message_pl : settings.success_message_en;
    return (
      <div className="text-sm font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-md p-3 border border-emerald-500/20">
        {successText}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      {doc.sections.map((section) => (
        <SectionRenderer
          key={section.id}
          section={section}
          lang={lang}
          errors={errors}
          liveCount={liveCount}
          mailingLists={settings.popup_mailing_lists ?? []}
          tick={tick}
        />
      ))}
      {state === "err" && errMsg && (
        <p className="text-xs text-destructive">{errMsg}</p>
      )}
    </form>
  );
}

function SectionRenderer({
  section,
  lang,
  errors,
  liveCount,
  mailingLists,
  tick,
}: {
  section: NlSection;
  lang: NlLang;
  errors: Record<string, string>;
  liveCount: number | null;
  mailingLists: NewsletterMailingList[];
  tick: number;
}) {
  const st = section.style ?? {};
  const layout = section.layout ?? "single";
  const gap = st.gap ?? 12;

  const renderWidgets = (list: typeof section.widgets) =>
    list.map((w) => (
      <RuntimeWidget
        key={w.id}
        widget={w}
        lang={lang}
        error={errors[widgetErrorKey(w)]}
        liveCount={liveCount}
        mailingLists={mailingLists}
        tick={tick}
      />
    ));

  const containerStyle: React.CSSProperties = {
    backgroundColor: st.bg ?? undefined,
    color: st.fg ?? undefined,
    padding: `${st.paddingY ?? 0}px ${st.paddingX ?? 0}px`,
    borderRadius: st.radius ? `${st.radius}px` : undefined,
    textAlign: st.align ?? undefined,
  };

  if (layout === "single") {
    return (
      <div
        style={{
          ...containerStyle,
          display: "flex",
          flexDirection: "column",
          gap: `${gap}px`,
        }}
      >
        {renderWidgets(section.widgets)}
      </div>
    );
  }

  const col0 = section.widgets.filter((w) => (w.col ?? 0) === 0);
  const col1 = section.widgets.filter((w) => w.col === 1);
  const gridCols =
    layout === "1-2"
      ? "1fr 2fr"
      : layout === "2-1"
        ? "2fr 1fr"
        : "1fr 1fr";
  return (
    <div
      style={{
        ...containerStyle,
        display: "grid",
        gridTemplateColumns: gridCols,
        gap: `${gap}px`,
      }}
     
    >
      <div style={{ display: "flex", flexDirection: "column", gap: `${gap}px`, minWidth: 0 }}>
        {renderWidgets(col0)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: `${gap}px`, minWidth: 0 }}>
        {renderWidgets(col1)}
      </div>
    </div>
  );
}

function widgetErrorKey(w: NlWidget): string {
  switch (w.type) {
    case "field.email": return "email";
    case "field.text":
    case "field.select": return w.name;
    case "field.checkbox": return w.key;
    case "field.mailing-lists": return `ml_${w.id}`;
    default: return w.id;
  }
}

const INPUT_CLS = "w-full px-3 py-2 rounded border border-input bg-background text-sm";

function RuntimeWidget({
  widget: w,
  lang,
  error,
  liveCount,
  mailingLists,
  tick,
}: {
  widget: NlWidget;
  lang: NlLang;
  error?: string;
  liveCount: number | null;
  mailingLists: NewsletterMailingList[];
  tick: number;
}) {
  void tick; // rerender countdown
  switch (w.type) {
    case "heading": {
      const H = (`h${w.level}` as unknown) as keyof React.JSX.IntrinsicElements;
      return (
        <H
          className={
            "font-display leading-tight " +
            (w.level === 1 ? "text-3xl" : w.level === 2 ? "text-2xl" : w.level === 3 ? "text-xl" : "text-lg")
          }
          style={{ textAlign: w.align ?? "left", color: w.color ?? undefined }}
        >
          {pickI(w.text, lang)}
        </H>
      );
    }
    case "paragraph":
      return (
        <p
          className={"leading-relaxed [&_a]:underline " + (w.size === "sm" ? "text-xs" : w.size === "lg" ? "text-base" : "text-sm")}
          style={{ color: w.color ?? undefined }}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(pickI(w.html, lang)) }}
        />
      );
    case "image":
      return w.url ? (
        <img
          src={w.url}
          alt={w.alt ?? ""}
          loading="lazy"
          className={"w-full object-cover " + (w.rounded ? "rounded-lg" : "")}
          style={{ aspectRatio: w.aspect === "auto" ? undefined : w.aspect?.replace("/", " / ") }}
        />
      ) : null;
    case "divider":
      return <hr style={{ borderTopWidth: `${w.thickness ?? 1}px`, borderColor: w.color ?? "currentColor", opacity: 0.4 }} />;
    case "spacer":
      return <div aria-hidden="true" style={{ height: `${w.size}px` }} />;
    case "field.email":
      return (
        <FieldWrap label={pickI(w.label, lang)} required error={error}>
          <input name="email" type="email" required placeholder={pickI(w.placeholder, lang)} className={INPUT_CLS} maxLength={254} />
        </FieldWrap>
      );
    case "field.text":
      return (
        <FieldWrap label={pickI(w.label, lang)} required={w.required} error={error}>
          <input name={w.name} type="text" required={w.required} placeholder={pickI(w.placeholder, lang)} className={INPUT_CLS} maxLength={200} />
        </FieldWrap>
      );
    case "field.select":
      return (
        <FieldWrap label={pickI(w.label, lang)} required={w.required} error={error}>
          <select name={w.name} required={w.required} className={INPUT_CLS} defaultValue="">
            <option value="" disabled>{pickI(w.placeholder, lang)}</option>
            {w.options.map((o) => (
              <option key={o.value} value={o.value}>{lang === "pl" ? o.labelPl : o.labelEn}</option>
            ))}
          </select>
        </FieldWrap>
      );
    case "field.checkbox":
      return (
        <div>
          <label className="flex items-start gap-2 text-xs opacity-95">
            <input name={w.key} type="checkbox" required={w.required} className="mt-0.5" />
            <span
              className="[&_a]:underline"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(pickI(w.html, lang)) }}
            />
          </label>
          {error && <span className="block text-[11px] text-destructive mt-1">{error}</span>}
        </div>
      );
    case "field.mailing-lists": {
      const restricted = w.listIds?.length ? mailingLists.filter((l) => w.listIds!.includes(l.id)) : mailingLists;
      if (restricted.length === 0) return null;
      const name = `ml_${w.id}`;
      if (w.display === "select") {
        return (
          <FieldWrap label={pickI(w.label, lang)} required={w.required} error={error}>
            <select name={name} required={w.required} className={INPUT_CLS} defaultValue="">
              <option value="" disabled>{lang === "pl" ? "Wybierz..." : "Choose..."}</option>
              {restricted.map((l) => (
                <option key={l.id} value={l.id}>{lang === "pl" ? l.label_pl : l.label_en}</option>
              ))}
            </select>
          </FieldWrap>
        );
      }
      return (
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold">
            {pickI(w.label, lang)}
            {w.required ? <span className="text-destructive ml-0.5">*</span> : null}
          </legend>
          {restricted.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-xs">
              <input name={name} type="checkbox" value={l.id} />
              {lang === "pl" ? l.label_pl : l.label_en}
            </label>
          ))}
          {error && <span className="block text-[11px] text-destructive">{error}</span>}
        </fieldset>
      );
    }
    case "submit":
      return (
        <button
          type="submit"
          className={"px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-90 " + (w.fullWidth ? "w-full" : "")}
          style={{ backgroundColor: w.bg ?? "var(--primary)", color: w.fg ?? "var(--primary-foreground)" }}
        >
          {pickI(w.label, lang)}
        </button>
      );
    case "success-message":
      return null; // rendered po sukcesie
    case "social-proof": {
      const count = liveCount ?? w.fallbackCount ?? 0;
      const text = pickI(w.text, lang).replace("{count}", count.toLocaleString(lang === "pl" ? "pl-PL" : "en-US"));
      return <div className="text-xs font-medium text-muted-foreground" style={{ textAlign: w.align ?? "center" }}>{text}</div>;
    }
    case "countdown": {
      const diff = Math.max(0, new Date(w.deadline).getTime() - Date.now());
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const cell = (n: number, l: string) => (
        <div className="text-center px-2 py-2 rounded" style={{ backgroundColor: w.accent ?? "var(--muted)" }}>
          <div className="text-xl font-bold leading-none tabular-nums">{String(n).padStart(2, "0")}</div>
          <div className="text-[10px] uppercase tracking-wider opacity-80 mt-1">{l}</div>
        </div>
      );
      return (
        <div className="grid grid-cols-4 gap-2">
          {cell(d, pickI(w.labelDays, lang))}
          {cell(h, pickI(w.labelHours, lang))}
          {cell(m, pickI(w.labelMinutes, lang))}
          {cell(s, pickI(w.labelSeconds, lang))}
        </div>
      );
    }
    default:
      return null;
  }
}

function FieldWrap({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold">
        {label}
        {required ? <span className="text-destructive ml-0.5">*</span> : null}
      </span>
      {children}
      {error && <span className="block text-[11px] text-destructive">{error}</span>}
    </label>
  );
}
