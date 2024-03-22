FROM node:20.11.1-alpine3.18

RUN apk add --no-cache dcron
COPY cronjob /etc/crontabs/root
RUN chmod 0644 /etc/crontabs/root

RUN mkdir -p /app/node_modules && chown -R node:node /app

WORKDIR /app
ENV npm_config_cache=/app/.npm
ENV APP_NAME rekry-hakuvahti

COPY package*.json .

USER node
COPY --chown=node:node . .
RUN npm install && npm cache clean --force
RUN npm run hav:init-mongodb

EXPOSE 3000

RUN mkdir -p /app/logs
# RUN crond -f -L /app/logs/cron.log

CMD ["npm", "run", "start"]
