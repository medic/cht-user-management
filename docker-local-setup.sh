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
elif [[ -z "$(docker images -q cht-user-management:local 2> /dev/null)" ]] ||  [[ -z "$(docker images -q cht-user-management-worker:local 2> /dev/null)" ]]; then
  echo;echo "Docker images not found - please call

     ./docker-local-setup.sh build

to build missing images";echo;
  exit 1
fi

echo;echo "Starting Docker Compose...";echo
CHT_USER_MANAGEMENT_IMAGE=cht-user-management:local CHT_USER_MANAGEMENT_WORKER_IMAGE=cht-user-management-worker:local docker compose up

echo;echo "Server is now running at http://127.0.0.1:$EXTERNAL_PORT/login";echo
