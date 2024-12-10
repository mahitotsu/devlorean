import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";

export class RegionalWebStack extends Stack {
    constructor(scope: any, id: string, props: StackProps) {
        super(scope, id, props);

        const contentsBucket = new Bucket(this, 'ContentsBucket', {
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            publicReadAccess: false,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        });
        new BucketDeployment(contentsBucket, 'Deployer', {
            destinationBucket: contentsBucket,
            destinationKeyPrefix: '',
            sources: [Source.asset(`${__dirname}/../../devlorean-web/.output/public`)],
            memoryLimit: 1024,
        });
    }
}