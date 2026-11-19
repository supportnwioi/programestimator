# NWIOI Program Cost Estimator: Node server image for Cloudflare Containers (linux/amd64).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 NWIOI_DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY src ./src
COPY public ./public
COPY config ./config
EXPOSE 8080
CMD ["node", "server.js"]
