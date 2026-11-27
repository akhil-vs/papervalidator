# Local development image for the Angular 9 app on Node 22.
# Production hosting is the static build published to Firebase Hosting.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 4200

# with-openssl-legacy.js turns on the OpenSSL legacy provider webpack 4 needs.
CMD ["npm", "start", "--", "--host", "0.0.0.0", "--port", "4200", "--poll", "2000", "--disable-host-check"]
