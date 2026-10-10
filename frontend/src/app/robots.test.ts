import { describe, expect, it } from 'vitest';

import robots from '@/app/robots';

describe('robots', () => {
  it('keeps personal result pages disallowed', () => {
    const config = robots();
    const rules = Array.isArray(config.rules) ? config.rules : [config.rules];
    for (const rule of rules) {
      expect(rule.disallow).toEqual(['/api/', '/results', '/en/results', '/tr/results']);
    }
  });
});
