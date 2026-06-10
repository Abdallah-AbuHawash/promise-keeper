# Promise-Keeper — single-stage image.
# node:22-slim + build tools so better-sqlite3's native addon compiles if no
# prebuilt binary is available for the platform.
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps (tsx is a devDependency used to run TS directly).
COPY package*.json ./
RUN npm ci

# App source.
COPY tsconfig.json ./
COPY src ./src

# Long-polls Telegram + serves the Slack webhook on $PORT (Railway injects PORT).
CMD ["npm", "start"]
