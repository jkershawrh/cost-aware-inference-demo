import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const violations = []
const sensitiveName = /(^|\/)(\.env|[^/]*kubeconfig[^/]*|secret\.ya?ml|id_(rsa|ed25519)|[^/]*\.(pem|key))$/i
const contentRules = [
  ['workstation path', /\/Users\/[A-Za-z0-9._-]+\/(Documents|Downloads|Desktop)\//],
  ['named test-cluster domain', /fm2aihpcsed\.com/i],
  ['cluster-admin identity', /\bkubeadmin\b|client-key-data:/i],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['embedded bearer token', /Authorization:\s*Bearer\s+[A-Za-z0-9._~-]{15,}/i],
]

for (const file of files) {
  if (file === 'scripts/check-public-repo.mjs') continue
  if (sensitiveName.test(file) && !file.endsWith('.example')) violations.push(`${file}: sensitive filename`)
  if (/\.(png|jpg|jpeg|gif|woff2?|otf|ttf)$/i.test(file)) continue
  const content = readFileSync(file, 'utf8')
  for (const [label, pattern] of contentRules) {
    if (pattern.test(content)) violations.push(`${file}: ${label}`)
  }
  if (/\.env(?:\.|$)/i.test(file) && /(?:API_KEY|PASSWORD|TOKEN)[ \t]*=[ \t]*(?!$|example|placeholder|changeme)[^\s#]{8,}/im.test(content)) {
    violations.push(`${file}: embedded credential`)
  }
  if (/\.ya?ml$/i.test(file) && /(?:password|api[_-]?key|token):[ \t]*(?!$|example|placeholder|changeme)[^\s#]{8,}/im.test(content)) {
    violations.push(`${file}: embedded credential`)
  }
}

if (violations.length) {
  console.error('Public repository boundary check failed:')
  for (const violation of [...new Set(violations)]) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(`Public repository boundary verified across ${files.length} tracked files.`)
