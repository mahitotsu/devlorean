FROM public.ecr.aws/docker/library/node:slim

RUN apt-get update && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/*

COPY ./.output/server .

EXPOSE 3000
ENTRYPOINT [ "node", "index.mjs" ]