#!/bin/bash

# Get the port from the first argument, default to 6379 if not provided
REDIS_PORT=${1:-6363}

# Wait for Redis to be ready
echo "Waiting for Redis to be ready on port $REDIS_PORT..."

while ! nc -z localhost $REDIS_PORT; do
  sleep 1
done

echo "Redis is up and running on port $REDIS_PORT"