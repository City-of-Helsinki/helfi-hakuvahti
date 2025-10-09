FROM registry.access.redhat.com/ubi8/nodejs-20

ENV npm_config_cache="$HOME/.npm"
ENV APP_NAME rekry-hakuvahti

RUN mkdir -p "$HOME/node_modules" "$HOME/logs"

WORKDIR "$HOME"
COPY package.json .
COPY package-lock.json .
COPY . .

RUN npm install 
RUN npm cache clean --force

EXPOSE 3000
RUN chown -R :0 "$HOME" && chmod -R g+wx "$HOME"
USER nobody:0

CMD [ "npm", "run", "start" ]
