import { describe, expect, it } from 'vitest';

import { buildSiteJsonLd } from './site-schema';

type GraphNode = { '@type': string; url?: string };

describe('site JSON-LD', () => {
  it('points WebSite, Organization, and WebApplication at /', () => {
    const graph = buildSiteJsonLd('en')['@graph'] as GraphNode[];
    const website = graph.find((node) => node['@type'] === 'WebSite');
    const organization = graph.find((node) => node['@type'] === 'Organization');
    const webApp = graph.find((node) => node['@type'] === 'WebApplication');

    expect(website?.url).toBe('https://movieswrapped.com/');
    expect(organization?.url).toBe('https://movieswrapped.com/');
    expect(webApp?.url).toBe('https://movieswrapped.com/');
    expect(JSON.stringify(graph)).not.toContain('https://movieswrapped.com/en');
  });

  it('keeps the same site URLs on the Turkish page', () => {
    const graph = buildSiteJsonLd('tr')['@graph'] as GraphNode[];
    const website = graph.find((node) => node['@type'] === 'WebSite');
    expect(website?.url).toBe('https://movieswrapped.com/');
  });
});
