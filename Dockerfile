# CHT User Management: the SvelteKit app, built with adapter-node.
#
#   docker build -t cht-user-management .
#   docker run -p 3000:3000 --env-file .env -v cht-user-management-data:/app/data cht-user-management
#
# Settings come from the environment (see .env.example); nothing secret is baked into the image.

# ---- build: every dependency, then the app
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
# `prepare` (svelte-kit sync) needs the sources, which aren't copied yet
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build \
	&& npm prune --omit=dev --ignore-scripts

# ---- run: the built app and its production dependencies only
FROM node:22-bookworm-slim
WORKDIR /app
# BODY_SIZE_LIMIT: CSV files may be 5 MB, plus the form around them; the Node adapter's default is 512K
ENV NODE_ENV=production \
	PORT=3000 \
	ARCHIVE_LOCATION=/app/data/archives \
	JOB_WORK_DIR=/tmp/cht-iam-jobs \
	BODY_SIZE_LIMIT=6M

COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
# background jobs start cht-conf with this script, from the app's folder
COPY --from=build --chown=node:node /app/scripts/cht-conf-job.cjs ./scripts/cht-conf-job.cjs
# every deployment's folder; DEPLOYMENT_DIR names one, or a folder mounted instead
COPY --from=build --chown=node:node /app/config/deployments ./config/deployments

# archives of deleted and merged docs, kept for ARCHIVE_TTL
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/_healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "build"]
