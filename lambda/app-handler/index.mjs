import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const BUCKET_NAME = process.env.BUCKET_NAME;
const OBJECT_KEY = process.env.OBJECT_KEY;

export const handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;

  try {
    // Route to appropriate handler
    if (method === 'PUT' && path === '/append') {
      return await handleAppend(event);
    } else if (method === 'GET' && path === '/read') {
      return await handleRead(event);
    } else {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Not Found',
      };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: `Error: ${error.message}`,
    };
  }
};

async function handleAppend(event) {
  // 1. Extract plain text body
  const textToAppend = event.body || '';

  // 2. Read existing object (ERROR if doesn't exist - per spec)
  let existingContent = '';
  try {
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: OBJECT_KEY,
    });
    const getResponse = await s3Client.send(getCommand);
    existingContent = await streamToString(getResponse.Body);
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Error: S3 object does not exist. Please create it first.',
      };
    }
    throw error;
  }

  // 3. Append new text with newline
  const updatedContent = existingContent + textToAppend + '\n';

  // 4. Upload with metadata timestamp
  const currentTimestamp = new Date().toISOString();
  const putCommand = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: OBJECT_KEY,
    Body: updatedContent,
    ContentType: 'text/plain',
    Metadata: {
      'last-write': currentTimestamp, // x-amz-meta-last-write
    },
  });

  await s3Client.send(putCommand);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain' },
    body: 'Text appended successfully',
  };
}

async function handleRead(event) {
  // 1. Read object (ERROR if doesn't exist)
  try {
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: OBJECT_KEY,
    });
    const getResponse = await s3Client.send(getCommand);
    const content = await streamToString(getResponse.Body);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: content,
    };
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Error: S3 object does not exist.',
      };
    }
    throw error;
  }
}

// Helper to convert ReadableStream to string
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
