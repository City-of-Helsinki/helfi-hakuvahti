FROM node:20.11.1-alpine3.18

# Env
ENV npm_config_cache=/app/.npm
ENV APP_NAME rekry-hakuvahti

# Add packages
RUN apk add --no-cache curl openrc dcron
COPY cronjob /etc/crontabs/root
RUN chmod 0644 /etc/crontabs/root

# Set up paths and permissions
RUN mkdir -p /app/node_modules
RUN mkdir -p /app/logs
COPY entrypoint.sh /app/
RUN chmod 0644 /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
RUN chmod 0644 /usr/sbin/crond
RUN chmod +x /usr/sbin/crond
RUN chmod 0644 /usr/bin/crontab
RUN chmod +x /usr/bin/crontab
RUN touch /app/logs/send-emails.log
RUN touch /app/logs/populate-email-queue.log
RUN touch /app/logs/cron.log

# Copy app to container
WORKDIR /app
COPY --chown=node:node package.json .
COPY --chown=node:node package-lock.json .
COPY --chown=node:node . .

# Run NPM install
RUN npm install 
RUN npm cache clean --force
RUN npm run hav:init-mongodb

# Chown everything to node user
RUN chown -R node:node /app

# Open port 3000
EXPOSE 3000

# Run entrypoint as root to start the cron
USER root
ENTRYPOINT [ "/app/entrypoint.sh" ]

# Run the app as node user
USER node
CMD [ "npm", "run", "start" ]
