import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3n from 'aws-cdk-lib/aws-s3-notifications'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as iam from 'aws-cdk-lib/aws-iam'

interface ImportServiceStackProps extends cdk.StackProps {
    catalogItemsQueueArn: string
    catalogItemsQueueUrl: string
    basicAuthorizerFn: lambda.IFunction
    userPool: cognito.IUserPool
    userPoolClient: cognito.IUserPoolClient
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
                CATALOG_ITEMS_QUEUE_URL: catalogItemsQueue.queueUrl,
            },
        })

        importBucket.grantRead(importFileParser)
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

        // ─── Cognito User Pool authorizer ────────────────────────────────────────
        //
        // Validates the Cognito JWT (id token or access token) passed in the
        // Authorization header. No lambda invocation needed — API Gateway validates
        // the token directly against the User Pool.

        const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(
            this,
            'CognitoAuthorizer',
            {
                cognitoUserPools: [props.userPool],
                authorizerName: 'CognitoAuthorizer',
                // Cache validated tokens for 5 minutes
                resultsCacheTtl: cdk.Duration.seconds(300),
                identitySource: apigateway.IdentitySource.header('Authorization'),
            }
        )

        const importIntegration = new apigateway.LambdaIntegration(importProductsFile)

        // ─── /import resource ─────────────────────────────────────────────────────

        const importResource = api.root.addResource('import')

        importResource.addMethod('POST', importIntegration, {
            authorizer: cognitoAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        })

        importResource.addMethod('GET', importIntegration, {
            authorizer: cognitoAuthorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
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