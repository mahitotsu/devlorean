import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { IVpc, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerImage, CpuArchitecture, FargateService, FargateTaskDefinition } from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, IApplicationLoadBalancer, ListenerCondition, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { LambdaTarget } from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

interface ServiceStackProps extends StackProps {
    vpc: IVpc;
}

export class ServiceStack extends Stack {
    constructor(scope: Construct, id: string, props: ServiceStackProps) {
        super(scope, id, props);

        const privateSubnets = props.vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS }).subnets;
        const vpc = Vpc.fromVpcAttributes(this, 'Vpc', {
            vpcId: props.vpc.vpcId,
            availabilityZones: props.vpc.availabilityZones,
            privateSubnetIds: privateSubnets.map(subnet => subnet.subnetId),
            privateSubnetRouteTableIds: privateSubnets.map(subnet => subnet.routeTable.routeTableId),
        });
        const loadBalancer = new ApplicationLoadBalancer(vpc, 'Endpoint', {
            vpc,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            internetFacing: false,
        });

        const cluster = new Cluster(this, 'ServiceCluster', { vpc, });
        const serviceHealthCheck = new NodejsFunction(this, 'ServiceHealthCheck', {
            runtime: Runtime.NODEJS_20_X,
            architecture: Architecture.ARM_64,
            entry: `${__dirname}/functions/ServiceHealthCheck.ts`,
        });

        const listenerPort = 80;
        const containerPort = 3000;
        const protocol = ApplicationProtocol.HTTP;

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

        const listener = loadBalancer.addListener('Listener', {
            port: listenerPort, protocol,
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
                vpc,
                port: containerPort, protocol,
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

        this._endpoint = loadBalancer;
    }

    private _endpoint: IApplicationLoadBalancer;

    get endpoint() { return this._endpoint; }
}