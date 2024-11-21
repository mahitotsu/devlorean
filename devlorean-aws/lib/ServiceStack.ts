import { Stack, StackProps } from "aws-cdk-lib";
import { ApplicationLoadBalancer, ApplicationProtocol, IApplicationLoadBalancer, ListenerAction } from "aws-cdk-lib/aws-elasticloadbalancingv2";
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

        const listener = loadBalancer.addListener('Listener', {
            port: props.listenerPort,
            protocol: props.protocol,
            defaultAction: ListenerAction.fixedResponse(404),
        });
    }
}