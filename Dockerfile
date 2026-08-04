# PiOps -- Docker image
#
# Build context is the repository root (this file lives there), since the
# backend expects the frontend as a sibling directory (backend/server.js
# resolves it via path.join(__dirname, '..', 'frontend')).
#
# ssh2's optional native acceleration (cpu-features) is skipped with
# --ignore-scripts -- it's not required, ssh2 works fine in pure JS, and
# skipping it means no build toolchain (gcc/python/make) is needed in the
# image at all, which matters most on ARM-based NAS models.

FROM node:20-bookworm-slim

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm install --omit=dev --ignore-scripts

COPY backend/ ./backend/
COPY frontend/ ./frontend/

ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000

WORKDIR /app/backend
# Device registry, encryption key, groups, alert config, and custom
# commands all live here -- mount this as a volume so they survive
# container recreation/updates.
VOLUME ["/app/backend/data"]

CMD ["node", "server.js"]
