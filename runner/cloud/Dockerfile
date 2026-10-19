# Production runner image: the pinned public engine commit + the runner (runner/cloud) + a Tor client.
# One container runs one investigation. Build context prepared by scripts/prepare_build_context.sh.
# Sized for 1 vCPU / 2 GiB (E1B measured peak RSS 625 MB standard with the allowlist; deep at 1 GiB was never
# measured, so the job keeps 2 GiB).

# Base and Tor are pinned to what runner:bf2213c-95be6a1 (the last good production image) was built from (R2b).
FROM python:3.11-slim@sha256:e88e9763f943ec1834f992a4b51e0f24500486803e8bc534e5767af9ea65f6ce AS builder

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

FROM python:3.11-slim@sha256:e88e9763f943ec1834f992a4b51e0f24500486803e8bc534e5767af9ea65f6ce

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
    tor=0.4.9.14-0+deb13u1 ca-certificates \
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

# Warm the Tor consensus/descriptor cache (client-only torrc) so a run bootstraps from cached directory state. The
# build fails unless Tor reaches "Bootstrapped 100%" (scripts/tor_warmup.sh logs Tor's exit code and last lines).
RUN bash /app/runner/cloud/scripts/tor_warmup.sh

ENTRYPOINT ["python", "-m", "cloud.run"]
