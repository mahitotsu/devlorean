#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

bun run --cwd $SCRIPT_DIR/devlorean-web build
mvn -f $SCRIPT_DIR/devlorean-api package