import { describe, expect, it } from 'vitest';
import { patchBinding, providerObject, runtimeProfiles } from '../../../ui/src/lib/provider-settings.js';

describe('provider editor mutations', () => {
  it('changes one identity mapping without losing unrelated agents or opaque configuration', () => {
    const original = { provider: { type: 'github-app/v1', agents: { engineer: { appId: 123, privateKeySecret: 'OLD', subject: 'worker' }, reviewer: { subject: 'reviewer' } }, plugin: { list: ['a', 'b'] } }, 'x-policy': { retain: true } };
    const next = patchBinding(original, 'agents.engineer.privateKeySecret', 'NEW');
    expect(next).toMatchObject({ provider: { agents: { engineer: { appId: 123, privateKeySecret: 'NEW' }, reviewer: { subject: 'reviewer' } }, plugin: { list: ['a', 'b'] } }, 'x-policy': { retain: true } });
    expect(original.provider.agents.engineer.privateKeySecret).toBe('OLD');
  });
  it('expands shorthand without discarding binding extensions', () => {
    const next = patchBinding({ provider: 'modal/v1', 'x-policy': 1 }, 'image', 'example/worker');
    expect(next).toEqual({ provider: { type: 'modal/v1', image: 'example/worker' }, 'x-policy': 1 });
    expect(providerObject(patchBinding(next, 'image', '').provider)).toEqual({ type: 'modal/v1' });
  });
  it('rejects prototype mutation paths', () => {
    expect(() => patchBinding(undefined, '__proto__.polluted', true)).toThrow('Invalid configuration key');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('rejects invalid runtime drafts before editor state changes', () => {
    for (const bad of [null, [], { bad: null }, { bad: 'codex' }, { bad: { protocol: 'codex' } }, { bad: { protocol: 'codex/v1', args: [1] } }, { bad: { protocol: 'codex/v1', command: '/bin/codex' } }]) expect(() => runtimeProfiles(bad)).toThrow();
    const valid = { codex: { protocol: 'codex-app-server/v1', command: 'codex', args: ['--config', 'value'], 'x-extra': { opaque: true } } };
    expect(runtimeProfiles(valid)).toEqual(valid);
  });
});
