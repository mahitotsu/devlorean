import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { GatewayVpcEndpointAwsService, IpAddresses, IpProtocol, Ipv6Addresses, Peer, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { CfnService, Cluster, ContainerImage, FargateService, FargateTaskDefinition, HealthCheck, ICluster, LogDriver } from "aws-cdk-lib/aws-ecs";
import { NetworkListenerAction, NetworkLoadBalancer, NetworkTargetGroup, Protocol, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Accelerator } from "aws-cdk-lib/aws-globalaccelerator";
import { NetworkLoadBalancerEndpoint } from "aws-cdk-lib/aws-globalaccelerator-endpoints";
import { Effect, PolicyStatement, StarPrincipal } from "aws-cdk-lib/aws-iam";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

interface ServiceConfig {
    name: string;
    port: number;
    securityGroup: SecurityGroup;
}

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

        const vpc = new Vpc(this, 'Vpc', {
            ipProtocol: IpProtocol.DUAL_STACK,
            ipAddresses: IpAddresses.cidr('10.0.0.0/16'), ipv6Addresses: Ipv6Addresses.amazonProvided(),
            maxAzs: 2, createInternetGateway: true, natGateways: 1,
            subnetConfiguration: [
                { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 19, ipv6AssignAddressOnCreation: true, },
                { name: 'private', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 18, ipv6AssignAddressOnCreation: true },
                { name: 'isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 19, ipv6AssignAddressOnCreation: true },
            ],
        });
        const s3Vpce = vpc.addGatewayEndpoint('S3Endpoint', {
            service: GatewayVpcEndpointAwsService.S3, subnets: [{ subnetType: SubnetType.PRIVATE_WITH_EGRESS }]
        });

        const nlbSg = new SecurityGroup(vpc, 'LbSG', { vpc });
        const nlb = new NetworkLoadBalancer(vpc, 'LoadBalancer', {
            vpc, vpcSubnets: { subnetType: SubnetType.PUBLIC },
            internetFacing: false, securityGroups: [nlbSg],
        });

        const sgwServiceConfig = { name: 'Sgw', port: 80, securityGroup: new SecurityGroup(vpc, 'SgwSecurityGroup', { vpc }) };
        const webServiceConfig = { name: 'Web', port: 3000, securityGroup: new SecurityGroup(vpc, 'WebSecurityGroup', { vpc }) };
        const serviceCluster = new Cluster(vpc, 'ServiceCluster', { vpc, });

        const sgwService = this.createService({
            cluster: serviceCluster, loadBalaner: nlb,
            config: sgwServiceConfig,
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-sgw`),
            cpu: 512, memoryLimitMiB: 1024,
            environment: {
                BUCKET_NAME: contentsBucket.bucketDomainName,
                WEB_HOST: `${nlb.loadBalancerDnsName}`,
                WEB_PORT: `${webServiceConfig.port}`,
            },
            healthCheck: {
                command: ['CMD-SHELL', 'curl -sf http://localhost:9901/ready'],
                interval: Duration.seconds(10), timeout: Duration.seconds(5),
                retries: 5, startPeriod: Duration.seconds(10),
            },
            desiredCount: 1,
        });
        const webService = this.createService({
            cluster: serviceCluster, loadBalaner: nlb,
            config: webServiceConfig,
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-web`),
            cpu: 1024, memoryLimitMiB: 2048,
            healthCheck: {
                command: ['CMD-SHELL', 'curl -sf http://localhost:3000/health'],
                interval: Duration.seconds(10), timeout: Duration.seconds(5),
                retries: 5, startPeriod: Duration.seconds(10),
            },
            desiredCount: 1,
        });

        nlb.connections.allowFrom(Peer.anyIpv4(), Port.tcp(sgwServiceConfig.port));
        nlb.connections.allowFrom(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(webServiceConfig.port));

        sgwServiceConfig.securityGroup.connections.allowFrom(nlb, Port.tcp(sgwServiceConfig.port));
        webServiceConfig.securityGroup.connections.allowFrom(nlb, Port.tcp(webServiceConfig.port));

        contentsBucket.addToResourcePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            principals: [new StarPrincipal()],
            actions: ['s3:GetObject'],
            resources: [contentsBucket.arnForObjects('*')],
            conditions: { 'StringEquals': { 'aws:SourceVpce': s3Vpce.vpcEndpointId, } }
        }));
        contentsBucket.grantRead(sgwService.taskDefinition.taskRole);

        const accelerator = new Accelerator(this, 'Accelerator', {});
        accelerator.addListener('Listener', {
            portRanges: [{ fromPort: 80, toPort: 80, }, { fromPort: 443, toPort: 443, },],
        }).addEndpointGroup('Endpoints', {
            endpoints: [new NetworkLoadBalancerEndpoint(nlb, { preserveClientIp: true, })]
        });

        new CfnOutput(this, 'Endpoint', { value: `http://${accelerator.dnsName}` });
    }

    createService(args: {
        cluster: ICluster;
        loadBalaner: NetworkLoadBalancer;
        config: ServiceConfig,
        image: ContainerImage;
        cpu: number;
        memoryLimitMiB: number;
        environment?: { [key: string]: string };
        healthCheck?: HealthCheck;
        desiredCount: number;
    }) {
        const scope = new Construct(args.cluster, args.config.name);

        const taskDefinition = new FargateTaskDefinition(scope, 'TaskDefinition', {
            cpu: args.cpu, memoryLimitMiB: args.memoryLimitMiB,
        });
        taskDefinition.addContainer('Container', {
            image: args.image,
            environment: args.environment,
            portMappings: [{ containerPort: args.config.port }],
            healthCheck: args.healthCheck,
            logging: LogDriver.awsLogs({ streamPrefix: 'service' }),
        });

        const service = new FargateService(scope, 'Service', {
            cluster: args.cluster, taskDefinition,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS, },
            securityGroups: [args.config.securityGroup],
            desiredCount: args.desiredCount,
            healthCheckGracePeriod: Duration.seconds(30),
        });

        const cfnService = service.node.defaultChild as CfnService;
        cfnService.deploymentConfiguration = { maximumPercent: 200, minimumHealthyPercent: 0, };

        const vpc = args.cluster.vpc;
        args.loadBalaner.addListener(`Listener_${args.config.port}`, {
            port: args.config.port, protocol: Protocol.TCP,
            defaultAction: NetworkListenerAction.forward([new NetworkTargetGroup(scope, 'TargetGroup', {
                vpc, port: args.config.port, targetType: TargetType.IP,
                targets: [service],
                preserveClientIp: false, crossZoneEnabled: true,
                healthCheck: {
                    healthyThresholdCount: 2, unhealthyThresholdCount: 2,
                    interval: Duration.seconds(10), timeout: Duration.seconds(5),
                },
                deregistrationDelay: Duration.seconds(0),
            })])
        });

        return service;
    }
}