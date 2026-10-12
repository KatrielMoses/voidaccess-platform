from cloud.masking import (
    mask_credential,
    mask_email,
    mask_entity_value,
    mask_partial,
    mask_phone,
    secret_value_token,
)


def test_masking_matches_engine_client_vectors(vectors):
    assert vectors["masking"], "vectors file is empty"
    for v in vectors["masking"]:
        assert mask_entity_value(v["type"], v["value"]) == v["mask_entity_value"], v
        assert secret_value_token(v["value"]) == v["secret_value_token"], v
        assert mask_credential(v["value"]) == v["mask_credential"], v
        assert mask_email(v["value"]) == v["mask_email"], v
        assert mask_partial(v["value"]) == v["mask_partial"], v
        assert mask_phone(v["value"]) == v["mask_phone"], v


def test_secret_token_has_no_part_of_the_value():
    token = secret_value_token("hunter2-hunter2")
    assert token.startswith("len:15 sha256:") and "hunter" not in token
