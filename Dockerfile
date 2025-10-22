# Production Dockerfile using Bun
FROM oven/bun:1.3-debian AS builder

RUN apt update && apt install -y ffmpeg

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY ./src ./src
COPY ./scripts ./scripts
COPY .env.production index.ts ./

# Set environment variables
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080

# Start the application directly with bun
CMD ["bun", "index.ts"]
