# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Create logs directory
RUN mkdir -p logs

# Expose port (adjust if needed)
EXPOSE 3000

# Create a startup script
RUN echo '#!/bin/sh\n\
npm run migrate\n\
npm run init:analysis\n\
npm run init:userdata\n\
node dist/index.js' > /app/start.sh && \
chmod +x /app/start.sh

# Start the application with initialization
CMD ["/app/start.sh"] 