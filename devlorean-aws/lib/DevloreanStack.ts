import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { IpAddresses, IpProtocol, Ipv6Addresses, Peer, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerImage, FargateService, FargateTaskDefinition } from "aws-cdk-lib/aws-ecs";
import { IpAddressType, NetworkLoadBalancer, NetworkTargetGroup, Protocol } from "aws-cdk-lib/aws-elasticloadbalancingv2";

export class DevloreanStack extends Stack {
    constructor(scope: any, id: string, props: StackProps) {
        super(scope, id, props);

        const webServerPort = 3001;
        const listenerPort = 80;

        const vpc = new Vpc(this, 'Vpc', {
            createInternetGateway: true,
            maxAzs: 2, natGateways: 2,
            ipProtocol: IpProtocol.DUAL_STACK,
            ipAddresses: IpAddresses.cidr('10.0.0.0/24'),
            ipv6Addresses: Ipv6Addresses.amazonProvided(),
            subnetConfiguration: [{
                name: 'public', subnetType: SubnetType.PUBLIC,
                cidrMask: 28, ipv6AssignAddressOnCreation: true,
            }, {
                name: 'private', subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                cidrMask: 26, ipv6AssignAddressOnCreation: true,
            }],
        });

        const lbSg = new SecurityGroup(this, 'LoadBalancerSecurityGroup', {
            vpc, allowAllOutbound: false, allowAllIpv6Outbound: false,
        });
        const lb = new NetworkLoadBalancer(vpc, 'NetworkLoadBalancer', {
            internetFacing: true,
            vpc, vpcSubnets: { subnetType: SubnetType.PUBLIC },
            ipAddressType: IpAddressType.DUAL_STACK,
            securityGroups: [lbSg],
        });
        const listener = lb.addListener('Listener', {
            port: listenerPort, protocol: Protocol.TCP,
        });
        lb.connections.allowFrom(Peer.anyIpv4(), Port.tcp(listenerPort));
        lb.connections.allowFrom(Peer.anyIpv6(), Port.tcp(listenerPort));

        const serviceCluster = new Cluster(vpc, 'ServiceCluster', { vpc, });

        const webServerTaskDefinition = new FargateTaskDefinition(this, 'WebServerTaskDefinition', {
            cpu: 256, memoryLimitMiB: 512,
        });
        webServerTaskDefinition.addContainer('WebServerContainer', {
            image: ContainerImage.fromAsset(`${__dirname}/../../devlorean-web`, {
                buildArgs: { port: webServerPort.toString(), }
            }),
            portMappings: [{ containerPort: webServerPort }]
        });
        const webServerService = new FargateService(serviceCluster, 'WebServerService', {
            taskDefinition: webServerTaskDefinition,
            cluster: serviceCluster, vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
            assignPublicIp: false,
            desiredCount: 1,
        });
        const webServerTargetGroup = new NetworkTargetGroup(vpc, 'WebServerTargetGroup', {
            vpc, port: webServerPort,
            targets: [webServerService],
            healthCheck: {
                enabled: true,
                port: webServerPort.toString(), protocol: Protocol.TCP,
                healthyThresholdCount: 2, unhealthyThresholdCount: 2,
                timeout: Duration.seconds(2), interval: Duration.seconds(10),
            },
            deregistrationDelay: Duration.seconds(0),
        });
        listener.addTargetGroups('WebServerTargetGroup', webServerTargetGroup);
        webServerService.connections.allowFrom(lbSg, Port.tcp(webServerPort));

        new CfnOutput(this, 'EntryPointURL', { value: `http://${lb.loadBalancerDnsName}:${listenerPort}` });
    }
}