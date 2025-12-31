#!/usr/bin/env node
require('dotenv').config();
const cdk = require('aws-cdk-lib');
const { TextAppendAppStack } = require('../lib/text-append-app-stack');
const { TextAppendSecurityStack } = require('../lib/text-append-security-stack');

const app = new cdk.App();

// Validate environment variables
const bucketName = process.env.S3_BUCKET_NAME;
const objectKey = process.env.S3_OBJECT_KEY;

if (!bucketName || !objectKey) {
  throw new Error('S3_BUCKET_NAME and S3_OBJECT_KEY must be defined in .env');
}

// Stack 1: App Stack (can be deployed independently)
const appStack = new TextAppendAppStack(app, 'TextAppendAppStack', {
  bucketName,
  objectKey,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION,
  },
});

// Stack 2: Security Stack (depends on App Stack)
const securityStack = new TextAppendSecurityStack(app, 'TextAppendSecurityStack', {
  bucket: appStack.bucket,
  httpApi: appStack.httpApi,
  objectKey,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION,
  },
});

// Explicit dependency declaration
securityStack.addDependency(appStack);
