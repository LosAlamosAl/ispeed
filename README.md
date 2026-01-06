# Serverless Text-Append Service

A serverless public API that appends text to a single S3 object, featuring an integrated circuit breaker security mechanism. The system uses a single AWS CDK stack with a Lambda function that handles both text operations and circuit breaker logic.

## Architecture Overview

### Single-Stack Design

**TextAppendAppStack**
- S3 Bucket for storing the text file (with versioning enabled)
- Lambda function with:
  - Reserved concurrency (1) to prevent race conditions
  - Integrated circuit breaker logic that monitors write frequency
  - Permission to delete API Gateway stage if writes are too frequent
- HTTP API Gateway (v2) with two endpoints:
  - `PUT /append` - Append text to the S3 object (with circuit breaker check)
  - `GET /read` - Read the current content of the S3 object

**Circuit Breaker:**
- Before each append operation, the Lambda checks the S3 object's `LastModified` timestamp
- If the last write occurred within 30 minutes, the circuit breaker activates
- The Lambda deletes the API Gateway stage, making the API unavailable
- Manual recovery is required via AWS CLI

## Prerequisites

- **AWS Account** with appropriate permissions
- **AWS CLI** configured with credentials
- **Node.js** 20.x or higher
- **AWS CDK** CLI installed globally (`npm install -g aws-cdk`)

## Setup Instructions

### 1. Clone/Download the Project

```bash
cd /workspaces/ispeed
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file from the example template:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
S3_BUCKET_NAME=text-append-bucket-unique-12345
S3_OBJECT_KEY=data.txt
AWS_REGION=us-east-1
```

**Important:** The `S3_BUCKET_NAME` must be globally unique across all AWS accounts.

### 4. Bootstrap CDK (First Time Only)

If this is your first time using CDK in your AWS account/region:

```bash
cdk bootstrap aws://ACCOUNT-ID/REGION
```

Or use the default account/region:

```bash
cdk bootstrap
```

## Deployment

### Deploy the Stack

Deploy the application stack:

```bash
cdk deploy TextAppendAppStack
```

The deployment will output the API Gateway URL. Save this for testing:

```
Outputs:
TextAppendAppStack.HttpApiUrl = https://[api-id].execute-api.[region].amazonaws.com/
TextAppendAppStack.HttpApiId = [api-id]
```

### Create the Initial S3 Object

**Important:** Before testing the API, create the initial S3 object:

```bash
# Create empty initial file
echo "" > /tmp/initial.txt

# Upload to S3(using bucket/key from your .env file)
aws s3 cp /tmp/initial.txt s3://${S3_BUCKET_NAME}/${S3_OBJECT_KEY}
```

Alternatively, create with some initial content:

```bash
echo "Initial content" | aws s3 cp - s3://${S3_BUCKET_NAME}/${S3_OBJECT_KEY}
```

### Test the Endpoints

Export the API URL for convenience:

```bash
export API_URL=$(aws cloudformation describe-stacks \
  --stack-name TextAppendAppStack \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiUrl`].OutputValue' \
  --output text)
```

Test the endpoints:

```bash
# Test READ
curl "${API_URL}read"

# Test APPEND
curl -X PUT "${API_URL}append" -H "Content-Type: text/plain" -d "Hello World"

# Verify append worked
curl "${API_URL}read"
```

## API Usage

### Endpoint: PUT /append

Appends plain text to the S3 object.

**Request:**
```bash
curl -X PUT https://[api-id].execute-api.[region].amazonaws.com/append \
  -H "Content-Type: text/plain" \
  -d "This is the text to append"
```

Using the exported `API_URL`:
```bash
curl -X PUT "${API_URL}append" \
  -H "Content-Type: text/plain" \
  -d "Hello World"
```

**Response (Success):**
```
Text appended successfully
```

**Response (Error - Object Doesn't Exist):**
```
Error: S3 object does not exist. Please create it first.
```

### Endpoint: GET /read

Reads and returns the current content of the S3 object.

**Request:**
```bash
curl https://[api-id].execute-api.[region].amazonaws.com/read
```

Using the exported `API_URL`:
```bash
curl "${API_URL}read"
```

**Response:**
```
Initial content
Hello World
```

## Circuit Breaker Behavior

The App Lambda monitors the S3 object's LastModified timestamp. If writes occur too frequently:

1. Client attempts to append text via `PUT /append`
2. App Lambda checks the S3 object's `LastModified` timestamp (from AWS S3, not metadata)
3. If `(Current Time - LastModified) < 30 minutes`, the circuit breaker activates
4. The App Lambda deletes the API Gateway `$default` stage
5. The Lambda returns a 503 error: "Circuit breaker activated"
6. The API becomes **unavailable** immediately
7. Manual recovery is required (see below)

**Testing the Circuit Breaker:**

```bash
# First append (should succeed)
curl -X PUT "${API_URL}append" -d "First write"

# Second append (within 30 minutes) - triggers circuit breaker
curl -X PUT "${API_URL}append" -d "Second write"
# Expected: 503 error "Circuit breaker activated..."

# API should become unavailable immediately
curl "${API_URL}read"
# Expected: Connection refused or 404 Not Found
```

## Recovery Procedure (After Circuit Breaker Activation)

When the circuit breaker deletes the API stage, you must manually recreate it.

### Method 1: AWS CLI (Recommended)

```bash
# Get the API ID from CloudFormation outputs
export API_ID=$(aws cloudformation describe-stacks \
  --stack-name TextAppendAppStack \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiId`].OutputValue' \
  --output text)

# Recreate the $default stage
aws apigatewayv2 create-stage \
  --api-id $API_ID \
  --stage-name '$default' \
  --auto-deploy

# Verify recovery
curl "${API_URL}read"
```

### Method 2: CDK Re-Deployment

Re-deploy the App Stack to recreate the stage:

```bash
cdk deploy TextAppendAppStack
```

### Method 3: AWS Console

1. Open the [API Gateway Console](https://console.aws.amazon.com/apigateway/)
2. Select "APIs" from the left sidebar
3. Click on "text-append-api"
4. Click "Stages" in the left sidebar
5. Click the "Create" button
6. Enter stage name: `$default`
7. Enable "Auto-deploy"
8. Click "Create"

## Validation and Testing

### Check Lambda Reserved Concurrency

```bash
# Get the App Lambda function name
APP_LAMBDA=$(aws cloudformation describe-stack-resources \
  --stack-name TextAppendAppStack \
  --query 'StackResources[?ResourceType==`AWS::Lambda::Function`].PhysicalResourceId' \
  --output text | grep -i app)

# Check configuration
aws lambda get-function-configuration --function-name $APP_LAMBDA
# Look for: "ReservedConcurrentExecutions": 1
```

### Check S3 LastModified Timestamp

```bash
aws s3api head-object \
  --bucket ${S3_BUCKET_NAME} \
  --key ${S3_OBJECT_KEY} \
  --query 'LastModified'
```

Expected output: An ISO 8601 timestamp
```
2026-01-05T12:34:56.000Z
```

### View Lambda Logs

**App Lambda:**
```bash
aws logs tail /aws/lambda/TextAppendAppStack-AppLambda* --follow
```

## Project Structure

```
/workspaces/ispeed/
├── .env                                    # Environment configuration (create from .env.example)
├── .env.example                            # Example environment template
├── README.md                               # This file
├── spec.md                                 # Original specification
├── cdk.json                                # CDK configuration
├── package.json                            # Node.js dependencies
├── bin/
│   └── ispeed.js                          # CDK app entry point
├── lib/
│   └── text-append-app-stack.js           # App stack (S3, Lambda, API Gateway)
└── lambda/
    └── app-handler/
        └── index.mjs                       # App Lambda (PUT /append, GET /read, circuit breaker)
```

## Key Design Decisions

### Reserved Concurrency = 1

**⚠️ TEMPORARY WORKAROUND ACTIVE:**
Reserved concurrency is currently **disabled** due to AWS account concurrency limits. This is commented out in `lib/text-append-app-stack.js` line 35.

**IMPORTANT:** Without reserved concurrency:
- **Race conditions are possible** if multiple clients append simultaneously
- **Data corruption can occur** during concurrent writes
- **Only use for single-user testing** until AWS concurrency limit increase is approved
- **DO NOT deploy to production** without restoring `reservedConcurrentExecutions: 1`

**To restore (after limit increase):**
1. Request AWS Lambda concurrency limit increase to at least 1000 (see Troubleshooting section)
2. Uncomment line 35 in `lib/text-append-app-stack.js`
3. Redeploy: `cdk deploy TextAppendAppStack`

**Original design:** The App Lambda should have a reserved concurrency of 1 to prevent race conditions during the read-modify-write operation on the S3 object. This ensures data consistency but limits throughput to sequential requests.

### Plain Text Body
The PUT /append endpoint accepts plain text in the request body (not JSON). The entire body is appended as-is with a newline.

### Error on Missing Object
If the S3 object doesn't exist, both endpoints return a 404 error. The object must be created manually before using the API.

### Circuit Breaker via Stage Deletion
The circuit breaker uses a destructive action (deleting the API stage) to ensure write frequency limits are enforced. The App Lambda checks the S3 object's built-in `LastModified` timestamp before each write, eliminating the need for custom metadata. This requires manual intervention to recover, providing a strong deterrent against rapid writes.

### Single-Stack Architecture
The system uses a single CDK stack with the circuit breaker logic integrated directly into the App Lambda. This simplifies deployment and eliminates the complexity of cross-stack references and S3 event notifications that were required in the previous two-stack design.

## Troubleshooting

### Problem: "NoSuchKey" Error When Calling /append or /read

**Cause:** The S3 object doesn't exist.

**Solution:**
```bash
echo "" | aws s3 cp - s3://${S3_BUCKET_NAME}/${S3_OBJECT_KEY}
```

### Problem: ReservedConcurrentExecutions Error During Deployment

**Error:** `Resource handler returned message: "Specified ReservedConcurrentExecutions for function decreases account's UnreservedConcurrentExecution below its minimum value of [10]"`

**Cause:** Your AWS account has insufficient Lambda concurrency quota. AWS requires at least 10 unreserved concurrent executions.

**Check your limits:**
```bash
aws lambda get-account-settings
# Look at: ConcurrentExecutions (should be 1000, not 10)
```

**Solution:** Request AWS Lambda concurrency limit increase:

1. **Via Service Quotas Console:**
   - Go to [AWS Service Quotas Console](https://console.aws.amazon.com/servicequotas/)
   - Search for "Lambda"
   - Select "AWS Lambda"
   - Find "Concurrent executions"
   - Request increase to **1000**

2. **Via AWS CLI:**
   ```bash
   aws service-quotas request-service-quota-increase \
     --service-code lambda \
     --quota-code L-B99A9384 \
     --desired-value 1000 \
     --region us-east-1
   ```

3. **Temporary workaround (testing only):**
   - Reserved concurrency is currently disabled in the code (see "Reserved Concurrency = 1" section)
   - **WARNING:** This removes race condition protection
   - Deploy will succeed but concurrent writes may corrupt data
   - After limit increase approved, restore `reservedConcurrentExecutions: 1` in `lib/text-append-app-stack.js`

### Problem: Lambda "Access Denied" on S3

**Cause:** IAM permissions not properly configured.

**Solution:** Redeploy the stack:
```bash
cdk deploy TextAppendAppStack
```

### Problem: API Gateway Stage Not Found

**Cause:** Circuit breaker activated and deleted the stage.

**Solution:** See "Recovery Procedure" section above.

## CloudWatch Logs

The App Lambda logs to CloudWatch with a 10-day retention policy:

- **App Lambda:** `/aws/lambda/TextAppendAppStack-AppLambda[...]`

View logs in real-time:
```bash
aws logs tail /aws/lambda/TextAppendAppStack-AppLambda* --follow
```

## Cleanup

To remove all resources:

```bash
# Destroy both stacks
cdk destroy --all
```

**Note:** The S3 bucket has a `RETAIN` removal policy to protect data. After destroying the stacks, you must manually delete the bucket if desired:

```bash
# Delete all objects first
aws s3 rm s3://${S3_BUCKET_NAME} --recursive

# Delete the bucket
aws s3 rb s3://${S3_BUCKET_NAME}
```

## Cost Estimation

**Monthly costs (low usage):**
- S3 storage: ~$0.023/GB
- Lambda invocations: ~$0.20 per 1M requests
- API Gateway: ~$1.00 per 1M requests
- CloudWatch Logs: ~$0.50/GB ingested

**Estimated total: < $5/month for testing**

## Security Considerations

- **Public API:** No authentication required (per specification)
- **S3 Bucket:** Private access, only Lambda can read/write
- **IAM Roles:** Least privilege - Lambdas only have necessary permissions
- **Circuit Breaker:** Enforces write frequency limits
- **Data Protection:** S3 bucket has RETAIN policy to prevent accidental deletion

## Future Enhancements

- Add API Key authentication
- Implement rate limiting via API Gateway usage plans
- Add CloudWatch alarms for circuit breaker activation
- Implement automatic stage recreation after cooldown period
- Add size limits on appended text
- Support multiple objects via path parameters

## License

This project is provided as-is for educational and testing purposes.

## Support

For issues or questions, please refer to:
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [Amazon S3 Documentation](https://docs.aws.amazon.com/s3/)
- [API Gateway Documentation](https://docs.aws.amazon.com/apigateway/)
