import { Stack, StackProps } from "aws-cdk-lib";
import { IpAddresses, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { ApplicationLoadBalancer, IApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

interface VpcStackProps extends StackProps {
    vpcCidr: string;
}

export class VpcStack extends Stack {

    constructor(scope: Construct, id: string, props: VpcStackProps) {
        super(scope, id, props);

        const vpc = new Vpc(this, 'Vpc', {
            ipAddresses: IpAddresses.cidr(props.vpcCidr),
            createInternetGateway: true,
            subnetConfiguration: [
                { subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 18, name: 'Private' },
                { subnetType: SubnetType.PUBLIC, cidrMask: 20, name: 'Public' },
            ],
            natGatewaySubnets: { subnetType: SubnetType.PUBLIC },
            restrictDefaultSecurityGroup: false,
        });

        const alb = new ApplicationLoadBalancer(vpc, 'Endpoint', {
            vpc,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            internetFacing: false,
        });
        this._endpoint = alb;
    }

    private _endpoint: IApplicationLoadBalancer;

    get endpoint() { return this._endpoint; }
}