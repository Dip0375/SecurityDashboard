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
      if (error.code === "PGRST116") return null;
      throw error;
    }
    if (!data?.encrypted_secret) return null;
    return decryptPayload(data.encrypted_secret);
  } catch (err) {
    console.warn(`[aws-query] Could not resolve credentials from Supabase for ${accountId}:`, err.message || err);
    return null;
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

async function getWAFData(client) {
  const scopes = ["REGIONAL", "CLOUDFRONT"];
  const webACLs = [];

  for (const scope of scopes) {
    try {
      const res = await client.send(new ListWebACLsCommand({ Scope: scope, Limit: 100 }));
      for (const acl of res.WebACLs || []) {
        let detail = null;
        let attachedResources = [];
        try {
          const full = await client.send(new GetWebACLCommand({ Scope: scope, Name: acl.Name, Id: acl.Id }));
          detail = full.WebACL;
        } catch { /* list data is still useful */ }
        try {
          const resources = await client.send(new ListResourcesForWebACLCommand({ WebACLArn: acl.ARN }));
          attachedResources = resources.ResourceArns || [];
        } catch { /* not all WebACLs will support resource listing */ }
        webACLs.push({
          name: acl.Name,
          id: acl.Id,
          scope,
          arn: acl.ARN,
          attachedResources,
          defaultAction: detail?.DefaultAction?.Allow ? "ALLOW" : detail?.DefaultAction?.Block ? "BLOCK" : "UNKNOWN",
          rules: (detail?.Rules || []).map(r => ({
            name: r.Name,
            priority: r.Priority,
            action: r.Action?.Allow ? "ALLOW" : r.Action?.Block ? "BLOCK" : r.Action?.Count ? "COUNT" : "MANAGED",
            ruleGroup: r.RuleGroupReference?.Name || null,
          })),
        });
      }
    } catch { /* scope may be unavailable in this region */ }
  }

  const allRules = webACLs.flatMap(acl => acl.rules.map(rule => ({ ...rule, webAcl: acl.name, scope: acl.scope, blocks: rule.action === "BLOCK" ? 1 : 0 })));
  const allow = webACLs.filter(a => a.defaultAction === "ALLOW").length;
  const block = allRules.filter(r => r.action === "BLOCK").length;
  const count = allRules.filter(r => r.action === "COUNT").length;
  const challenge = allRules.filter(r => r.action === "MANAGED" || r.action === "CHALLENGE").length;
  const captcha = allRules.filter(r => r.action === "CAPTCHA").length;

  const ruleGroupMap = new Map();
  for (const rule of allRules) {
    if (!rule.ruleGroup) continue;
    const existing = ruleGroupMap.get(rule.ruleGroup) || { name: rule.ruleGroup, ruleCount: 0, webACLs: new Set(), totalRules: 0 };
    existing.ruleCount += 1;
    existing.webACLs.add(rule.webAcl);
    ruleGroupMap.set(rule.ruleGroup, existing);
  }

  const blockedRuleMap = new Map();
  for (const rule of allRules) {
    const key = `${rule.webAcl}/${rule.name}`;
    blockedRuleMap.set(key, Math.max(1, rule.blocks));
  }

  const attackTypes = Array.from(blockedRuleMap.entries())
    .sort((a,b) => b[1] - a[1])
    .slice(0, 10)
    .map(([rule, requests]) => ({ type: rule, requests }));

  const managedRuleGroups = Array.from(ruleGroupMap.values()).map(group => ({
    name: group.name,
    ruleCount: group.ruleCount,
    webACLs: Array.from(group.webACLs),
  }));

  const geoMap = new Map();
  const uriMap = new Map();
  const terminatedRuleMap = new Map();

  // Fetch sampled requests for each WebACL to get GeoIP and URI data
  for (const acl of webACLs) {
    try {
      const timeWindow = {
        StartTime: new Date(Date.now() - 3600000), // Last 1 hour
        EndTime: new Date(),
      };
      const sampled = await client.send(new GetSampledRequestsCommand({
        WebACLArn: acl.arn,
        RuleMetricName: "Default_Action", // Sample from default action
        Scope: acl.scope,
        TimeWindow: timeWindow,
        MaxItems: 100,
      }));

      for (const req of sampled.SampledRequests || []) {
        const country = req.Request?.Country || "Unknown";
        const uri = req.Request?.URI || "/";
        const termRule = req.TerminatingRuleId || "Default";

        geoMap.set(country, (geoMap.get(country) || 0) + 1);
        uriMap.set(uri, (uriMap.get(uri) || 0) + 1);
        terminatedRuleMap.set(termRule, (terminatedRuleMap.get(termRule) || 0) + 1);
      }
    } catch (e) {
      console.warn(`[aws-query] WAF sampled requests failed for ${acl.name}:`, e.message);
    }
  }

  const topGeoIPs = Array.from(geoMap.entries())
    .sort((a,b) => b[1] - a[1])
    .slice(0, 10)
    .map(([country, requests]) => ({ country, requests }));

  const topURIs = Array.from(uriMap.entries())
    .sort((a,b) => b[1] - a[1])
    .slice(0, 10)
    .map(([uri, requests]) => ({ uri, requests }));

  const blockedRules = Array.from(terminatedRuleMap.entries())
    .sort((a,b) => b[1] - a[1])
    .slice(0, 10)
    .map(([rule, blocks]) => ({ rule, blocks }));

  return {
    allow,
    block,
    count,
    challenge,
    captcha,
    totalTraffic: allow + block + count + challenge + captcha,
    configuredRules: allRules.length,
    webACLs,
    topGeoIPs,
    topURIs,
    blockedRules,
    attackTypes,
    managedRuleGroups,
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
    findings: findingItems.slice(0, 25),
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
    findings: findingsList.slice(0, 25),
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

  const { accountId, region: requestedRegion, credential } = req.body || {};
  if (!accountId) return res.status(400).json({ error: "accountId is required" });

  const creds = await resolveCredentials(accountId, credential);
  if (!creds) {
    return res.status(404).json({
      error: `No credentials configured server-side for account ${accountId}. ` +
             "Add AWS_ACCOUNT_<ID>_ACCESS_KEY_ID / _SECRET_ACCESS_KEY / _REGION " +
             "in Vercel → Settings → Environment Variables, or store encrypted credentials in Supabase.",
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

    const [ec2, eks, s3, vpc, alb, waf, securityHub, guardDuty, inspector] = await Promise.all([
      safeCall("EC2", () => getEC2Inventory(ec2Client), { total:0, running:0, stopped:0, instances:[] }),
      safeCall("EKS", () => getEKSInventory(eksClient), { total:0, clusters:[] }),
      safeCall("S3", () => getS3Inventory(s3Client, region), { total:0, public:0, private:0, buckets:[] }),
      safeCall("VPC", () => getVPCInventory(ec2Client), { total:0, vpcs:[] }),
      safeCall("ALB", () => getALBInventory(albClient), { total:0, loadBalancers:[] }),
      safeCall("WAF", () => getWAFData(wafClient), { allow:0, block:0, count:0, challenge:0, captcha:0, configuredRules:0, totalTraffic:0, webACLs:[], topGeoIPs:[], topURIs:[], blockedRules:[], attackTypes:[], managedRuleGroups:[] }),
      safeCall("Security Hub", () => getSecurityHubData(securityHubClient), { score:0, critical:0, high:0, medium:0, low:0, trend:[], findings:[] }),
      safeCall("GuardDuty", () => getGuardDutyData(guardDutyClient), { findings:0, high:0, medium:0, low:0, types:[] }),
      safeCall("Inspector", () => getInspectorData(inspectorClient), { score:0, critical:0, high:0, medium:0, low:0, findings:[] }),
    ]);

    return res.status(200).json({ ec2, eks, s3, vpc, alb, waf, securityHub, guardDuty, inspector, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[aws-query] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
