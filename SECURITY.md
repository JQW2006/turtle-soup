# 安全策略 · Security Policy

如果你发现了安全问题（例如 API Key 泄露、绕过访问口令），请**不要**公开提 Issue，而是通过 GitHub 的 [Private vulnerability reporting](../../security/advisories/new) 私下报告。我们会尽快回复。

If you find a security issue (for example a way to leak the API key or bypass the access token), please **do not** open a public issue. Report it privately through GitHub's [private vulnerability reporting](../../security/advisories/new).

## 部署建议 · Deployment notes

- 公网部署时请设置 `APP_ACCESS_TOKEN`，或至少设置 `SETTINGS_LOCKED=true`，否则访客可以替换 API Key 或把 Base URL 指向自己的服务器。
- When exposing the app to the internet, set `APP_ACCESS_TOKEN`, or at least `SETTINGS_LOCKED=true`; otherwise visitors could replace your API key or redirect requests (and your key) to their own server.
- 不要提交 `.env` 和 `data/` 目录（已在 `.gitignore` 中忽略）。 / Never commit `.env` or `data/` (both are git-ignored).
