FROM node:20.11.1-alpine3.18

ENV npm_config_cache=/app/.npm
ENV APP_NAME rekry-hakuvahti

RUN apk add --no-cache dcron
COPY cronjob /etc/crontabs/root
RUN chmod 0644 /etc/crontabs/root

#RUN mkdir -p /app
#RUN mkdir -p /app/node_modules
#RUN mkdir -p /app/logs
#RUN chown -R node:node /app

USER node

WORKDIR /app

COPY --chown=node:node package.json .
COPY --chown=node:node package-lock.json .
COPY --chown=node:node . .

RUN npm install 
RUN npm cache clean --force
RUN npm run hav:init-mongodb

EXPOSE 3000

COPY --chown=node:node entrypoint.sh .
RUN chmod 0644 entrypoint.sh
RUN chmod +x entrypoint.sh


# CMD [ "npm", "run", "start" ]

ENTRYPOINT ["/app/entrypoint.sh"]
