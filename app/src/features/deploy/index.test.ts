// Keychain entries follow project renames and deletes, each on its own, and
// are checked against the project folders once the projects have loaded.
const mockHooks: { renamed?(from: string, to: string): Promise<void>; deleted?(project: string): Promise<void> }[] = [];
const mockProjects = { state: { projects: [] as string[], loaded: false }, listeners: new Set<(s: { projects: string[]; loaded: boolean }) => void>() };
jest.mock('../../state', () => ({
  onProjectChange: (h: (typeof mockHooks)[number]) => mockHooks.push(h),
  projectsStore: {
    getState: () => mockProjects.state,
    subscribe: (fn: (s: { projects: string[]; loaded: boolean }) => void) => {
      mockProjects.listeners.add(fn);
      return () => mockProjects.listeners.delete(fn);
    },
  },
  storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
}));
const mockSecrets = { rename: jest.fn(), remove: jest.fn(), reconcile: jest.fn() };
const mockDeployHooks = { rename: jest.fn(), remove: jest.fn(), reconcile: jest.fn() };
jest.mock('../env/store', () => ({ projectSecrets: mockSecrets }));
jest.mock('./deploy', () => ({ deployHooks: mockDeployHooks, deploy: jest.fn(), readConfig: jest.fn() }));

beforeAll(() => {
  // After the mocks above are set up (an import would run before them).
  require('./index');
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('Keychain entries per project', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('moves the deploy hook on rename even when moving the secrets fails, and the other way round', async () => {
    mockSecrets.rename.mockRejectedValueOnce(new Error('keychain locked'));
    mockDeployHooks.rename.mockResolvedValueOnce(undefined);
    await mockHooks[0].renamed!('a', 'b');
    expect(mockDeployHooks.rename).toHaveBeenCalledWith('a', 'b');

    mockSecrets.remove.mockResolvedValueOnce(undefined);
    mockDeployHooks.remove.mockRejectedValueOnce(new Error('keychain locked'));
    await expect(mockHooks[0].deleted!('b')).resolves.toBeUndefined();
    expect(mockSecrets.remove).toHaveBeenCalledWith('b');
  });

  it('checks the entries against the project folders once the projects have loaded', async () => {
    expect(mockSecrets.reconcile).not.toHaveBeenCalled();
    mockSecrets.reconcile.mockResolvedValue(undefined);
    mockDeployHooks.reconcile.mockResolvedValue(undefined);
    mockProjects.state = { projects: ['x'], loaded: true };
    for (const l of [...mockProjects.listeners]) l(mockProjects.state);
    await settle();
    expect(mockSecrets.reconcile).toHaveBeenCalledTimes(1);
    expect(mockDeployHooks.reconcile).toHaveBeenCalledTimes(1);
  });
});
