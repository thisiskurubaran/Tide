import { cancelSend, onSendRequested, PENDING_SEND_MS, requestSend, takeSend } from './pending';

describe('requests sent from links', () => {
  it('finds the request by position or name, once', () => {
    requestSend('p', 'api.http', 'create user');
    expect(takeSend('p', 'api.http', ['List users', 'Create user'])).toBe(1);
    expect(takeSend('p', 'api.http', ['List users', 'Create user'])).toBeNull();
    requestSend('p', 'api.http', '1');
    expect(takeSend('p', 'other.http', ['a'])).toBeNull();
    expect(takeSend('p', 'api.http', ['a', 'b'])).toBe(0);
    // A position past the last request sends nothing (not the last one).
    requestSend('p', 'api.http', '9');
    expect(takeSend('p', 'api.http', ['a', 'b'])).toBeNull();
    requestSend('p', 'api.http', '999');
    expect(takeSend('p', 'api.http', ['a', 'b'])).toBeNull();
    requestSend('p', 'api.http', '0');
    expect(takeSend('p', 'api.http', ['a', 'b'])).toBeNull();
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

describe('a confirmed send that waits too long', () => {
  it('expires after a short while', () => {
    requestSend('p', 'slow.http', '1', 1000);
    expect(takeSend('p', 'slow.http', ['a'], 1000 + PENDING_SEND_MS + 1)).toBeNull();
    // And it's gone, not just skipped.
    expect(takeSend('p', 'slow.http', ['a'], 1000)).toBeNull();
    requestSend('p', 'slow.http', '1', 1000);
    expect(takeSend('p', 'slow.http', ['a'], 1000 + PENDING_SEND_MS - 1)).toBe(0);
  });

  it('is dropped when the pane closes without sending it', () => {
    requestSend('p', 'closed.http', '1', 2000);
    cancelSend('p', 'closed.http', 1500);
    expect(takeSend('p', 'closed.http', ['a'], 2001)).toBeNull();
    // One asked for before that pane opened is left for the next pane.
    requestSend('p', 'closed.http', '1', 1000);
    cancelSend('p', 'closed.http', 1500);
    expect(takeSend('p', 'closed.http', ['a'], 2000)).toBe(0);
  });
});
