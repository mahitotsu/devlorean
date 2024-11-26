import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { ApplicationLoadBalancer, ApplicationProtocol, ApplicationTargetGroup, IApplicationLoadBalancer, TargetType } from "aws-cdk-lib/aws-elasticloadbalancingv2";
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
        });

        const serviceHealthCheck = new NodejsFunction(this, 'ServiceHealthCheck', {
            runtime: Runtime.NODEJS_20_X,
            architecture: Architecture.ARM_64,
            entry: `${__dirname}/functions/ServiceHealthCheck.ts`,
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
    }
}