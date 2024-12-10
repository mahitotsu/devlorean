FROM envoyproxy/envoy:v1.32.2

RUN apt-get update && \
    apt-get install -y gettext-base && \
    rm -rf /var/lib/apt/lists/*

ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /usr/local/bin/tini
RUN chmod +x /usr/local/bin/tini

WORKDIR /tmp
COPY ./entrypoint.sh .
COPY ./envoy.yaml .

EXPOSE 10000
ENTRYPOINT ["tini", "--"]
CMD ["./entrypoint.sh"]