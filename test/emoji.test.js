import test from 'node:test';
import assert from 'node:assert';
import { formatMessage } from '../utils.js';

test('formatMessage handles emoji', () => {
  const res = formatMessage('1.2.3.4', 'user', 'hola 😊');
  assert.strictEqual(res, '[1.2.3.4] [user]:\nhola 😊');
});
