# Development Journey: Serverless Text-Append Service with Circuit Breaker

**Project:** AWS CDK Two-Stack Text Append Service with Security Guard
**Date:** December 31, 2025 - January 1, 2026
**Status:** ✅ Successfully Deployed and Tested
**Cost:** $5.50 in API usage, 2,459 lines added, 69 lines removed

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Planning Phase](#planning-phase)
3. [Implementation Journey](#implementation-journey)
4. [Problems Encountered & Solutions](#problems-encountered--solutions)
5. [Final Architecture](#final-architecture)
6. [Key Decisions & Trade-offs](#key-decisions--trade-offs)
7. [Lessons Learned](#lessons-learned)
8. [Testing & Validation](#testing--validation)

---

## Project Overview

### Objective
Build a serverless API that appends text to a single S3 object with a "circuit breaker" security mechanism that monitors write frequency and disables the API if writes occur within 30 minutes.

### Requirements (from spec.md)
- **Two separate CDK stacks** (App and Security) for phased deployment
- **App Stack:** S3 bucket, Lambda with reserved concurrency (1), HTTP API Gateway v2
- **Security Stack:** Guard Lambda triggered by S3 events, monitors metadata, deletes API stage if threshold breached
- **Input format:** Plain text body (not JSON)
- **Error handling:** Return 404 if S3 object doesn't exist
- **Recovery:** Manual via AWS CLI to recreate API stage
- **Technology:** AWS CDK (JavaScript), Node.js 20.x, AWS SDK v3

### Success Criteria
✅ App Stack deploys independently
✅ Endpoints work: PUT /append, GET /read
✅ Security Stack deploys after App Stack
✅ Circuit breaker triggers on rapid writes
✅ API becomes unavailable after threshold breach
✅ Manual recovery via AWS CLI

---

## Planning Phase

### Initial Analysis
The user provided `spec.md` with complete requirements. The assistant analyzed the file and identified key clarifications needed before implementation.

### Questions Asked & Answers Received

**Q1: What should happen if the S3 object doesn't exist on first PUT /append?**
**A1:** Return an error (user must create object manually)

**Q2: What format should PUT /append accept?**
**A2:** Plain text body (entire request body appended as-is)
*User asked for cURL example:*
```bash
curl -X PUT https://api-url/append \
  -H "Content-Type: text/plain" \
  -d "This is the text to append"
```

**Q3: After Guard Lambda deletes API stage, what's the recovery process?**
**A3:** Use AWS CLI to redeploy the stage (not the entire stack), with documentation

**Q4: Should there be size limits or validation on appended text?**
**A4:** No limits (subject to Lambda/API Gateway limits)

### Planning Strategy
- **Phase 1: Exploration** - Used Explore agent to check if CDK project exists (result: empty directory)
- **Phase 2: Design** - Used Plan agent to create detailed implementation plan
- **Phase 3: Review** - Created comprehensive plan file at `/home/devboy/.claude/plans/encapsulated-kindling-crystal.md`
- **Phase 4: Implementation** - User approved plan, proceeded with implementation

---

## Implementation Journey

### Step 1: Project Initialization
```bash
cdk init app --language javascript
npm install dotenv @aws-sdk/client-s3 @aws-sdk/client-apigatewayv2
```

**Challenge:** Directory not empty due to `spec.md`
**Solution:** Temporarily moved spec.md, initialized CDK, moved it back

### Step 2: Environment Configuration
Created `.env.example`:
```env
S3_BUCKET_NAME=your-unique-bucket-name
S3_OBJECT_KEY=data.txt
AWS_REGION=us-east-1
```

### Step 3: Lambda Handlers

#### App Lambda (`lambda/app-handler/index.mjs`)
**Key Features:**
- Routes internally: PUT /append, GET /read
- Plain text body handling (no JSON parsing)
- Stream-to-string helper for S3 responses
- Sets `x-amz-meta-last-write` metadata on uploads
- Returns 404 if S3 object doesn't exist

#### Guard Lambda (`lambda/guard-handler/index.mjs`)
**Key Features:**
- Triggered by S3 ObjectCreated events
- Uses HeadObjectCommand (efficient, no data transfer)
- Calculates time difference: (Current Time - Metadata Timestamp) in minutes
- Calls DeleteStageCommand if < 30 minutes
- Non-throwing error handling (allows S3 events to succeed)

### Step 4: CDK Stack Definitions

#### App Stack (`lib/text-append-app-stack.js`)
**Resources:**
- S3 Bucket (non-versioned, RemovalPolicy.RETAIN)
- App Lambda (Node.js 20.x, reserved concurrency: 1, timeout: 30s)
- HTTP API Gateway v2 (public, CORS enabled)
- Routes: PUT /append, GET /read
- CloudFormation Outputs: HttpApiUrl, HttpApiId

#### Security Stack (`lib/text-append-security-stack.js`)
**Resources:**
- Guard Lambda (Node.js 20.x, timeout: 30s)
- IAM permissions: s3:GetObject, apigateway:DELETE
- S3 event notification (via Custom Resource - see Problem #1)
- Custom Resource Lambda for notification configuration

### Step 5: App Entry Point (`bin/ispeed.js`)
**Key Implementation:**
- Loads dotenv at start
- Validates environment variables (S3_BUCKET_NAME, S3_OBJECT_KEY)
- Creates App Stack with bucket and object key props
- Creates Security Stack with cross-stack references (bucket, httpApi)
- Explicit dependency: `securityStack.addDependency(appStack)`

### Step 6: Documentation
Created comprehensive `README.md` with:
- Architecture overview
- Prerequisites and setup instructions
- Deployment guide (phased approach)
- API usage examples
- Circuit breaker behavior explanation
- Recovery procedures (AWS CLI commands)
- Troubleshooting section
- Cost estimation

---

## Problems Encountered & Solutions

### Problem #1: Circular Dependency Error ❌ → ✅

**Error:**
```
ValidationError: 'TextAppendSecurityStack' depends on 'TextAppendAppStack'
({TextAppendSecurityStack}.addDependency({TextAppendAppStack})).
Adding this dependency (TextAppendAppStack -> TextAppendSecurityStack/GuardLambda/Resource.Arn)
would create a cyclic reference.
```

**Root Cause:**
- Security Stack explicitly depends on App Stack (uses bucket, httpApi props)
- Calling `bucket.addEventNotification()` in Security Stack modifies the App Stack's S3 bucket resource
- This created: App Stack → Security Stack (cross-stack) AND App Stack ← Security Stack (bucket modification)
- Result: Circular dependency

**Solution: Custom Resource Pattern**

Instead of using `bucket.addEventNotification()` (which modifies the bucket construct), implemented a CloudFormation Custom Resource:

1. **Created Custom Resource Lambda** (`lambda/s3-notification-config/index.mjs`)
   - Uses AWS SDK to configure S3 notifications at deployment time
   - Handles CREATE, UPDATE, DELETE CloudFormation lifecycle events
   - Sends responses back to CloudFormation via pre-signed URL

2. **Updated Security Stack**
   - Removed `bucket.addEventNotification()` call
   - Added `guardLambda.addPermission()` for S3 to invoke Lambda
   - Created Custom Resource Lambda with S3 notification permissions
   - Created Custom Resource Provider
   - Created Custom Resource that triggers at deployment time

**Benefits:**
- ✅ No circular dependency (S3 bucket resource never modified in CloudFormation)
- ✅ Configuration happens at runtime via AWS SDK
- ✅ Proper cleanup on stack deletion
- ✅ Maintains two-stack architecture as required

**Code Changes:**
```javascript
// BEFORE (caused circular dependency)
bucket.addEventNotification(
  s3.EventType.OBJECT_CREATED,
  new s3n.LambdaDestination(guardLambda),
  { prefix: objectKey }
);

// AFTER (Custom Resource approach)
// 1. Grant Lambda permission
guardLambda.addPermission('S3InvokePermission', {
  principal: new iam.ServicePrincipal('s3.amazonaws.com'),
  action: 'lambda:InvokeFunction',
  sourceArn: bucket.bucketArn,
});

// 2. Create Custom Resource Lambda
const s3NotificationConfigLambda = new lambda.Function(this, 'S3NotificationConfigLambda', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda/s3-notification-config'),
  timeout: Duration.seconds(60),
});

// 3. Grant permissions and create Custom Resource
// (see full implementation in lib/text-append-security-stack.js)
```

---

### Problem #2: Reserved Concurrency Deployment Error ❌ → ✅

**Error:**
```
TextAppendAppStack failed: Resource handler returned message:
"Specified ReservedConcurrentExecutions for function decreases account's
UnreservedConcurrentExecution below its minimum value of [10]."
```

**Root Cause:**
AWS account has severely limited Lambda concurrency quota:
```json
{
  "AccountLimit": {
    "ConcurrentExecutions": 10,          // Should be 1000!
    "UnreservedConcurrentExecutions": 10
  }
}
```

**Analysis:**
- Default AWS accounts have 1,000 concurrent executions
- This account only has 10 (sandbox/learning environment)
- AWS requires at least 10 unreserved executions
- Cannot set `reservedConcurrentExecutions: 1` with only 10 total

**Solution: Temporary Workaround (with clear warnings)**

Commented out reserved concurrency with prominent warnings:

```javascript
// ⚠️ WARNING: Reserved concurrency temporarily disabled due to AWS account limits
// TODO: Restore after AWS concurrency limit increase is approved
// REQUIRED: reservedConcurrentExecutions: 1 prevents S3 race conditions
// WITHOUT THIS: Concurrent writes may corrupt the S3 object!
// DO NOT USE IN PRODUCTION without reserved concurrency or external locking
const appLambda = new lambda.Function(this, 'AppLambda', {
  // ... other config ...
  // reservedConcurrentExecutions: 1,  // TEMPORARILY COMMENTED - SEE WARNING ABOVE
});
```

**Documentation Updates:**
- Added warning banner in README "Reserved Concurrency = 1" section
- Created new troubleshooting entry with three methods to request limit increase:
  1. AWS Service Quotas Console
  2. AWS CLI command
  3. AWS Support case
- Added restoration instructions for after limit increase

**Long-term Solution:**
Request AWS Lambda concurrency limit increase to 1000:
```bash
aws service-quotas request-service-quota-increase \
  --service-code lambda \
  --quota-code L-B99A9384 \
  --desired-value 1000 \
  --region us-east-1
```

**Trade-off:**
- ⚠️ Deployment works but race condition protection is REMOVED
- ⚠️ Concurrent writes can corrupt S3 object data
- ✅ Suitable for single-user testing only
- ✅ Clear documentation ensures it won't be missed when deploying to production

---

### Problem #3: Construct Metadata Warning ⚠️ (Non-blocking)

**Warning:**
```
[Warning at /TextAppendAppStack/AppLambda/ServiceRole]
Failed to add construct metadata for node [ServiceRole].
Reason: ValidationError: The result of fromAwsManagedPolicyName
can not be used in this API
[ack: @aws-cdk/core:addConstructMetadataFailed]
```

**Root Cause:**
- CDK tries to attach metadata to IAM roles for analytics/tracking
- AWS managed policies don't support certain metadata attachment
- This is internal CDK tracking, not a functional issue

**Decision: Ignore**
- ✅ Warning is harmless and non-blocking
- ✅ Doesn't affect deployment or functionality
- ✅ Stack deploys successfully despite warning
- ❌ Cannot suppress via context flags (different warning system)
- Alternative: Set `"@aws-cdk/core:disableConstructMetadata": true` but unnecessary

---

### Problem #4: README Step Ordering Error ❌ → ✅

**Issue:**
README instructions had users create S3 object in Setup section (step 5), but the S3 bucket doesn't exist until after deployment (step 6+).

**Error users would encounter:**
```bash
aws s3 cp /tmp/initial.txt s3://${S3_BUCKET_NAME}/${S3_OBJECT_KEY}
# NoSuchBucket error - bucket doesn't exist yet!
```

**Solution: Reordered README Sections**

**Before:**
1. Setup Instructions → 5. Create S3 Object
2. Deployment → Deploy App Stack

**After:**
1. Setup Instructions (removed S3 object creation)
2. Deployment → Deploy App Stack
3. Deployment → Create S3 Object ✅ (bucket now exists)
4. Deployment → Test Endpoints

**Code Changes:**
- Moved "Create the Initial S3 Object" section from Setup to Deployment
- Added clear note: "The S3 bucket now exists"
- Added testing commands immediately after object creation
- Improved deployment workflow clarity

---

### Problem #5: Circuit Breaker Not Working (IAM Permission) ❌ → ✅

**Symptoms:**
- S3 event notification configured correctly ✅
- Guard Lambda being triggered ✅
- API stage NOT being deleted ❌
- No errors in logs ❌ (wait, there were errors!)

**Investigation:**
Checked Guard Lambda CloudWatch logs and found:
```
ERROR Guard Lambda error: AccessDeniedException:
User: arn:aws:sts::376309481893:assumed-role/.../GuardLambda
is not authorized to perform: apigateway:DELETE on resource:
arn:aws:apigateway:us-west-2::/apis/2p9zkwbwnc/stages/$default
because no identity-based policy allows the apigateway:DELETE action
```

**Root Cause:**
Used wrong IAM action in Security Stack:
```javascript
// WRONG - this IAM action doesn't exist for API Gateway V2
actions: ['apigateway:DeleteStage']
```

**API Gateway V2 uses REST-style IAM actions**, not operation-specific names:
- ✅ `apigateway:GET`, `apigateway:POST`, `apigateway:PUT`, `apigateway:DELETE`
- ❌ `apigateway:GetStage`, `apigateway:DeleteStage`, etc.

This is different from API Gateway V1 (REST API) which uses operation names.

**Solution:**
Changed IAM action in `lib/text-append-security-stack.js`:
```javascript
// AFTER - correct IAM action for API Gateway V2
actions: ['apigateway:DELETE']
```

**Deployment & Testing:**
```bash
# Redeploy Security Stack
cdk deploy TextAppendSecurityStack

# Test circuit breaker
curl -X PUT "${API_URL}append" -d "First write"
curl -X PUT "${API_URL}append" -d "Second write"  # Triggers circuit breaker
curl "${API_URL}read"  # 404 - API stage deleted! ✅
```

**Result:** ✅ Circuit breaker now works correctly!

---

## Final Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    TextAppendAppStack                            │
│                                                                   │
│  ┌──────────────┐         ┌──────────────┐      ┌────────────┐ │
│  │   S3 Bucket  │◄────────│  App Lambda  │◄─────│  HTTP API  │ │
│  │              │         │              │      │  Gateway   │ │
│  │ data.txt     │         │ Concurrency: │      │  (v2)      │ │
│  │ +metadata    │         │ [commented]  │      │            │ │
│  └──────┬───────┘         └──────────────┘      └─────▲──────┘ │
│         │                                              │         │
│         │ S3 Event                             ┌───────┴──────┐ │
│         │ Notification                         │  Public API  │ │
└─────────┼──────────────────────────────────────┴──────────────┘ │
          │                                       PUT /append      │
          │                                       GET /read        │
          │                                                        │
          ▼                                                        │
┌─────────────────────────────────────────────────────────────────┘
│                 TextAppendSecurityStack
│
│  ┌──────────────────┐        ┌──────────────────────┐
│  │  Guard Lambda    │        │ Custom Resource      │
│  │                  │        │ Lambda               │
│  │ - Check metadata │        │                      │
│  │ - If < 30 min:   │        │ - Configures S3      │
│  │   DELETE stage   │        │   notifications      │
│  └──────────────────┘        └──────────────────────┘
│
│  Permissions:                  Permissions:
│  - s3:GetObject                - s3:PutBucketNotification
│  - apigateway:DELETE           - s3:GetBucketNotification
└─────────────────────────────────────────────────────────────────┘
```

### File Structure

```
/workspaces/ispeed/
├── .env                                    # Environment config (not in git)
├── .env.example                            # Template
├── README.md                               # User documentation
├── DEVELOPMENT_JOURNEY.md                  # This file
├── spec.md                                 # Original requirements
├── cdk.json                                # CDK configuration
├── package.json                            # Dependencies
├── bin/
│   └── ispeed.js                          # CDK app entry (dotenv, validation)
├── lib/
│   ├── text-append-app-stack.js           # App Stack definition
│   └── text-append-security-stack.js      # Security Stack definition
└── lambda/
    ├── app-handler/
    │   └── index.mjs                       # App Lambda (append/read)
    ├── guard-handler/
    │   └── index.mjs                       # Guard Lambda (circuit breaker)
    └── s3-notification-config/
        └── index.mjs                       # Custom Resource Lambda
```

### Data Flow

#### Append Flow
1. Client → `PUT /append` with plain text body
2. API Gateway → App Lambda
3. App Lambda → Read S3 object
4. App Lambda → Append text + newline
5. App Lambda → Upload to S3 with `x-amz-meta-last-write` = current timestamp
6. S3 → Trigger ObjectCreated event → Guard Lambda
7. Guard Lambda → HeadObject to get metadata
8. Guard Lambda → Calculate time difference
9. **IF** < 30 minutes: Guard Lambda → DeleteStage (circuit breaker!) 🔥
10. **ELSE**: Do nothing

#### Read Flow
1. Client → `GET /read`
2. API Gateway → App Lambda
3. App Lambda → Read S3 object
4. App Lambda → Return content as text/plain

#### Circuit Breaker Recovery
1. User → `aws apigatewayv2 create-stage --api-id ... --stage-name '$default' --auto-deploy`
2. API Gateway → Stage recreated
3. API operational again ✅

---

## Key Decisions & Trade-offs

### 1. Custom Resource vs. Direct Bucket Modification
**Decision:** Use Custom Resource Lambda to configure S3 notifications
**Trade-off:**
- ➕ Avoids circular dependency
- ➕ Cleaner stack separation
- ➖ More complex (additional Lambda function)
- ➖ Requires understanding of Custom Resource lifecycle

### 2. Reserved Concurrency Temporarily Disabled
**Decision:** Comment out `reservedConcurrentExecutions: 1` due to account limits
**Trade-off:**
- ➕ Deployment succeeds in limited AWS environment
- ➖ Race condition protection REMOVED
- ⚠️ NOT suitable for production
- ✅ Clearly documented with warnings

### 3. Plain Text Body (Not JSON)
**Decision:** Accept raw request body as text, not JSON with `{text: "..."}`
**Trade-off:**
- ➕ Simpler implementation
- ➕ Lower bandwidth (no JSON overhead)
- ➖ Less structured
- ➖ Cannot add additional fields (metadata, options)

### 4. Error on Missing S3 Object
**Decision:** Return 404 if object doesn't exist (don't auto-create)
**Trade-off:**
- ➕ Explicit control over initialization
- ➕ Prevents accidental object creation
- ➖ Requires manual setup step
- ➖ Less "magic" for end users

### 5. Destructive Circuit Breaker (Stage Deletion)
**Decision:** Delete API stage rather than disable routes or use authorizer
**Trade-off:**
- ➕ Strong deterrent (requires manual recovery)
- ➕ Complete API shutdown (cannot bypass)
- ➖ Requires AWS CLI knowledge to recover
- ➖ No automatic recovery mechanism

### 6. Two-Stack Architecture
**Decision:** Split into App and Security stacks (per spec requirement)
**Trade-off:**
- ➕ Allows testing App Stack independently
- ➕ Security layer can be added/removed without affecting core app
- ➖ More complex deployment
- ➖ Cross-stack references add coupling

### 7. API Gateway V2 (HTTP API)
**Decision:** Use HTTP API (v2) instead of REST API (v1)
**Trade-off:**
- ➕ Lower cost (~70% cheaper)
- ➕ Better performance
- ➕ Simpler configuration
- ➖ Different IAM action names (learned the hard way!)
- ➖ Fewer features than REST API

---

## Lessons Learned

### Technical Lessons

1. **Circular Dependencies in CDK**
   - Direct construct modification creates implicit dependencies
   - Use Custom Resources for runtime configuration
   - CloudFormation has strict dependency rules - understand the DAG

2. **API Gateway V2 IAM Permissions**
   - HTTP API uses REST-style actions: `GET`, `POST`, `PUT`, `DELETE`
   - REST API uses operation names: `GetStage`, `DeleteStage`
   - Always check AWS documentation for exact IAM action names

3. **AWS Account Limits**
   - Sandbox/learning environments may have severely restricted quotas
   - Lambda concurrency limit can be 10 instead of default 1000
   - Always check account settings when encountering quota errors

4. **Reserved Concurrency for Race Condition Prevention**
   - Setting `reservedConcurrentExecutions: 1` serializes Lambda invocations
   - Critical for read-modify-write operations on shared resources
   - Trade-off: limits throughput but ensures data consistency

5. **Custom Resources in CDK**
   - Powerful pattern for runtime configuration
   - Must implement all lifecycle events: CREATE, UPDATE, DELETE
   - Must send CloudFormation response (SUCCESS or FAILED)
   - Failure to respond causes CloudFormation to hang for 1 hour

6. **S3 Metadata in Lambda**
   - Metadata keys accessed WITHOUT `x-amz-meta-` prefix in SDK responses
   - But MUST be set WITH prefix in PutObjectCommand (AWS adds it)
   - Use ISO 8601 timestamps for cross-platform compatibility

### Process Lessons

1. **Ask Clarifying Questions First**
   - Saved time by understanding requirements before coding
   - Plain text vs JSON decision affected entire implementation
   - Error handling strategy (404 vs auto-create) simplified Lambda logic

2. **Comprehensive Planning Pays Off**
   - Used Plan agent to create detailed implementation guide
   - Anticipated most architectural decisions
   - Plan file served as implementation roadmap

3. **Documentation Matters**
   - Created README before deployment
   - Caught logical error (S3 object creation before bucket exists)
   - Recovery procedures essential for circuit breaker design

4. **Test Early, Test Often**
   - User tested after each stack deployment
   - CloudWatch Logs were critical for debugging circuit breaker
   - S3 notification configuration verified via AWS CLI

5. **Clear Warnings for Temporary Workarounds**
   - Reserved concurrency disabled with prominent warnings
   - Documented restoration steps
   - Prevents production deployment without fix

### CDK Best Practices

1. **Cross-Stack References**
   - Pass construct objects via props (type-safe)
   - CDK automatically generates CloudFormation exports/imports
   - Use explicit `addDependency()` to enforce deployment order

2. **Environment Variables**
   - Use dotenv for local configuration
   - Validate early (in `bin/` entry point)
   - Fail fast with clear error messages

3. **CloudFormation Outputs**
   - Export critical values (API URL, API ID)
   - Use descriptive export names
   - Makes testing and debugging easier

4. **Resource Naming**
   - Let CDK generate logical IDs (don't override unless necessary)
   - Use descriptive construct IDs for readability
   - Physical resource names shown in AWS console

---

## Testing & Validation

### Pre-Deployment Validation

```bash
# Synthesize CloudFormation templates
cdk synth

# Review differences before deployment
cdk diff
```

### Deployment Sequence

```bash
# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy App Stack
cdk deploy TextAppendAppStack

# Create initial S3 object
echo "Initial content" | aws s3 cp - s3://${S3_BUCKET_NAME}/${S3_OBJECT_KEY}

# Test App Stack endpoints
export API_URL=$(aws cloudformation describe-stacks \
  --stack-name TextAppendAppStack \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiUrl`].OutputValue' \
  --output text)

curl "${API_URL}read"  # Should return "Initial content"
curl -X PUT "${API_URL}append" -d "Test line"
curl "${API_URL}read"  # Should return "Initial content\nTest line\n"

# Deploy Security Stack
cdk deploy TextAppendSecurityStack

# Test circuit breaker
curl -X PUT "${API_URL}append" -d "First write"
curl -X PUT "${API_URL}append" -d "Second write"  # Triggers circuit breaker
sleep 5  # Wait for Guard Lambda to process
curl "${API_URL}read"  # Should fail - API stage deleted!
```

### Post-Deployment Validation

#### 1. Verify S3 Event Notification
```bash
aws s3api get-bucket-notification-configuration --bucket ${S3_BUCKET_NAME}
```

Expected output:
```json
{
  "LambdaFunctionConfigurations": [
    {
      "Id": "guard-lambda-notification-...",
      "LambdaFunctionArn": "arn:aws:lambda:...:function:TextAppendSecurityStack-GuardLambda...",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {"Name": "Prefix", "Value": "speeds.txt"}
          ]
        }
      }
    }
  ]
}
```

#### 2. Verify S3 Metadata
```bash
aws s3api head-object --bucket ${S3_BUCKET_NAME} --key ${S3_OBJECT_KEY} --query 'Metadata'
```

Expected output:
```json
{
  "last-write": "2026-01-01T00:26:13.123Z"
}
```

#### 3. Check CloudWatch Logs

**App Lambda:**
```bash
aws logs tail /aws/lambda/TextAppendAppStack-AppLambda... --follow
```

Expected log entries:
```
Event: { requestContext: { http: { method: 'PUT', path: '/append' } }, body: 'Test line' }
Successfully appended text to S3
```

**Guard Lambda (after circuit breaker triggers):**
```bash
aws logs tail /aws/lambda/TextAppendSecurityStack-GuardLambda... --follow
```

Expected log entries:
```
Guard Lambda triggered: { Records: [ ... ] }
Processing: bucket-name/speeds.txt
Last write timestamp: 2026-01-01T00:26:13.123Z
Time difference: 0.05 minutes
Threshold breached! Deleting API stage: $default
Successfully deleted stage: $default
```

#### 4. Verify Circuit Breaker Recovery
```bash
# Get API ID
export API_ID=$(aws cloudformation describe-stacks \
  --stack-name TextAppendAppStack \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiId`].OutputValue' \
  --output text)

# Recreate stage
aws apigatewayv2 create-stage \
  --api-id $API_ID \
  --stage-name '$default' \
  --auto-deploy

# Verify recovery
curl "${API_URL}read"  # Should work again!
```

---

## Final Status

### ✅ Successfully Completed

- [x] Two-stack CDK architecture (App + Security)
- [x] App Lambda with PUT /append and GET /read endpoints
- [x] Plain text body handling
- [x] S3 metadata timestamp tracking
- [x] Guard Lambda circuit breaker (30-minute threshold)
- [x] API stage deletion on threshold breach
- [x] Manual recovery via AWS CLI
- [x] Comprehensive documentation (README.md)
- [x] Custom Resource for S3 notification (circular dependency fix)
- [x] Correct IAM permissions (apigateway:DELETE)
- [x] Deployment and testing validated

### ⚠️ Temporary Workarounds

- Reserved concurrency disabled due to AWS account limits
  - **Impact:** Race condition protection removed
  - **Mitigation:** Documented prominently, testing with single user only
  - **Resolution:** Request AWS concurrency limit increase to 1000

### 📊 Project Metrics

- **Total Cost:** $5.50 (API usage)
- **API Duration:** 25 minutes 24 seconds
- **Wall Time:** 3 days 23 minutes (including planning and troubleshooting)
- **Code Changes:** 2,459 lines added, 69 lines removed
- **Files Created:** 10 (Lambda handlers, stacks, configs, docs)
- **Problems Solved:** 5 (circular dependency, concurrency limits, README ordering, IAM permissions, metadata warnings)

---

## Conversation Highlights

### User Quotes

> "I'll review, deploy, and test myself."
> *(After plan approval - autonomous testing)*

> "When I run 'cdk bootstrap' I get the following error..."
> *(First major issue - circular dependency)*

> "The 'aws lambda get-account-settings' returned... ConcurrentExecutions: 10"
> *(Discovery of severe account limitations)*

> "I added the flag to cdk.json but it did not suppress the warning."
> *(Attempting to fix non-critical metadata warning)*

> "There is a problem with the README.md file. Section 5 (create the initial S3 object) fails because the TextAppendAppStack stack has not been deployed yet."
> *(Excellent catch on documentation logic error)*

> "I deployed both stacks and the circuit breaker is not working."
> *(Beginning of final debugging session)*

> "It's working now, capture the conversation"
> *(Success! 🎉)*

### Assistant Approach

1. **Planning First:** Used specialized agents (Explore, Plan) before implementation
2. **Clear Communication:** Explained problems and solutions with code examples
3. **Proactive Documentation:** Updated README alongside code changes
4. **Debugging Methodology:** Systematic checks (S3 config → Logs → Permissions)
5. **Learning Moments:** Explained WHY (e.g., API Gateway V2 IAM actions)

---

## Conclusion

This project successfully implemented a serverless text-append service with a unique circuit breaker security mechanism. The journey involved:

- **5 significant problems** solved (circular dependencies, AWS limits, IAM permissions)
- **3 Lambda functions** (App, Guard, Custom Resource)
- **2 CDK stacks** with cross-stack references
- **1 working circuit breaker** that enforces write frequency limits

The implementation demonstrates:
- Advanced CDK patterns (Custom Resources, cross-stack references)
- AWS SDK v3 usage (S3, API Gateway V2)
- CloudFormation Custom Resource lifecycle management
- Comprehensive documentation and error handling
- Real-world debugging and problem-solving

**Status:** Production-ready except for reserved concurrency (pending AWS limit increase)

---

**Document Generated:** January 1, 2026
**Final Deployment:** TextAppendAppStack + TextAppendSecurityStack
**Circuit Breaker Status:** ✅ Fully Functional
**Next Steps:** Request AWS Lambda concurrency limit increase, restore reserved concurrency, deploy to production

---

*End of Development Journey*
