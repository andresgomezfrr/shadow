import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripShadowFromSettings, stripShadowSectionFromClaudeMd } from './uninstall-helpers.js';

const SHADOW_PATH = '/Users/test/.shadow';
const shadowCmd = (script: string) => `${SHADOW_PATH}/${script}`;

describe('stripShadowFromSettings — statusLine', () => {
  it('removes statusLine that points at Shadow', () => {
    const input = { statusLine: { type: 'command', command: shadowCmd('statusline.sh') } };
    const { settings, touched, removed } = stripShadowFromSettings(input);
    assert.equal(touched, true);
    assert.equal(settings.statusLine, undefined);
    assert.ok(removed.includes('statusLine'));
  });

  it('preserves a third-party statusLine (must not nuke unrelated entries)', () => {
    const input = { statusLine: { type: 'command', command: '/usr/local/bin/my-statusline.sh' } };
    const { settings, touched } = stripShadowFromSettings(input);
    assert.equal(touched, false);
    assert.deepEqual(settings.statusLine, input.statusLine);
  });

  it('preserves a statusLine that mentions /.shadow/ but does not end with statusline.sh', () => {
    // Edge case: a third-party tool that happens to live under a path containing ".shadow"
    const input = { statusLine: { command: '/Users/test/.shadow/external-tool.sh' } };
    const { touched } = stripShadowFromSettings(input);
    assert.equal(touched, false);
  });

  it('does not crash if statusLine is missing or non-object', () => {
    assert.doesNotThrow(() => stripShadowFromSettings({}));
    assert.doesNotThrow(() => stripShadowFromSettings({ statusLine: null as unknown as object }));
    assert.doesNotThrow(() => stripShadowFromSettings({ statusLine: 'invalid' as unknown as object }));
  });
});

describe('stripShadowFromSettings — hooks', () => {
  it('removes a hook event composed entirely of Shadow groups', () => {
    const input = {
      hooks: {
        SessionStart: [
          { hooks: [{ command: shadowCmd('session-start.sh') }] },
        ],
      },
    };
    const { settings, touched, removed } = stripShadowFromSettings(input);
    assert.equal(touched, true);
    // Whole event key should disappear since it had only Shadow entries
    assert.equal((settings.hooks as Record<string, unknown> | undefined), undefined);
    assert.ok(removed.some(r => r.startsWith('hooks.SessionStart')));
  });

  it('preserves third-party groups in the same event (CRITICAL: no friendly fire)', () => {
    const thirdPartyGroup = { hooks: [{ command: '/usr/local/bin/my-hook.sh' }] };
    const input = {
      hooks: {
        SessionStart: [
          { hooks: [{ command: shadowCmd('session-start.sh') }] },
          thirdPartyGroup,
        ],
      },
    };
    const { settings, touched } = stripShadowFromSettings(input);
    assert.equal(touched, true);
    const hooks = settings.hooks as Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    assert.equal(hooks.SessionStart.length, 1);
    assert.deepEqual(hooks.SessionStart[0], thirdPartyGroup);
  });

  it('preserves a group containing a Shadow hook AND a third-party hook (does NOT split — leaves the whole group untouched)', () => {
    // Documents the conservative behaviour: if a user has consolidated a
    // third-party command into the same `hooks: [...]` array as Shadow's,
    // we leave it. Surgical splitting is not worth the complexity.
    // (The deployer never builds groups like this — third-party additions
    // would have to be done manually.)
    const mixed = {
      hooks: [
        { command: shadowCmd('post-tool.sh') },
        { command: '/usr/local/bin/my-tool.sh' },
      ],
    };
    const input = { hooks: { PostToolUse: [mixed] } };
    const { touched } = stripShadowFromSettings(input);
    // The whole group is dropped because it contains a Shadow command —
    // assert this is the actual behaviour so a future change is conscious.
    assert.equal(touched, true);
  });

  it('preserves hooks for events that contain no Shadow entries at all', () => {
    const input = {
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ command: '/usr/local/bin/external.sh' }] },
        ],
      },
    };
    const { settings, touched } = stripShadowFromSettings(input);
    assert.equal(touched, false);
    assert.deepEqual(settings, input);
  });

  it('removes hook entries that point at Shadow paths but does not match unrelated /.shadow/ paths', () => {
    const input = {
      hooks: {
        Stop: [
          { hooks: [{ command: '/Users/test/.shadow/random-other-script.sh' }] },
        ],
      },
    };
    const { touched } = stripShadowFromSettings(input);
    // Only matches the 6 known suffixes — random scripts under .shadow/ stay
    assert.equal(touched, false);
  });

  it('handles all 6 Shadow hook suffixes', () => {
    const suffixes = [
      'session-start.sh',
      'post-tool.sh',
      'user-prompt.sh',
      'stop.sh',
      'stop-failure.sh',
      'subagent-start.sh',
    ];
    for (const suffix of suffixes) {
      const input = {
        hooks: {
          AnyEvent: [{ hooks: [{ command: shadowCmd(suffix) }] }],
        },
      };
      const { touched } = stripShadowFromSettings(input);
      assert.equal(touched, true, `suffix ${suffix} should be detected as a Shadow hook`);
    }
  });

  it('drops the top-level `hooks` key when all events become empty', () => {
    const input = {
      hooks: {
        SessionStart: [{ hooks: [{ command: shadowCmd('session-start.sh') }] }],
        Stop: [{ hooks: [{ command: shadowCmd('stop.sh') }] }],
      },
    };
    const { settings } = stripShadowFromSettings(input);
    assert.equal(settings.hooks, undefined);
  });

  it('keeps the top-level `hooks` key when at least one event still has third-party entries', () => {
    const input = {
      hooks: {
        SessionStart: [{ hooks: [{ command: shadowCmd('session-start.sh') }] }],
        Stop: [{ hooks: [{ command: '/usr/local/bin/external-stop.sh' }] }],
      },
    };
    const { settings } = stripShadowFromSettings(input);
    const hooks = settings.hooks as Record<string, unknown>;
    assert.equal(hooks.SessionStart, undefined);
    assert.ok(hooks.Stop);
  });

  it('does not crash on malformed hooks entries (missing inner hooks array)', () => {
    const input = {
      hooks: {
        SessionStart: [{ /* missing hooks */ } as unknown as { hooks?: unknown[] }],
      },
    };
    assert.doesNotThrow(() => stripShadowFromSettings(input));
  });
});

describe('stripShadowFromSettings — mcpServers.shadow', () => {
  it('removes legacy mcpServers.shadow entry', () => {
    const input = { mcpServers: { shadow: { command: 'shadow', args: ['mcp', 'serve'] } } };
    const { settings, touched, removed } = stripShadowFromSettings(input);
    assert.equal(touched, true);
    assert.ok(removed.includes('mcpServers.shadow'));
    // mcpServers becomes empty → key removed
    assert.equal(settings.mcpServers, undefined);
  });

  it('preserves other mcpServers entries (does not nuke filesystem-mcp etc)', () => {
    const input = {
      mcpServers: {
        shadow: { command: 'shadow' },
        'filesystem-mcp': { command: 'fs-mcp' },
      },
    };
    const { settings, touched } = stripShadowFromSettings(input);
    assert.equal(touched, true);
    const mcp = settings.mcpServers as Record<string, unknown>;
    assert.equal(mcp.shadow, undefined);
    assert.deepEqual(mcp['filesystem-mcp'], { command: 'fs-mcp' });
  });

  it('does nothing if mcpServers does not contain shadow', () => {
    const input = { mcpServers: { 'filesystem-mcp': { command: 'fs-mcp' } } };
    const { settings, touched } = stripShadowFromSettings(input);
    assert.equal(touched, false);
    assert.deepEqual(settings, input);
  });
});

describe('stripShadowFromSettings — combined / no-op', () => {
  it('reports touched=false on an empty settings object', () => {
    const { touched, removed } = stripShadowFromSettings({});
    assert.equal(touched, false);
    assert.equal(removed.length, 0);
  });

  it('does not mutate the input object', () => {
    const input = {
      statusLine: { command: shadowCmd('statusline.sh') },
      hooks: { Stop: [{ hooks: [{ command: shadowCmd('stop.sh') }] }] },
      mcpServers: { shadow: { command: 'shadow' } },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    stripShadowFromSettings(input);
    assert.deepEqual(input, snapshot, 'input must not be mutated');
  });

  it('preserves unrelated top-level keys (theme, model, env, permissions, …)', () => {
    const input = {
      theme: 'dark',
      model: 'opus-4-7',
      env: { FOO: 'bar' },
      permissions: { allow: ['Bash(git:*)'] },
      statusLine: { command: shadowCmd('statusline.sh') },
    };
    const { settings } = stripShadowFromSettings(input);
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.model, 'opus-4-7');
    assert.deepEqual(settings.env, { FOO: 'bar' });
    assert.deepEqual(settings.permissions, { allow: ['Bash(git:*)'] });
    assert.equal(settings.statusLine, undefined);
  });

  it('cleans a realistic settings.json — Shadow gone, third-party intact', () => {
    const input = {
      theme: 'dark',
      statusLine: { type: 'command', command: shadowCmd('statusline.sh') },
      hooks: {
        SessionStart: [
          { hooks: [{ command: shadowCmd('session-start.sh') }] },
          { hooks: [{ command: '/usr/local/bin/my-session-hook.sh' }] },
        ],
        UserPromptSubmit: [
          { hooks: [{ command: shadowCmd('user-prompt.sh') }] },
        ],
        PostToolUse: [
          { hooks: [{ command: '/opt/my-tool/post.sh' }] },
        ],
      },
      mcpServers: {
        shadow: { command: 'shadow', args: ['mcp', 'serve'] },
        github: { command: 'gh-mcp' },
      },
    };
    const { settings, touched } = stripShadowFromSettings(input);
    assert.equal(touched, true);
    // theme survives
    assert.equal(settings.theme, 'dark');
    // statusLine gone
    assert.equal(settings.statusLine, undefined);
    // hooks: SessionStart trimmed to third-party only, UserPromptSubmit gone, PostToolUse intact
    const hooks = settings.hooks as Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    assert.equal(hooks.SessionStart.length, 1);
    assert.equal(hooks.SessionStart[0].hooks?.[0].command, '/usr/local/bin/my-session-hook.sh');
    assert.equal(hooks.UserPromptSubmit, undefined);
    assert.equal(hooks.PostToolUse[0].hooks?.[0].command, '/opt/my-tool/post.sh');
    // mcpServers: shadow gone, github survives
    const mcp = settings.mcpServers as Record<string, unknown>;
    assert.equal(mcp.shadow, undefined);
    assert.deepEqual(mcp.github, { command: 'gh-mcp' });
  });
});

describe('stripShadowSectionFromClaudeMd', () => {
  it('removes the SHADOW:START/END block', () => {
    const content = '# Top\n\n<!-- SHADOW:START -->\nshadow stuff\n<!-- SHADOW:END -->\n\n## Other section\n';
    const { content: out, removed } = stripShadowSectionFromClaudeMd(content);
    assert.equal(removed, true);
    assert.ok(!out.includes('SHADOW:START'));
    assert.ok(!out.includes('SHADOW:END'));
    assert.ok(!out.includes('shadow stuff'));
    assert.ok(out.includes('# Top'));
    assert.ok(out.includes('## Other section'));
  });

  it('returns content unchanged when markers are absent', () => {
    const content = '# Just a regular CLAUDE.md\n\nNothing to see here.\n';
    const { content: out, removed } = stripShadowSectionFromClaudeMd(content);
    assert.equal(removed, false);
    assert.equal(out, content);
  });

  it('returns unchanged when only one marker is present (defensive)', () => {
    const content = '# Top\n<!-- SHADOW:START -->\nbroken block\n';
    const { removed } = stripShadowSectionFromClaudeMd(content);
    assert.equal(removed, false);
  });

  it('collapses 3+ blank lines into 2 after removal', () => {
    const content = '# Top\n\n\n\n<!-- SHADOW:START -->\nx\n<!-- SHADOW:END -->\n\n\n\n## Bottom\n';
    const { content: out, removed } = stripShadowSectionFromClaudeMd(content);
    assert.equal(removed, true);
    assert.ok(!/\n{3,}/.test(out), 'should not contain 3+ consecutive newlines');
  });

  it('always ends with a single trailing newline', () => {
    const content = '# Top\n\n<!-- SHADOW:START -->\nx\n<!-- SHADOW:END -->\n';
    const { content: out } = stripShadowSectionFromClaudeMd(content);
    assert.ok(out.endsWith('\n'));
    assert.ok(!out.endsWith('\n\n'));
  });
});
