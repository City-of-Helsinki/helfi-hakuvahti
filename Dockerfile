# This docker image is used for local development.
# The production environment runs image generated
# with openshift/Dockerfile.
FROM registry.access.redhat.com/ubi9/nodejs-22

ENV npm_config_cache="$HOME/.npm"
ENV APP_NAME rekry-hakuvahti

RUN mkdir -p "$HOME/node_modules" "$HOME/logs"
COPY --chmod=755 entrypoint.sh /

EXPOSE 3000

ENTRYPOINT [ "/entrypoint.sh" ]

CMD [ "npm", "run", "start" ]
