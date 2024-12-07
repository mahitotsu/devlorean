FROM public.ecr.aws/amazoncorretto/amazoncorretto:23-al2023-headless

WORKDIR /workdir
COPY ./target/*.jar app.jar

EXPOSE 9080
ENTRYPOINT [ "java", "-jar", "./app.jar" ]