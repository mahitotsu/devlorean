import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { GatewayVpcEndpointAwsService, IpAddresses, IpProtocol, Ipv6Addresses, Peer, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { CfnService, Cluster, ContainerImage, FargateService, FargateTaskDefinition, HealthCheck, ICluster, LogDriver } from "aws-cdk-lib/aws-ecs";
import { INetworkLoadBalancer, NetworkListenerAction, NetworkLoadBalancer, NetworkTargetGroup, Protocol, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Effect, PolicyStatement, StarPrincipal } from "aws-cdk-lib/aws-iam";
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
            internetFacing: true, securityGroups: [nlbSg],
        });

        const serviceCluster = new Cluster(vpc, 'ServiceCluster', { vpc, });

        const sgwService = this.createService({
            name: 'Sgw', cluster: serviceCluster, nlb, listenerPort: 80,
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-sgw`),
            cpu: 512, memoryLimitMiB: 1024, containerPort: 10000,
            environment: {
                BUCKET_NAME: contentsBucket.bucketDomainName,
                WEB_HOST: `${nlb.loadBalancerDnsName}`,
                WEB_PORT: `${3000}`,
                // LOG_LEVEL: 'debug'
            },
            healthCheck: {
                command: ['CMD-SHELL', 'curl -sf http://localhost:9901/ready'],
                interval: Duration.seconds(10), timeout: Duration.seconds(5),
                retries: 5, startPeriod: Duration.seconds(10),
            },
            desiredCount: 1, 
        });
        const webServer = this.createService({
            name: 'Web', cluster: serviceCluster, nlb, listenerPort: 3000,
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-web`),
            cpu: 1024, memoryLimitMiB: 2048, containerPort: 3000,
            healthCheck: {
                command: ['CMD-SHELL', 'curl -sf http://localhost:3000/health'],
                interval: Duration.seconds(10), timeout: Duration.seconds(5),
                retries: 5, startPeriod: Duration.seconds(10),
            },
            desiredCount: 1, 
        });

        nlb.connections.allowFrom(Peer.anyIpv4(), Port.tcp(80));
        // nlb.connections.allowFrom(sgwService, Port.tcp(3000));
        nlb.connections.allowFrom(Peer.anyIpv4(), Port.tcp(3000));

        sgwService.connections.allowFrom(nlb, Port.tcp(10000));
        webServer.connections.allowFrom(nlb, Port.tcp(3000));

        contentsBucket.addToResourcePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            principals: [new StarPrincipal()],
            actions: ['s3:GetObject'],
            resources: [contentsBucket.arnForObjects('*')],
            conditions: { 'StringEquals': { 'aws:SourceVpce': s3Vpce.vpcEndpointId, } }
        }));
        contentsBucket.grantRead(sgwService.taskDefinition.taskRole);
    }

    createService(args: {
        name: string;
        cluster: ICluster;
        nlb: INetworkLoadBalancer;
        listenerPort: number;
        image: ContainerImage;
        cpu: number;
        memoryLimitMiB: number;
        containerPort: number;
        environment?: { [key: string]: string };
        healthCheck?: HealthCheck;
        desiredCount: number;
    }) {
        const scope = new Construct(args.cluster, args.name);

        const taskDefinition = new FargateTaskDefinition(scope, 'TaskDefinition', {
            cpu: args.cpu, memoryLimitMiB: args.memoryLimitMiB,
        });
        taskDefinition.addContainer('Container', {
            image: args.image,
            environment: args.environment,
            portMappings: [{ containerPort: args.containerPort },],
            healthCheck: args.healthCheck,
            logging: LogDriver.awsLogs({ streamPrefix: 'service' }),
        });

        const service = new FargateService(scope, 'Service', {
            cluster: args.cluster, taskDefinition,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS, },
            desiredCount: args.desiredCount,
            healthCheckGracePeriod: Duration.seconds(30),
        });

        const cfnService = service.node.defaultChild as CfnService;
        cfnService.deploymentConfiguration = { maximumPercent: 200, minimumHealthyPercent: 0, };

        args.nlb.addListener(`${args.name}Listener`, {
            port: args.listenerPort, protocol: Protocol.TCP,
            defaultAction: NetworkListenerAction.forward([new NetworkTargetGroup(scope, 'TargetGroup', {
                vpc: args.cluster.vpc, port: args.containerPort, targetType: TargetType.IP,
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