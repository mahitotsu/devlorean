#!/usr/bin/env node
import { App, Environment } from 'aws-cdk-lib';
import 'source-map-support/register';
import { VpcStack } from '../lib/VpcStack';

interface RegionConfig {
  env: Environment;
  vpcCidr: string;
}

const account = process.env.CDK_DEFAULT_ACCOUNT;
const cidrBase = 0;

const hndConfig: RegionConfig = {
  env: { account, region: 'ap-northeast-1' },
  vpcCidr: `10.${cidrBase + 0}.0.0/16`,
};
const kixConfig: RegionConfig = {
  env: { account, region: 'ap-northeast-3' },
  vpcCidr: `10.${cidrBase + 1}.0.0/16`,
};

const app = new App()
new VpcStack(app, 'HndVpcStack', hndConfig);
new VpcStack(app, 'KixVpcStack', kixConfig);