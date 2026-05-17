#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ProductServiceStack } from "../lib/backend-shop-react-redux-cloudfront-stack";
import { ImportServiceStack } from "../lib/import-service-stack";
import { AuthorizationServiceStack } from "../lib/authorization-service-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

// ─── 1. Authorization Service — User Pool + basicAuthorizer lambda ────────────
const authService = new AuthorizationServiceStack(app, "AuthorizationServiceStack", {
  env,
});

// ─── 2. Product Service — SQS + SNS + catalogBatchProcess ────────────────────
const productService = new ProductServiceStack(app, "ProductServiceStack", {
  env,
  notificationEmail: process.env.NOTIFICATION_EMAIL ?? "you@example.com",
});

// ─── 3. Import Service — consumes auth + queue from above stacks ──────────────
new ImportServiceStack(app, "ImportServiceStack", {
  env,
  catalogItemsQueueArn: productService.catalogItemsQueueArn,
  catalogItemsQueueUrl: productService.catalogItemsQueueUrl,
  basicAuthorizerFn: authService.basicAuthorizerFn,
  userPool: authService.userPool,
  userPoolClient: authService.userPoolClient,
});