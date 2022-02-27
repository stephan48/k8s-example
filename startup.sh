#!/bin/bash

set -x

export IP=$(hostname -i)
export ROLE=${ROLE:=UNKNOWN}

# exec container command
exec node index.js