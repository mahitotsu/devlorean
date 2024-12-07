FROM envoyproxy/envoy:v1.32-latest

RUN apt-get update -y && apt-get install -y curl gettext-base

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
COPY ./envoy.template.yaml /etc/envoy/envoy.template.yaml

EXPOSE 10000
ENTRYPOINT [ "/entrypoint.sh" ]