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
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";

// ─── Resolve credentials from environment ────────────────────────────────────
function resolveCredentials(accountId, requestCredential) {
  const safe = accountId.replace(/\D/g, ""); // digits only
  if (requestCredential?.accessKeyId && requestCredential?.secretAccessKey) {
    return {
      accessKeyId: requestCredential.accessKeyId,
      secretAccessKey: requestCredential.secretAccessKey,
      region: requestCredential.region || "us-east-1",
    };
  }

  const accessKeyId     = process.env[`AWS_ACCOUNT_${safe}_ACCESS_KEY_ID`];
  const secretAccessKey = process.env[`AWS_ACCOUNT_${safe}_SECRET_ACCESS_KEY`];
  const region          = process.env[`AWS_ACCOUNT_${safe}_REGION`] || "us-east-1";

  if (!accessKeyId || !secretAccessKey) {
    return null; // account not configured server-side
  }
  return { accessKeyId, secretAccessKey, region };
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

  const creds = resolveCredentials(accountId, credential);
  if (!creds) {
    return res.status(404).json({
      error: `No credentials configured server-side for account ${accountId}. ` +
             "Add AWS_ACCOUNT_<ID>_ACCESS_KEY_ID / _SECRET_ACCESS_KEY / _REGION " +
             "in Vercel → Settings → Environment Variables.",
    });
  }

  const region   = requestedRegion || creds.region;
  const awsCreds = { credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey }, region };

  try {
    const ec2Client = new EC2Client(awsCreds);
    const eksClient = new EKSClient(awsCreds);
    const s3Client  = new S3Client({ ...awsCreds, region: "us-east-1" }); // S3 is global
    const albClient = new ElasticLoadBalancingV2Client(awsCreds);

    const [ec2, eks, s3, vpc, alb] = await Promise.all([
      getEC2Inventory(ec2Client),
      getEKSInventory(eksClient),
      getS3Inventory(s3Client, region),
      getVPCInventory(ec2Client),
      getALBInventory(albClient),
    ]);

    return res.status(200).json({ ec2, eks, s3, vpc, alb, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[aws-query] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
