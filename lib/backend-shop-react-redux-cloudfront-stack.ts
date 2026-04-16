import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'

export class ProductServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const honoLambda = new NodejsFunction(this, 'hono-api', {
      entry: 'lambda/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
    })

    const api = new apigateway.LambdaRestApi(this, 'product-api', {
      handler: honoLambda,
      proxy: true, // 🔥 critical
    })

    new cdk.CfnOutput(this, 'apiUrl', {
      value: api.url ?? '',
    })
  }
}