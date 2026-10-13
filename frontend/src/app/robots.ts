import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/seo';

// Source of truth for /robots.txt (no public/robots.txt copy).
// Static export requires explicitly static data routes.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = SITE_URL;

  // Personal results pages must never be indexed — they contain a user's
  // private Letterboxd analysis. The rest of the site is open to everyone,
  // including AI answer-engine crawlers (AEO).
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/results', '/en/results', '/tr/results'],
      },
      // AI answer-engine / LLM crawlers — explicit allow (AEO). Results
      // pages stay disallowed for them too.
      // GrokBot and xAI-SearchBot are the tokens public crawler registries
      // report for xAI. As of 2026-10-12 xAI had not published an official
      // crawler user-agent, so these two lines are a request, not a contract.
      {
        userAgent: ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'CCBot', 'cohere-ai', 'meta-externalagent', 'Bytespider', 'Applebot-Extended', 'Amazonbot', 'DuckAssistBot', 'YouBot', 'Googlebot', 'Bingbot', 'GrokBot', 'xAI-SearchBot'],
        allow: '/',
        disallow: ['/api/', '/results', '/en/results', '/tr/results'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
