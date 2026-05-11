# AWS SecureView Dashboard

A real-time AWS security and resource inventory dashboard built with React + Vite.

---

## 🔐 Credential Security Architecture

### Why AWS keys must NEVER go in `.env` / Vite variables

Vite **bakes every `VITE_*` variable into the public JavaScript bundle**.  
Anyone who opens DevTools → Sources can read them.  
**AWS Access Keys in `VITE_*` = immediate credential leak.**

### What goes where

| Data | Where it lives | Why |
|------|----------------|-----|
| Dashboard login password | `.env.local` → `VITE_DEFAULT_CREDENTIALS` | Only used in the browser auth flow; not an AWS secret |
| AWS Access Key ID | Vercel Environment Variables (server-side) | Never sent to browser |
| AWS Secret Access Key | Vercel Environment Variables (server-side) | Never sent to browser |
| Encrypted credential cache | `credentialStore.js` → AES-256-GCM in memory | Cleared on logout |

### How it works end-to-end

```
User enters keys in "Onboard Account" form
        │
        ▼
credentialStore.saveCredential()
  • PBKDF2-derives an AES-256-GCM key from (user password + random salt)
  • Encrypts {accessKeyId, secretAccessKey} with Web Crypto API
  • Stores cipher-text in localStorage (unreadable without session secret)
  • Clears raw values from JS memory
        │
        ▼
(Production) POST /api/aws-query  ← only accountId, no keys
        │
        ▼
Vercel serverless function (api/aws-query.js)
  • Reads AWS_ACCOUNT_<ID>_ACCESS_KEY_ID from process.env (Vercel server)
  • Calls EC2 / EKS / S3 / ALB APIs
  • Returns ONLY the results (resource lists, counts)
  • AWS keys stay on the server – browser never sees them
```

### IAM permissions required (ReadOnly)

Create an IAM user/role with these managed policies:
- `AmazonEC2ReadOnlyAccess`
- `AmazonEKSReadPolicy` (or `AmazonEKS_ReadOnly`)
- `AmazonS3ReadOnlyAccess`
- `ElasticLoadBalancingReadOnly`
- `SecurityAudit` (for Security Hub, GuardDuty, Inspector, WAF)

**Never attach `AdministratorAccess`.**

---

## 🚀 Deployment to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/your-org/aws-secureview.git
git push -u origin main
```

`.env.local` and `.env.*` are in `.gitignore` — they will NOT be committed.

### 2. Import in Vercel

Go to [vercel.com/new](https://vercel.com/new) → Import your GitHub repo.

### 3. Set Environment Variables in Vercel

In **Vercel Dashboard → Your Project → Settings → Environment Variables**, add:

```
# Dashboard login (not AWS keys)
DASHBOARD_CREDENTIALS     = [{"email":"admin@you.com","password":"...","role":"admin","name":"Admin"}]
VITE_MOCK_AWS             = false     ← disable mock mode in production

# Per AWS account (repeat for each account)
AWS_ACCOUNT_123456789012_ACCESS_KEY_ID      = AKIAIOSFODNN7EXAMPLE
AWS_ACCOUNT_123456789012_SECRET_ACCESS_KEY  = wJalrXUtnFEMI/K7MDENG/...
AWS_ACCOUNT_123456789012_REGION             = us-east-1

# Optional: restrict CORS to your domain
ALLOWED_ORIGIN  = https://your-secureview.vercel.app
```

**Set all `AWS_ACCOUNT_*` variables to "Server" scope only** (not Preview/Development).

### 4. Install API dependencies

```bash
npm install @aws-sdk/client-ec2 @aws-sdk/client-eks @aws-sdk/client-s3 @aws-sdk/client-elastic-load-balancing-v2
```

### 5. Deploy

Vercel auto-deploys on every push to `main`.

---

## 🏗 Inventory Section

The **Inventory** page shows live AWS resource counts and names:

| Service | Shows |
|---------|-------|
| EC2 | Total instances · running/stopped count · name, type, AZ, state |
| EKS | Cluster count · Kubernetes version · node count · status |
| S3 | Bucket count · **public vs private** · region per bucket |
| VPC | VPC count · CIDR · subnet count · default flag |
| ALB | Load balancer count · public vs internal · DNS name |

### How public S3 buckets are detected

A bucket is marked **Public** if either:
1. `GetBucketPolicyStatus` returns `IsPublic: true` — meaning the bucket policy grants `s3:GetObject` to `*`
2. `GetBucketAcl` contains a grant to `AllUsers` or `AuthenticatedUsers` URIs

**No time range** — the Inventory page always shows the current live state.

---

## 💻 Local Development

```bash
npm install
npm run dev
```

The dashboard runs in **mock mode** by default (`VITE_MOCK_AWS=true`).  
Mock data is generated deterministically from the account ID — it's consistent across reloads.

To test with real AWS:
1. Set `VITE_MOCK_AWS=false` in `.env.local`
2. Run the Vercel dev server: `npx vercel dev` (so `/api` routes work locally)

---

## 🔄 Key Rotation Checklist

- [ ] Rotate AWS IAM keys every **90 days**
- [ ] Update `AWS_ACCOUNT_*` env vars in Vercel after rotation
- [ ] Enable **MFA** on the IAM user
- [ ] Enable **CloudTrail** to audit API calls made with these keys
- [ ] Set up **IAM Access Analyzer** to detect over-permissive policies
- [ ] Never share or log the secret key — not even in Slack/email

---

## 📁 Project Structure

```
aws-secureview/
├── api/
│   └── aws-query.js          ← Vercel serverless; holds AWS credentials
├── src/
│   ├── aws-security-dashboard-v4.jsx  ← main UI
│   ├── credentialStore.js    ← AES-256-GCM credential encryption
│   ├── awsFetcher.js         ← calls /api/aws-query (or mock)
│   └── main.jsx
├── .env.local                ← local dev only; never committed
├── .env.example              ← safe template (no real secrets)
├── .gitignore
└── vercel.json
```
