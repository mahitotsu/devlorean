import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { GatewayVpcEndpointAwsService, IpAddresses, IpProtocol, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { CfnService, Cluster, ContainerImage, FargateService, FargateTaskDefinition, LogDriver } from "aws-cdk-lib/aws-ecs";
import { NetworkListenerAction, NetworkLoadBalancer, NetworkTargetGroup, Protocol, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

export class RegionalWebStack extends Stack {
    constructor(scope: any, id: string, props: StackProps) {
        super(scope, id, props);

        const contentsBucket = new Bucket(this, 'ContentsBucket', {
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            publicReadAccess: false,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        });
        new BucketDeployment(contentsBucket, 'Deployer', {
            destinationBucket: contentsBucket,
            destinationKeyPrefix: '',
            sources: [Source.asset(`${__dirname}/../../devlorean-web/.output/public`)],
            memoryLimit: 1024,
        });

        const maxAzs = 2;
        const vpc = new Vpc(this, 'Vpc', {
            ipProtocol: IpProtocol.IPV4_ONLY, ipAddresses: IpAddresses.cidr('10.0.0.0/16'),
            maxAzs, createInternetGateway: true, natGateways: maxAzs,
            subnetConfiguration: [
                { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 19, },
                { name: 'private', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 18, },
                { name: 'isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 19, },
            ],
        });
        const s3Vpce = vpc.addGatewayEndpoint('S3Endpoint', {
            service: GatewayVpcEndpointAwsService.S3, subnets: [{ subnetType: SubnetType.PRIVATE_WITH_EGRESS }]
        });

        const servicePort = 80;
        const listenerPort = 80;
        const serviceNamespace = 'service.local';
        const apiName = 'api';

        const web = new Construct(this, 'Web');
        const webTaskDef = new FargateTaskDefinition(web, 'TaskDefinition', {
            cpu: 1024, memoryLimitMiB: 2048,
        });
        webTaskDef.addContainer('sgw', {
            essential: true,
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-sgw`),
            portMappings: [{ containerPort: servicePort }],
            environment: {
                BUCKET_NAME: contentsBucket.bucketName,
                WEB_HOST: 'localhost',
                WEB_PORT: '3000'
            },
            healthCheck: {
                command: ['curl', '-f', `http://localhost:${servicePort}/health`],
                startPeriod: Duration.seconds(10),
                interval: Duration.seconds(5),
                timeout: Duration.seconds(2),
                retries: 5,
            },
            logging: LogDriver.awsLogs({
                streamPrefix: 'sgw',
                logGroup: new LogGroup(web, 'SgwLogGroup', {
                    removalPolicy: RemovalPolicy.DESTROY,
                    retention: RetentionDays.ONE_DAY,
                })
            })
        });
        webTaskDef.addContainer('sig', {
            essential: false,
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-sig`),
            logging: LogDriver.awsLogs({
                streamPrefix: 'sig',
                logGroup: new LogGroup(web, 'SigLogGroup', {
                    removalPolicy: RemovalPolicy.DESTROY,
                    retention: RetentionDays.ONE_DAY,
                })
            })
        });
        webTaskDef.addContainer('web', {
            essential: true,
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-web`),
            environment: {
                NUXT_API_BASE: `http://${apiName}.${serviceNamespace}:${servicePort}`,
            },
            healthCheck: {
                command: ['curl', '-f', 'http://localhost:3000/health'],
                startPeriod: Duration.seconds(10),
                interval: Duration.seconds(5),
                timeout: Duration.seconds(2),
                retries: 5,
            },
            logging: LogDriver.awsLogs({
                streamPrefix: 'web',
                logGroup: new LogGroup(web, 'WebLogGroup', {
                    removalPolicy: RemovalPolicy.DESTROY,
                    retention: RetentionDays.ONE_DAY,
                })
            })
        });

        const api = new Construct(this, 'Api');
        const apiTaskDef = new FargateTaskDefinition(api, 'TaskDefinition', {
            cpu: 2048, memoryLimitMiB: 4096,
        });
        apiTaskDef.addContainer('api', {
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-api`),
            portMappings: [{ containerPort: servicePort, name: apiName }],
            environment: {
                SERVER_PORT: servicePort.toString(),
            },
            healthCheck: {
                command: ['curl', '-f', `http://localhost:${servicePort}/actuator/health`],
                startPeriod: Duration.seconds(10),
                interval: Duration.seconds(5),
                timeout: Duration.seconds(2),
                retries: 5,
            },
            logging: LogDriver.awsLogs({
                streamPrefix: 'api',
                logGroup: new LogGroup(api, 'ApiLogGroup', {
                    removalPolicy: RemovalPolicy.DESTROY,
                    retention: RetentionDays.ONE_DAY,
                })
            })
        });

        const nlbSg = new SecurityGroup(this, 'NlbSg', { vpc, allowAllOutbound: false });
        const webSg = new SecurityGroup(this, 'WebSg', { vpc, allowAllOutbound: false });
        const apiSg = new SecurityGroup(this, 'ApiSg', { vpc, allowAllOutbound: false });
        nlbSg.connections.allowFromAnyIpv4(Port.tcp(listenerPort));
        webSg.connections.allowFrom(nlbSg, Port.tcp(servicePort));
        webSg.connections.allowToAnyIpv4(Port.tcp(443));
        apiSg.connections.allowFrom(webSg, Port.tcp(servicePort));
        apiSg.connections.allowToAnyIpv4(Port.tcp(443));

        contentsBucket.grantRead(webTaskDef.taskRole);
        contentsBucket.addToResourcePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            principals: [webTaskDef.taskRole],
            actions: ['s3:GetObject'],
            resources: [contentsBucket.arnForObjects('*')],
            conditions: {
                'StringEquals': {
                    'aws:SourceVpce': s3Vpce.vpcEndpointId,
                }
            },
        }));

        const cluster = new Cluster(vpc, 'Cluster', {
            vpc,
            defaultCloudMapNamespace: { name: serviceNamespace, useForServiceConnect: true, },
            enableFargateCapacityProviders: true,
        });
        cluster.addDefaultCapacityProviderStrategy([
            { capacityProvider: 'FARGATE_SPOT', weight: 1 },
        ]);

        const webService = new FargateService(web, 'Service', {
            taskDefinition: webTaskDef, cluster,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS }, securityGroups: [webSg],
            assignPublicIp: false,
            desiredCount: 1,
        });
        webService.enableServiceConnect({
            logDriver: LogDriver.awsLogs({
                streamPrefix: 'trf',
                logGroup: new LogGroup(web, 'TrfLogGroup', {
                    removalPolicy: RemovalPolicy.DESTROY,
                    retention: RetentionDays.ONE_DAY,
                })
            }),
        });
        const cfnWebService = webService.node.defaultChild as CfnService;
        cfnWebService.deploymentConfiguration = { minimumHealthyPercent: 0, maximumPercent: 200 };

        const apiService = new FargateService(api, 'Service', {
            taskDefinition: apiTaskDef, cluster,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS }, securityGroups: [apiSg],
            assignPublicIp: false,
            desiredCount: 1,
        });
        apiService.enableServiceConnect({
            services: [{ portMappingName: apiName }],
            logDriver: LogDriver.awsLogs({
                streamPrefix: 'trf',
                logGroup: new LogGroup(api, 'TrfLogGroup', {
                    removalPolicy: RemovalPolicy.DESTROY,
                    retention: RetentionDays.ONE_DAY,
                })
            }),
        });
        const cfnApiService = apiService.node.defaultChild as CfnService;
        cfnApiService.deploymentConfiguration = { minimumHealthyPercent: 0, maximumPercent: 200 };
        webService.node.addDependency(apiService);

        const nlb = new NetworkLoadBalancer(vpc, 'LoadBalancer', {
            vpc, vpcSubnets: { subnetType: SubnetType.PUBLIC },
            internetFacing: true,
            securityGroups: [nlbSg],
        });
        nlb.addListener('Listener', {
            port: listenerPort, protocol: Protocol.TCP,
            defaultAction: NetworkListenerAction.forward([
                new NetworkTargetGroup(webService, 'TargetGroup', {
                    targetType: TargetType.IP,
                    port: servicePort, protocol: Protocol.TCP, vpc, preserveClientIp: false,
                    targets: [webService],
                    healthCheck: {
                        healthyThresholdCount: 2, unhealthyThresholdCount: 2,
                        interval: Duration.seconds(5), timeout: Duration.seconds(2),
                    },
                    deregistrationDelay: Duration.seconds(0),
                })
            ]),
        });

        new CfnOutput(this, 'Endpoint', { value: `http://${nlb.loadBalancerDnsName}` });
    }
}