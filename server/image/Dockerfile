# Image for remote sessions: Node LTS, Python 3, git and build tools.
FROM node:24-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git less nano procps iproute2 \
    python3 python3-pip python3-venv python-is-python3 \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

# Debian marks the system Python as externally managed; inside a throwaway
# container plain `pip install` is what users expect.
RUN rm -f /usr/lib/python3*/EXTERNALLY-MANAGED

# The node image already has uid 1000 as "node"; rename it so the prompt says tide.
RUN usermod -l tide -d /home/tide -m node && groupmod -n tide node \
  && mkdir -p /workspace && chown tide:tide /workspace

ENV npm_config_update_notifier=false PIP_DISABLE_PIP_VERSION_CHECK=1 PS1='\[\e[34m\]\u\[\e[0m\] \[\e[36m\]\w\[\e[0m\] $ '
USER tide
WORKDIR /workspace
CMD ["sleep", "infinity"]
