# Development image

FROM registry.access.redhat.com/ubi9/nodejs-24 AS development

ENV npm_config_cache="/tmp/.npm"
ENV APP_NAME hakuvahti

WORKDIR /app

EXPOSE 3000

CMD ["npm", "run", "dev"]

# Production image

FROM registry.access.redhat.com/ubi9/nodejs-24

ENV npm_config_cache="/tmp/.npm" APP_NAME=rekry-hakuvahti

WORKDIR "/app"

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=default:0 / "/app/"

EXPOSE 3000

USER nobody:0

CMD ["npm", "run", "start"]
