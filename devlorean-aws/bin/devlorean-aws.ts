import { App } from "aws-cdk-lib";
import { DevloreanStack } from "../lib/DevloreanStack";

const app = new App();
new DevloreanStack(app, 'DevloreanStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-1' },
});