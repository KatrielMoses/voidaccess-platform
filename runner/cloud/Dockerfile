# Production runner image: the pinned public engine commit + the runner (runner/cloud) + a Tor client.
# One container runs one investigation. Build context prepared by scripts/prepare_build_context.sh.
# Sized for 1 vCPU / 2 GiB (E1B measured peak RSS 625 MB standard with the allowlist; deep at 1 GiB was never
# measured, so the job keeps 2 GiB).

FROM python:3.11-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY engine/ /build/engine/

WORKDIR /build/engine
# spaCy NER is a core dependency (en_core_web_sm). The nlp extra pulls sentence-transformers/torch and is not
# needed by the CLI investigate path.
RUN pip install --no-cache-dir . \
    && python -m spacy download en_core_web_sm

FROM python:3.11-slim

ARG ENGINE_GIT_SHA=unknown
ARG RUNNER_GIT_SHA=unknown
ENV ENGINE_GIT_SHA=${ENGINE_GIT_SHA} \
    RUNNER_GIT_SHA=${RUNNER_GIT_SHA} \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
# The engine's pyproject package list omits 13 top-level packages (shared_corpus, trust_gate, netpool, ...), so the
# full staged tree goes on PYTHONPATH ahead of the pip-installed copy; pip supplies the dependencies.
ENV PYTHONPATH=/app/engine:/app/runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tor ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 runner \
    && mkdir -p /var/lib/tor-cloud /tmp/va-run \
    && chown runner:runner /var/lib/tor-cloud /tmp/va-run \
    && chmod 700 /var/lib/tor-cloud

COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY engine/ /app/engine/

COPY runner/cloud/requirements.txt /app/runner/cloud/requirements.txt
RUN pip install --no-cache-dir -r /app/runner/cloud/requirements.txt

COPY runner/cloud/ /app/runner/cloud/
# The engine ran as root with a writable tree in E0/E1B; keep its tree writable for the unprivileged user.
RUN chown -R runner:runner /app/engine

USER runner

# Warm the Tor consensus/descriptor cache (client-only torrc) so a run bootstraps from cached directory state.
RUN printf 'SocksPort 127.0.0.1:9050\nDataDirectory /var/lib/tor-cloud\nLog notice file /tmp/tor-warm.log\n' > /tmp/torrc \
    && (tor -f /tmp/torrc & TOR_PID=$!; \
        for i in $(seq 1 150); do grep -q 'Bootstrapped 100%' /tmp/tor-warm.log 2>/dev/null && break; kill -0 $TOR_PID 2>/dev/null || break; sleep 1; done; \
        tail -n 3 /tmp/tor-warm.log; kill $TOR_PID 2>/dev/null; wait $TOR_PID 2>/dev/null; true) \
    && rm -f /tmp/tor-warm.log /tmp/torrc

ENTRYPOINT ["python", "-m", "cloud.run"]
