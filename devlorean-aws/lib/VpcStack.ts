import { Stack, StackProps } from "aws-cdk-lib";
import { IpAddresses, IVpc, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
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

        this._vpc = vpc;
    }

    private _vpc: IVpc;

    get vpc() { return this._vpc; }
}