import { Stack, StackProps } from "aws-cdk-lib";
import { IpAddresses, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

interface VpcStackProps extends StackProps {
    vpcCidr: string;
}

export class VpcStack extends Stack {
    constructor(scope: Construct, id: string, props: VpcStackProps) {
        super(scope, id, props);

        const vpc = new Vpc(this, 'Vpc', {
            ipAddresses: IpAddresses.cidr(props.vpcCidr),
            subnetConfiguration: [
                { subnetType: SubnetType.PUBLIC, name: 'Public', cidrMask: 20, },
                { subnetType: SubnetType.PRIVATE_WITH_EGRESS, name: 'Private', cidrMask: 18, },
            ],
            createInternetGateway: true,
            natGatewaySubnets: { subnetType: SubnetType.PUBLIC }
        });
    }
}