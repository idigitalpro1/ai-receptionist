FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY bot.js ./
COPY assets ./assets
CMD ["node", "bot.js"]
