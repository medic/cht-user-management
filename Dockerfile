FROM node:20-alpine

ENV EXTERNAL_PORT 3000
ENV PORT 3000

WORKDIR /app

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --spider http://127.0.0.1:${PORT}/_healthz || exit 1

COPY package*.json ./
RUN apk add git
RUN npm ci --omit=dev

COPY src ./src
COPY tsconfig.json ./
RUN npm run build

CMD npm start
