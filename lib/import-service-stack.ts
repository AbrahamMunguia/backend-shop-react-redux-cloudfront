import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3n from 'aws-cdk-lib/aws-s3-notifications'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as iam from 'aws-cdk-lib/aws-iam'

// Task 6.2: accept queue references from Product Service stack
interface ImportServiceStackProps extends cdk.StackProps {
    catalogItemsQueueArn: string
    catalogItemsQueueUrl: string
}

export class ImportServiceStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: ImportServiceStackProps) {
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

        // Task 6.2: reference the SQS queue from Product Service
        const catalogItemsQueue = sqs.Queue.fromQueueAttributes(
            this,
            'CatalogItemsQueue',
            {
                queueArn: props.catalogItemsQueueArn,
                queueUrl: props.catalogItemsQueueUrl,
            }
        )

        const sharedLambdaProps = {
            runtime: lambda.Runtime.NODEJS_22_X,
            memorySize: 512,
            timeout: cdk.Duration.seconds(10),
        }

        // ─── importProductsFile Lambda ────────────────────────────────────────────

        const importProductsFile = new NodejsFunction(this, 'importProductsFile', {
            ...sharedLambdaProps,
            entry: 'lambda/import.ts',
            handler: 'handler',
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

        // ─── importFileParser Lambda ──────────────────────────────────────────────

        const importFileParser = new NodejsFunction(this, 'importFileParser', {
            ...sharedLambdaProps,
            entry: 'lambda/file-parser.ts',
            handler: 'handler',
            timeout: cdk.Duration.seconds(60),
            environment: {
                // Task 6.2: queue URL so the lambda forwards each CSV record to SQS
                CATALOG_ITEMS_QUEUE_URL: catalogItemsQueue.queueUrl,
            },
        })

        importBucket.grantRead(importFileParser)

        // Task 6.2: allow importFileParser to send messages into the queue
        catalogItemsQueue.grantSendMessages(importFileParser)

        // ─── S3 Event Trigger: uploaded/* → importFileParser ──────────────────────

        importBucket.addEventNotification(
            s3.EventType.OBJECT_CREATED,
            new s3n.LambdaDestination(importFileParser),
            { prefix: 'uploaded/' }
        )

        // ─── API Gateway ──────────────────────────────────────────────────────────

        const api = new apigateway.RestApi(this, 'import-api', {
            restApiName: 'Import Service API',
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: [
                    'Content-Type',
                    'Authorization',
                    'X-Amz-Date',
                    'X-Api-Key',
                    'X-Amz-Security-Token',
                ],
            },
        })

        const importIntegration = new apigateway.LambdaIntegration(importProductsFile)

        const importResource = api.root.addResource('import')
        importResource.addMethod('POST', importIntegration)
        importResource.addMethod('GET', importIntegration, {
            requestParameters: {
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