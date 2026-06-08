# SouthyBot Netlify Deployment

Deploy this folder to Netlify as the site root.

## Netlify Settings

```text
Build command: leave empty
Publish directory: .
Functions directory: netlify/functions
```

Add this environment variable:

```text
SOUTHYBOT_SESSION_SECRET=choose-a-long-random-secret
```

After deployment, test:

```text
https://your-site.netlify.app/
https://your-site.netlify.app/api/health
https://your-site.netlify.app/api/knowledge-base
https://your-site.netlify.app/knowledge-base.json
```

The website uses Netlify Functions for `/api/knowledge-base`, `/api/login`, `/api/session`, and `/api/logout`.
If Netlify Functions are not included in a manual deploy, SouthyBot will still load answers from `/knowledge-base.json`.
