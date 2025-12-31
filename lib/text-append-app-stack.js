const { Stack, CfnOutput, Duration, RemovalPolicy } = require('aws-cdk-lib');
const s3 = require('aws-cdk-lib/aws-s3');
const lambda = require('aws-cdk-lib/aws-lambda');
const apigatewayv2 = require('aws-cdk-lib/aws-apigatewayv2');
const integrations = require('aws-cdk-lib/aws-apigatewayv2-integrations');

class TextAppendAppStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const { bucketName, objectKey } = props;

    // 1. S3 Bucket (non-versioned)
    this.bucket = new s3.Bucket(this, 'TextAppendBucket', {
      bucketName: bucketName,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // 2. App Lambda Function
    // ⚠️ WARNING: Reserved concurrency temporarily disabled due to AWS account limits
    // TODO: Restore after AWS concurrency limit increase is approved
    // REQUIRED: reservedConcurrentExecutions: 1 prevents S3 race conditions
    // WITHOUT THIS: Concurrent writes may corrupt the S3 object!
    // DO NOT USE IN PRODUCTION without reserved concurrency or external locking
    const appLambda = new lambda.Function(this, 'AppLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/app-handler'),
      environment: {
        BUCKET_NAME: this.bucket.bucketName,
        OBJECT_KEY: objectKey,
      },
      // reservedConcurrentExecutions: 1,  // TEMPORARILY COMMENTED - SEE WARNING ABOVE
      timeout: Duration.seconds(30),
    });

    // Grant permissions
    this.bucket.grantReadWrite(appLambda);

    // 3. HTTP API Gateway (v2)
    this.httpApi = new apigatewayv2.HttpApi(this, 'TextAppendApi', {
      apiName: 'text-append-api',
      description: 'Public API for appending text to S3 object',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.PUT,
        ],
      },
    });

    // 4. Lambda Integration
    const lambdaIntegration = new integrations.HttpLambdaIntegration(
      'AppLambdaIntegration',
      appLambda
    );

    // 5. Routes
    this.httpApi.addRoutes({
      path: '/append',
      methods: [apigatewayv2.HttpMethod.PUT],
      integration: lambdaIntegration,
    });

    this.httpApi.addRoutes({
      path: '/read',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: lambdaIntegration,
    });

    // 6. CloudFormation Outputs
    new CfnOutput(this, 'HttpApiUrl', {
      value: this.httpApi.url,
      description: 'HTTP API Gateway URL',
      exportName: 'TextAppendApiUrl',
    });

    new CfnOutput(this, 'HttpApiId', {
      value: this.httpApi.httpApiId,
      description: 'HTTP API Gateway ID',
      exportName: 'TextAppendApiId',
    });
  }
}

module.exports = { TextAppendAppStack };
