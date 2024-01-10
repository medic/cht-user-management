FROM node:20-alpine

WORKDIR /app

COPY package*.json .
COPY dist ./dist

CMD npm start
