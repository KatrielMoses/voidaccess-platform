/** Words on the sign-in page. There is no separate sign-up: the first sign-in creates the account. */
export const auth = {
  signIn: {
    title: "Create your free account",
    /** {{tokens}} are filled from @voidaccess/config on the server (lib/facts.ts). */
    description: "{{free.credits}} credits every month. No card. Already have an account? Same buttons; we'll sign you in.",
    /** Under the form; {stars} is the live GitHub star count (lib/stats.ts). */
    github: "Open source on GitHub ({stars}★)",
    emailLabel: "Email",
    sendCode: "Email me a sign-in code",
    codeTitle: "Check your email",
    codeSent: "We sent a 6-digit code to {email}. It expires in 10 minutes.",
    codeLabel: "Sign-in code",
    verify: "Sign in",
    resend: "Send a new code",
    resendIn: "Send a new code in {seconds}s",
    resent: "A new code is on its way.",
    differentEmail: "Use a different email",
    sendFailed: "Could not send the code. Try again in a moment.",
    codeFailed: "That code didn't work. Check it, or send a new one.",
    oauthFailed: "That sign-in did not complete. Try again, or use an email code.",
    captcha: "We couldn't check your browser just now. Complete the check if one appears, or try again.",
    terms: "By continuing you agree to our {terms} and {aup}.",
    termsLink: "Terms",
    aupLink: "Acceptable Use Policy",
  },
  providers: {
    google: "Continue with Google",
    microsoft: "Continue with Microsoft",
    github: "Continue with GitHub",
  },
  or: "or",
} as const;
