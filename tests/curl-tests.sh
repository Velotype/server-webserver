#!/bin/bash

server_path="http://127.0.0.1:3000"
FAILED="false"
FAILED_NUM=0

#------------------------------------------

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${server_path}/hello")
if [ "$HTTP_CODE" = "200" ]; then
    echo "Success"
else
    echo "Failure: HTTP $HTTP_CODE received."
    FAILED="true"
    ((FAILED_NUM++))
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${server_path}/qwertyqwerty")
if [ "$HTTP_CODE" = "404" ]; then
    echo "Success"
else
    echo "Failure: HTTP $HTTP_CODE received."
    FAILED="true"
    ((FAILED_NUM++))
fi

HTTP_RESPONSE=$(curl -s "${server_path}/hello")
if [ "$HTTP_RESPONSE" = "Hello webserver" ]; then
    echo "Success"
else
    echo "Failure: HTTP $HTTP_RESPONSE received."
    FAILED="true"
    ((FAILED_NUM++))
fi

HTTP_RESPONSE=$(curl -s "${server_path}/static/example.txt")
if [ "$HTTP_RESPONSE" = "Some example text" ]; then
    echo "Success"
else
    echo "Failure: HTTP $HTTP_RESPONSE received."
    FAILED="true"
    ((FAILED_NUM++))
fi

#-----------------------------------------------------

if [ "$FAILED" = "false" ]; then
    echo "Success: all tests passed."
    exit 0
else
    echo "Failure: ${FAILED_NUM} tests failed."
    exit 1
fi
