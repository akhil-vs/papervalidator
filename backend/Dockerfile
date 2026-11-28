FROM node:22-bookworm-slim

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY db/migrations/003_auth.sql ./db/migrations/003_auth.sql
RUN npm run build && npm prune --omit=dev

ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "dist/main.js"]
