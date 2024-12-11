import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { GatewayVpcEndpointAwsService, IpAddresses, IpProtocol, Ipv6Addresses, Peer, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { CfnService, Cluster, ContainerImage, FargateService, FargateTaskDefinition, ICluster } from "aws-cdk-lib/aws-ecs";
import { NetworkListenerAction, NetworkLoadBalancer, NetworkTargetGroup, Protocol, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2";
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

        const serviceNamespace = 'service.local';
        const sgwDiscoveryName = 'sgw';

        const vpc = new Vpc(this, 'Vpc', {
            ipProtocol: IpProtocol.DUAL_STACK,
            ipAddresses: IpAddresses.cidr('10.0.0.0/16'), ipv6Addresses: Ipv6Addresses.amazonProvided(),
            maxAzs: 2, createInternetGateway: true, natGateways: 1,
            subnetConfiguration: [
                { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 19 },
                { name: 'private', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 18 },
                { name: 'isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 19 },
            ],
        });
        const s3Vpce = vpc.addGatewayEndpoint('S3Endpoint', {
            service: GatewayVpcEndpointAwsService.S3, subnets: [{ subnetType: SubnetType.PRIVATE_WITH_EGRESS }]
        });

        const serviceCluster = new Cluster(vpc, 'ServiceCluster', {
            vpc, defaultCloudMapNamespace: { name: serviceNamespace, },
        });

        const sgwService = this.createService({
            name: sgwDiscoveryName, cluster: serviceCluster,
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-sgw`),
            cpu: 256, memoryLimitMiB: 512, containerPort: 10000,
            environment: { BUCKET_NAME: contentsBucket.bucketDomainName, },
            desiredCount: 1,
        });

        const nlbSg = new SecurityGroup(vpc, 'LbSG', { vpc });
        const nlb = new NetworkLoadBalancer(vpc, 'LoadBalancer', {
            vpc, vpcSubnets: { subnetType: SubnetType.PUBLIC },
            internetFacing: true, securityGroups: [nlbSg],
        });
        nlb.addListener('SgwListener', {
            port: 80, protocol: Protocol.TCP,
            defaultAction: NetworkListenerAction.forward([new NetworkTargetGroup(nlb, 'TargetGroup', {
                vpc, port: 10000, targetType: TargetType.IP,
                targets: [sgwService],
                preserveClientIp: false, crossZoneEnabled: true,
                healthCheck: {
                    healthyThresholdCount: 2, unhealthyThresholdCount: 2,
                    interval: Duration.seconds(10), timeout: Duration.seconds(5),
                },
                deregistrationDelay: Duration.seconds(0),
            })])
        });

        nlb.connections.allowFrom(Peer.anyIpv4(), Port.tcp(80));
        sgwService.connections.allowFrom(nlb, Port.tcp(10000));

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
        image: ContainerImage;
        cpu: number;
        memoryLimitMiB: number;
        containerPort: number;
        environment?: { [key: string]: string };
        desiredCount: number;
    }) {
        const scope = new Construct(args.cluster, args.name);

        const taskDefinition = new FargateTaskDefinition(scope, 'TaskDefinition', {
            cpu: args.cpu, memoryLimitMiB: args.memoryLimitMiB,
        });
        taskDefinition.addContainer('Container', {
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-sgw`),
            environment: args.environment,
            portMappings: [{ containerPort: args.containerPort, name: args.name },],
        });

        const service = new FargateService(scope, 'Service', {
            cluster: args.cluster, taskDefinition,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS, },
            desiredCount: args.desiredCount,
            serviceConnectConfiguration: {
                services: [{ portMappingName: args.name, }],
            },
        });
        service.node.addDependency(args.cluster.defaultCloudMapNamespace!);

        const cfnService = service.node.defaultChild as CfnService;
        cfnService.deploymentConfiguration = { maximumPercent: 200, minimumHealthyPercent: 0, };

        return service;
    }
}