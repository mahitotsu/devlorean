#/bin/sh
SCRIPT_DIR=$(dirname "$(realpath "$0")")
envsubst < ${SCRIPT_DIR}/envoy.yaml > /etc/envoy/envoy.yaml
echo "===== print envoy.yaml ====="
cat /etc/envoy/envoy.yaml
echo "===== ---------------- ====="

exec envoy -c /etc/envoy/envoy.yaml --log-level ${LOG_LEVEL:-info}