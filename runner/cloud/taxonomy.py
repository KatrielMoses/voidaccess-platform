"""Entity taxonomy: the same mapping as packages/engine-client/src/entities.ts (a test keeps them in step).

The engine emits UPPER_SNAKE types. Those that are not in the bundle taxonomy are mapped through
`ALIASES` or left out of the bundle (counted in `metrics.dropped_entities`).
"""

from __future__ import annotations

TYPE_CATEGORY: dict[str, str] = {
    **dict.fromkeys(
        ["RANSOMWARE_GROUP", "THREAT_ACTOR", "THREAT_ACTOR_HANDLE", "MITRE_TECHNIQUE", "MITRE_TACTIC"], "threat"
    ),
    **dict.fromkeys(
        [
            "MALWARE_FAMILY",
            "FILE_HASH_MD5",
            "FILE_HASH_SHA1",
            "FILE_HASH_SHA256",
            "YARA_RULE",
            "NUCLEI_TEMPLATE",
        ],
        "malware",
    ),
    **dict.fromkeys(["CVE_NUMBER", "CVE", "EXPLOIT_DB_ID"], "vulnerability"),
    **dict.fromkeys(
        [
            "IP_ADDRESS",
            "IPV6_ADDRESS",
            "MAC_ADDRESS",
            "DOMAIN",
            "ENS_DOMAIN",
            "URL",
            "ONION_URL",
            "PASTE_URL",
            "IPFS_CID",
        ],
        "network",
    ),
    **dict.fromkeys(
        [
            "BITCOIN_ADDRESS",
            "BITCOIN_CASH_ADDRESS",
            "ETHEREUM_ADDRESS",
            "ETH_ADDRESS",
            "MONERO_ADDRESS",
            "LITECOIN_ADDRESS",
            "ZCASH_ADDRESS",
            "DOGECOIN_ADDRESS",
            "XRP_ADDRESS",
            "SOLANA_ADDRESS",
            "TRON_ADDRESS",
            "DASH_ADDRESS",
            "CRYPTO_SEED_PHRASE",
        ],
        "crypto",
    ),
    **dict.fromkeys(
        [
            "API_KEY",
            "AWS_ACCESS_KEY",
            "AWS_SECRET_KEY",
            "GITHUB_TOKEN",
            "SLACK_TOKEN",
            "DISCORD_TOKEN",
            "JWT_TOKEN",
            "GOOGLE_API_KEY",
            "STRIPE_KEY",
            "STEALER_LOG_ENTRY",
            "COMBO_LIST_ENTRY",
        ],
        "credential",
    ),
    **dict.fromkeys(
        [
            "TELEGRAM_HANDLE",
            "DISCORD_HANDLE",
            "XMPP_JID",
            "TOX_ID",
            "SESSION_ID",
            "MATRIX_HANDLE",
            "WIRE_HANDLE",
            "ICQ_NUMBER",
            "WICKR_ID",
        ],
        "messaging",
    ),
    **dict.fromkeys(["EMAIL_ADDRESS", "PHONE_NUMBER", "PERSON_NAME", "PGP_KEY_BLOCK"], "identity"),
    "ORGANIZATION_NAME": "org",
    "LOCATION": "other",
    "DATE": "other",
}

# Engine names that differ from the bundle taxonomy.
ALIASES: dict[str, str] = {
    "PHONE": "PHONE_NUMBER",
    "EMAIL": "EMAIL_ADDRESS",
    "MALWARE": "MALWARE_FAMILY",
    "PGP_KEY": "PGP_KEY_BLOCK",
    "THREAT_ACTOR_NAME": "THREAT_ACTOR",
    "ORGANIZATION": "ORGANIZATION_NAME",
    "ORG": "ORGANIZATION_NAME",
    "PERSON": "PERSON_NAME",
    "GPE": "LOCATION",
    "LOC": "LOCATION",
}

ACTOR_TYPES = frozenset({"THREAT_ACTOR", "THREAT_ACTOR_HANDLE", "RANSOMWARE_GROUP"})


def normalize_type(engine_type: str | None) -> str | None:
    """The bundle EntityType for an engine entity type, or None when it has no place in the taxonomy."""
    t = (engine_type or "").strip().upper()
    t = ALIASES.get(t, t)
    return t if t in TYPE_CATEGORY else None


def is_secret_type(t: str) -> bool:
    """Raw value is a secret: never leaves the engine, shown as `len:N` (contract G4)."""
    return TYPE_CATEGORY[t] == "credential" or t == "CRYPTO_SEED_PHRASE"


def is_sensitive_type(t: str) -> bool:
    """Flagged `sensitive` in a bundle: secrets, emails, phones, personal names (contract G4)."""
    return is_secret_type(t) or t in {"EMAIL_ADDRESS", "PHONE_NUMBER", "PERSON_NAME"}
