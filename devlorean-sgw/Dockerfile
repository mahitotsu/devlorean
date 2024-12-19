FROM public.ecr.aws/nginx/nginx:mainline

RUN apt-get update && \
    apt-get install -y gettext-base curl && \
    rm -rf /var/lib/apt/lists/*

COPY ./default.conf /etc/nginx/templates/default.conf.template