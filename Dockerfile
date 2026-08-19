FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json ./
COPY server ./server
COPY src/protocol.ts ./src/protocol.ts
RUN npm run build:server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/carl-else/quizatz"

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
	&& rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist-server ./dist-server

USER node
EXPOSE 3000
CMD ["node", "dist-server/server/index.js"]