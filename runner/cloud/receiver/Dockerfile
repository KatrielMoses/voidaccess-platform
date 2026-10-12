FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY engine-client/ ./engine-client/
COPY receiver.ts ./
ENV NODE_ENV=production
CMD ["node_modules/.bin/tsx", "receiver.ts"]
