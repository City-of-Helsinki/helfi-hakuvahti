FROM registry.access.redhat.com/ubi9/nodejs-22 as builder

ENV npm_config_cache="/tmp/.npm"

WORKDIR "$HOME"
COPY --chown=default:0 / "$HOME/"

RUN npm ci

RUN \
  npm run copy:assets && \
  npx tsc

FROM registry.access.redhat.com/ubi9/nodejs-22

ENV npm_config_cache="/tmp/.npm"
ENV APP_NAME rekry-hakuvahti

WORKDIR "$HOME"
COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=default:0 / "$HOME/"
COPY --from=builder --chown=default:0 $HOME/dist $HOME/dist

EXPOSE 3000
RUN \
  chown -R :0 "$HOME" && \
  chmod -R g+wx "$HOME"

USER nobody:0

CMD ["fastify", "start", "-l", "info", "dist/app.js"]
