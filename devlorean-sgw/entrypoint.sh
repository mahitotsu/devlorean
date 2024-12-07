#!/bin/sh
envsubst < /etc/envoy/envoy.template.yaml > /etc/envoy/envoy.yaml
cat /etc/envoy/envoy.yaml
exec envoy -c /etc/envoy/envoy.yaml 