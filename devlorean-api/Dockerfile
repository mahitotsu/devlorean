FROM public.ecr.aws/amazoncorretto/amazoncorretto:23-headless

WORKDIR /workdir
COPY target/*.jar app.jar

EXPOSE 8080
ENTRYPOINT [ "java", "-jar", "app.jar" ]