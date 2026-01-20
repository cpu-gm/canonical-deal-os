FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY server/ ./server/
COPY src/ ./src/
COPY .github/ ./.github/

# Create data directory
RUN mkdir -p ./server/.data

# Build assets (if needed)
RUN npm run build 2>/dev/null || true

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.BFF_PORT || 8787) + '/health', (res) => { if (res.statusCode === 200) process.exit(0); else process.exit(1); });"

# Expose port
EXPOSE 8787

# Start application
CMD ["node", "server/index.js"]
