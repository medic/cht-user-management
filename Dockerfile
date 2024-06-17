FROM node:20-alpine

ENV EXTERNAL_PORT 3000
ENV PORT 3000
ENV NODE_ENV production

WORKDIR /app

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --spider http://localhost:${PORT}/_healthz || exit 1

COPY package*.json ./
RUN apk add git
RUN npm ci --omit=dev

COPY src ./src
COPY tsconfig.json .
RUN npm run build

CMD npm start
