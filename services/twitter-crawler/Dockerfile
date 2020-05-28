FROM node:14

WORKDIR /usr/src/ap
COPY package.json yarn.lock ./
RUN yarn
COPY . .
CMD [ "node", "index.js" ]