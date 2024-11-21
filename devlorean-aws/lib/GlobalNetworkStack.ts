import { Stack, StackProps } from "aws-cdk-lib";
import { IApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Accelerator } from "aws-cdk-lib/aws-globalaccelerator";
import { ApplicationLoadBalancerEndpoint } from "aws-cdk-lib/aws-globalaccelerator-endpoints";
import { Construct } from "constructs";

interface GlobalNetworkStackProps extends StackProps {
    loadBalancers: IApplicationLoadBalancer[];
    listenerPort: number;
}

export class GlobalNetworkStack extends Stack {

    constructor(scope: Construct, id: string, props: GlobalNetworkStackProps) {
        super(scope, id, props);

        const globalEndpoint = new Accelerator(this, 'GlobalEndpoint', {});
        const listener = globalEndpoint.addListener('Listener', { portRanges: [{ fromPort: props.listenerPort },] });

        props.loadBalancers
            .map((loadBalancer, index) => new ApplicationLoadBalancerEndpoint(loadBalancer))
            .forEach((endpoint, index) => listener.addEndpointGroup(`Endpoint${index}`, { endpoints: [endpoint] }));
    }
}