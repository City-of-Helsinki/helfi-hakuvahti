FROM node:20.11.1-alpine3.18

ENV npm_config_cache=/app/.npm
ENV APP_NAME rekry-hakuvahti

RUN mkdir -p /app/node_modules
RUN mkdir -p /app/logs
RUN chown -R :0 /app && chmod -R g+w /app

WORKDIR /app
COPY package.json .
COPY package-lock.json .
COPY . .

RUN npm install 
RUN npm cache clean --force

EXPOSE 3000

CMD [ "npm", "run", "start" ]
