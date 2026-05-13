/**
 * api/mitre-mapping.js
 * Utility to map AWS Security findings to MITRE ATT&CK tactics and techniques.
 */

const MITRE_MAP = {
  // GuardDuty Mapping
  "Recon:EC2/PortProbeUnprotectedPort": { tactic: "Reconnaissance", technique: "Active Scanning" },
  "Recon:IAMUser/NetworkPermissions": { tactic: "Discovery", technique: "Permission Groups Discovery" },
  "UnauthorizedAccess:EC2/SSHBruteForce": { tactic: "Credential Access", technique: "Brute Force" },
  "UnauthorizedAccess:EC2/RDPBruteForce": { tactic: "Credential Access", technique: "Brute Force" },
  "Discovery:EC2/PortScanning": { tactic: "Discovery", technique: "Network Service Scanning" },
  "Impact:EC2/CryptoCurrencyTraffic": { tactic: "Impact", technique: "Resource Hijacking" },
  "CredentialAccess:IAMUser/InstanceCredentialExfiltration": { tactic: "Credential Access", technique: "Steal or Forge Kerberos Tickets" },
  "Stealth:IAMUser/CloudTrailLoggingDisabled": { tactic: "Defense Evasion", technique: "Impair Defenses" },
  "Policy:IAMUser/RootCredentialUsage": { tactic: "Privilege Escalation", technique: "Valid Accounts" },

  // Security Hub / Inspector Common Patterns
  "S3.1": { tactic: "Initial Access", technique: "Exploit Public-Facing Application" }, // S3 buckets should prohibit public read access
  "EC2.1": { tactic: "Initial Access", technique: "Exploit Public-Facing Application" }, // EBS snapshots should not be public
  "IAM.1": { tactic: "Privilege Escalation", technique: "Valid Accounts" }, // IAM root user access key should not exist
};

export function getMitreDetails(findingType) {
  const match = MITRE_MAP[findingType] || { tactic: "Execution", technique: "User Execution" };
  return match;
}

export function getTacticColor(tactic) {
  const colors = {
    "Reconnaissance": "#00d4ff",
    "Resource Development": "#00a8cc",
    "Initial Access": "#00e878",
    "Execution": "#ffd000",
    "Persistence": "#ff8c00",
    "Privilege Escalation": "#ff3b5c",
    "Defense Evasion": "#a855f7",
    "Credential Access": "#f43f8d",
    "Discovery": "#dce8f8",
    "Lateral Movement": "#6b85a8",
    "Collection": "#344d6e",
    "Command and Control": "#1e3a5f",
    "Exfiltration": "#080d1a",
    "Impact": "#ff3b5c"
  };
  return colors[tactic] || "#6b85a8";
}
