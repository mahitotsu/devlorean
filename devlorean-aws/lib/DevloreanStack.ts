import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { GatewayVpcEndpointAwsService, IpAddresses, IpProtocol, Peer, Port, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
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
            ipProtocol: IpProtocol.IPV4_ONLY,
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

        const backTaskDefinition = new FargateTaskDefinition(serviceCluster, 'BackTaskDefinition', {
            runtimePlatform: { cpuArchitecture: CpuArchitecture.X86_64 },
            cpu: 1024, memoryLimitMiB: 2048,
        });
        backTaskDefinition.addContainer('main', {
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-api`),
            portMappings: [{ name: 'main', containerPort: 8080 }],
            logging: LogDriver.awsLogs({ streamPrefix: 'back' }),
            healthCheck: {
                command: ["CMD", "curl", "-f", "http://localhost:8080/actuator/health"],
                startPeriod: Duration.seconds(10),
                timeout: Duration.seconds(2),
                interval: Duration.seconds(10),
                retries: 5,
            },
        });
        const backService = new FargateService(backTaskDefinition, 'BackService', {
            cluster: serviceCluster, vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            taskDefinition: backTaskDefinition,
            desiredCount: 1,
            assignPublicIp: false,
            serviceName: backServiceName,
            serviceConnectConfiguration: {
                logDriver: LogDriver.awsLogs({ streamPrefix: 'back-traffic' }),
                services: [{ portMappingName: 'main', discoveryName: backServiceName }],
            },
        });
        backService.connections.allowFrom(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(8080));

        const frontTaskDefinition = new FargateTaskDefinition(serviceCluster, 'FrontTaskDefinition', {
            runtimePlatform: { cpuArchitecture: CpuArchitecture.X86_64 },
            cpu: 512, memoryLimitMiB: 1024,
        });
        frontTaskDefinition.addContainer('main', {
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-web`, { file: 'Dockerfile.server' }),
            portMappings: [{ name: 'main', containerPort: 3000 }],
            environment: {
                NUXT_BACKEND_BASEURL: `http://${backServiceName}.${serviceNamespace}:${8080}`
            },
            logging: LogDriver.awsLogs({ streamPrefix: 'front' }),
            healthCheck: {
                command: ["CMD", "nc", "-z", "localhost", "3000"],
                startPeriod: Duration.seconds(10),
                timeout: Duration.seconds(2),
                interval: Duration.seconds(10),
                retries: 5,
            },
        });
        const frontService = new FargateService(frontTaskDefinition, 'FrontService', {
            cluster: serviceCluster, vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            taskDefinition: frontTaskDefinition,
            desiredCount: 1,
            assignPublicIp: false,
            serviceName: frontServiceName,
            serviceConnectConfiguration: {
                logDriver: LogDriver.awsLogs({ streamPrefix: 'front-traffic' }),
                services: [{ portMappingName: 'main', discoveryName: frontServiceName }],
            }
        });
        frontService.connections.allowFrom(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(3000));

        const gatewayTaskDefinition = new FargateTaskDefinition(serviceCluster, 'GatewayTaskDefinition', {
            runtimePlatform: { cpuArchitecture: CpuArchitecture.X86_64 },
            cpu: 512, memoryLimitMiB: 1024,
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
            desiredCount: 1,
            assignPublicIp: false,
            serviceName: gatewayServiceName,
            serviceConnectConfiguration: {
                logDriver: LogDriver.awsLogs({ streamPrefix: 'gateway-traffic' }),
            }
        });
        gatewayService.connections.allowFrom(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(8080));
        staticContents.grantRead(gatewayService.taskDefinition.taskRole);

        const lb = new NetworkLoadBalancer(vpc, 'LoadBalancer', {
            vpc,
            vpcSubnets: { subnetType: SubnetType.PUBLIC },
            internetFacing: true,
        });
        const gatewayTargetGroup = new NetworkTargetGroup(gatewayTaskDefinition, 'TargetGroup', {
            port: 8080, protocol: Protocol.TCP,
            targets: [gatewayService],
            vpc,
            preserveClientIp: false,
            deregistrationDelay: Duration.millis(0),
            healthCheck: {
                interval: Duration.seconds(5),
                timeout: Duration.seconds(2),
                healthyThresholdCount: 3,
                unhealthyThresholdCount: 2
            }
        });
        lb.addListener('Listener', {
            port: listnerPort, protocol: Protocol.TCP,
            defaultAction: NetworkListenerAction.forward([gatewayTargetGroup]),
        });
        lb.connections.allowFromAnyIpv4(Port.tcp(listnerPort));

        new CfnOutput(this, 'EndpointUrl', { value: `http://${lb.loadBalancerDnsName}:${listnerPort}` });
    }
}