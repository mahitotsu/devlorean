#!/usr/bin/env node

import { App } from "aws-cdk-lib";
import { RegionalWebStack } from "../lib/RegionalWebStack";

const app = new App();
new RegionalWebStack(app, 'HdkRegionalWebStack', {
  env: { region: 'ap-northeast-1', account: process.env.CDK_DEFAULT_ACCOUNT, }
});