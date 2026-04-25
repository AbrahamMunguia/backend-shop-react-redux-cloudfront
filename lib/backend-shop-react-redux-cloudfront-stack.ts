import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'

export class ProductServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ─── DynamoDB Tables ──────────────────────────────────────────────────────

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

    // ─── Shared Lambda config ─────────────────────────────────────────────────

    const sharedLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
    }

    // ─── Lambda Functions ─────────────────────────────────────────────────────

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

    // ─── DynamoDB Permissions ─────────────────────────────────────────────────

    productsTable.grantReadWriteData(productsLambda)
    stockTable.grantReadWriteData(stockLambda)

    // ─── API Gateway ──────────────────────────────────────────────────────────

    const api = new apigateway.RestApi(this, 'product-api', {
      restApiName: 'Product Service API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    })

    const productsIntegration = new apigateway.LambdaIntegration(productsLambda)
    const stockIntegration = new apigateway.LambdaIntegration(stockLambda)

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