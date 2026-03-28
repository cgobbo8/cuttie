FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN node ace build

# Production
FROM base AS production
ENV NODE_ENV=production
ENV PORT=3333
ENV HOST=0.0.0.0

# Copy built app and production deps
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./

EXPOSE 3333

CMD ["node", "bin/server.js"]
