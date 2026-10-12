export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly kind: "resend" | "log" | "disabled";
  send(mail: Mail): Promise<void>;
}

class LogMailer implements Mailer {
  readonly kind = "log" as const;
  async send(mail: Mail) {
    const line = JSON.stringify({ at: new Date().toISOString(), ...mail });
    console.log(`[email:log] to=${mail.to} subject=${JSON.stringify(mail.subject)}`);
    const file = process.env.MAIL_LOG_FILE;
    if (file) {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(file, `${line}\n`);
    }
  }
}

class DisabledMailer implements Mailer {
  readonly kind = "disabled" as const;
  async send(mail: Mail) {
    console.warn(`[email:disabled] not sending to ${mail.to.replace(/^(.).*(@.*)$/, (_m, a: string, b: string) => `${a}***${b}`)}: no transport configured`);
  }
}

class ResendMailer implements Mailer {
  readonly kind = "resend" as const;
  constructor(
    private apiKey: string,
    private from: string,
  ) {}
  async send(mail: Mail) {
    const { Resend } = await import("resend");
    const { error } = await new Resend(this.apiKey).emails.send({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
    if (error) throw new Error(`resend: ${error.message}`);
  }
}

/** resend when a key and sender are configured; the log transport in dev/test; otherwise disabled (never throws). */
export function getMailer(): Mailer {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (process.env.EMAIL_TRANSPORT === "log") return new LogMailer();
  if (key && from) return new ResendMailer(key, from);
  if (process.env.NODE_ENV !== "production") return new LogMailer();
  return new DisabledMailer();
}
