import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { GatewayVpcEndpointAwsService, IpAddresses, IpProtocol, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { CfnService, Cluster, ContainerImage, FargateService, FargateTaskDefinition, HealthCheck, ICluster, LogDriver, Protocol } from "aws-cdk-lib/aws-ecs";
import { NetworkListenerAction, NetworkLoadBalancer, NetworkTargetGroup, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";

export class DevloreanStack extends Stack {
    constructor(scope: any, id: string, props: StackProps) {
        super(scope, id, props);

        const serviceNamespace = 'service.local';

        const vpc = new Vpc(this, 'Vpc', {
            maxAzs: 2, createInternetGateway: true, natGateways: 2,
            ipProtocol: IpProtocol.IPV4_ONLY,
            ipAddresses: IpAddresses.cidr('10.0.0.0/24'), 
            subnetConfiguration: [{
                name: 'Public', subnetType: SubnetType.PUBLIC, cidrMask: 27,
            }, {
                name: 'Private', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 26,
            }, {
                name: 'Isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 27,
            }]
        });
        vpc.addGatewayEndpoint('s3Vpce', {
            service: GatewayVpcEndpointAwsService.S3,
            subnets: [{ subnetType: SubnetType.PRIVATE_WITH_EGRESS }],
        });

        const contents = new Bucket(this, 'ContentsBucket', {
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            publicReadAccess: false,
        });
        new BucketDeployment(contents, 'Deployer', {
            destinationBucket: contents,
            destinationKeyPrefix: '',
            sources: [Source.asset(`${__dirname}/../../devlorean-web/.output/public`)],
            memoryLimit: 512,
            logGroup: new LogGroup(contents, 'DeploymentLogGroup', {
                retention: RetentionDays.ONE_DAY,
                removalPolicy: RemovalPolicy.DESTROY,
            }),
        });

        const cluster = new Cluster(vpc, 'Cluster', {
            vpc,
            defaultCloudMapNamespace: { name: serviceNamespace, useForServiceConnect: true, },
        });

        const apiService = this.createService({
            name: 'Api', assetPath: `${__dirname}/../../devlorean-api`,
            cluster, desiredCount: 1, containerPort: 8080,
            cpu: 512, memory: 2048,
            healthCheck: {
                command: ['CMD', 'curl', '-f', 'http://localhost:8080/actuator/health'],
                startPeriod: Duration.seconds(30),
                interval: Duration.seconds(10),
                timeout: Duration.seconds(2),
                retries: 5,
            },
        });
        const webService = this.createService({
            name: 'Web', assetPath: `${__dirname}/../../devlorean-web`,
            cluster, desiredCount: 1, containerPort: 3000,
            cpu: 256, memory: 1024,
            environment: {
                NUXT_API_BASE_URL: `http://api.${serviceNamespace}:8080`,
            },
            healthCheck: {
                command: ['CMD', 'curl', '-f', 'http://localhost:3000/api/health'],
                startPeriod: Duration.seconds(30),
                interval: Duration.seconds(10),
                timeout: Duration.seconds(2),
                retries: 5,
            },
        });
        const sgwService = this.createService({
            name: 'Sgw', assetPath: `${__dirname}/../../devlorean-sgw`,
            cluster, desiredCount: 1, containerPort: 10000,
            cpu: 256, memory: 1024,
            environment: {
                CDS_HOST: contents.bucketDomainName,
                CDS_PORT: '443',
                WEB_HOST: `web.${serviceNamespace}`,
                WEB_PORT: '3000'
            },
            healthCheck: {
                command: ['CMD', 'curl', '-f', 'http://localhost:9901/ready'],
                startPeriod: Duration.seconds(30),
                interval: Duration.seconds(10),
                timeout: Duration.seconds(2),
                retries: 5,
            },
        });

        const nlbSg = new SecurityGroup(vpc, 'NlbSg', {
            vpc, allowAllOutbound: true,
        });
        const nlb = new NetworkLoadBalancer(vpc, 'LoadBalancer', {
            vpc, internetFacing: true, crossZoneEnabled: true,
            securityGroups: [nlbSg],
        });
        nlb.addListener('Listener', {
            port: 80,
            defaultAction: NetworkListenerAction.forward([new NetworkTargetGroup(vpc, 'SgwTargetGroup', {
                vpc, port: 10000, targetType: TargetType.IP,
                crossZoneEnabled: true, preserveClientIp: false,
                targets: [sgwService],
                deregistrationDelay: Duration.seconds(0),
                healthCheck: {
                    port: '10000',
                    healthyThresholdCount: 2,
                    unhealthyThresholdCount: 2,
                    interval: Duration.seconds(5),
                    timeout: Duration.seconds(2),
                },
            })]),
        });

        apiService.connections.allowFrom(webService, Port.tcp(8080));
        webService.connections.allowFrom(sgwService, Port.tcp(3000));
        sgwService.connections.allowFrom(nlbSg, Port.tcp(10000));
        nlb.connections.allowFromAnyIpv4(Port.tcp(80));

        contents.grantRead(sgwService.taskDefinition.taskRole);
        contents.addToResourcePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            principals: [sgwService.taskDefinition.taskRole],
            actions: ['s3:GetObject'],
            resources: [contents.arnForObjects('*')],
        }));

        new CfnOutput(this, 'DevloreanEndpoint', { value: `http://${nlb.loadBalancerDnsName}/` });
    }

    createService(props: {
        name: string; assetPath: string;
        cluster: ICluster; desiredCount: number; containerPort: number;
        cpu: number, memory: number,
        environment?: { [key: string]: string; },
        healthCheck?: HealthCheck,
    }): FargateService {

        const taskDefinition = new FargateTaskDefinition(props.cluster, `${props.name}TaskDefinition`, {
            cpu: props.cpu, memoryLimitMiB: props.memory,
        });
        const container = taskDefinition.addContainer(`${props.name}Container`, {
            image: ContainerImage.fromAsset(props.assetPath),
            portMappings: [{ name: props.name.toLowerCase(), containerPort: props.containerPort, protocol: Protocol.TCP }],
            environment: props.environment,
            healthCheck: props.healthCheck,
            logging: LogDriver.awsLogs({
                logGroup: new LogGroup(props.cluster, `${props.name}ServiceLogGroup`, {
                    retention: RetentionDays.ONE_DAY,
                    removalPolicy: RemovalPolicy.DESTROY,
                }),
                streamPrefix: 'service-'
            }),
        });

        const serviceSg = new SecurityGroup(props.cluster, `${props.name}ServiceSg`, {
            vpc: props.cluster.vpc, allowAllOutbound: true,
        });
        const service = new FargateService(props.cluster, `${props.name}Service`, {
            cluster: props.cluster, taskDefinition,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS }, assignPublicIp: false,
            securityGroups: [serviceSg],
            desiredCount: props.desiredCount,
            serviceConnectConfiguration: {
                services: [{
                    portMappingName: props.name.toLowerCase(),
                    discoveryName: props.name.toLowerCase(),
                }],
                logDriver: LogDriver.awsLogs({
                    logGroup: new LogGroup(props.cluster, `${props.name}TrafficLogGroup`, {
                        retention: RetentionDays.ONE_DAY,
                        removalPolicy: RemovalPolicy.DESTROY,
                    }),
                    streamPrefix: `traffic-`
                }),
            },
        });

        const cfnService = service.node.defaultChild as CfnService;
        cfnService.deploymentConfiguration = { maximumPercent: 200, minimumHealthyPercent: 0 };

        return service;
    }
}