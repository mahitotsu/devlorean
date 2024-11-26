FROM public.ecr.aws/docker/library/node:current-bullseye-slim AS  builder

WORKDIR /workdir

COPY . .
RUN npm i
RUN npm run build

# -----
FROM public.ecr.aws/docker/library/node:current-bullseye-slim

COPY --from=builder /workdir/.output ./.output
EXPOSE 3000

ENTRYPOINT [ "node" ]
CMD [ "./.output/server/index.mjs" ]