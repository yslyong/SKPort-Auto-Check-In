FROM node:18-alpine

# Use non-root node user provided by the image
WORKDIR /home/node/app

# Install dependencies (prefer lockfile; fallback to npm install) and verify critical modules
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --production --no-audit --no-fund; \
    else \
      npm install --production --no-audit --no-fund; \
    fi && \
    node -e "try{require('dotenv'); console.log('dotenv OK')}catch(e){console.error('dotenv missing'); process.exit(1)}" && \
    npm ls --depth=0

# Copy app
COPY . .
RUN chown -R node:node /home/node/app

USER node
ENV NODE_ENV=production

CMD ["node", "main.js"]
