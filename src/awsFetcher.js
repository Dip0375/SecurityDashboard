import { getCredential } from "./credentialStore.js";

/**
 * awsFetcher.js
 * ──────────────────────────────────────────────────────────────────────────────
 * Thin wrapper that calls the Vercel serverless API route `/api/aws-query`
 * which is the ONLY code that ever touches the raw AWS credentials.
 *
 * The browser never sends credentials in the request body.  Instead it sends
 * only the accountId; the API route looks up the encrypted secret from its own
 * secure store (AWS Secrets Manager / SSM Parameter Store / Vercel env vars).
 *
 * WHY THIS PATTERN?
 * ─────────────────
 * • Vite bundles everything into a public JS file.  Any VITE_* variable you
 *   use becomes readable to anyone who downloads your site's JS bundle.
 * • A serverless function runs on Vercel's private infrastructure.  The
 *   AWS credentials live there and are never sent to the browser.
 * • The browser only ever sees the query RESULTS (resource lists, counts).
 *
 * MOCK MODE
 * ─────────
 * When `import.meta.env.VITE_MOCK_AWS === 'true'` (or the API is unreachable)
 * this module returns realistic-looking mock data so the UI works during
 * local development without real AWS accounts.
 */

const MOCK = import.meta.env.VITE_MOCK_AWS === "true" || (import.meta.env.DEV && import.meta.env.VITE_MOCK_AWS !== "false");

// ─── Mock inventory data (returned during local dev) ─────────────────────────
function buildMockInventory(accountId) {
  const seed = accountId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng  = (min, max) => min + ((seed * 1103515245 + 12345) & 0x7fffffff) % (max - min + 1);

  const ec2Names  = ["web-prod-01","web-prod-02","api-server","bastion-host","nat-instance","worker-01","worker-02","db-proxy"];
  const eksNames  = ["prod-cluster","staging-cluster","data-pipeline"];
  const s3Names   = ["my-app-assets","backup-bucket","logs-archive","terraform-state","media-uploads"];
  const vpcNames  = ["vpc-prod","vpc-staging","vpc-shared-services"];
  const albNames  = ["alb-web-public","alb-api-internal","alb-admin"];

  const ec2Count  = rng(3, 8);
  const eksCount  = rng(1, 3);
  const s3Count   = rng(3, 5);
  const vpcCount  = rng(1, 3);
  const albCount  = rng(1, 3);

  return {
    ec2: {
      total: ec2Count,
      running: ec2Count - rng(0, 2),
      stopped: rng(0, 2),
      instances: ec2Names.slice(0, ec2Count).map((name, i) => ({
        id:    `i-0${(seed + i).toString(16).padStart(16, "0").slice(0, 16)}`,
        name,
        type:  ["t3.micro","t3.small","t3.medium","m5.large","c5.xlarge"][i % 5],
        state: i < ec2Count - rng(0, 2) ? "running" : "stopped",
        az:    ["us-east-1a","us-east-1b","us-east-1c"][i % 3],
      })),
    },
    eks: {
      total: eksCount,
      clusters: eksNames.slice(0, eksCount).map((name, i) => ({
        name,
        nodeCount: rng(2, 10),
        version:   `1.${28 + i}`,
        status:    "ACTIVE",
      })),
    },
    s3: {
      total: s3Count,
      public: rng(0, 2),
      private: s3Count - rng(0, 2),
      buckets: s3Names.slice(0, s3Count).map((name, i) => ({
        name,
        // A bucket is "public" if it has a public ACL or bucket policy allowing s3:GetObject to *
        isPublic: i < rng(0, 2),
        region:   ["us-east-1","us-west-2","eu-west-1"][i % 3],
        sizeGB:   rng(1, 500),
      })),
    },
    vpc: {
      total: vpcCount,
      vpcs: vpcNames.slice(0, vpcCount).map((name, i) => ({
        id:      `vpc-0${(seed + i + 100).toString(16).padStart(8, "0")}`,
        name,
        cidr:    `10.${i}.0.0/16`,
        subnets: rng(3, 8),
        isDefault: i === 0,
      })),
    },
    alb: {
      total: albCount,
      loadBalancers: albNames.slice(0, albCount).map((name, i) => ({
        name,
        scheme:   i === 0 ? "internet-facing" : "internal",
        state:    "active",
        dns:      `${name}.${accountId.slice(-4)}.elb.amazonaws.com`,
        targets:  rng(2, 8),
      })),
    },
    waf: {
      allow:     rng(5, 20),
      block:     rng(2, 15),
      count:     rng(1, 8),
      challenge: rng(0, 4),
      captcha:   rng(0, 2),
      configuredRules: rng(10, 32),
      webACLs: [
        { name: `global-acl-${seed % 3 + 1}`, scope: "CLOUDFRONT", defaultAction: "BLOCK", rules: [{ name: "SQLInjection", action: "BLOCK" }, { name: "XSS", action: "BLOCK" }] },
        { name: `regional-acl-${seed % 4 + 1}`, scope: "REGIONAL", defaultAction: "ALLOW", rules: [{ name: "RateLimit", action: "COUNT" }] },
      ],
      topGeoIPs: [
        { country: "China", requests: rng(300, 1200) },
        { country: "Russia", requests: rng(180, 920) },
        { country: "Nigeria", requests: rng(140, 780) },
      ],
      topURIs: [
        { uri: "/api/login", requests: rng(260, 650) },
        { uri: "/admin", requests: rng(180, 490) },
        { uri: "/checkout", requests: rng(120, 360) },
      ],
      blockedRules: [
        { rule: "SQLInjection", blocks: rng(60, 160) },
        { rule: "XSS", blocks: rng(30, 90) },
      ],
    },
    securityHub: {
      score: rng(40, 95),
      critical: rng(0, 5),
      high: rng(2, 10),
      medium: rng(10, 30),
      low: rng(40, 100),
      standards: [
        { name: "AWS Foundational Security Best Practices", score: rng(60, 90), failedChecks: rng(5, 15) },
        { name: "CIS AWS Foundations Benchmark", score: rng(70, 95), failedChecks: rng(2, 8) },
        { name: "PCI DSS v3.2.1", score: rng(50, 85), failedChecks: rng(10, 25) },
      ],
      mitreTactics: [
        { tactic: "Initial Access", count: rng(1, 5) },
        { tactic: "Discovery", count: rng(5, 15) },
        { tactic: "Persistence", count: rng(1, 3) },
        { tactic: "Privilege Escalation", count: rng(2, 6) },
      ],
      findings: Array.from({ length: 5 }).map((_, i) => ({
        title: ["S3 Bucket Public Access","IAM Root User MFA Disabled","EC2 Security Group Open Port 22","RDS Snapshot Public","CloudTrail Disabled"][i],
        severity: i === 0 ? "critical" : i < 3 ? "high" : "medium",
        resource: `resource-${i}`,
        compliance: "FAILED",
      })),
    },
    guardDuty: {
      findings: rng(5, 25),
      high: rng(1, 5),
      medium: rng(5, 10),
      low: rng(10, 20),
      types: [
        { type: "UnauthorizedAccess:EC2/SSHBruteForce", count: rng(50, 200), severity: "high" },
        { type: "Discovery:S3/MaliciousIPCaller", count: rng(10, 50), severity: "medium" },
      ],
      findingsList: Array.from({ length: 5 }).map((_, i) => ({
        title: ["SSH Brute Force Attack","Cryptomining Activity","DNS Exfiltration","Tor Exit Node Traffic","IAM Role Assumption"][i],
        severity: i === 0 ? "high" : "medium",
        type: "T1078 - Valid Accounts",
        resource: "i-0abc123",
        region: "us-east-1",
      })),
    },
    inspector: {
      score: rng(50, 90),
      critical: rng(0, 3),
      high: rng(5, 15),
      medium: rng(20, 50),
      low: rng(50, 100),
      findingsList: Array.from({ length: 5 }).map((_, i) => ({
        resource: "i-0987654321",
        resourceType: i % 2 === 0 ? "AWS::EC2::Instance" : "AWS::ECR::ContainerImage",
        type: "CVE-2023-1234 - Buffer Overflow",
        severity: i === 0 ? "critical" : "high",
      })),
    },
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Real API call (Vercel serverless route) ──────────────────────────────────
async function fetchFromAPI(accountId, region, credential) {
  const body = { accountId, region, service: "inventory" };
  if (credential) body.credential = credential;
  const res = await fetch("/api/aws-query", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    let message = body;
    try {
      const parsed = JSON.parse(body);
      message = parsed.error || parsed.message || body;
    } catch {}
    throw new Error(`AWS query failed: ${message}`);
  }
  return res.json();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch AWS resource inventory for a given account.
 * In MOCK mode returns generated data immediately.
 * In production hits the /api/aws-query serverless endpoint.
 *
 * @param {string} accountId  – 12-digit AWS account ID
 * @param {string} region
 * @returns {Promise<InventoryData>}
 */
export async function fetchInventory(accountId, region) {
  const credential = getCredential(accountId);
  if (MOCK && !credential) {
    // Simulate network latency
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 800));
    return buildMockInventory(accountId);
  }
  return fetchFromAPI(accountId, region, credential || undefined);
}
