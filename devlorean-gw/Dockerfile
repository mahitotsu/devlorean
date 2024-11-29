FROM envoyproxy/envoy:v1.32-latest

COPY ./envoy.yml /etc/envoy/envoy.yml
CMD [ "/usr/local/bin/envoy", "-c", "/etc/envoy/envoy.yml" ]