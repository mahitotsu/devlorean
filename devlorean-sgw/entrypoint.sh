#/bin/sh
./envoy.yaml < envsubst > /etc/envoy/envoy.yaml
exec envoy -c /etc/envoy/envoy.yaml