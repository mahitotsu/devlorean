#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { DevloreanStack } from "../lib/DevloreanStack";

const app = new App();

new DevloreanStack(app, 'HndStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1'
  }
});