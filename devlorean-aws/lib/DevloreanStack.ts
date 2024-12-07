import { Stack, StackProps } from "aws-cdk-lib";
import { IpAddresses, IpProtocol, Ipv6Addresses, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";

export class DevloreanStack extends Stack {
    constructor(scope: any, id: string, props: StackProps) {
        super(scope, id, props);

        const vpc = new Vpc(this, 'Vpc', {
            maxAzs: 2, createInternetGateway: true, natGateways: 2,
            ipProtocol: IpProtocol.DUAL_STACK,
            ipAddresses: IpAddresses.cidr('10.0.0.0/24'), ipv6Addresses: Ipv6Addresses.amazonProvided(),
            subnetConfiguration: [{
                name: 'Public', subnetType: SubnetType.PUBLIC, cidrMask: 27,
            }, {
                name: 'Private', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 26,
            }, {
                name: 'Isolated', subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 27,
            }]
        });
    }
}