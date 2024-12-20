FROM public.ecr.aws/amazoncorretto/amazoncorretto:23-al2023-headless

WORKDIR /workdir
COPY ./target/*.jar ./app.jar

EXPOSE ${SERVER_PORT}
ENTRYPOINT [ "java", "-jar", "/workdir/app.jar" ]