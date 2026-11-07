import { onSendRequested, requestSend, takeSend } from './pending';

describe('requests sent from links', () => {
  it('finds the request by position or name, once', () => {
    requestSend('p', 'api.http', 'create user');
    expect(takeSend('p', 'api.http', ['List users', 'Create user'])).toBe(1);
    expect(takeSend('p', 'api.http', ['List users', 'Create user'])).toBeNull();
    requestSend('p', 'api.http', '1');
    expect(takeSend('p', 'other.http', ['a'])).toBeNull();
    expect(takeSend('p', 'api.http', ['a', 'b'])).toBe(0);
    requestSend('p', 'api.http', '9');
    expect(takeSend('p', 'api.http', ['a', 'b'])).toBe(1);
  });

  it('waits until the file has requests', () => {
    requestSend('p', 'new.http', '1');
    expect(takeSend('p', 'new.http', [])).toBeNull();
    expect(takeSend('p', 'new.http', ['a'])).toBe(0);
  });
});

describe('a send asked for while the pane is open', () => {
  it('tells the open pane', () => {
    const heard: string[] = [];
    const off = onSendRequested((p, f) => heard.push(`${p}/${f}`));
    requestSend('demo', 'later.http', '1');
    off();
    requestSend('demo', 'other.http', '1');
    expect(heard).toEqual(['demo/later.http']);
    expect(takeSend('demo', 'later.http', ['a'])).toBe(0);
  });
});
