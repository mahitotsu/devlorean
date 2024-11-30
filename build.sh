#!/bin/bash
npm --prefix ./devlorean-web run build
mvn -f ./devlorean-api package