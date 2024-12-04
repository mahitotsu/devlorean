FROM public.ecr.aws/docker/library/node:lts-alpine

ARG port=3000

RUN apk add --no-cache curl
WORKDIR /runtime
COPY ./.output/server ./server

ENV PORT=${port}
EXPOSE ${PORT}
ENTRYPOINT [ "node", "./server/index.mjs" ]