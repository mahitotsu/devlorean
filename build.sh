#!/bin/bash
SCRIPT_DIR=$(cd $(dirname $0); pwd)

bun run --cwd $SCRIPT_DIR/devlorean-web build