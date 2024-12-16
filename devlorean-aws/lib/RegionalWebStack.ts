import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { GatewayVpcEndpointAwsService, IpAddresses, IpProtocol, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { CfnService, Cluster, ContainerImage, FargateService, FargateTaskDefinition, LogDriver } from "aws-cdk-lib/aws-ecs";
import { NetworkListenerAction, NetworkLoadBalancer, NetworkTargetGroup, Protocol, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Effect, PolicyStatement, StarPrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";

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

        const servicePort = 10000;
        const listenerPort = 80;

        const taskDefinition = new FargateTaskDefinition(this, 'TaskDefinition', {
            cpu: 1024, memoryLimitMiB: 2048,
        });
        taskDefinition.addContainer('sgw', {
            essential: true,
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-sgw`),
            portMappings: [{ containerPort: servicePort }],
            environment: {
                BUCKET_NAME: contentsBucket.bucketName,
                WEB_HOST: 'localhost'
            },
            healthCheck: {
                command: ['curl', '-f', 'http://localhost:9901/ready'],
                startPeriod: Duration.seconds(10),
                interval: Duration.seconds(5),
                timeout: Duration.seconds(2),
                retries: 5,
            },
            logging: LogDriver.awsLogs({
                streamPrefix: 'sgw',
                logGroup: new LogGroup(this, 'SgwLogGroup', {
                    removalPolicy: RemovalPolicy.DESTROY,
                    retention: RetentionDays.ONE_DAY,
                })
            })
        });
        taskDefinition.addContainer('web', {
            essential: true,
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-web`),
            healthCheck: {
                command: ['curl', '-f', 'http://localhost:3000/health'],
                startPeriod: Duration.seconds(10),
                interval: Duration.seconds(5),
                timeout: Duration.seconds(2),
                retries: 5,
            },
        });

        const nlbSg = new SecurityGroup(this, 'NlbSg', { vpc, allowAllOutbound: false });
        const serviceSg = new SecurityGroup(this, 'serviceSg', { vpc, allowAllOutbound: false });
        nlbSg.connections.allowFromAnyIpv4(Port.tcp(listenerPort));
        serviceSg.connections.allowFrom(nlbSg, Port.tcp(servicePort));
        serviceSg.connections.allowToAnyIpv4(Port.tcp(443));

        const cluster = new Cluster(vpc, 'Cluster', { vpc });
        const service = new FargateService(cluster, 'Service', {
            taskDefinition, cluster,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS }, securityGroups: [serviceSg],
            assignPublicIp: false,
            desiredCount: 1,
        });
        const cfnService = service.node.defaultChild as CfnService;
        cfnService.deploymentConfiguration = { minimumHealthyPercent: 0, maximumPercent: 200 };

        const targetGroup = new NetworkTargetGroup(service, 'TargetGroup', {
            targetType: TargetType.IP,
            port: servicePort, protocol: Protocol.TCP, vpc, preserveClientIp: false,
            targets: [service],
            healthCheck: {
                healthyThresholdCount: 2, unhealthyThresholdCount: 2,
                interval: Duration.seconds(5), timeout: Duration.seconds(2),
            },
            deregistrationDelay: Duration.seconds(0),
        });

        const nlb = new NetworkLoadBalancer(vpc, 'LoadBalancer', {
            vpc, vpcSubnets: { subnetType: SubnetType.PUBLIC },
            internetFacing: true,
            securityGroups: [nlbSg],
        });
        nlb.addListener('Listener', {
            port: listenerPort, protocol: Protocol.TCP,
            defaultAction: NetworkListenerAction.forward([targetGroup]),
        });

        contentsBucket.grantRead(taskDefinition.taskRole);
        contentsBucket.addToResourcePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            principals: [new StarPrincipal()],
            actions: ['s3:GetObject'],
            resources: [contentsBucket.arnForObjects('*')],
            conditions: {
                'StringEquals': {
                    'aws:SourceVpce': s3Vpce.vpcEndpointId,
                }
            },
        }));

        new CfnOutput(this, 'Endpoint', { value: `http://${nlb.loadBalancerDnsName}` });
    }
}