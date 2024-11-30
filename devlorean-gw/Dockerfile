FROM public.ecr.aws/amazonlinux/amazonlinux:2023 as builder

RUN yum update -y && yum install -y gettext

ARG public_cluster_hostname
ARG server_cluster_hostname

ENV PUBLIC_CLUSTER_HOSTNAME=${public_cluster_hostname}
ENV SERVER_CLUSTER_HOSTNAME=${server_cluster_hostname}

WORKDIR /tmp
COPY ./envoy.template.yml .
RUN envsubst < ./envoy.template.yml > ./envoy.yml

# -----
FROM envoyproxy/envoy:v1.32-latest

RUN apt-get update -y && apt-get install -y curl
COPY --from=builder /tmp/envoy.yml /etc/envoy/envoy.yml

EXPOSE 8080
CMD [ "/usr/local/bin/envoy", "-c", "/etc/envoy/envoy.yml" ]