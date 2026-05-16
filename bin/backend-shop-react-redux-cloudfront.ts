#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ProductServiceStack } from "../lib/backend-shop-react-redux-cloudfront-stack";
import { ImportServiceStack } from "../lib/import-service-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

// ─── Product Service — deployed first, exports queue ARN ──────────────────────
const productService = new ProductServiceStack(app, "ProductServiceStack", {
  env,
  // Task 6.3: replace with your actual email address
  notificationEmail: process.env.NOTIFICATION_EMAIL ?? "you@example.com",
});

// ─── Import Service — consumes the queue from Product Service ─────────────────
new ImportServiceStack(app, "ImportServiceStack", {
  env,
  catalogItemsQueueArn: productService.catalogItemsQueueArn,
  catalogItemsQueueUrl: productService.catalogItemsQueueUrl,
});
