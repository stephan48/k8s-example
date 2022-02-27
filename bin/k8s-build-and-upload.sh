#!/bin/bash

docker build --tag $1 .
docker push $1
