import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as triggers from 'aws-cdk-lib/triggers'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as path from 'path'

interface ProductServiceStackProps extends cdk.StackProps {
  notificationEmail: string;
}

export class ProductServiceStack extends cdk.Stack {
  // Expose queue ARN/URL so Import Service stack can reference them
  public readonly catalogItemsQueueArn: string;
  public readonly catalogItemsQueueUrl: string;

  constructor(scope: Construct, id: string, props: ProductServiceStackProps) {
    super(scope, id, props)

    const productsTable = dynamodb.Table.fromTableName(
      this,
      "ProductsTable",
      "products"
    );

    const stockTable = dynamodb.Table.fromTableName(
      this,
      "StocksTable",
      "stock"   // ← note: your actual table is named "stock" not "stocks"
    );

    const sharedLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
    }

    const productsLambda = new NodejsFunction(this, 'ProductsLambda', {
      ...sharedLambdaProps,
      entry: 'lambda/products.ts',
      handler: 'handler',
      description: 'Lambda function for products operations',
      environment: {
        PRODUCTS_TABLE_NAME: productsTable.tableName,
        STOCK_TABLE_NAME: stockTable.tableName,
      },
    })

    const stockLambda = new NodejsFunction(this, 'StockLambda', {
      ...sharedLambdaProps,
      entry: 'lambda/stock.ts',
      handler: 'handler',
      description: 'Lambda function for stock operations',
      environment: {
        STOCK_TABLE_NAME: stockTable.tableName,
      },
    })

    productsTable.grantReadWriteData(productsLambda)
    productsTable.grantReadData(stockLambda)
    stockTable.grantReadWriteData(productsLambda)
    stockTable.grantReadWriteData(stockLambda)

    const seedLambda = new NodejsFunction(this, 'SeedLambda', {
      ...sharedLambdaProps,
      entry: 'lambda/seed.ts',
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      environment: {
        PRODUCTS_TABLE_NAME: productsTable.tableName,
        STOCK_TABLE_NAME: stockTable.tableName,
      },
    })

    productsTable.grantReadWriteData(seedLambda)
    stockTable.grantReadWriteData(seedLambda)

    new triggers.Trigger(this, 'SeedTrigger', {
      handler: seedLambda,
      executeAfter: [productsTable, stockTable],
      invocationType: triggers.InvocationType.REQUEST_RESPONSE,
    })

    const api = new apigateway.RestApi(this, 'product-api', {
      restApiName: 'Product Service API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    })

    const productsIntegration = new apigateway.LambdaIntegration(productsLambda)
    const stockIntegration = new apigateway.LambdaIntegration(stockLambda)

    // /products        → GET (list), POST (create)
    // /products/{id}   → GET (single)
    const productsResource = api.root.addResource('products')
    productsResource.addMethod('GET', productsIntegration)
    productsResource.addMethod('POST', productsIntegration)

    const productByIdResource = productsResource.addResource('{id}')
    productByIdResource.addMethod('GET', productsIntegration)

    // /stocks              → GET (list), POST (create/update)
    // /stocks/{product_id} → GET (single)
    const stockResource = api.root.addResource('stocks')
    stockResource.addMethod('GET', stockIntegration)
    stockResource.addMethod('POST', stockIntegration)

    const stockByProductIdResource = stockResource.addResource('{product_id}')
    stockByProductIdResource.addMethod('GET', stockIntegration)

    // ─── Task 6.1: SQS Queue ─────────────────────────────────────────────────

    const catalogItemsQueue = new sqs.Queue(this, 'CatalogItemsQueue', {
      queueName: 'catalogItemsQueue',
      deadLetterQueue: {
        queue: new sqs.Queue(this, 'CatalogItemsDLQ', {
          queueName: 'catalogItemsQueue-dlq',
          retentionPeriod: cdk.Duration.days(14),
        }),
        maxReceiveCount: 3,
      },
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(4),
    })

    this.catalogItemsQueueArn = catalogItemsQueue.queueArn
    this.catalogItemsQueueUrl = catalogItemsQueue.queueUrl

    // ─── Task 6.3: SNS Topic + Email Subscription ─────────────────────────────

    const createProductTopic = new sns.Topic(this, 'CreateProductTopic', {
      topicName: 'createProductTopic',
      displayName: 'Product Service — Product Creation Notifications',
    })

    createProductTopic.addSubscription(
      new snsSubscriptions.EmailSubscription(props.notificationEmail, {
        filterPolicy: {
          productCount: sns.SubscriptionFilter.numericFilter({
            greaterThan: 0,
          }),
        },
      })
    )

    // ─── Task 6.1: catalogBatchProcess Lambda ─────────────────────────────────

    const catalogBatchProcess = new NodejsFunction(this, 'CatalogBatchProcess', {
      ...sharedLambdaProps,
      entry: path.join(__dirname, '../functions/catalogBatchProcess.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      environment: {
        PRODUCTS_TABLE_NAME: productsTable.tableName,
        STOCKS_TABLE_NAME: stockTable.tableName,
        CREATE_PRODUCT_TOPIC_ARN: createProductTopic.topicArn,
      },
    })

    catalogBatchProcess.addEventSource(
      new lambdaEventSources.SqsEventSource(catalogItemsQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(10),
        reportBatchItemFailures: true,
      })
    )

    productsTable.grantWriteData(catalogBatchProcess)
    stockTable.grantWriteData(catalogBatchProcess)
    createProductTopic.grantPublish(catalogBatchProcess)

    // ─── Outputs ──────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url ?? '',
      description: 'Base URL for the Product Service API',
    })

    new cdk.CfnOutput(this, 'ProductsTableName', {
      value: productsTable.tableName,
    })

    new cdk.CfnOutput(this, 'StockTableName', {
      value: stockTable.tableName,
    })

    new cdk.CfnOutput(this, 'CatalogItemsQueueArn', {
      value: catalogItemsQueue.queueArn,
      exportName: 'CatalogItemsQueueArn',
      description: 'SQS queue ARN for Import Service to send CSV records into',
    })

    new cdk.CfnOutput(this, 'CatalogItemsQueueUrl', {
      value: catalogItemsQueue.queueUrl,
      exportName: 'CatalogItemsQueueUrl',
    })

    new cdk.CfnOutput(this, 'CreateProductTopicArn', {
      value: createProductTopic.topicArn,
      exportName: 'CreateProductTopicArn',
    })
  }
}