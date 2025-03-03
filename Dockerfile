FROM registry.access.redhat.com/ubi9/nodejs-20

ENV npm_config_cache=/app/.npm
ENV APP_NAME rekry-hakuvahti

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
