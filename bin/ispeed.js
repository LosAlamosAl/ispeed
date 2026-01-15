#!/usr/bin/env node
require('dotenv').config();
const cdk = require('aws-cdk-lib');
const { TextAppendAppStack } = require('../lib/text-append-app-stack');

const app = new cdk.App();

// Validate environment variables
const bucketName = process.env.S3_BUCKET_NAME;
const objectKey = process.env.S3_OBJECT_KEY;
const alertEmail = process.env.CIRCUIT_BREAKER_EMAIL;

if (!bucketName || !objectKey) {
  throw new Error('S3_BUCKET_NAME and S3_OBJECT_KEY must be defined in .env');
}

if (!alertEmail) {
  console.warn('WARNING: CIRCUIT_BREAKER_EMAIL not set. Circuit breaker alerts will not be configured.');
}

// App Stack (single stack architecture with integrated circuit breaker)
new TextAppendAppStack(app, 'TextAppendAppStack', {
  bucketName,
  objectKey,
  alertEmail,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION,
  },
});
