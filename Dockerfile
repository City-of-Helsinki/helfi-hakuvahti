FROM node:20-alpine

ENV npm_config_cache=/app/.npm
ENV APP_NAME rekry-hakuvahti

RUN apk add --no-cache dcron libcap && \
    chown nobody:nobody /usr/sbin/crond && \
    setcap cap_setgid=ep /usr/sbin/crond

RUN mkdir /etc/periodic/1min \
    && mkdir /etc/periodic/30min \
    && mkdir /etc/periodic/12hour

COPY crontab /etc/crontabs/root

COPY cron/queue.sh /etc/periodic/1min/
COPY cron/populate.sh /etc/periodic/30min/
RUN chmod 755 /etc/periodic/1min/*.sh
RUN chmod 755 /etc/periodic/30min/*.sh

RUN mkdir -p /app/node_modules
RUN mkdir -p /app/logs
COPY entrypoint.sh /app/
RUN chmod 755 /app/entrypoint.sh

WORKDIR /app
COPY --chown=node:node package.json .
COPY --chown=node:node package-lock.json .
COPY --chown=node:node . .
RUN chown -R node:node /app

RUN npm install 
RUN npm cache clean --force

EXPOSE 3000

ENTRYPOINT [ "/app/entrypoint.sh" ]

CMD [ "npm", "run", "start" ]
