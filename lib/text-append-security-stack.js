const { Stack, Duration } = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const s3n = require('aws-cdk-lib/aws-s3-notifications');
const iam = require('aws-cdk-lib/aws-iam');
const s3 = require('aws-cdk-lib/aws-s3');

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
    guardLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['apigateway:DeleteStage'],
        resources: [
          `arn:aws:apigateway:${this.region}::/apis/${httpApi.httpApiId}/stages/$default`,
        ],
      })
    );

    // 4. S3 Event Notification
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(guardLambda),
      { prefix: objectKey }
    );
  }
}

module.exports = { TextAppendSecurityStack };
