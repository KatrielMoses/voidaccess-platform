import { appendFileSync } from "node:fs";
import { EMAIL_CONTENT } from "./content";

export { EMAIL_CONTENT };

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** template id, used by tests and the e2e log transport */
  template: string;
  /** extra headers (List-Unsubscribe, List-Unsubscribe-Post on lifecycle email) */
  headers?: Record<string, string>;
}

export interface EmailTransport {
  send(msg: EmailMessage): Promise<void>;
}

/** Dev/test transport: prints to the console, keeps an in-memory outbox, optionally appends JSONL to EMAIL_LOG_FILE. */
export class LogTransport implements EmailTransport {
  readonly outbox: Array<EmailMessage & { at: string }> = [];
  constructor(private readonly file: string | undefined = process.env.EMAIL_LOG_FILE) {}
  async send(msg: EmailMessage) {
    const entry = { ...msg, at: new Date().toISOString() };
    this.outbox.push(entry);
    if (this.file) appendFileSync(this.file, JSON.stringify(entry) + "\n");
    if (process.env.NODE_ENV !== "test")
      console.log(`[email:log] to=${msg.to} template=${msg.template}\n${msg.text}\n`);
  }
}

/** Production transport over the Resend HTTP API (no SDK dependency). */
export class ResendTransport implements EmailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  async send(msg: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        ...(msg.headers ? { headers: msg.headers } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
  }
}

let transport: EmailTransport | undefined;
let log: LogTransport | undefined;

/** Resend when RESEND_API_KEY is set (production), otherwise the log transport. */
export function getTransport(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  if (transport) return transport;
  if (env.RESEND_API_KEY)
    transport = new ResendTransport(
      env.RESEND_API_KEY,
      env.EMAIL_FROM ?? "VoidAccess <no-reply@voidaccess.pro>",
    );
  else transport = log = new LogTransport();
  return transport;
}
export function setTransport(t: EmailTransport | undefined) {
  transport = t;
}
export function getLogTransport(): LogTransport | undefined {
  return log;
}

const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
const compose = (t: { subject: string; body: string }, vars: Record<string, string>) => ({
  subject: fill(t.subject, vars),
  text: `${fill(t.body, vars)}\n\n${EMAIL_CONTENT.signature}\n`,
});
/** Lifecycle email: founder sign-off plus the unsubscribe footer carrying the signed link. */
const composeLifecycle = (
  t: { subject: string; body: string },
  vars: Record<string, string>,
  unsubscribeUrl: string,
) => ({
  subject: fill(t.subject, vars),
  text: `${fill(t.body, vars)}\n\n${EMAIL_CONTENT.founderSignature}\n\n--\n${fill(EMAIL_CONTENT.unsubscribeFooter, { unsubscribeUrl })}\n`,
});

export const templates = {
  verifyEmail: (p: { name: string; url: string }) => compose(EMAIL_CONTENT.verifyEmail, p),
  magicLink: (p: { url: string; minutes?: number }) =>
    compose(EMAIL_CONTENT.magicLink, { url: p.url, minutes: String(p.minutes ?? 5) }),
  passwordReset: (p: { name: string; url: string }) => compose(EMAIL_CONTENT.passwordReset, p),
  changeEmail: (p: { name: string; url: string }) => compose(EMAIL_CONTENT.changeEmail, p),
  resultsReady: (p: { name: string; query: string; resultsUrl: string }) =>
    compose(EMAIL_CONTENT.resultsReady, p),
  // ---- billing (P5) ----
  welcomePro: (p: { name: string; plan: string; credits: string; url: string; billingUrl: string }) =>
    compose(EMAIL_CONTENT.welcomePro, p),
  creditAlert80: (p: {
    name: string;
    pct: string;
    balance: string;
    billingUrl: string;
    expiryMonths: string;
  }) => compose(EMAIL_CONTENT.creditAlert80, p),
  creditAlert100: (p: { name: string; resetDate: string; billingUrl: string; expiryMonths: string }) =>
    compose(EMAIL_CONTENT.creditAlert100, p),
  foundingReleaseWarning: (p: {
    name: string;
    date: string;
    reason: string;
    nextPlan: string;
    howToKeep: string;
    foundingPrice: string;
    termMonths: string;
    renewalMonths: string;
    inactivityMonths: string;
    billingUrl: string;
  }) => compose(EMAIL_CONTENT.foundingReleaseWarning, p),
  foundingReleased: (p: { name: string; reason: string; whatHappensNext: string; billingUrl: string }) =>
    compose(EMAIL_CONTENT.foundingReleased, p),
  cancellationSurvey: (p: { name: string; date: string }) => compose(EMAIL_CONTENT.cancellationSurvey, p),
  paymentFailed: (p: { name: string; portalUrl: string }) => compose(EMAIL_CONTENT.paymentFailed, p),
  // ---- lifecycle (P6): consent-gated, every one carries the unsubscribe footer ----
  welcome: (p: { name: string; url: string; freeCredits: string; unsubscribeUrl: string }) =>
    composeLifecycle(
      EMAIL_CONTENT.welcome,
      {
        name: p.name,
        url: p.url,
        freeCredits: p.freeCredits,
        examples: EMAIL_CONTENT.welcome.exampleQueries.map((q) => `  - ${q}`).join("\n"),
      },
      p.unsubscribeUrl,
    ),
  firstInvestigationNudge: (p: { name: string; url: string; example: string; unsubscribeUrl: string }) =>
    composeLifecycle(EMAIL_CONTENT.firstInvestigationNudge, p, p.unsubscribeUrl),
  whatNext: (p: { name: string; url: string; billingUrl: string; unsubscribeUrl: string }) =>
    composeLifecycle(EMAIL_CONTENT.whatNext, p, p.unsubscribeUrl),
};

export type TemplateName = keyof typeof templates;

/**
 * Consent class of every template. `transactional` is always sent (the account holder needs it to use or secure
 * the account); `lifecycle` is product/marketing email: it needs the user's preference and an unsubscribe link.
 * A new template must be classified here (the TS record is exhaustive).
 */
export const TEMPLATE_CATEGORY: Record<TemplateName, "transactional" | "lifecycle"> = {
  verifyEmail: "transactional",
  magicLink: "transactional",
  passwordReset: "transactional",
  changeEmail: "transactional",
  resultsReady: "transactional",
  welcomePro: "transactional",
  creditAlert80: "transactional",
  creditAlert100: "transactional",
  foundingReleaseWarning: "transactional",
  foundingReleased: "transactional",
  cancellationSurvey: "transactional",
  paymentFailed: "transactional",
  welcome: "lifecycle",
  firstInvestigationNudge: "lifecycle",
  whatNext: "lifecycle",
};

/** RFC 8058 one-click unsubscribe headers for a lifecycle message. `oneClickUrl` accepts a POST without sign-in. */
export const unsubscribeHeaders = (oneClickUrl: string) => ({
  "List-Unsubscribe": `<${oneClickUrl}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});

/** Render a template and send it with the configured transport. */
export async function sendEmail<T extends TemplateName>(
  template: T,
  to: string,
  params: Parameters<(typeof templates)[T]>[0],
  opts: { oneClickUrl?: string } = {},
): Promise<void> {
  const { subject, text } = (templates[template] as (p: typeof params) => { subject: string; text: string })(
    params,
  );
  // Lifecycle email must be unsubscribable in one click; refuse to send it without the header.
  if (TEMPLATE_CATEGORY[template] === "lifecycle" && !opts.oneClickUrl)
    throw new Error(`${template} is a lifecycle email: pass opts.oneClickUrl (List-Unsubscribe)`);
  await getTransport().send({
    to,
    subject,
    text,
    template,
    ...(opts.oneClickUrl ? { headers: unsubscribeHeaders(opts.oneClickUrl) } : {}),
  });
}
