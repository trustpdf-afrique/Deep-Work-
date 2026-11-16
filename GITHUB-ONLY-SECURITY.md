# ZAKARIA AI — GitHub Pages safe configuration

## Important security limitation

GitHub Pages is a static hosting service. It can host the ZAKARIA AI interface, but it cannot
securely execute a Gemini API request on behalf of each visitor while keeping the Gemini API key
secret.

**Do not put `GEMINI_API_KEY` in `index.html`, `api-config.js`, or any public GitHub file.**
A GitHub Actions secret is safe only while the action is running; if its value is written into
the browser JavaScript, visitors can recover it.

## Current project

- Cloudflare Worker URL has been removed from the frontend.
- The frontend reads its backend URL from `api-config.js`.
- No Gemini API key is included in the repository.
- The existing Firebase files are unchanged.

## To have a real secure AI chat

You need a server-side runtime (for example a serverless function) connected to this GitHub
repository. The Gemini key must be stored as a secret on that server. GitHub Pages remains the
public website.

This is the only safe way to keep the Gemini key private for a public web app.
