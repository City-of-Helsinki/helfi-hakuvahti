# Development image

FROM registry.access.redhat.com/ubi9/nodejs-24 AS development

ENV npm_config_cache="/tmp/.npm"
ENV APP_NAME hakuvahti

WORKDIR /app

COPY tools/entrypoint /entrypoint

EXPOSE 3000

ENTRYPOINT ["/entrypoint"]

# Production image

FROM registry.access.redhat.com/ubi9/nodejs-24

ENV npm_config_cache="/tmp/.npm"
ENV APP_NAME rekry-hakuvahti
# Run TypeScript sources directly via Node's native type stripping.
ENV NODE_OPTIONS=--experimental-strip-types

WORKDIR "/app"

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=default:0 / "/app/"

EXPOSE 3000

USER nobody:0

CMD ["npx", "fastify", "start", "-l", "info", "src/app.ts"]
