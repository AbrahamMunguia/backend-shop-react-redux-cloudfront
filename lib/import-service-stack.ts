import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as iam from 'aws-cdk-lib/aws-iam'

export class ImportServiceStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)

        // ─── S3 Bucket ────────────────────────────────────────────────────────────

        const importBucket = new s3.Bucket(this, 'ImportBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            cors: [
                {
                    allowedOrigins: ['*'],
                    allowedMethods: [
                        s3.HttpMethods.GET,
                        s3.HttpMethods.POST,
                        s3.HttpMethods.PUT,
                        s3.HttpMethods.DELETE,
                        s3.HttpMethods.HEAD,
                    ],
                    allowedHeaders: ['*'],
                },
            ],
        })

        // ─── Lambda ───────────────────────────────────────────────────────────────

        const importProductsFile = new NodejsFunction(this, 'importProductsFile', {
            runtime: lambda.Runtime.NODEJS_22_X,
            memorySize: 512,
            timeout: cdk.Duration.seconds(10),
            entry: 'lambda/import.ts',
            handler: 'handler',
            description: 'Lambda function for import operations',
            environment: {
                IMPORT_BUCKET_NAME: importBucket.bucketName,
            },
        })
        importBucket.grantReadWrite(importProductsFile)

        importProductsFile.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ['s3:PutObject'],
                resources: [importBucket.arnForObjects('uploaded/*')],
            })
        )

        // ─── API Gateway ──────────────────────────────────────────────────────────

        const api = new apigateway.RestApi(this, 'import-api', {
            restApiName: 'Import Service API',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
            },
        })

        const importIntegration = new apigateway.LambdaIntegration(importProductsFile)

        // GET /import?name={fileName}  →  returns signed S3 PUT URL
        const importResource = api.root.addResource('import')
        importResource.addMethod('POST', importIntegration)

        importResource.addMethod('GET', importIntegration, {
            requestParameters: {
                // Mark 'name' as a documented (but not enforced) query param
                'method.request.querystring.name': false,
            },
        })

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