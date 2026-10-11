// Copy lives here so the growth architect can rewrite it without touching code.
// Placeholders: {{name}}, {{url}}, {{query}}, {{resultsUrl}}, {{minutes}}. Plain text only.
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
} as const;
