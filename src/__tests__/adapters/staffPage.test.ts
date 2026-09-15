import { readFileSync } from 'fs';
import { runInNewContext } from 'vm';

it.each(['code', 'state', 'error', 'error_description'])('escapes OAuth %s on the staff-tools origin', key => {
  const page = readFileSync('public/index.html', 'utf8');
  const script = page.match(/<script>([\s\S]*?)<\/script>/)![1];
  const node = { innerHTML: '' };
  const params = new URLSearchParams({ code: 'synthetic', error: key.startsWith('error') ? 'test' : '', [key]: '<img src=x onerror="alert(1)">' });
  runInNewContext(script, { URLSearchParams, window: { location: { search: '?' + params } }, document: { getElementById: () => node } });
  expect(node.innerHTML).not.toContain('<img');
  expect(node.innerHTML).toContain('&lt;img');
});
