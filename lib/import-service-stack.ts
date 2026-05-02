import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as s3 from 'aws-cdk-lib/aws-s3'

export class ImportServiceStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)
        const importBucket = new s3.Bucket(this, 'ImportBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            cors: [
                {
                    allowedOrigins: ['*'],
                    allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT, s3.HttpMethods.DELETE, s3.HttpMethods.HEAD],
                    allowedHeaders: ['*'],
                },
            ],
        });
        const sharedLambdaProps = {
            runtime: lambda.Runtime.NODEJS_22_X,
            memorySize: 512,
            timeout: cdk.Duration.seconds(10),
        }

        const importLambda = new NodejsFunction(this, 'ImportLambda', {
            ...sharedLambdaProps,
            entry: 'lambda/import.ts',
            handler: 'handler',
            environment: {
                IMPORT_BUCKET_NAME: importBucket.bucketName,
            },
        });

        importBucket.grantReadWrite(importLambda);

        const api = new apigateway.RestApi(this, 'import-api', {
            restApiName: 'Import Service API',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
            },
        })

        const importIntegration = new apigateway.LambdaIntegration(importLambda)

        const importResource = api.root.addResource('import')
        importResource.addMethod('GET', importIntegration)
        importResource.addMethod('POST', importIntegration)

        const importByIdResource = importResource.addResource('{id}')
        importByIdResource.addMethod('GET', importIntegration)

        // ─── Outputs ──────────────────────────────────────────────────────────────

        new cdk.CfnOutput(this, 'ImportApiUrl', {
            value: api.url ?? '',
            description: 'Base URL for the Import Service API',
        })

        new cdk.CfnOutput(this, 'ImportBucketName', {
            value: importBucket.bucketName,
        })
    }
}