#!/bin/bash

# Deployment script for MyTube
set -e

echo "🚀 Starting MyTube deployment..."

# Check if we're in the right directory
if [ ! -f "docker-compose.yaml" ]; then
    echo "❌ Error: docker-compose.yaml not found. Please run from backend directory."
    exit 1
fi

# Parse arguments
ENVIRONMENT=${1:-local}

if [ "$ENVIRONMENT" = "production" ] || [ "$ENVIRONMENT" = "prod" ]; then
    echo "📦 Deploying for PRODUCTION (gan.ba)..."

    # Use production Caddyfile
    if [ -f "config/Caddyfile.production" ]; then
        cp config/Caddyfile.production config/Caddyfile
        echo "✅ Updated Caddyfile for production"
    fi

    # Use production env
    if [ -f ".env.production" ]; then
        cp .env.production .env
        echo "✅ Updated environment for production"
    fi
else
    echo "📦 Deploying for LOCAL (powa.lan)..."
fi

# Build frontend
echo "🔨 Building frontend..."
docker compose build frontend

# Start services
echo "🚀 Starting services..."
docker compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check status
echo "📊 Service status:"
docker compose ps

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Frontend: http://localhost:3000"
if [ "$ENVIRONMENT" = "production" ] || [ "$ENVIRONMENT" = "prod" ]; then
    echo "Public URL: https://gan.ba"
else
    echo "Public URL: https://powa.lan"
fi
echo ""
echo "View logs: docker compose logs -f"
echo "Stop services: docker compose down"
