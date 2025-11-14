FROM registry.access.redhat.com/ubi9/nodejs-22 AS builder

ENV npm_config_cache="/tmp/.npm"

WORKDIR "/app"
COPY --chown=default:0 / "/app/"

RUN npm ci

RUN \
  npm run copy:assets && \
  npx tsc

# Development image

FROM registry.access.redhat.com/ubi9/nodejs-22 AS development

ENV npm_config_cache="$HOME/.npm"
ENV APP_NAME rekry-hakuvahti

WORKDIR /app

COPY --chown=default:0 package*.json ./
RUN npm ci

EXPOSE 3000

CMD ["npm", "run", "dev"]

# Production image

FROM registry.access.redhat.com/ubi9/nodejs-22

ENV npm_config_cache="/tmp/.npm"
ENV APP_NAME rekry-hakuvahti

WORKDIR "/app"

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=default:0 / "/app/"
COPY --from=builder --chown=default:0 /app/dist /app/dist

EXPOSE 3000

USER nobody:0

CMD ["npx", "fastify", "start", "-l", "info", "dist/app.js"]
