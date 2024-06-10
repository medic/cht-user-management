#!/bin/bash

# Build cht-user-management image
echo "Building cht-user-management image..."
docker build -f Dockerfile -t cht-user-management:local .

# Build worker image
echo "Building worker image..."
docker build -f Dockerfile.worker -t cht-worker:local .

# Start Docker Compose
echo "Starting Docker Compose..."
docker compose up