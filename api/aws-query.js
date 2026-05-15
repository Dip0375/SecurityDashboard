/**
 * api/aws-query.js  (Vercel Serverless Function)
 * ──────────────────────────────────────────────────────────────────────────────
 * This is the ONLY place where AWS credentials are used.
 * The browser never receives raw keys – it only receives query results.
 *
 * HOW TO ADD AN ACCOUNT (secure flow):
 * 1.  User enters Access Key + Secret Key in the dashboard UI.
 * 2.  The dashboard POSTs them to /api/store-credentials  (see below).
 * 3.  That route stores them in Vercel Environment Variables OR
 *     AWS Secrets Manager (both options shown).
 * 4.  This file reads from env vars / Secrets Manager – never from the client.
 *
 * ENV VAR NAMING CONVENTION (set in Vercel Dashboard → Settings → Env Vars):
 *   AWS_ACCOUNT_<ACCOUNT_ID>_ACCESS_KEY_ID
 *   AWS_ACCOUNT_<ACCOUNT_ID>_SECRET_ACCESS_KEY
 *   AWS_ACCOUNT_<ACCOUNT_ID>_REGION
 *
 * Example for account 123456789012:
 *   AWS_ACCOUNT_123456789012_ACCESS_KEY_ID     = AKIAIOSFODNN7EXAMPLE
 *   AWS_ACCOUNT_123456789012_SECRET_ACCESS_KEY = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
 *   AWS_ACCOUNT_123456789012_REGION            = us-east-1
 *
 * These variables are PRIVATE (not exposed to the browser bundle).
 *
 * ─── REQUIRED NPM PACKAGES ────────────────────────────────────────────────────
 * npm install @aws-sdk/client-ec2 @aws-sdk/client-eks @aws-sdk/client-s3
 *             @aws-sdk/client-elastic-load-balancing-v2
 */

import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
} from "@aws-sdk/client-ec2";
import { EKSClient, ListClustersCommand, DescribeClusterCommand } from "@aws-sdk/client-eks";
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketPolicyStatusCommand,
  GetBucketAclCommand,
} from "@aws-sdk/client-s3";
import { getSupabaseClient, decryptPayload } from "./supabaseClient.js";
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  WAFV2Client,
  ListWebACLsCommand,
  GetWebACLCommand,
  ListResourcesForWebACLCommand,
  GetSampledRequestsCommand,
} from "@aws-sdk/client-wafv2";
import {
  SecurityHubClient,
  GetFindingsCommand,
  DescribeStandardsCommand,
  GetEnabledStandardsCommand,
} from "@aws-sdk/client-securityhub";
import {
  GuardDutyClient,
  ListDetectorsCommand,
  ListFindingsCommand,
  GetFindingsCommand as GetGuardDutyFindingsCommand,
} from "@aws-sdk/client-guardduty";
import {
  Inspector2Client,
  ListFindingsCommand as ListInspectorFindingsCommand,
} from "@aws-sdk/client-inspector2";
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from "@aws-sdk/client-cloudwatch";
import { getMitreDetails } from "./mitre-mapping.js";

// ─── Resolve credentials from environment ────────────────────────────────────
async function resolveCredentials(accountId, requestCredential) {
  if (requestCredential?.accessKeyId && requestCredential?.secretAccessKey) {
    return {
      accessKeyId: requestCredential.accessKeyId,
      secretAccessKey: requestCredential.secretAccessKey,
      region: requestCredential.region || "us-east-1",
    };
  }

  const safe = accountId.replace(/\D/g, ""); // digits only
  const accessKeyId     = process.env[`AWS_ACCOUNT_${safe}_ACCESS_KEY_ID`];
  const secretAccessKey = process.env[`AWS_ACCOUNT_${safe}_SECRET_ACCESS_KEY`];
  const region          = process.env[`AWS_ACCOUNT_${safe}_REGION`] || "us-east-1";

  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey, region };
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("aws_account_credentials")
      .select("encrypted_secret")
      .eq("account_id", accountId)
      .single();
    
    if (error) {
      if (error.code === "PGRST116") {
        throw new Error(`Credential record not found in Supabase for account ${accountId}. Please re-add the account with IAM keys.`);
      }
      throw new Error(`Supabase query error: ${error.message}`);
    }
    
    if (!data?.encrypted_secret) {
      throw new Error(`Credential record exists but contains no encrypted data for account ${accountId}.`);
    }

    try {
      return decryptPayload(data.encrypted_secret);
    } catch (decryptErr) {
      throw new Error(`Decryption failed for account ${accountId}. Check if APP_ENCRYPTION_KEY is correct in Vercel. Original error: ${decryptErr.message}`);
    }
  } catch (err) {
    console.error(`[aws-query] Credential resolution failed for ${accountId}:`, err.message);
    throw err; 
  }
}

// ─── EC2 inventory ────────────────────────────────────────────────────────────
async function getEC2Inventory(client) {
  const res = await client.send(new DescribeInstancesCommand({ MaxResults: 1000 }));
  const instances = (res.Reservations || []).flatMap((r) =>
    (r.Instances || []).map((i) => ({
      id:    i.InstanceId,
      name:  i.Tags?.find((t) => t.Key === "Name")?.Value || i.InstanceId,
      type:  i.InstanceType,
      state: i.State?.Name,
      az:    i.Placement?.AvailabilityZone,
    }))
  );
  return {
    total:   instances.length,
    running: instances.filter((i) => i.state === "running").length,
    stopped: instances.filter((i) => i.state === "stopped").length,
    instances,
  };
}

// ─── EKS inventory ────────────────────────────────────────────────────────────
async function getEKSInventory(client) {
  const list = await client.send(new ListClustersCommand({}));
  const clusters = await Promise.all(
    (list.clusters || []).map(async (name) => {
      const { cluster: c } = await client.send(new DescribeClusterCommand({ name }));
      return {
        name:      c.name,
        status:    c.status,
        version:   c.version,
        nodeCount: null, // requires managed node group calls – add if needed
      };
    })
  );
  return { total: clusters.length, clusters };
}

// ─── S3 inventory ─────────────────────────────────────────────────────────────
async function getS3Inventory(s3Client, region) {
  const list = await s3Client.send(new ListBucketsCommand({}));
  const buckets = await Promise.all(
    (list.Buckets || []).map(async (b) => {
      let isPublic = false;
      let bucketRegion = "unknown";
      try {
        const loc = await s3Client.send(new GetBucketLocationCommand({ Bucket: b.Name }));
        bucketRegion = loc.LocationConstraint || "us-east-1";
      } catch { /* ignore */ }
      try {
        // GetBucketPolicyStatus returns {IsPublic: true} if bucket policy grants public access
        const ps = await s3Client.send(new GetBucketPolicyStatusCommand({ Bucket: b.Name }));
        if (ps.PolicyStatus?.IsPublic) isPublic = true;
      } catch { /* bucket has no policy – fine */ }
      if (!isPublic) {
        try {
          const acl = await s3Client.send(new GetBucketAclCommand({ Bucket: b.Name }));
          isPublic = (acl.Grants || []).some(
            (g) =>
              g.Grantee?.URI === "http://acs.amazonaws.com/groups/global/AllUsers" ||
              g.Grantee?.URI === "http://acs.amazonaws.com/groups/global/AuthenticatedUsers"
          );
        } catch { /* ignore */ }
      }
      return { name: b.Name, isPublic, region: bucketRegion };
    })
  );
  return {
    total:   buckets.length,
    public:  buckets.filter((b) => b.isPublic).length,
    private: buckets.filter((b) => !b.isPublic).length,
    buckets,
  };
}

// ─── VPC inventory ────────────────────────────────────────────────────────────
async function getVPCInventory(ec2Client) {
  const [vpcsRes, subnetsRes] = await Promise.all([
    ec2Client.send(new DescribeVpcsCommand({})),
    ec2Client.send(new DescribeSubnetsCommand({})),
  ]);
  const subnetMap = {};
  (subnetsRes.Subnets || []).forEach((s) => {
    subnetMap[s.VpcId] = (subnetMap[s.VpcId] || 0) + 1;
  });
  const vpcs = (vpcsRes.Vpcs || []).map((v) => ({
    id:        v.VpcId,
    name:      v.Tags?.find((t) => t.Key === "Name")?.Value || v.VpcId,
    cidr:      v.CidrBlock,
    isDefault: v.IsDefault,
    subnets:   subnetMap[v.VpcId] || 0,
  }));
  return { total: vpcs.length, vpcs };
}

// ─── ALB inventory ────────────────────────────────────────────────────────────
async function getALBInventory(client) {
  const res = await client.send(new DescribeLoadBalancersCommand({}));
  const loadBalancers = (res.LoadBalancers || []).map((lb) => ({
    name:   lb.LoadBalancerName,
    scheme: lb.Scheme,
    state:  lb.State?.Code,
    dns:    lb.DNSName,
  }));
  return { total: loadBalancers.length, loadBalancers };
}

function emptySeverity() {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

function severityKey(value) {
  const sev = String(value || "").toLowerCase();
  if (sev === "informational") return "low";
  return ["critical", "high", "medium", "low"].includes(sev) ? sev : "low";
}

async function safeCall(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[aws-query] ${label} unavailable:`, err.name || err.message);
    return { ...fallback, error: err.message };
  }
}

// ─── Map AWS WAF rule action to a display string ─────────────────────────────
function resolveRuleAction(r) {
  if (r.Action?.Allow)     return "ALLOW";
  if (r.Action?.Block)     return "BLOCK";
  if (r.Action?.Count)     return "COUNT";
  if (r.Action?.Captcha)   return "CAPTCHA";
  if (r.Action?.Challenge) return "CHALLENGE";
  // Managed rule groups use OverrideAction instead of Action
  if (r.OverrideAction?.Count) return "COUNT";
  if (r.OverrideAction?.None)  return "MANAGED";
  return "MANAGED";
}

// ─── All AWS regions where WAF Regional WebACLs can exist ────────────────────const WAF_REGIONAL_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "ca-central-1", "ca-west-1",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-central-2",
  "eu-north-1", "eu-south-1", "eu-south-2",
  "ap-south-1", "ap-south-2",
  "ap-southeast-1", "ap-southeast-2", "ap-southeast-3", "ap-southeast-4",
  "ap-northeast-1", "ap-northeast-2", "ap-northeast-3",
  "ap-east-1",
  "me-south-1", "me-central-1",
  "af-south-1",
  "sa-east-1",
  "il-central-1",
];

// ─── Scan one region for Regional WebACLs ────────────────────────────────────
async function scanRegionForWebACLs(awsCreds, region) {
  const client = new WAFV2Client({ ...awsCreds, region });
  const webACLs = [];
  try {
    const res = await client.send(new ListWebACLsCommand({ Scope: "REGIONAL", Limit: 100 }));
    for (const acl of res.WebACLs || []) {
      let detail = null;
      let attachedResources = [];
      try {
        const full = await client.send(new GetWebACLCommand({ Scope: "REGIONAL", Name: acl.Name, Id: acl.Id }));
        detail = full.WebACL;
      } catch (e) { /* skip detail */ }
      try {
        const r = await client.send(new ListResourcesForWebACLCommand({ WebACLArn: acl.ARN }));
        attachedResources = r.ResourceArns || [];
      } catch (e) { /* skip resources */ }

      webACLs.push({
        name: acl.Name,
        id: acl.Id,
        scope: "REGIONAL",
        region,
        arn: acl.ARN,
        attachedResources,
        defaultAction: detail?.DefaultAction?.Allow ? "ALLOW" : detail?.DefaultAction?.Block ? "BLOCK" : "UNKNOWN",
        rules: (detail?.Rules || []).map(r => ({
          name: r.Name,
          priority: r.Priority,
          action: resolveRuleAction(r),
          ruleGroup: r.Statement?.RuleGroupReferenceStatement?.ARN?.split("/").pop()
            || r.Statement?.ManagedRuleGroupStatement?.Name
            || null,
          metricName: r.VisibilityConfig?.MetricName || r.Name,
        })),
        defaultMetricName: detail?.VisibilityConfig?.MetricName || acl.Name,
      });
    }
  } catch (e) {
    // Region may not support WAF or credentials may not have access — skip silently
  }
  return webACLs;
}

async function getWAFData(awsCreds, timeRangeHours = 24) {
  const webACLs = [];

  // ── 1. Scan CloudFront (GLOBAL) — always us-east-1 ───────────────────────
  const globalClient = new WAFV2Client({ ...awsCreds, region: "us-east-1" });
  try {
    const res = await globalClient.send(new ListWebACLsCommand({ Scope: "CLOUDFRONT", Limit: 100 }));
    for (const acl of res.WebACLs || []) {
      let detail = null;
      try {
        const full = await globalClient.send(new GetWebACLCommand({ Scope: "CLOUDFRONT", Name: acl.Name, Id: acl.Id }));
        detail = full.WebACL;
      } catch (e) { /* skip */ }

      webACLs.push({
        name: acl.Name,
        id: acl.Id,
        scope: "CLOUDFRONT",
        region: "us-east-1",
        arn: acl.ARN,
        attachedResources: [],   // CloudFront associations are on the distribution, not here
        defaultAction: detail?.DefaultAction?.Allow ? "ALLOW" : detail?.DefaultAction?.Block ? "BLOCK" : "UNKNOWN",
        rules: (detail?.Rules || []).map(r => ({
          name: r.Name,
          priority: r.Priority,
          action: resolveRuleAction(r),
          ruleGroup: r.Statement?.RuleGroupReferenceStatement?.ARN?.split("/").pop()
            || r.Statement?.ManagedRuleGroupStatement?.Name
            || null,
          metricName: r.VisibilityConfig?.MetricName || r.Name,
        })),
        defaultMetricName: detail?.VisibilityConfig?.MetricName || acl.Name,
      });
    }
  } catch (e) {
    console.warn("[aws-query] CloudFront WAF scan failed:", e.message);
  }

  // ── 2. Scan ALL regions for Regional WebACLs in parallel ─────────────────
  // Start with the account's primary region, then fan out to all others.
  // We use a concurrency limit to avoid hitting API rate limits.
  const primaryRegion = awsCreds.region;
  const otherRegions  = WAF_REGIONAL_REGIONS.filter(r => r !== primaryRegion);
  const allRegions    = [primaryRegion, ...otherRegions];

  // Scan in batches of 6 to stay within WAF API rate limits
  const BATCH = 6;
  for (let i = 0; i < allRegions.length; i += BATCH) {
    const batch = allRegions.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(r => scanRegionForWebACLs(awsCreds, r)));
    results.forEach(acls => webACLs.push(...acls));
  }

  // ── 3. Build rule group map ───────────────────────────────────────────────
  const allRules = webACLs.flatMap(acl =>
    acl.rules.map(rule => ({ ...rule, webAcl: acl.name, scope: acl.scope, region: acl.region }))
  );

  const ruleGroupMap = new Map();
  for (const rule of allRules) {
    if (!rule.ruleGroup) continue;
    const existing = ruleGroupMap.get(rule.ruleGroup) || { name: rule.ruleGroup, ruleCount: 0, webACLs: new Set() };
    existing.ruleCount += 1;
    existing.webACLs.add(rule.webAcl);
    ruleGroupMap.set(rule.ruleGroup, existing);
  }
  const managedRuleGroups = Array.from(ruleGroupMap.values()).map(g => ({
    name: g.name, ruleCount: g.ruleCount, webACLs: Array.from(g.webACLs),
  }));

  // ── 4. CloudWatch metrics (exact match with AWS WAF console) ─────────────
  let allow = 0, block = 0, count = 0, challenge = 0, captcha = 0;
  let metricsSource = "RuleConfig";

  try {
    const cwMetrics = await getWAFCloudWatchMetrics(awsCreds, webACLs, timeRangeHours);
    if (cwMetrics.totalTraffic > 0) {
      allow = cwMetrics.allow; block = cwMetrics.block; count = cwMetrics.count;
      challenge = cwMetrics.challenge; captcha = cwMetrics.captcha;
      metricsSource = "CloudWatch";
    }
  } catch (e) {
    console.warn("[aws-query] CloudWatch WAF metrics failed:", e.message);
  }

  // ── 5. Sampled requests for Geo IP, URIs, terminating rules ──────────────
  const geoMap = new Map();
  const uriMap = new Map();
  const terminatedRuleMap = new Map();
  let sampledAllow = 0, sampledBlock = 0, sampledCount = 0, sampledChallenge = 0, sampledCaptcha = 0;

  const sampleHours = Math.min(timeRangeHours, 3);
  const timeWindow = {
    StartTime: new Date(Date.now() - sampleHours * 3600 * 1000),
    EndTime: new Date(),
  };

  // Group ACLs by region so we reuse one client per region
  const aclsByRegion = new Map();
  for (const acl of webACLs) {
    const key = acl.scope === "CLOUDFRONT" ? "us-east-1:CLOUDFRONT" : `${acl.region}:REGIONAL`;
    if (!aclsByRegion.has(key)) aclsByRegion.set(key, { acls: [], region: acl.scope === "CLOUDFRONT" ? "us-east-1" : acl.region, scope: acl.scope });
    aclsByRegion.get(key).acls.push(acl);
  }

  for (const { acls, region: aclRegion, scope } of aclsByRegion.values()) {
    const samplingClient = new WAFV2Client({ ...awsCreds, region: aclRegion });
    for (const acl of acls) {
      const uniqueMetrics = [...new Set([acl.defaultMetricName, ...acl.rules.map(r => r.metricName)].filter(Boolean))];
      for (const metricName of uniqueMetrics) {
        try {
          const sampled = await samplingClient.send(new GetSampledRequestsCommand({
            WebACLArn: acl.arn,
            RuleMetricName: metricName,
            Scope: scope,
            TimeWindow: timeWindow,
            MaxItems: 500,
          }));
          for (const req of sampled.SampledRequests || []) {
            const country  = req.Request?.Country || "Unknown";
            const uri      = req.Request?.URI || "/";
            const termRule = req.TerminatingRuleId || "Default_Action";
            geoMap.set(country,  (geoMap.get(country)  || 0) + 1);
            uriMap.set(uri,      (uriMap.get(uri)       || 0) + 1);
            terminatedRuleMap.set(termRule, (terminatedRuleMap.get(termRule) || 0) + 1);

            const action = req.Action?.toUpperCase() || "";
            if      (action === "ALLOW")     sampledAllow++;
            else if (action === "BLOCK")     sampledBlock++;
            else if (action === "COUNT")     sampledCount++;
            else if (action === "CAPTCHA" || action === "CAPTCHA_REQUEST_CUSTOMRESPONSE") sampledCaptcha++;
            else if (action === "CHALLENGE") sampledChallenge++;
            else sampledAllow++;
          }
        } catch (e) { /* metric may have no traffic */ }
      }
    }
  }

  // If CloudWatch gave no data, fall back to sampled requests
  if (metricsSource === "RuleConfig") {
    const hasSampled = (sampledAllow + sampledBlock + sampledCount + sampledChallenge + sampledCaptcha) > 0;
    if (hasSampled) {
      allow = sampledAllow; block = sampledBlock; count = sampledCount;
      challenge = sampledChallenge; captcha = sampledCaptcha;
      metricsSource = "SampledRequests";
    } else {
      // Last resort: count rules by action type
      allow     = webACLs.filter(a => a.defaultAction === "ALLOW").length;
      block     = allRules.filter(r => r.action === "BLOCK").length;
      count     = allRules.filter(r => r.action === "COUNT").length;
      challenge = allRules.filter(r => r.action === "CHALLENGE").length;
      captcha   = allRules.filter(r => r.action === "CAPTCHA").length;
    }
  }

  // ── 6. Build output arrays ────────────────────────────────────────────────
  const topGeoIPs = Array.from(geoMap.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([country, requests]) => ({ country, requests }));

  const topURIs = Array.from(uriMap.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([uri, requests]) => ({ uri, requests }));

  const blockedRules = Array.from(terminatedRuleMap.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([rule, blocks]) => ({ rule, blocks }));

  const attackTypes = blockedRules
    .filter(r => r.rule !== "Default_Action")
    .slice(0, 10)
    .map(r => ({ type: r.rule, requests: r.blocks }));

  // Regions that have at least one WebACL
  const activeRegions = [...new Set(webACLs.map(a => a.region))].sort();

  return {
    allow, block, count, challenge, captcha,
    totalTraffic: allow + block + count + challenge + captcha,
    configuredRules: allRules.length,
    webACLs,
    topGeoIPs,
    topURIs,
    blockedRules,
    attackTypes,
    managedRuleGroups,
    activeRegions,
    metricsSource,
    sampledFromRealTraffic: metricsSource !== "RuleConfig",
  };
}

// ─── Fetch WAF metrics from CloudWatch (exact match with AWS WAF console) ─────
async function getWAFCloudWatchMetrics(awsCreds, webACLs, timeRangeHours = 24) {
  const endTime   = new Date();
  const startTime = new Date(endTime.getTime() - timeRangeHours * 60 * 60 * 1000);
  const period    = timeRangeHours <= 3 ? 300 : timeRangeHours <= 24 ? 3600 : 86400;

  let totalAllow = 0, totalBlock = 0, totalCount = 0, totalChallenge = 0, totalCaptcha = 0;

  // Group WebACLs by their CloudWatch region to reuse clients
  const aclsByRegion = new Map();
  for (const acl of webACLs) {
    // CloudFront WAF metrics are always in us-east-1
    const cwRegion = acl.scope === "CLOUDFRONT" ? "us-east-1" : acl.region;
    if (!aclsByRegion.has(cwRegion)) aclsByRegion.set(cwRegion, []);
    aclsByRegion.get(cwRegion).push(acl);
  }

  for (const [cwRegion, acls] of aclsByRegion.entries()) {
    const cwClient = new CloudWatchClient({ ...awsCreds, region: cwRegion });

    for (const acl of acls) {
      // CloudFront WAF uses "CloudFront" as the Region dimension value
      const regionDimValue = acl.scope === "CLOUDFRONT" ? "CloudFront" : acl.region;

      const metricNames = [
        { name: "AllowedRequests",   key: "allow" },
        { name: "BlockedRequests",   key: "block" },
        { name: "CountedRequests",   key: "count" },
        { name: "ChallengeRequests", key: "challenge" },
        { name: "CaptchaRequests",   key: "captcha" },
      ];

      for (const { name: metricName, key } of metricNames) {
        try {
          const result = await cwClient.send(new GetMetricStatisticsCommand({
            Namespace:  "AWS/WAFV2",
            MetricName: metricName,
            Dimensions: [
              { Name: "WebACL", Value: acl.name },
              { Name: "Region", Value: regionDimValue },
              { Name: "Rule",   Value: "ALL" },
            ],
            StartTime:  startTime,
            EndTime:    endTime,
            Period:     period,
            Statistics: ["Sum"],
          }));
          const sum = (result.Datapoints || []).reduce((acc, dp) => acc + (dp.Sum || 0), 0);
          if (key === "allow")     totalAllow     += sum;
          if (key === "block")     totalBlock     += sum;
          if (key === "count")     totalCount     += sum;
          if (key === "challenge") totalChallenge += sum;
          if (key === "captcha")   totalCaptcha   += sum;
        } catch (e) {
          // Metric may not exist for this WebACL — skip silently
        }
      }
    }
  }

  return {
    allow:        Math.round(totalAllow),
    block:        Math.round(totalBlock),
    count:        Math.round(totalCount),
    challenge:    Math.round(totalChallenge),
    captcha:      Math.round(totalCaptcha),
    totalTraffic: Math.round(totalAllow + totalBlock + totalCount + totalChallenge + totalCaptcha),
    isFromCloudWatch: true,
  };
}

async function getSecurityHubData(client) {
  const findings = [];
  let nextToken;
  do {
    const res = await client.send(new GetFindingsCommand({
      MaxResults: 100,
      NextToken: nextToken,
      Filters: {
        RecordState: [{ Value: "ACTIVE", Comparison: "EQUALS" }],
        WorkflowStatus: [{ Value: "RESOLVED", Comparison: "NOT_EQUALS" }],
      },
    }));
    findings.push(...(res.Findings || []));
    nextToken = res.NextToken;
  } while (nextToken && findings.length < 300);

  const counts = emptySeverity();
  const regions = new Map();
  const tacticMap = new Map();

  const findingItems = findings.map(f => {
    const severity = severityKey(f.Severity?.Label);
    const region = f.AwsRegion || f.Resources?.[0]?.Region || "global";
    counts[severity]++;
    regions.set(region, (regions.get(region) || 0) + 1);

    const mitre = getMitreDetails(f.GeneratorId || f.Title);
    tacticMap.set(mitre.tactic, (tacticMap.get(mitre.tactic) || 0) + 1);

    return {
      title: f.Title,
      resource: f.Resources?.[0]?.Id || "-",
      resourceType: f.Resources?.[0]?.Type || "-",
      severity,
      region,
      compliance: f.Compliance?.Status || "-",
      type: f.ProductArn?.split("/").pop() || f.ProductFields?.ProductName || "SecurityHub",
      mitre,
    };
  });

  // Fetch standards
  let standards = [];
  try {
    const enabled = await client.send(new GetEnabledStandardsCommand({}));
    standards = (enabled.StandardsSubscriptions || []).map(s => {
      const standardFindings = findingItems.filter(f => f.title.includes(s.StandardsArn.split("/").pop()));
      const failed = standardFindings.filter(f => f.compliance === "FAILED").length;
      return {
        name: s.StandardsArn.split("/").pop(),
        arn: s.StandardsArn,
        status: s.StandardsStatus,
        failedChecks: failed,
        score: Math.max(0, 100 - failed * 5),
      };
    });
  } catch (e) {
    console.warn("[aws-query] Security Hub standards failed:", e.message);
  }

  const findingsByRegion = Array.from(regions.entries()).map(([region, count]) => ({ region, count }));
  const mitreTactics = Array.from(tacticMap.entries()).map(([tactic, count]) => ({ tactic, count }));
  const weighted = counts.critical * 12 + counts.high * 6 + counts.medium * 3 + counts.low;

  return {
    score: Math.max(0, 100 - weighted),
    ...counts,
    trend: [],
    standards,
    findingsByRegion,
    mitreTactics,
    findings: findingItems.slice(0, 100),
  };
}

async function getGuardDutyData(client) {
  const detectors = (await client.send(new ListDetectorsCommand({}))).DetectorIds || [];
  const allFindings = [];
  for (const detectorId of detectors) {
    const listed = await client.send(new ListFindingsCommand({
      DetectorId: detectorId,
      MaxResults: 50,
      FindingCriteria: { Criterion: { serviceArchived: { Eq: ["false"] } } },
    }));
    const ids = listed.FindingIds || [];
    if (ids.length) {
      const res = await client.send(new GetGuardDutyFindingsCommand({ DetectorId: detectorId, FindingIds: ids }));
      allFindings.push(...(res.Findings || []));
    }
  }
  const typeCounts = new Map();
  const resourceCounts = new Map();
  const regionCounts = new Map();
  const findingsList = allFindings.map(f => {
    const severity = f.Severity >= 7 ? "high" : f.Severity >= 4 ? "medium" : "low";
    const type = f.Type || "Unknown";
    const resource = f.Resources?.[0]?.ResourceType || f.Resources?.[0]?.InstanceDetails?.InstanceId || f.Resources?.[0]?.Id || "Unknown";
    const region = f.Resources?.[0]?.Region || f.Region || "global";
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    resourceCounts.set(resource, (resourceCounts.get(resource) || 0) + 1);
    regionCounts.set(region, (regionCounts.get(region) || 0) + 1);
    return {
      title: f.Title || f.Description || "GuardDuty Finding",
      severity,
      type,
      resource,
      region,
    };
  });

  const high = findingsList.filter(f => f.severity === "high").length;
  const medium = findingsList.filter(f => f.severity === "medium").length;
  const low = findingsList.filter(f => f.severity === "low").length;
  const types = Array.from(typeCounts.entries())
    .sort((a,b)=>b[1]-a[1])
    .slice(0, 10)
    .map(([type,count]) => ({ type, count, severity: "high" }));
  const topResources = Array.from(resourceCounts.entries())
    .sort((a,b)=>b[1]-a[1])
    .slice(0, 10)
    .map(([resource,count]) => ({ resource, count }));
  return {
    findings: findingsList.length,
    high,
    medium,
    low,
    types,
    topResources,
    findingsList: findingsList.slice(0, 50),
    findingsByRegion: Array.from(regionCounts.entries()).map(([region,count]) => ({ region, count })),
  };
}

async function getInspectorData(client) {
  const findings = [];
  let nextToken;
  do {
    const res = await client.send(new ListInspectorFindingsCommand({
      maxResults: 100,
      nextToken,
      filterCriteria: { findingStatus: [{ comparison: "EQUALS", value: "ACTIVE" }] },
    }));
    findings.push(...(res.findings || []));
    nextToken = res.nextToken;
  } while (nextToken && findings.length < 300);

  const counts = emptySeverity();
  const resourceTypes = new Map();
  const findingsList = findings.map(f => {
    const severity = severityKey(f.severity);
    const resource = f.resources?.[0]?.id || f.resourceId || "-";
    const resourceType = f.resources?.[0]?.type || f.resourceType || "Unknown";
    counts[severity]++;
    resourceTypes.set(resourceType, (resourceTypes.get(resourceType) || 0) + 1);
    return {
      resource,
      resourceType,
      type: f.title || f.type || "-",
      severity,
      description: f.description || f.title || "Inspector finding",
    };
  });

  const weighted = counts.critical * 10 + counts.high * 5 + counts.medium * 2 + counts.low;
  return {
    score: Math.max(0, 100 - weighted),
    ...counts,
    findings: findingsList.slice(0, 100),
    findingsList,
    criticalFindings: findingsList.filter(f => f.severity === "critical"),
    resourceTypes: Array.from(resourceTypes.entries()).map(([resourceType,count]) => ({ resourceType, count })).sort((a,b)=>b.count-a.count).slice(0, 10),
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS – allow only your own domain in production
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { accountId, region: requestedRegion, credential, timeRange } = req.body || {};
  if (!accountId) return res.status(400).json({ error: "accountId is required" });

  // Convert timeRange to hours for CloudWatch queries
  function timeRangeToHours(tr) {
    if (!tr || tr.type === "relative") {
      const map = { "1m": 1/60, "5m": 5/60, "10m": 10/60, "30m": 0.5, "1h": 1, "3h": 3, "6h": 6, "12h": 12, "24h": 24, "3d": 72, "7d": 168, "14d": 336, "30d": 720, "3mo": 2160, "6mo": 4320, "12mo": 8760 };
      return map[tr?.value] || 24;
    }
    if (tr.type === "absolute") {
      return Math.max(1, (new Date(tr.end) - new Date(tr.start)) / 3600000);
    }
    return 24;
  }
  const timeRangeHours = timeRangeToHours(timeRange);

  let creds;
  try {
    creds = await resolveCredentials(accountId, credential);
  } catch (err) {
    return res.status(500).json({ 
      error: `Credential Resolution Error: ${err.message}`,
      hint: "Try deleting and re-adding the AWS account in the Accounts section."
    });
  }

  if (!creds) {
    return res.status(404).json({
      error: `No credentials found for account ${accountId}.`,
      hint: "Add AWS_ACCOUNT_<ID>_ACCESS_KEY_ID in Vercel or re-add the account in the dashboard."
    });
  }

  const region   = requestedRegion || creds.region;
  const awsCreds = { credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey }, region };

  try {
    const ec2Client = new EC2Client(awsCreds);
    const eksClient = new EKSClient(awsCreds);
    const s3Client  = new S3Client({ ...awsCreds, region: "us-east-1" }); // S3 is global
    const albClient = new ElasticLoadBalancingV2Client(awsCreds);
    const wafClient = new WAFV2Client(awsCreds);
    const securityHubClient = new SecurityHubClient(awsCreds);
    const guardDutyClient = new GuardDutyClient(awsCreds);
    const inspectorClient = new Inspector2Client(awsCreds);

    // Clients for Global/Fallback region (us-east-1)
    const globalAwsCreds = { ...awsCreds, region: "us-east-1" };
    const securityHubGlobal = region === "us-east-1" ? securityHubClient : new SecurityHubClient(globalAwsCreds);
    const guardDutyGlobal   = region === "us-east-1" ? guardDutyClient : new GuardDutyClient(globalAwsCreds);
    const inspectorGlobal   = region === "us-east-1" ? inspectorClient : new Inspector2Client(globalAwsCreds);

    const [ec2, eks, s3, vpc, alb, waf, securityHub, guardDuty, inspector] = await Promise.all([
      safeCall("EC2", () => getEC2Inventory(ec2Client), { total:0, running:0, stopped:0, instances:[] }),
      safeCall("EKS", () => getEKSInventory(eksClient), { total:0, clusters:[] }),
      safeCall("S3", () => getS3Inventory(s3Client, region), { total:0, public:0, private:0, buckets:[] }),
      safeCall("VPC", () => getVPCInventory(ec2Client), { total:0, vpcs:[] }),
      safeCall("ALB", () => getALBInventory(albClient), { total:0, loadBalancers:[] }),
      safeCall("WAF", () => getWAFData(awsCreds, timeRangeHours), { allow:0, block:0, count:0, challenge:0, captcha:0, configuredRules:0, totalTraffic:0, webACLs:[], topGeoIPs:[], topURIs:[], blockedRules:[], attackTypes:[], managedRuleGroups:[] }),
      
      // Multi-region aggregation for security findings
      (async () => {
        const [reg, glob] = await Promise.all([
          safeCall("Security Hub", () => getSecurityHubData(securityHubClient), null),
          region !== "us-east-1" ? safeCall("Security Hub Global", () => getSecurityHubData(securityHubGlobal), null) : Promise.resolve(null)
        ]);
        return aggregateSecurityHub(reg, glob);
      })(),
      
      (async () => {
        const [reg, glob] = await Promise.all([
          safeCall("GuardDuty", () => getGuardDutyData(guardDutyClient), null),
          region !== "us-east-1" ? safeCall("GuardDuty Global", () => getGuardDutyData(guardDutyGlobal), null) : Promise.resolve(null)
        ]);
        return aggregateGuardDuty(reg, glob);
      })(),
      
      (async () => {
        const [reg, glob] = await Promise.all([
          safeCall("Inspector", () => getInspectorData(inspectorClient), null),
          region !== "us-east-1" ? safeCall("Inspector Global", () => getInspectorData(inspectorGlobal), null) : Promise.resolve(null)
        ]);
        return aggregateInspector(reg, glob);
      })(),
    ]);

    return res.status(200).json({ ec2, eks, s3, vpc, alb, waf, securityHub, guardDuty, inspector, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[aws-query] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Aggregation Helpers ───────────────────────────────────────────────────────

function aggregateSecurityHub(reg, glob) {
  const fallback = { score: 100, critical: 0, high: 0, medium: 0, low: 0, trend: [], findings: [], standards: [], findingsByRegion: [], mitreTactics: [] };
  if (!reg && !glob) return fallback;
  const r = reg || fallback;
  const g = glob || fallback;
  
  const findings = [...(r.findings || []), ...(g.findings || [])].slice(0, 100);
  const critical = (r.critical || 0) + (g.critical || 0);
  const high = (r.high || 0) + (g.high || 0);
  const medium = (r.medium || 0) + (g.medium || 0);
  const low = (r.low || 0) + (g.low || 0);
  
  const weighted = critical * 12 + high * 6 + medium * 3 + low;
  return {
    ...r,
    score: Math.max(0, 100 - weighted),
    critical, high, medium, low,
    findings,
    standards: [...(r.standards || []), ...(g.standards || [])],
    findingsByRegion: [...(r.findingsByRegion || []), ...(g.findingsByRegion || [])],
    mitreTactics: [...(r.mitreTactics || []), ...(g.mitreTactics || [])],
  };
}

function aggregateGuardDuty(reg, glob) {
  const fallback = { findings: 0, high: 0, medium: 0, low: 0, types: [], findingsList: [], findingsByRegion: [], topResources: [] };
  if (!reg && !glob) return fallback;
  const r = reg || fallback;
  const g = glob || fallback;

  return {
    findings: (r.findings || 0) + (g.findings || 0),
    high: (r.high || 0) + (g.high || 0),
    medium: (r.medium || 0) + (g.medium || 0),
    low: (r.low || 0) + (g.low || 0),
    types: [...(r.types || []), ...(g.types || [])].slice(0, 20),
    findingsList: [...(r.findingsList || []), ...(g.findingsList || [])].slice(0, 100),
    findingsByRegion: [...(r.findingsByRegion || []), ...(g.findingsByRegion || [])],
    topResources: [...(r.topResources || []), ...(g.topResources || [])].slice(0, 20),
  };
}

function aggregateInspector(reg, glob) {
  const fallback = { score: 100, critical: 0, high: 0, medium: 0, low: 0, findings: [], findingsList: [], criticalFindings: [], resourceTypes: [] };
  if (!reg && !glob) return fallback;
  const r = reg || fallback;
  const g = glob || fallback;

  const critical = (r.critical || 0) + (g.critical || 0);
  const high = (r.high || 0) + (g.high || 0);
  const medium = (r.medium || 0) + (g.medium || 0);
  const low = (r.low || 0) + (g.low || 0);
  
  const weighted = critical * 10 + high * 5 + medium * 2 + low;
  return {
    ...r,
    score: Math.max(0, 100 - weighted),
    critical, high, medium, low,
    findings: [...(r.findings || []), ...(g.findings || [])].slice(0, 100),
    findingsList: [...(r.findingsList || []), ...(g.findingsList || [])].slice(0, 100),
    criticalFindings: [...(r.criticalFindings || []), ...(g.criticalFindings || [])],
    resourceTypes: [...(r.resourceTypes || []), ...(g.resourceTypes || [])],
  };
}
