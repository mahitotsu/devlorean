FROM envoyproxy/envoy:v1.32-latest

RUN apt-get update -y && apt-get install -y curl
COPY ./envoy.yaml /etc/envoy/envoy.yaml

EXPOSE 8080
CMD ["-c", "/etc/envoy/envoy.yaml"]
