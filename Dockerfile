FROM node:20.11.1-alpine3.18

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app

WORKDIR /home/node/app
ENV npm_config_cache=/home/node/app/.npm
ENV APP_NAME rekry-hakuvahti

COPY package*.json ./

USER node
COPY --chown=node:node . .
RUN npm install && npm cache clean --force

EXPOSE 3000

CMD ["npm", "run", "start"]
