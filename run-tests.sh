#!/bin/bash

deno run test-webserver &
webserver_background_pid=$!
echo "webserver_background_pid = $webserver_background_pid"
trap "kill $webserver_background_pid" EXIT

sleep 0.5

./tests/curl-tests.sh
