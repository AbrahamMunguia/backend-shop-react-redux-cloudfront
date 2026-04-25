import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as triggers from 'aws-cdk-lib/triggers'

export class ProductServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const productsTable = new dynamodb.Table(this, 'ProductsTable', {
      tableName: 'products',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const stockTable = new dynamodb.Table(this, 'StockTable', {
      tableName: 'stock',
      partitionKey: { name: 'product_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const sharedLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
    }

    const productsLambda = new NodejsFunction(this, 'ProductsLambda', {
      ...sharedLambdaProps,
      entry: 'lambda/products.ts',
      handler: 'handler',
      environment: {
        PRODUCTS_TABLE_NAME: productsTable.tableName,
      },
    })

    const stockLambda = new NodejsFunction(this, 'StockLambda', {
      ...sharedLambdaProps,
      entry: 'lambda/stock.ts',
      handler: 'handler',
      environment: {
        STOCK_TABLE_NAME: stockTable.tableName,
      },
    })

    productsTable.grantReadWriteData(productsLambda)
    productsTable.grantReadData(stockLambda)
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
  }
}