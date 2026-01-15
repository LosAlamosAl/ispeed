const { Stack, CfnOutput, Duration, RemovalPolicy } = require('aws-cdk-lib');
const s3 = require('aws-cdk-lib/aws-s3');
const lambda = require('aws-cdk-lib/aws-lambda');
const apigatewayv2 = require('aws-cdk-lib/aws-apigatewayv2');
const integrations = require('aws-cdk-lib/aws-apigatewayv2-integrations');
const iam = require('aws-cdk-lib/aws-iam');
const logs = require('aws-cdk-lib/aws-logs');
const ssm = require('aws-cdk-lib/aws-ssm');
const sns = require('aws-cdk-lib/aws-sns');
const snsSubscriptions = require('aws-cdk-lib/aws-sns-subscriptions');

class TextAppendAppStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const { bucketName, objectKey } = props;

    // 1. S3 Bucket with versioning and lifecycle rule
    this.bucket = new s3.Bucket(this, 'TextAppendBucket', {
      bucketName: bucketName,
      versioned: true,
      lifecycleRules: [
        {
          id: 'ExpireOldVersions',
          enabled: true,
          noncurrentVersionsToRetain: 3, // Keep 3 non-current + 1 current = 4 total
          noncurrentVersionExpiration: Duration.days(1), // Delete after 1 day when count exceeds 3
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // 2. SSM Parameter for circuit breaker threshold
    const thresholdParameter = new ssm.StringParameter(this, 'ThresholdParameter', {
      parameterName: '/ispeed/threshold-minutes',
      stringValue: '1',
      description: 'Minimum time (in minutes) between S3 writes before circuit breaker activates',
      tier: ssm.ParameterTier.STANDARD,
    });

    // 3. SNS Topic for circuit breaker alerts
    const circuitBreakerTopic = new sns.Topic(this, 'CircuitBreakerTopic', {
      topicName: 'ispeed-circuit-breaker-alerts',
      displayName: 'iSpeed Circuit Breaker Alerts',
    });

    // Add email subscription
    const alertEmail = props.alertEmail;
    if (alertEmail) {
      circuitBreakerTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(alertEmail)
      );
    }

    // 4. App Lambda Function
    const appLambda = new lambda.Function(this, 'AppLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/app-handler'),
      environment: {
        BUCKET_NAME: this.bucket.bucketName,
        OBJECT_KEY: objectKey,
        API_ID: '', // Will be set after httpApi is created
        STAGE_NAME: '$default',
        THRESHOLD_PARAMETER_NAME: thresholdParameter.parameterName,
        SNS_TOPIC_ARN: circuitBreakerTopic.topicArn,
      },
      reservedConcurrentExecutions: 1, // Prevents S3 race conditions
      timeout: Duration.seconds(30),
      logRetention: logs.RetentionDays.TEN_DAYS,
    });

    // Grant S3 permissions
    this.bucket.grantReadWrite(appLambda);

    // Grant SSM parameter read permission
    thresholdParameter.grantRead(appLambda);

    // Grant SNS publish permission
    circuitBreakerTopic.grantPublish(appLambda);

    // 5. HTTP API Gateway (v2)
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

    // 5. Lambda Integration
    const lambdaIntegration = new integrations.HttpLambdaIntegration(
      'AppLambdaIntegration',
      appLambda
    );

    // 6. Routes
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

    // 7. Update Lambda environment with API_ID and grant API Gateway permissions
    appLambda.addEnvironment('API_ID', this.httpApi.httpApiId);

    // Grant App Lambda permission to delete API Gateway stage (circuit breaker)
    appLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['apigateway:DELETE'],
        resources: [
          `arn:aws:apigateway:${this.region}::/apis/${this.httpApi.httpApiId}/stages/$default`,
        ],
      })
    );

    // 8. CloudFormation Outputs
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

    new CfnOutput(this, 'ThresholdParameterName', {
      value: thresholdParameter.parameterName,
      description: 'SSM Parameter name for threshold configuration',
      exportName: 'ThresholdParameterName',
    });

    new CfnOutput(this, 'CircuitBreakerTopicArn', {
      value: circuitBreakerTopic.topicArn,
      description: 'SNS Topic ARN for circuit breaker alerts',
      exportName: 'CircuitBreakerTopicArn',
    });
  }
}

module.exports = { TextAppendAppStack };
