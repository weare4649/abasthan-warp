FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache curl tar ca-certificates

COPY package.json ./
COPY build.js ./
RUN node build.js

COPY . .

EXPOSE 8080
ENV PORT=8080

CMD ["node", "index.js"]
