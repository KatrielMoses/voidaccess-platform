import { signCallback } from "./hmac";
import { maskCredential, maskEmail, maskEntityValue, maskPartial, maskPhone, secretValueToken } from "./mask";
import type { EntityType } from "./entities";

/** Deterministic inputs for the Python runner's cross-check tests (see scripts/gen-runner-vectors.ts). */
export function buildVectors() {
  const secret = "run-secret-0123456789abcdef";
  const bodies = [
    JSON.stringify({ run_id: "r1", seq: 1, type: "stage", stage: "refine", status: "start", stage_total: 8 }),
    JSON.stringify({ run_id: "r1", seq: 2, type: "counts", message: "café ☃ 😀", stage_total: 8 }),
    "",
  ];
  const signing = bodies.map((body, i) => {
    const timestamp = 1_800_000_000 + i;
    return {
      secret,
      run_id: "r1",
      seq: i + 1,
      timestamp,
      body,
      headers: signCallback({ secret, runId: "r1", seq: i + 1, rawBody: body, timestamp }),
    };
  });

  const maskValues: Array<[EntityType, string]> = [
    ["API_KEY", "sk-live-AbCdEf0123456789"],
    ["AWS_ACCESS_KEY", "AKIAIOSFODNN7EXAMPLE"],
    ["GITHUB_TOKEN", "ghp_" + "a".repeat(36)],
    [
      "CRYPTO_SEED_PHRASE",
      "abandon ability able about above absent absorb abstract absurd abuse access accident",
    ],
    ["API_KEY", "pässwörd😀"],
    ["EMAIL_ADDRESS", "john.doe@acme.com"],
    ["EMAIL_ADDRESS", "a@b.co"],
    ["EMAIL_ADDRESS", "no-at-sign"],
    ["XMPP_JID", "boss@jabber.example"],
    ["PHONE_NUMBER", "+1 (415) 555-0132"],
    ["PHONE_NUMBER", "12345"],
    ["PERSON_NAME", "Jane Q. Public"],
    ["PERSON_NAME", "Zoe"],
    ["CVE_NUMBER", "CVE-2024-3400"],
    ["IP_ADDRESS", "203.0.113.7"],
    ["ONION_URL", "http://exampleonionaddress.onion/"],
  ];
  const masking = maskValues.map(([type, value]) => ({
    type,
    value,
    mask_entity_value: maskEntityValue(type, value),
    secret_value_token: secretValueToken(value),
    mask_credential: maskCredential(value),
    mask_email: maskEmail(value),
    mask_partial: maskPartial(value),
    mask_phone: maskPhone(value),
  }));
  return { signing, masking };
}
