import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { Peer, Port, SubnetType } from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerImage, CpuArchitecture, FargateService, FargateTaskDefinition } from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, IApplicationLoadBalancer, ListenerCondition, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { LambdaTarget } from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

interface ServiceStackProps extends StackProps {
    loadBalancer: IApplicationLoadBalancer;
    listenerPort: number;
    protocol: ApplicationProtocol;
}

export class ServiceStack extends Stack {
    constructor(scope: Construct, id: string, props: ServiceStackProps) {
        super(scope, id, props);

        const loadBalancer = ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(this, 'LoadBalancer', {
            loadBalancerArn: props.loadBalancer.loadBalancerArn,
            securityGroupId: props.loadBalancer.connections.securityGroups[0].securityGroupId,
            vpc: props.loadBalancer.vpc,
        });
        const cluster = new Cluster(this, 'ServiceCluster', { vpc: loadBalancer.vpc, });

        const serviceHealthCheck = new NodejsFunction(this, 'ServiceHealthCheck', {
            runtime: Runtime.NODEJS_20_X,
            architecture: Architecture.ARM_64,
            entry: `${__dirname}/functions/ServiceHealthCheck.ts`,
        });

        const containerPort = 3000;
        const serviceWebTaskDefinition = new FargateTaskDefinition(this, 'ServiceWebTaskDefintiion', {
            cpu: 512, memoryLimitMiB: 1024,
            runtimePlatform: { cpuArchitecture: CpuArchitecture.X86_64 },
        });
        const serviceWebContainer = serviceWebTaskDefinition.addContainer('Web', {
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-web`, {
                assetName: `ContainerImage${Date.now()}`
            }),
            portMappings: [{ containerPort }],
        });
        const serviceWeb = new FargateService(cluster, 'ServiceWeb', {
            taskDefinition: serviceWebTaskDefinition,
            cluster,
            desiredCount: 1,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
        });
        cluster.vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS }).subnets.forEach(subnet => {
            loadBalancer.connections.allowTo(Peer.ipv4(subnet.ipv4CidrBlock), Port.tcp(containerPort));
        });

        const listener = loadBalancer.addListener('Listener', {
            port: props.listenerPort,
            protocol: props.protocol,
            defaultTargetGroups: [new ApplicationTargetGroup(serviceHealthCheck, 'TargetGroup', {
                targetType: TargetType.LAMBDA,
                targets: [new LambdaTarget(serviceHealthCheck)],
                healthCheck: {
                    enabled: true,
                    healthyHttpCodes: '200',
                    healthyThresholdCount: 2,
                    unhealthyThresholdCount: 2,
                    interval: Duration.seconds(10),
                    timeout: Duration.seconds(3),
                },
            })]
        });
        listener.addTargetGroups('Web', {
            priority: 100,
            conditions: [
                ListenerCondition.pathPatterns(['/*']),
            ],
            targetGroups: [new ApplicationTargetGroup(serviceWeb, 'TargetGroup', {
                targetType: TargetType.IP,
                vpc: cluster.vpc,
                port: serviceWebContainer.portMappings[0].containerPort,
                protocol: ApplicationProtocol.HTTP,
                targets: [serviceWeb],
                healthCheck: {
                    enabled: true,
                    path: '/',
                    healthyHttpCodes: '200',
                    healthyThresholdCount: 2,
                    unhealthyThresholdCount: 2,
                    interval: Duration.seconds(10),
                    timeout: Duration.seconds(3),
                },
                deregistrationDelay: Duration.seconds(0),
            })],
        });
    }
}