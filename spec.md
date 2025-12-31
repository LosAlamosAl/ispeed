# Product Specification: Serverless Text-Append Service (Multi-Stack)

## 1. Project Overview

A serverless public API that appends text to a single S3 object. The system is split into two stacks to allow the core application to be tested before the "Circuit Breaker" security layer is deployed.

## 2. Technical Stack

- **IaC Framework:** AWS CDK (JavaScript)
- **API Version:** API Gateway HTTP API (v2)
- **Runtime:** Node.js 20.x
- **Storage:** Amazon S3 (Standard, No Versioning)
- **Configuration:** `.env` file for S3 Bucket and Object names.

## 3. Architecture & Multi-Stack Structure

The project MUST be structured as two separate stacks in `bin/app.js`:

### A. TextAppendAppStack (The "App")

- **Resources:**
  - **S3 Bucket:** Non-versioned. Name pulled from `.env`.
  - **HTTP API:** Public, no auth.
  - **App Lambda:** Handles `PUT /append` and `GET /read`.
- **App Lambda Logic:**
  - **PUT:** Reads object, appends text + `\n`, and uploads with metadata `x-amz-meta-last-write` set to current timestamp.
  - **GET:** Returns object content as `text/plain`.
- **Concurrency:** `reservedConcurrentExecutions: 1` to prevent S3 race conditions.

### B. TextAppendSecurityStack (The "Guard")

- **Dependency:** Depends on `TextAppendAppStack`.
- **Resources:**
  - **Guard Lambda:** Triggered by `s3:ObjectCreated:*` on the App's bucket.
- **Guard Lambda Logic:**
  1. Check `x-amz-meta-last-write` metadata via `HeadObjectCommand`.
  2. If (Current Time - Metadata Timestamp) < 30 minutes:
     - Call `apigatewayv2.DeleteStage` for the `$default` stage of the App API.
- **Permissions:** `s3:GetObject` and `apigateway:DeleteStage`.

## 4. Implementation Requirements

1. **Environment Variables:** Use `dotenv` in the CDK app to load `S3_BUCKET_NAME` and `S3_OBJECT_KEY`.
2. **Cross-Stack References:** Pass the `Bucket` and `HttpApi` objects from the App Stack to the Security Stack as properties.
3. **AWS SDK v3:** Use `@aws-sdk/client-s3` and `@aws-sdk/client-apigatewayv2`.
4. **Outputs:** Export the `HttpApiUrl` and `HttpApiId` as CloudFormation outputs.

## 5. Deployment Workflow

1. User deploys `TextAppendAppStack` first to verify functionality.
2. User deploys `TextAppendSecurityStack` once the app logic is confirmed.
