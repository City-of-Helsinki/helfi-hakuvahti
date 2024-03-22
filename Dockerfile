FROM node:20.11.1-alpine3.18

ENV npm_config_cache=/app/.npm
ENV APP_NAME rekry-hakuvahti

# crontab
RUN apk add --no-cache dcron
COPY cronjob /etc/crontabs/root
RUN chmod 0644 /etc/crontabs/root

RUN mkdir -p /app
RUN mkdir -p /app/node_modules
RUN mkdir -p /app/logs
RUN chown -R node:node /app

USER node

WORKDIR /app

COPY --chown=node:node package.json .
COPY --chown=node:node package-lock.json .
COPY --chown=node:node . .

RUN npm install 
RUN npm cache clean --force
RUN npm run hav:init-mongodb

EXPOSE 3000

# RUN crond -f -L /app/logs/cron.log

CMD ["npm", "run", "start"]

