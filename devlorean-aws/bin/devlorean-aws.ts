#!/usr/bin/env node
import { App, Environment } from 'aws-cdk-lib';
import { ApplicationProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import 'source-map-support/register';
import { GlobalNetworkStack } from '../lib/GlobalNetworkStack';
import { ServiceStack } from '../lib/ServiceStack';
import { VpcStack } from '../lib/VpcStack';

interface RegionConfig {
  env: Environment;
  vpcCidr: string;
}

interface CommonConfig {
  listenerPort: number;
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
const commonConfig: CommonConfig = {
  listenerPort: 80,
};

const app = new App()

const hndVpc = new VpcStack(app, 'HndVpcStack', {
  env: hndConfig.env,
  vpcCidr: hndConfig.vpcCidr,
  crossRegionReferences: true
});
const kixVpc = new VpcStack(app, 'KixVpcStack', {
  env: kixConfig.env,
  vpcCidr: kixConfig.vpcCidr,
  crossRegionReferences: true
});
new GlobalNetworkStack(app, 'GlobalNetworkStack', {
  env: { account, region: 'us-east-1' },
  loadBalancers: [hndVpc.endpoint, kixVpc.endpoint],
  listenerPort: commonConfig.listenerPort,
  crossRegionReferences: true,
});

const hndService = new ServiceStack(app, 'HndServiceStack', {
  env: hndConfig.env,
  loadBalancer: hndVpc.endpoint,
  listenerPort: commonConfig.listenerPort,
  protocol: ApplicationProtocol.HTTP,
  crossRegionReferences: true,
});
const kixService = new ServiceStack(app, 'KixServiceStack', {
  env: kixConfig.env,
  loadBalancer: kixVpc.endpoint,
  listenerPort: commonConfig.listenerPort,
  protocol: ApplicationProtocol.HTTP,
  crossRegionReferences: true,
});