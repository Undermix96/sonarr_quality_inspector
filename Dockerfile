# ── Build stage ────────────────────────────────────────────────────────────
# Build always runs on the host native arch (fast, no emulation).
# BUILDPLATFORM = host arch; TARGETPLATFORM = target arch (amd64 / arm64).
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

WORKDIR /app

# Install dependencies only (layer cache friendly)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/

# ── Runtime stage ───────────────────────────────────────────────────────────
# Runtime must be the TARGET platform so the final image runs on the right arch.
FROM --platform=$TARGETPLATFORM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="Sonarr Quality Inspector" \
      org.opencontainers.image.description="Visual tool to identify episodes with lower quality than their season dominant in Sonarr" \
      org.opencontainers.image.source="https://github.com/undermix/sonarr-quality-inspector" \
      org.opencontainers.image.licenses="MIT"

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/src ./src
COPY --chown=appuser:appgroup package.json ./

USER appuser

# Expose port (default 3000, overridable via PORT env var)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/api/health || exit 1

CMD ["node", "src/server.js"]
