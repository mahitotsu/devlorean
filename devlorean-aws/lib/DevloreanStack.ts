import { Stack, StackProps } from "aws-cdk-lib";
import { IpAddresses, IpProtocol, Ipv6Addresses, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerImage, FargateService, FargateTaskDefinition, ICluster } from "aws-cdk-lib/aws-ecs";
import { NamespaceType } from "aws-cdk-lib/aws-servicediscovery";

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

        const cluster = new Cluster(vpc, 'Cluster', {
            vpc,
            defaultCloudMapNamespace: { name: 'devlorean.local', useForServiceConnect: true, type: NamespaceType.DNS_PRIVATE },
        });

        this.createFargateService('Web', cluster, 256, 512, `${__dirname}/../../devlorean-web`, 3000, 1);
        this.createFargateService('Api', cluster, 512, 1024, `${__dirname}/../../devlorean-api`, 9080, 1);
    }

    createFargateService(name: string, cluster: ICluster, cpu: number, memory: number, assetPath: string, port: number, desiredCount: number) {

        const taskDefinition = new FargateTaskDefinition(cluster, `${name}TaskDefinition`, {
            cpu, memoryLimitMiB: memory,
        });
        taskDefinition.addContainer(`${name}Container`, {
            image: ContainerImage.fromAsset(assetPath),
            portMappings: [{ containerPort: port, name: name.toLowerCase() }],
        });

        const service = new FargateService(cluster, `${name}Service`, {
            taskDefinition, cluster, assignPublicIp: false,
            vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            serviceConnectConfiguration: { services: [{ portMappingName: name.toLowerCase(), }] },
            desiredCount,
        });
        return service;
    }
}