FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "dist/main.js"]
