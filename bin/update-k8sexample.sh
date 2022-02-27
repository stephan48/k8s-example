#!/bin/bash
sed -i "s/frontend-v[0-9]*/frontend-v$1/" k8sexample-frontend.yaml
grep -B 1 registry k8sexample-frontend.yaml
kubectl apply -f k8sexample-frontend.yaml
stern k8sexample-frontend --since 5s
