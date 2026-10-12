// Copy lives here so the growth architect can rewrite it without touching code.
// Placeholders: {{name}}, {{url}}, {{query}}, {{resultsUrl}}, {{minutes}}, plus billing ones ({{plan}}, {{credits}}, {{pct}}, {{date}} ...).
// No prices or credit numbers are typed here: billing code passes them in from @voidaccess/config. Plain text only.
export const EMAIL_CONTENT = {
  productName: "VoidAccess",
  signature: "— The VoidAccess team",
  verifyEmail: {
    subject: "Confirm your email for VoidAccess",
    body: `Hi {{name}},

Confirm your email address to start investigating:

{{url}}

If you didn't create an account, ignore this message and nothing will happen.`,
  },
  magicLink: {
    subject: "Your VoidAccess sign-in link",
    body: `Use this link to sign in. It expires in {{minutes}} minutes and works once:

{{url}}

If you didn't ask for it, ignore this message.`,
  },
  passwordReset: {
    subject: "Reset your VoidAccess password",
    body: `Hi {{name}},

Use this link to choose a new password. It expires soon and works once:

{{url}}

If you didn't ask for a reset, ignore this message; your password stays the same.`,
  },
  changeEmail: {
    subject: "Confirm your new VoidAccess email",
    body: `Hi {{name}},

Confirm this address as your new VoidAccess email:

{{url}}`,
  },
  resultsReady: {
    subject: "Your investigation is ready",
    body: `Hi {{name}},

Your investigation "{{query}}" has finished.

View the results: {{resultsUrl}}`,
  },
  // ---- billing (P5). Receipts and invoices come from Dodo; these are the founder-voiced extras. ----
  welcomePro: {
    subject: "Welcome to VoidAccess {{plan}}",
    body: `Hi {{name}},

You're on {{plan}}. {{credits}} credits are in your account now and renew every month.

Start an investigation: {{url}}

Receipts and invoices come from our payment provider, Dodo Payments. You can manage your card and cancel any time from the billing page: {{billingUrl}}

If anything looks wrong, reply to this email and I'll sort it out.`,
  },
  creditAlert80: {
    subject: "You've used {{pct}}% of this month's credits",
    body: `Hi {{name}},

You've used about {{pct}}% of your monthly credits ({{balance}} left).

Top up any time, or move to a bigger plan, from the billing page: {{billingUrl}}

Credits reset every month and don't roll over; top-up credits last {{expiryMonths}} months.`,
  },
  creditAlert100: {
    subject: "You're out of monthly credits",
    body: `Hi {{name}},

Your monthly credits are used up. New investigations will wait until your credits reset on {{resetDate}}, unless you top up.

Top up or upgrade: {{billingUrl}}

Top-up credits are used after monthly credits and last {{expiryMonths}} months.`,
  },
  foundingReleaseWarning: {
    subject: "Your founding seat may be released on {{date}}",
    body: `Hi {{name}},

A heads-up about your founding seat: {{reason}}

If nothing changes, your seat is released on {{date}} and your plan moves to {{nextPlan}}. {{howToKeep}}

The rules, in short: founding price {{foundingPrice}}/mo for {{termMonths}} months, renewed each year if you paid for at least {{renewalMonths}} of the last {{termMonths}} months and used the product in the last {{inactivityMonths}} months.

Billing page: {{billingUrl}}`,
  },
  foundingReleased: {
    subject: "Your founding seat was released",
    body: `Hi {{name}},

Your founding seat was released today. {{reason}}

{{whatHappensNext}}

The seat goes back to the pool for the next new subscriber. Thank you for being early.

Billing page: {{billingUrl}}`,
  },
  cancellationSurvey: {
    subject: "What made you leave?",
    body: `Hi {{name}},

Your subscription is set to end on {{date}}; you keep everything until then.

One question, and a one-line reply is plenty: what made you leave? I read every answer.`,
  },
  paymentFailed: {
    subject: "We couldn't take your VoidAccess payment",
    body: `Hi {{name}},

Your latest payment didn't go through. Your plan stays active for now, but if it keeps failing the subscription will end.

Update your payment method here: {{portalUrl}}

If you've already fixed it, ignore this message.`,
  },
} as const;
