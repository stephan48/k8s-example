# FROM node:latest
FROM alpine:latest

# set the default NODE_ENV to production
# for dev/test build with: docker build --build-arg NODE=development .
# and the testing npms will be included
ARG NODE=production
ENV NODE_ENV ${NODE}

# copy package info early to install npms and delete npm command
WORKDIR /usr/src/app
COPY package*.json ./
RUN apk -U add curl jq bash nodejs npm python3 py3-pip graphviz coreutils font-bitstream-type1 ghostscript-fonts ttf-cantarell && \
  pip3 install netaddr && \
  npm install && apk del --purge npm && \
  rm -rvf /var/cache/* /root/.npm /tmp/*

#RUN mkdir -p /usr/src/app/dist/src/ && cp /usr/src/app/node_modules/viz.js/full.render.js /usr/src/app/dist/src/full.render.js

# copy the code
COPY . .
HEALTHCHECK --interval=10s --timeout=3s \
  CMD curl -f -s http://localhost:3000/health/ || exit 1
EXPOSE 3000
ENTRYPOINT ["bash","/usr/src/app/startup.sh"]
