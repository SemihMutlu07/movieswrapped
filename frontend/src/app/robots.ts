import type { MetadataRoute } from 'next';

import { SITE_ORIGIN } from '@/i18n/site';

// Static export requires explicitly static data routes.
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
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
      {
        userAgent: ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'CCBot', 'cohere-ai', 'meta-externalagent', 'Bytespider', 'Applebot-Extended', 'Amazonbot', 'DuckAssistBot', 'YouBot', 'Googlebot', 'Bingbot'],
        allow: '/',
        disallow: ['/api/', '/results', '/en/results', '/tr/results'],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
