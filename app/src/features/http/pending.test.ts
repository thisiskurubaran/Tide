import { requestSend, takeSend } from './pending';

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
