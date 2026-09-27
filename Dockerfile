FROM node:20-alpine

WORKDIR /app

# Install dependencies terlebih dahulu (memanfaatkan layer cache Docker)
COPY package*.json ./
RUN npm install --omit=dev

# Copy source code
COPY src ./src

ENV NODE_ENV=production

# Catatan: token TIDAK di-bake ke dalam image.
# Jalankan dengan: docker run --env-file .env waguri-afk-bot
CMD ["node", "src/index.js"]
