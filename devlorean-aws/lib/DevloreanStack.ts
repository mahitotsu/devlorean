import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { GatewayVpcEndpointAwsService, IpAddresses, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerImage, CpuArchitecture, FargateService, FargateTaskDefinition, LogDriver } from "aws-cdk-lib/aws-ecs";
import { NetworkListenerAction, NetworkLoadBalancer, NetworkTargetGroup, Protocol } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { NamespaceType } from "aws-cdk-lib/aws-servicediscovery";
import { Construct } from "constructs";

export class DevloreanStack extends Stack {
    constructor(scope: Construct, id: string, props: StackProps) {
        super(scope, id, props);

        const listnerPort = 80;
        const serviceNamespace = 'devlorean.local';
        const staticContrentsName = `static-${props.env?.account}`;
        const frontServiceName = 'front';
        const backServiceName = 'back';
        const gatewayServiceName = 'gateway';

        const vpc = new Vpc(this, 'Vpc', {
            ipAddresses: IpAddresses.cidr('10.0.0.0/16'),
            createInternetGateway: true,
            subnetConfiguration: [
                { name: 'Public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
                { name: 'Private', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
                { name: 'Isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 22 },
            ],
            natGateways: 3,
        });
        vpc.addGatewayEndpoint('StaticContentsEndpoint', {
            service: GatewayVpcEndpointAwsService.S3,
            subnets: [{ subnetType: SubnetType.PRIVATE_WITH_EGRESS }],
        });

        const serviceCluster = new Cluster(vpc, 'ServiceCluster', {
            vpc,
            defaultCloudMapNamespace: {
                name: serviceNamespace,
                type: NamespaceType.DNS_PRIVATE,
                useForServiceConnect: true,
            }
        });

        const staticContents = new Bucket(this, 'StaticContents', {
            publicReadAccess: false,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
        new BucketDeployment(staticContents, 'Deployer', {
            destinationBucket: staticContents,
            destinationKeyPrefix: '',
            sources: [Source.asset(`${__dirname}/../../devlorean-web/.output/public`)],
        });

        const frontTaskDefinition = new FargateTaskDefinition(serviceCluster, 'FrontTaskDefinition', {
            runtimePlatform: { cpuArchitecture: CpuArchitecture.X86_64 },
            cpu: 1024, memoryLimitMiB: 512,
        });
        frontTaskDefinition.addContainer('main', {
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-web`, { file: 'Dockerfile.server' }),
            portMappings: [{ name: 'main', containerPort: 3000 }],
            logging: LogDriver.awsLogs({ streamPrefix: 'front' })
        });
        const frontService = new FargateService(frontTaskDefinition, 'FrontService', {
            cluster: serviceCluster, vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            taskDefinition: frontTaskDefinition,
            assignPublicIp: false,
            serviceName: frontServiceName,
            serviceConnectConfiguration: {
                namespace: serviceNamespace,
                services: [{ portMappingName: 'main' }],
                logDriver: LogDriver.awsLogs({ streamPrefix: 'front-traffic' }),
            }
        });

        const gatewayTaskDefinition = new FargateTaskDefinition(serviceCluster, 'GatewayTaskDefinition', {
            runtimePlatform: { cpuArchitecture: CpuArchitecture.X86_64 },
            cpu: 1024, memoryLimitMiB: 512,
        });
        gatewayTaskDefinition.addContainer('main', {
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-gw`, {
                buildArgs: {
                    public_cluster_hostname: `${staticContrentsName}.s3-${props.env?.region}.amazonaws.com`,
                    server_cluster_hostname: `${frontServiceName}.${serviceNamespace}`,
                },
            }),
            portMappings: [{ name: 'main', containerPort: 8080 }],
            logging: LogDriver.awsLogs({ streamPrefix: 'gateway' }),
        });
        const gatewayService = new FargateService(gatewayTaskDefinition, 'GatewayService', {
            cluster: serviceCluster, vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            taskDefinition: gatewayTaskDefinition,
            assignPublicIp: false,
            serviceName: gatewayServiceName,
            serviceConnectConfiguration: {
                namespace: serviceNamespace,
                logDriver: LogDriver.awsLogs({ streamPrefix: 'gateway-traffic' }),
            }
        });
        staticContents.grantRead(gatewayService.taskDefinition.taskRole);
        const gatewayTargetGroup = new NetworkTargetGroup(gatewayTaskDefinition, 'TargetGroup', {
            port: 8080, protocol: Protocol.TCP,
            targets: [gatewayService],
            vpc,
        });

        const lb = new NetworkLoadBalancer(vpc, 'LoadBalancer', {
            vpc,
            vpcSubnets: { subnetType: SubnetType.PUBLIC },
            internetFacing: false,
        });
        lb.addListener('Listener', {
            port: listnerPort, protocol: Protocol.TCP,
            defaultAction: NetworkListenerAction.forward([gatewayTargetGroup]),
        });
    }
}