// Tiny robots.txt evaluator (groups for our UA and "*", Allow/Disallow, "*" and "$").

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === 'allow' || key === 'disallow')) current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  return groups;
}

function toRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** Longest matching rule wins; Allow wins ties. Empty Disallow allows everything. */
export function isAllowed(groups, userAgent, pathWithQuery) {
  const ua = String(userAgent).toLowerCase();
  const token = ua.split(/[/\s]/)[0];
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  let best = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (!rule.path) continue;
    if (!toRegex(rule.path).test(pathWithQuery)) continue;
    const len = rule.path.length;
    if (!best || len > best.len || (len === best.len && rule.allow)) best = { len, allow: rule.allow };
  }
  return best ? best.allow : true;
}
