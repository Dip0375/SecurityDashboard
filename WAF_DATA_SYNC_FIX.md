# WAF Data Sync Fix - CloudWatch Metrics Integration

## Issue Fixed
The SecureView dashboard was displaying different data than AWS WAF console because it was using **sampled requests** (~1% of traffic) instead of **actual CloudWatch metrics**.

## Solution Implemented
Updated the application to fetch exact CloudWatch metrics for WAF data:

### Changes Made:

1. **Added CloudWatch Client** (`api/aws-query.js`)
   - Imported `CloudWatchClient` and `GetMetricStatisticsCommand` from `@aws-sdk/client-cloudwatch`

2. **Created New Function: `getWAFCloudWatchMetrics()`**
   - Fetches exact metrics from CloudWatch for each WebACL
   - Queries metrics for last 24 hours:
     - `AllowedRequests` (Sum)
     - `BlockedRequests` (Sum)
     - `CountedRequests` (Sum)
     - `ChallengeRequests` (Sum)
     - `CaptchaRequests` (Sum)

3. **Updated `getWAFData()` Function**
   - Now tries CloudWatch metrics first
   - Falls back to sampled requests if CloudWatch is unavailable
   - Returns `metricsSource` field indicating data source

4. **Updated Dependencies** (`package.json`)
   - Added `@aws-sdk/client-cloudwatch: ^3.1045.0`

## Setup Requirements

### 1. Install Dependencies
```bash
npm install
```

### 2. IAM Permissions Required
Your AWS credentials need these permissions to fetch CloudWatch metrics:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:GetMetricStatistics",
        "wafv2:ListWebACLs",
        "wafv2:GetWebACL",
        "wafv2:ListResourcesForWebACL",
        "wafv2:GetSampledRequests"
      ],
      "Resource": "*"
    }
  ]
}
```

### 3. Environment Configuration
Ensure your AWS credentials are set up in environment variables:
```
AWS_ACCOUNT_<ACCOUNT_ID>_ACCESS_KEY_ID
AWS_ACCOUNT_<ACCOUNT_ID>_SECRET_ACCESS_KEY
AWS_ACCOUNT_<ACCOUNT_ID>_REGION
```

## How It Works

### Data Hierarchy:
1. **CloudWatch Metrics** (Preferred) - Exact aggregated metrics from CloudWatch
2. **Sampled Requests** (Fallback) - Approximated from WAF sampling (~1%)
3. **Rule Counts** (Last Resort) - Fallback if no traffic detected

### Response Object
The WAF data response now includes:
```javascript
{
  allow: 24,           // From CloudWatch AllowedRequests
  block: 0,            // From CloudWatch BlockedRequests
  count: 0,            // From CloudWatch CountedRequests
  challenge: 19,       // From CloudWatch ChallengeRequests
  captcha: 0,          // From CloudWatch CaptchaRequests
  totalTraffic: 43,
  metricsSource: "CloudWatch",      // NEW: Indicates data source
  usingCloudWatchMetrics: true,     // NEW: Boolean flag
  // ... other fields (webACLs, rules, etc.)
}
```

## Verification

### 1. Check Data Sync
- Open SecureView dashboard
- Compare metrics with AWS WAF console
- Metrics should now match exactly

### 2. Check Logs
Look for log messages indicating CloudWatch usage:
```
[aws-query] Using exact CloudWatch metrics for WAF data
```

Or if falling back to sampled data:
```
[aws-query] CloudWatch metrics fetch failed, falling back to sampled requests
```

## Troubleshooting

### Issue: CloudWatch metrics are still falling back to sampled data
**Solution:** Ensure your IAM user/role has `cloudwatch:GetMetricStatistics` permission

### Issue: Metrics showing zero
**Solution:** This is normal if there's no WAF traffic. CloudWatch only stores metrics when there's traffic.

### Issue: Permission denied errors
**Solution:** Add the required IAM permissions listed in the "IAM Permissions Required" section

## Time Window
- CloudWatch metrics are fetched for the **last 24 hours**
- Data is aggregated hourly for performance
- If you need a different time window, modify the `getWAFCloudWatchMetrics()` function

## Next Steps
1. Install dependencies: `npm install`
2. Verify IAM permissions
3. Restart the application
4. Compare SecureView metrics with AWS WAF console
5. Both should now show identical data
