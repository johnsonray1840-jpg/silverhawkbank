# ==============================================================================
# SILVERHAWK DIGITAL BANKING PLATFORM — ENTERPRISE DOCKERFILE
# Multi-Stage Optimized Production Build (Node.js 20 Alpine)
# ==============================================================================

# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Install native dependencies for build tools and Argon2
RUN apk add --no-cache python3 make g++ gcc libc-dev

# Copy package descriptors
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies including devDependencies for build
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code and config
COPY tsconfig*.json ./
COPY src/ ./src/

# Build production TypeScript bundle
RUN npm run build

# Prune devDependencies for minimal runtime image
RUN npm prune --production

# ==============================================================================
# Stage 2: Minimal Production Runtime
# ==============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime dependencies & security tools
RUN apk add --no-cache curl tzdata dumb-init

ENV NODE_ENV=production
ENV PORT=4000

# Create unprivileged system user for process isolation
RUN addgroup -S silverhawk && adduser -S silverhawk -G silverhawk

# Copy dependencies and build artifacts from builder
COPY --from=builder --chown=silverhawk:silverhawk /app/node_modules ./node_modules
COPY --from=builder --chown=silverhawk:silverhawk /app/dist ./dist
COPY --from=builder --chown=silverhawk:silverhawk /app/prisma ./prisma
COPY --from=builder --chown=silverhawk:silverhawk /app/package.json ./package.json

# Switch to unprivileged user
USER silverhawk

# Healthcheck probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/api/v1/health || exit 1

EXPOSE 4000

# Dumb-init handles PID 1 forwarding and graceful shutdown signals
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/src/main.js"]
