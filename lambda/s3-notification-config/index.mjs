import { S3Client, PutBucketNotificationConfigurationCommand, GetBucketNotificationConfigurationCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

// Helper to send CloudFormation response
async function sendResponse(event, context, status, data = {}) {
  const responseBody = JSON.stringify({
    Status: status,
    Reason: data.Reason || `See CloudWatch Log Stream: ${context.logStreamName}`,
    PhysicalResourceId: data.PhysicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data.Data || {},
  });

  console.log('Response body:', responseBody);

  const parsedUrl = new URL(event.ResponseURL);
  const options = {
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': responseBody.length,
    },
    body: responseBody,
  };

  try {
    const response = await fetch(event.ResponseURL, options);
    console.log('CloudFormation response status:', response.status);
  } catch (error) {
    console.error('Error sending response to CloudFormation:', error);
    throw error;
  }
}

export const handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const bucketName = event.ResourceProperties.BucketName;
  const lambdaArn = event.ResourceProperties.LambdaArn;
  const objectKey = event.ResourceProperties.ObjectKey;

  try {
    if (event.RequestType === 'Delete') {
      console.log('DELETE request - removing S3 notification configuration');

      // Get current notification configuration
      const getCommand = new GetBucketNotificationConfigurationCommand({
        Bucket: bucketName,
      });
      const currentConfig = await s3Client.send(getCommand);

      // Remove our Lambda configuration
      const updatedLambdaConfigs = (currentConfig.LambdaFunctionConfigurations || [])
        .filter(config => config.LambdaFunctionArn !== lambdaArn);

      // Update bucket notification
      const putCommand = new PutBucketNotificationConfigurationCommand({
        Bucket: bucketName,
        NotificationConfiguration: {
          LambdaFunctionConfigurations: updatedLambdaConfigs,
          TopicConfigurations: currentConfig.TopicConfigurations || [],
          QueueConfigurations: currentConfig.QueueConfigurations || [],
        },
      });

      await s3Client.send(putCommand);
      console.log('Successfully removed S3 notification configuration');

      await sendResponse(event, context, 'SUCCESS', {
        PhysicalResourceId: `s3-notification-${bucketName}`,
      });

    } else if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      console.log(`${event.RequestType} request - configuring S3 notification`);

      // Get current notification configuration
      const getCommand = new GetBucketNotificationConfigurationCommand({
        Bucket: bucketName,
      });

      let currentConfig;
      try {
        currentConfig = await s3Client.send(getCommand);
      } catch (error) {
        console.log('No existing notification configuration, starting fresh');
        currentConfig = {};
      }

      // Remove any existing configuration for this Lambda to avoid duplicates
      const otherLambdaConfigs = (currentConfig.LambdaFunctionConfigurations || [])
        .filter(config => config.LambdaFunctionArn !== lambdaArn);

      // Add our Lambda configuration
      const newLambdaConfig = {
        Id: `guard-lambda-notification-${Date.now()}`,
        LambdaFunctionArn: lambdaArn,
        Events: ['s3:ObjectCreated:*'],
        Filter: {
          Key: {
            FilterRules: [
              {
                Name: 'prefix',
                Value: objectKey,
              },
            ],
          },
        },
      };

      // Update bucket notification
      const putCommand = new PutBucketNotificationConfigurationCommand({
        Bucket: bucketName,
        NotificationConfiguration: {
          LambdaFunctionConfigurations: [...otherLambdaConfigs, newLambdaConfig],
          TopicConfigurations: currentConfig.TopicConfigurations || [],
          QueueConfigurations: currentConfig.QueueConfigurations || [],
        },
      });

      await s3Client.send(putCommand);
      console.log('Successfully configured S3 notification');

      await sendResponse(event, context, 'SUCCESS', {
        PhysicalResourceId: `s3-notification-${bucketName}`,
        Data: {
          NotificationId: newLambdaConfig.Id,
        },
      });

    } else {
      throw new Error(`Unknown request type: ${event.RequestType}`);
    }

  } catch (error) {
    console.error('Error:', error);
    await sendResponse(event, context, 'FAILED', {
      Reason: error.message,
      PhysicalResourceId: `s3-notification-${bucketName}`,
    });
  }
};
