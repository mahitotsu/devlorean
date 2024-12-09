FROM envoyproxy/envoy:v1.32.2

WORKDIR /workdir
COPY ./envoy.yaml /etc/envoy/envoy.yaml

EXPOSE 10000
CMD ["envoy", "-c", "/etc/envoy/envoy.yaml", "-l", "debug"]