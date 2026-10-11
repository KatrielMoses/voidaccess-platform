import { index, integer, pgTable, text, uuid, customType } from "drizzle-orm/pg-core";
import { createdAt, pk } from "./_common";
import { users } from "./auth";
import { investigations } from "./investigations";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * The ONLY table holding raw sensitive values, as envelope-encrypted ciphertext
 * (per-value AES-256-GCM DEK, DEK wrapped by Cloud KMS; local KEK in dev/test).
 * System-only: the app role has no grants. Decrypt only through decryptCredential(), which audits.
 * Every other table stores only masked_value + fingerprint.
 */
export const credentialVault = pgTable(
  "credential_vault",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    investigationId: uuid("investigation_id").references(() => investigations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // entity type or "byo_key:<provider>"
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    wrappedDek: bytea("wrapped_dek").notNull(),
    keyRef: text("key_ref").notNull(), // KMS key version name, or "local:v1"
    maskedValue: text("masked_value").notNull(),
    fingerprint: text("fingerprint").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index("credential_vault_user_idx").on(t.userId), index("credential_vault_fingerprint_idx").on(t.fingerprint)],
);
