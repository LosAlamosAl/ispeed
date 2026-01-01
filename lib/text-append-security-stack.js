const { Stack, Duration, CustomResource } = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const iam = require('aws-cdk-lib/aws-iam');
const cr = require('aws-cdk-lib/custom-resources');

class TextAppendSecurityStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const { bucket, httpApi, objectKey } = props;

    // 1. Guard Lambda Function
    const guardLambda = new lambda.Function(this, 'GuardLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/guard-handler'),
      environment: {
        BUCKET_NAME: bucket.bucketName,
        OBJECT_KEY: objectKey,
        API_ID: httpApi.httpApiId,
        STAGE_NAME: '$default',
      },
      timeout: Duration.seconds(30),
    });

    // 2. Grant S3 read permissions
    bucket.grantRead(guardLambda);

    // 3. Grant API Gateway DeleteStage permission
    // Note: API Gateway V2 uses REST-style IAM actions (DELETE, not DeleteStage)
    guardLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['apigateway:DELETE'],
        resources: [
          `arn:aws:apigateway:${this.region}::/apis/${httpApi.httpApiId}/stages/$default`,
        ],
      })
    );

    // 4. Grant S3 permission to invoke Guard Lambda
    guardLambda.addPermission('S3InvokePermission', {
      principal: new iam.ServicePrincipal('s3.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: bucket.bucketArn,
    });

    // 5. Custom Resource Lambda to configure S3 notification
    const s3NotificationConfigLambda = new lambda.Function(this, 'S3NotificationConfigLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/s3-notification-config'),
      timeout: Duration.seconds(60),
    });

    // Grant Custom Resource Lambda permission to configure S3 notifications
    s3NotificationConfigLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:PutBucketNotification',
          's3:GetBucketNotification',
        ],
        resources: [bucket.bucketArn],
      })
    );

    // 6. Custom Resource Provider
    const s3NotificationProvider = new cr.Provider(this, 'S3NotificationProvider', {
      onEventHandler: s3NotificationConfigLambda,
    });

    // 7. Custom Resource to trigger S3 notification configuration
    new CustomResource(this, 'S3NotificationConfig', {
      serviceToken: s3NotificationProvider.serviceToken,
      properties: {
        BucketName: bucket.bucketName,
        LambdaArn: guardLambda.functionArn,
        ObjectKey: objectKey,
      },
    });
  }
}

module.exports = { TextAppendSecurityStack };
