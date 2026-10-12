import hashlib
import hmac

from cloud.signing import compute_signature, sign_callback


def test_signatures_match_engine_client_vectors(vectors):
    assert vectors["signing"], "vectors file is empty"
    for v in vectors["signing"]:
        headers = sign_callback(v["secret"], v["run_id"], v["seq"], v["body"].encode("utf-8"), v["timestamp"])
        assert headers == v["headers"]


def test_signature_covers_timestamp_dot_raw_body():
    body = b'{"a":1}'
    expected = "sha256=" + hmac.new(b"k" * 16, b"1700000000." + body, hashlib.sha256).hexdigest()
    assert compute_signature("k" * 16, 1700000000, body) == expected
    assert compute_signature("k" * 16, 1700000001, body) != expected
    assert compute_signature("k" * 16, 1700000000, body + b" ") != expected
