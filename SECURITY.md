# Security Policy

OptiMasir is a static client-side web application. It has no user accounts, database, backend secrets, or server-side storage of routing scenarios.

## Reporting a vulnerability

Please report security issues privately to the project author through:

- https://www.linkedin.com/in/hossein-karimi-8a452153/

Do not include sensitive third-party data in a public GitHub issue.

## Deployment notes

- Keep the `vercel.json` security headers enabled.
- Keep third-party library versions pinned.
- Review CSP whenever a new external service is added.
- Test the deployed domain with browser developer tools and a reputable security-header scanner after every material change.
- For high-traffic production usage, replace public demo routing services with infrastructure you control and monitor.
