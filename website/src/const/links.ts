// Canonical external links, centralized so the repo slug and docs domain can't
// drift across pages. The operator guide and the GitHub icon previously pointed at
// a private, non-existent PuppetCopy/monorepo repo; the public submodule that holds
// operator/README.md is PuppetCopy/puppet.fund (see .gitmodules).
export const GITHUB_REPO_URL = 'https://github.com/PuppetCopy/puppet.fund'
export const OPERATOR_GUIDE_URL = `${GITHUB_REPO_URL}/blob/main/operator/README.md`
export const DOCS_URL = 'https://docs.puppet.fund'
