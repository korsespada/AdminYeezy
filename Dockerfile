FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN if [ "$(nproc)" -gt 1 ]; then \
      taskset -c 0,1 nice -n 10 npm ci; \
    else \
      nice -n 10 npm ci; \
    fi

COPY . .
RUN if [ "$(nproc)" -gt 1 ]; then \
      taskset -c 0,1 nice -n 10 npm run build; \
    else \
      nice -n 10 npm run build; \
    fi
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV PYTHON_PATH=python
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python-is-python3 ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m venv /opt/venv \
  && pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir -r requirements.txt

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/universal_ai_process.py ./universal_ai_process.py
COPY --from=builder /app/next.config.js ./next.config.js

RUN mkdir -p /app/tmp /app/scratch

EXPOSE 3000

CMD ["sh", "-c", "npm run db:migrate:media-seo && npm run db:migrate:supplier-ai && npm run db:migrate:measurement-templates && npm run start"]
