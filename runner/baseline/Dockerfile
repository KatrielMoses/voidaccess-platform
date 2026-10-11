# E0 engine-baseline image: pinned voidaccess engine + harness (Tor client inside).
# Build context prepared by scripts/prepare_build_context.sh (engine git archive only).

ARG ENGINE_GIT_SHA=unknown
FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY engine/pyproject.toml engine/README.md /build/engine/
COPY engine/ /build/engine/

WORKDIR /build/engine
# spaCy NER is a core dependency (en_core_web_sm). The nlp extra pulls
# sentence-transformers/torch and is not required by the CLI investigate path.
RUN pip install --no-cache-dir . \
    && python -m spacy download en_core_web_sm

FROM python:3.11-slim

ARG ENGINE_GIT_SHA=unknown
ENV ENGINE_GIT_SHA=${ENGINE_GIT_SHA}
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tor curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/tor-baseline && chown debian-tor:debian-tor /var/lib/tor-baseline || true

COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

COPY runner/baseline/requirements.txt /app/runner/baseline/requirements.txt
RUN pip install --no-cache-dir -r /app/runner/baseline/requirements.txt

COPY runner/baseline /app/runner/baseline

# Warm the Tor consensus/descriptor cache (client-only torrc) so runtime
# bootstrap starts from cached directory state.
RUN printf 'SocksPort 127.0.0.1:9050\nDataDirectory /var/lib/tor-baseline\nLog notice stdout\n' > /tmp/torrc \
    && (timeout 150 tor -f /tmp/torrc | grep -m1 'Bootstrapped 100%' || echo 'tor warm-up did not finish') \
    && pkill tor || true

ENTRYPOINT ["python", "-m", "baseline.run_one"]
