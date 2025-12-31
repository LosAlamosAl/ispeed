import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ApiGatewayV2Client, DeleteStageCommand } from '@aws-sdk/client-apigatewayv2';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const apiGatewayClient = new ApiGatewayV2Client({ region: process.env.AWS_REGION });

const BUCKET_NAME = process.env.BUCKET_NAME;
const OBJECT_KEY = process.env.OBJECT_KEY;
const API_ID = process.env.API_ID;
const STAGE_NAME = process.env.STAGE_NAME;

const THRESHOLD_MINUTES = 30;

export const handler = async (event) => {
  console.log('Guard Lambda triggered:', JSON.stringify(event, null, 2));

  try {
    // 1. Extract S3 event details
    for (const record of event.Records) {
      if (record.eventName.startsWith('ObjectCreated')) {
        const bucketName = record.s3.bucket.name;
        const objectKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

        console.log(`Processing: ${bucketName}/${objectKey}`);

        // 2. Get object metadata
        const headCommand = new HeadObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
        });
        const headResponse = await s3Client.send(headCommand);

        // 3. Extract last-write timestamp from metadata
        const lastWriteTimestamp = headResponse.Metadata?.['last-write'];

        if (!lastWriteTimestamp) {
          console.log('No last-write metadata found, skipping');
          continue;
        }

        console.log(`Last write timestamp: ${lastWriteTimestamp}`);

        // 4. Calculate time difference
        const lastWriteTime = new Date(lastWriteTimestamp);
        const currentTime = new Date();
        const diffMinutes = (currentTime - lastWriteTime) / (1000 * 60);

        console.log(`Time difference: ${diffMinutes.toFixed(2)} minutes`);

        // 5. If within threshold, delete API stage (circuit breaker)
        if (diffMinutes < THRESHOLD_MINUTES) {
          console.log(`Threshold breached! Deleting API stage: ${STAGE_NAME}`);

          const deleteCommand = new DeleteStageCommand({
            ApiId: API_ID,
            StageName: STAGE_NAME,
          });

          await apiGatewayClient.send(deleteCommand);

          console.log(`Successfully deleted stage: ${STAGE_NAME}`);
        } else {
          console.log(`Threshold not breached (${diffMinutes.toFixed(2)} >= ${THRESHOLD_MINUTES})`);
        }
      }
    }

    return {
      statusCode: 200,
      body: 'Guard check completed',
    };
  } catch (error) {
    console.error('Guard Lambda error:', error);
    // Don't throw - allow S3 event to succeed even if guard fails
    return {
      statusCode: 500,
      body: `Error: ${error.message}`,
    };
  }
};
