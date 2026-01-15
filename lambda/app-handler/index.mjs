import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import {
  ApiGatewayV2Client,
  DeleteStageCommand,
} from "@aws-sdk/client-apigatewayv2";
import {
  SSMClient,
  GetParameterCommand,
} from "@aws-sdk/client-ssm";

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const apiGatewayClient = new ApiGatewayV2Client({
  region: process.env.AWS_REGION,
});
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

const BUCKET_NAME = process.env.BUCKET_NAME;
const OBJECT_KEY = process.env.OBJECT_KEY;
const API_ID = process.env.API_ID;
const STAGE_NAME = process.env.STAGE_NAME;
const THRESHOLD_PARAMETER_NAME = process.env.THRESHOLD_PARAMETER_NAME;

async function getThresholdMinutes() {
  try {
    const response = await ssmClient.send(
      new GetParameterCommand({ Name: THRESHOLD_PARAMETER_NAME })
    );

    const value = parseFloat(response.Parameter.Value);

    if (isNaN(value) || value <= 0) {
      console.error(`Invalid threshold value: ${response.Parameter.Value}, using default: 1`);
      return 1;
    }

    console.log(`Threshold loaded from Parameter Store: ${value} minutes`);
    return value;

  } catch (error) {
    console.error('Failed to fetch threshold from Parameter Store:', error);
    console.warn('Using default: 1');
    return 1; // Safe default
  }
}

export const handler = async (event) => {
  console.log("Event:", JSON.stringify(event, null, 2));

  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;

  try {
    // Route to appropriate handler
    if (method === "PUT" && path === "/append") {
      return await handleAppend(event);
    } else if (method === "GET" && path === "/read") {
      return await handleRead(event);
    } else {
      return {
        statusCode: 404,
        headers: { "Content-Type": "text/plain" },
        body: "Not Found",
      };
    }
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain" },
      body: `Error: ${error.message}`,
    };
  }
};

async function handleAppend(event) {
  // Fetch threshold value at runtime
  const THRESHOLD_MINUTES = await getThresholdMinutes();

  // 1. Extract plain text body
  const textToAppend = event.body || "";

  // 2. Check if object exists and get LastModified timestamp (Circuit Breaker Check)
  let lastModified;
  try {
    const headCommand = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: OBJECT_KEY,
    });
    const headResponse = await s3Client.send(headCommand);
    lastModified = headResponse.LastModified;
  } catch (error) {
    if (error.name === "NotFound" || error.name === "NoSuchKey") {
      return {
        statusCode: 404,
        headers: { "Content-Type": "text/plain" },
        body: "Error: S3 object does not exist. Please create it first.",
      };
    }
    throw error;
  }

  // 3. Circuit Breaker: Check if write frequency is too high
  const currentTime = new Date();
  const diffMinutes = (currentTime - lastModified) / (1000 * 60);

  console.log(`Last modified: ${lastModified.toISOString()}`);
  console.log(`Time difference: ${diffMinutes.toFixed(2)} minutes`);

  if (diffMinutes < THRESHOLD_MINUTES) {
    console.log(`Threshold breached! Deleting API stage: ${STAGE_NAME}`);

    // Delete API stage (circuit breaker activated)
    try {
      const deleteCommand = new DeleteStageCommand({
        ApiId: API_ID,
        StageName: STAGE_NAME,
      });
      await apiGatewayClient.send(deleteCommand);
      console.log(`Successfully deleted stage: ${STAGE_NAME}`);
    } catch (error) {
      console.error("Error deleting API stage:", error);
      // Continue to return error to user even if deletion fails
    }

    return {
      statusCode: 503,
      headers: { "Content-Type": "text/plain" },
      body: `Circuit breaker activated: Writes must be at least ${THRESHOLD_MINUTES} minutes apart. API has been disabled.`,
    };
  }

  console.log(
    `Threshold not breached (${diffMinutes.toFixed(
      2
    )} >= ${THRESHOLD_MINUTES}), proceeding with append`
  );

  // 4. Read existing object
  let existingContent = "";
  try {
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: OBJECT_KEY,
    });
    const getResponse = await s3Client.send(getCommand);
    existingContent = await streamToString(getResponse.Body);
  } catch (error) {
    if (error.name === "NoSuchKey") {
      return {
        statusCode: 404,
        headers: { "Content-Type": "text/plain" },
        body: "Error: S3 object does not exist. Please create it first.",
      };
    }
    throw error;
  }

  // 5. Append new text with newline
  const updatedContent = existingContent + textToAppend + "\n";

  // 6. Upload to S3 (no metadata needed - using built-in LastModified)
  const putCommand = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: OBJECT_KEY,
    Body: updatedContent,
    ContentType: "text/plain",
  });

  await s3Client.send(putCommand);

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/plain" },
    body: "Text appended successfully",
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
      headers: { "Content-Type": "text/plain" },
      body: content,
    };
  } catch (error) {
    if (error.name === "NoSuchKey") {
      return {
        statusCode: 404,
        headers: { "Content-Type": "text/plain" },
        body: "Error: S3 object does not exist.",
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
  return Buffer.concat(chunks).toString("utf-8");
}
