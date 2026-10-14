// Copy lives here so the growth architect can rewrite it without touching code.
// Placeholders: {{name}}, {{url}}, {{code}}, {{query}}, {{resultsUrl}}, {{minutes}}, plus billing ones ({{plan}}, {{credits}}, {{pct}}, {{date}} ...).
// No prices or credit numbers are typed here: billing code passes them in from @voidaccess/config. Plain text only.
export const EMAIL_CONTENT = {
  productName: "VoidAccess",
  signature: "— The VoidAccess team",
  // Lifecycle emails are written in Katriel's voice, so they sign off as him.
  founderSignature: "— Katriel\nFounder, VoidAccess",
  // Appended to every lifecycle/marketing email (never to transactional ones). {{unsubscribeUrl}} is the signed link.
  unsubscribeFooter: `You're getting this because you have a VoidAccess account. Stop product tips and tutorials any time (receipts, security and usage emails still arrive): {{unsubscribeUrl}}`,
  signInCode: {
    subject: "Your VoidAccess sign-in code: {{code}}",
    body: `Your sign-in code is:

{{code}}

Enter it on the sign-in page. It expires in {{minutes}} minutes and works once. If this is your first sign-in, entering it creates your account.

If you didn't ask for it, ignore this message; nobody can sign in without the code.`,
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
  // ---- lifecycle (P6, PRD §5). Plain text, founder-voiced, sent once per user, only with product-email consent. ----
  // No prices or credit numbers are typed here: the sender passes them in from @voidaccess/config.
  welcome: {
    subject: "Welcome to VoidAccess",
    // {{examples}} is the bullet list below; {{freeCredits}} comes from config.
    exampleQueries: [
      "LockBit ransomware group",
      "acme-corp.com credential leaks",
      "BlackCat ALPHV affiliates and infrastructure",
    ],
    body: `Hi {{name}},

I'm Katriel, the person building VoidAccess. Thanks for signing up.

VoidAccess searches dark web sources for you, pulls out the entities it finds (actors, domains, wallets, emails), maps how they connect and writes up what it found. You describe what you're looking into in plain words and it does the legwork. Every finding links back to where it was seen, and we label what is a lead and what is confirmed.

Your account comes with {{freeCredits}} free credits each month. A few queries people start with:

{{examples}}

Start your first investigation: {{url}}

If something is confusing or broken, reply to this email. It comes straight to me.`,
  },
  firstInvestigationNudge: {
    subject: "Your first investigation takes 2 minutes",
    body: `Hi {{name}},

You signed up yesterday but haven't run an investigation yet, so here is the shortest path.

Open the new-investigation page, type what you want to look into, and leave the depth on Standard. Something like:

  {{example}}

It runs in the background; you can close the tab and we'll email you when the results are ready.

Start here: {{url}}

If you're not sure what to search, reply with what you're working on and I'll suggest a query.`,
  },
  whatNext: {
    subject: "Here's what you can do with your first results",
    body: `Hi {{name}},

You've finished your first investigation. A few things worth knowing:

- The graph shows how the entities connect. Open the Graph tab, click a node, and follow the edges to the sources behind them.
- Exports: CSV and JSON are free on every plan. Pro adds STIX, MISP, Sigma, YARA and the other formats.
- Archive context: findings are also filed anonymously in a shared archive (no queries, no accounts). Your results show when something was seen before from other sources. Treat those as leads, not facts.
- Credits: your monthly credits reset each month and don't roll over. If you need more, you can top up or move to Pro from the billing page: {{billingUrl}}

Run another investigation: {{url}}

Hit reply if there's something you wish it did. I read everything.`,
  },
} as const;
