#!/bin/bash

#!/bin/bash
set -e

if [ ! -f ".env" ]; then
  echo "Please create a .env file first. Copy the env.example and edit the new file"
  exit 1
fi
. .env

if [[ -n $1 ]] && [[ $1 == "build" ]]; then
  docker build -f Dockerfile -t cht-user-management:local .
  docker build -f Dockerfile.worker -t cht-user-management-worker:local .
fi

echo;echo "Starting Docker Compose...";echo
CHT_USER_MANAGEMENT_IMAGE=cht-user-management:local CHT_USER_MANAGEMENT_WORKER_IMAGE=cht-user-management-worker:local docker compose up -d

echo;echo "Server is now running at http://127.0.0.1:$EXTERNAL_PORT/login";echo
