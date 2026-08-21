ARG RUNTIME_IMAGE=adminyeezy-runtime:python311-ffmpeg

FROM node:20-bookworm-slim AS builder

WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=768

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

FROM ${RUNTIME_IMAGE} AS runner

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/universal_ai_process.py ./universal_ai_process.py
COPY --from=builder /app/next.config.js ./next.config.js

RUN mkdir -p /app/tmp /app/scratch

EXPOSE 3000

CMD ["sh", "-c", "npm run db:migrate:media-seo && npm run db:migrate:supplier-ai && npm run db:migrate:catalog-deletion && npm run db:migrate:measurement-templates && npm run db:migrate:batch-ai && npm run db:migrate:chromoff-ai && npm run db:migrate:supplier-post-process && npm run start"]
